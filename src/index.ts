import { pathFilteredMiddleware, setupExpressApp } from '@secoya/context-helpers/express';
import { setLogFormat, setLogLevel, LogFormat, LogLevel } from '@secoya/context-helpers/log';
import { startup } from '@secoya/context-helpers/startup';
import { docopt } from 'docopt';
import opentracingMiddleware from 'express-opentracing';
import * as sourceMapSupport from 'source-map-support';
import { setupListener as setupApiListener } from './api';
import { loadConfig, maskSensitiveConfig } from './config';
import { createS3Context, createSlackContext, initializeContext } from './context';
import { setupCleanup } from './grafana/cache';
import { setupListeners as setupSlackListeners } from './slack';

sourceMapSupport.install();

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
const params: Parameters = docopt(doc, {});
if (params['--log-level'] !== null && !(params['--log-level'] in LogLevel)) {
	throw new Error(`LEVEL must be one of ${Object.keys(LogLevel)}`);
}
if (params['--log-format'] !== null && !(params['--log-format'] in LogFormat)) {
	throw new Error(`FORMAT must be one of ${Object.keys(LogFormat)}`);
}

startup(
	{
		processTitle: 'grafana-unfurl',
		logFormat: params['--log-format'] || undefined,
		logLevel: params['--log-level'] || undefined,
	},
	async (startupContext) => {
		const { rootLog, tracer } = startupContext;
		const config = await loadConfig(params['--config']);
		if (!params['--log-level']) {
			setLogLevel(startupContext, config.logLevel);
		}
		if (!params['--log-format']) {
			setLogFormat(startupContext, config.logFormat);
		}
		rootLog.debug(`Configuration loaded: ${JSON.stringify(maskSensitiveConfig(config), null, 2)}`);

		const initContext = initializeContext({
			config,
			...(await setupExpressApp(startupContext)),
			...createS3Context({ config }),
			...createSlackContext({ config }),
			...startupContext,
		});
		initContext.express.use(pathFilteredMiddleware({ exclude: ['/assets'] }, opentracingMiddleware({ tracer })));
		initContext.express.use(pathFilteredMiddleware({ exclude: ['/assets'] }, initContext.requestContextMiddleware));
		await Promise.all(
			[setupCleanup, setupSlackListeners, setupApiListener].map((fn) => initContext.childSpan(fn)()),
		);
	},
);
