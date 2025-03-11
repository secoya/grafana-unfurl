import { pathFilteredMiddleware, setupExpressApp } from '@secoya/context-helpers/express';
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
}

const doc = `Grafana Unfurler for Slack
Usage:
  grafana-unfurl [options]

Options:
	-c --config=PATH     Path to the config file [default: config.yaml]`;
const params: Parameters = docopt(doc, {});

startup(
	{
		processTitle: 'grafana-unfurl',
	},
	async (startupContext) => {
		const { rootLog, tracer } = startupContext;
		const { config } = await loadConfig(params['--config']);
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
