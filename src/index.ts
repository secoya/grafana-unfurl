import { startup, ShutdownOptions } from '@secoya/shutdown-manager';
import { docopt } from 'docopt';
import * as express from 'express';
import { createServer } from 'http';
import * as sourceMapSupport from 'source-map-support';
import { setupListener as setupApiListener } from './api';
import { loadConfig, maskSensitiveConfig } from './config';
import { Context } from './context';
import { setupCleanup } from './grafana/cache';
import { log, setLogFormat, setLogLevel, LogFormat, LogLevel } from './log';
import { setupMetrics } from './metrics';
import { setupListeners as setupSlackListeners } from './slack';

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

	await setupMetrics();
	const app = express();
	const server = createServer(app);
	await new Promise<void>((resolve) => {
		server.listen(3000, () => {
			shutdown.handlers.push(server.close.bind(server));
			resolve();
		});
	});
	const context = new Context(config);

	setupCleanup(context, shutdown);
	setupSlackListeners(context, app);
	setupApiListener(context, app);
	log.info('startup complete');
}

startup(main, log);
