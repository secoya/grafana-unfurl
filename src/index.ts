import {
	createLogContext,
	createRootLogger,
	setLogFormat,
	setLogLevel,
	LogFormat,
	LogLevel,
} from '@secoya/log-helpers';
import { setupMetrics } from '@secoya/metrics-helpers';
import { setupKubernetesProbeResponders } from '@secoya/probes-helpers';
import { startup, ShutdownOptions } from '@secoya/shutdown-manager';
import { newSpan, setupTracing, TraceContext } from '@secoya/tracing-helpers';
import { docopt } from 'docopt';
import * as express from 'express';
import opentracingMiddleware from 'express-opentracing';
import { createServer } from 'http';
import { globalTracer } from 'opentracing';
import * as sourceMapSupport from 'source-map-support';
import { setupListener as setupApiListener } from './api';
import { loadConfig, maskSensitiveConfig } from './config';
import { initializeContext } from './context';
import { setupCleanup } from './grafana/cache';
import { setupListeners as setupSlackListeners } from './slack';
import { filteredMiddleware } from './utils';

sourceMapSupport.install();

process.title = 'grafana-unfurl';

interface Parameters {
	'--config': string;
	'--log-format': LogFormat | null;
	'--log-level': LogLevel | null;
}

const doc = `Grafana Unfurler for Slack
Usage:
  grafana-unfurl [options]

Options:
	-c --config=PATH     Path to the config file [default: config.yaml]
  --log-level=LEVEL    Set log level (default: info)
                       Valid levels are ${Object.keys(LogLevel)}
  --log-format=FORMAT  Set log format (${Object.keys(LogFormat)}) (default: json)`;

const rootLog = createRootLogger();
async function main(shutdown: ShutdownOptions) {
	const params: Parameters = docopt(doc, {});
	if (params['--log-level'] !== null && !(params['--log-level'] in LogLevel)) {
		throw new Error(`LEVEL must be one of ${Object.keys(LogLevel)}`);
	}
	if (params['--log-format'] !== null && !(params['--log-format'] in LogFormat)) {
		throw new Error(`FORMAT must be one of ${Object.keys(LogFormat)}`);
	}
	const config = await loadConfig(params['--config']);
	setLogLevel(rootLog, params['--log-level'] !== null ? params['--log-level'] : config.logLevel);
	setLogFormat(rootLog, params['--log-format'] !== null ? params['--log-format'] : config.logFormat);
	rootLog.debug(`Configuration loaded: ${JSON.stringify(maskSensitiveConfig(config), null, 2)}`);

	setupTracing(shutdown, 'grafana-unfurl', rootLog);
	await newSpan(async function initialize({ span }: TraceContext) {
		const { healthy, ready } = await setupKubernetesProbeResponders(shutdown);
		healthy(true);
		await setupMetrics(shutdown, 'grafana-unfurl');
		const { log } = createLogContext(rootLog, span);
		const app = express();
		app.use(filteredMiddleware({ exclude: ['/assets'] }, opentracingMiddleware({ tracer: globalTracer() })));
		const server = createServer(app);
		await new Promise<void>((resolve) => {
			server.listen(3000, () => {
				shutdown.handlers.push(server.close.bind(server));
				resolve();
			});
		});
		const initContext = initializeContext({ config, app, server, shutdown, span, rootLog, log });
		app.use(filteredMiddleware({ exclude: ['/assets'] }, initContext.requestContextMiddleware));
		await Promise.all(
			[setupCleanup, setupSlackListeners, setupApiListener].map((fn) => initContext.childSpan(fn)()),
		);
		ready(true);
		log.info('startup complete');
	})();
}

startup(main, rootLog);
