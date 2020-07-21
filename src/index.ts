import { startup, ShutdownOptions } from '@secoya/shutdown-manager';
import { docopt } from 'docopt';
import * as express from 'express';
import opentracingMiddleware from 'express-opentracing';
import { createServer } from 'http';
import { globalTracer, Span } from 'opentracing';
import * as sourceMapSupport from 'source-map-support';
import { setupListener as setupApiListener } from './api';
import { loadConfig, maskSensitiveConfig } from './config';
import { initializeContext } from './context';
import { setupCleanup } from './grafana/cache';
import { log, setLogFormat, setLogLevel, LogFormat, LogLevel } from './log';
import { setupMetrics } from './metrics';
import { setupListeners as setupSlackListeners } from './slack';
import { newSpan, setupTracing, TraceContext } from './tracing';
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

async function main(shutdown: ShutdownOptions) {
	const params: Parameters = docopt(doc, {});
	if (params['--log-level'] !== null && !(params['--log-level'] in LogLevel)) {
		throw new Error(`LEVEL must be one of ${Object.keys(LogLevel)}`);
	}
	if (params['--log-format'] !== null && !(params['--log-format'] in LogFormat)) {
		throw new Error(`FORMAT must be one of ${Object.keys(LogFormat)}`);
	}
	const config = await loadConfig(params['--config']);
	setLogLevel(params['--log-level'] !== null ? params['--log-level'] : config.logLevel);
	setLogFormat(params['--log-format'] !== null ? params['--log-format'] : config.logFormat);
	log.debug(`Configuration loaded: ${JSON.stringify(maskSensitiveConfig(config), null, 2)}`);

	setupTracing(shutdown, 'grafana-unfurl', log, log.level === LogLevel.DEBUG);
	await newSpan(async function initialize({ span }: TraceContext) {
		await setupMetrics();
		const app = express();
		app.use(filteredMiddleware({ exclude: ['/assets'] }, opentracingMiddleware({ tracer: globalTracer() })));
		const server = createServer(app);
		await new Promise<void>((resolve) => {
			server.listen(3000, () => {
				shutdown.handlers.push(server.close.bind(server));
				resolve();
			});
		});
		const initContext = initializeContext({ config, app, server, shutdown, span });
		app.use(filteredMiddleware({ exclude: ['/assets'] }, initContext.requestContextMiddleware));
		await Promise.all(
			[setupCleanup, setupSlackListeners, setupApiListener].map((fn) => initContext.childSpan(fn)()),
		);
		log.info('startup complete');
	})();
}

startup(main, log);
