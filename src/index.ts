import {
	newRuntimeContextFactory,
	newStartupContextFactory,
	newUntracedContextFactory,
	pluckKeys,
	RuntimeContextFor,
	StartupContextFor,
	UntracedContextFor,
} from '@secoya/context-helpers/assignment.js';
import { ConfigContext } from '@secoya/context-helpers/config.js';
import { pathFilteredMiddleware, setupExpressContext } from '@secoya/context-helpers/express.js';
import { assertIsLogContext } from '@secoya/context-helpers/log.js';
import { BaseContextFor, checkStartupOptions, RootContextFor, startup } from '@secoya/context-helpers/startup.js';
import { assertIsTraceContext } from '@secoya/context-helpers/trace.js';
import * as docopt from 'docopt';
import { setupListener as setupApiListener } from 'src/api.js';
import { Config, loadConfig, maskSensitiveConfig } from 'src/config.js';
import { createS3Context, createSlackContext, S3Context, SlackContext } from 'src/context.js';
import { setupCleanup } from 'src/grafana/cache.js';
import { setupListeners as setupSlackListeners } from 'src/slack.js';

export const startupOptions = checkStartupOptions({
	serviceName: 'grafana-unfurl',
	metricsEnabled: true,
	probesEnabled: true,
	tracingEnabled: true,
});

export type BaseContext = BaseContextFor<typeof setupBaseContext>;
export interface Context
	extends RuntimeContextFor<BaseContext, Context>,
		ConfigContext<Config>,
		S3Context,
		SlackContext {}
export interface UntracedContext extends UntracedContextFor<BaseContext, UntracedContext, Context> {}
export interface StartupContext
	extends StartupContextFor<BaseContext, StartupContext, Context, UntracedContext>,
		ConfigContext<Config> {}

interface DocoptParams {
	'--config': string;
}

const DOC = `Grafana Unfurler for Slack
Usage:
  grafana-unfurl [options]

Options:
	-c --config=PATH     Path to the config file [default: config.yaml]`;

export async function setupBaseContext(rootContext: RootContextFor<typeof startupOptions>) {
	const params: DocoptParams = docopt.docopt(DOC, { exit: false });
	const expressContext = await setupExpressContext(rootContext);
	const configContext = await loadConfig(params['--config']);
	rootContext.log.debug(
		`Configuration loaded: ${JSON.stringify(maskSensitiveConfig(configContext.config), null, 2)}`,
	);
	return {
		...configContext,
		...rootContext,
		...expressContext,
		...createS3Context(configContext),
		...createSlackContext(configContext),
	};
}

startup(startupOptions, async (rootContext) => {
	const baseContext = await setupBaseContext(rootContext);
	const createRuntimeContext = newRuntimeContextFactory(baseContext).add(
		pluckKeys('s3', 's3UrlSigning', 'slack'),
	).create;
	const startupContext: StartupContext = newStartupContextFactory(
		baseContext,
		createRuntimeContext,
		newUntracedContextFactory(baseContext, createRuntimeContext).create,
	).create();
	const { express, requestContextMiddleware, trace } = startupContext;

	express.use(pathFilteredMiddleware({ exclude: ['/assets'] }, requestContextMiddleware));
	await Promise.all([setupCleanup, setupSlackListeners, setupApiListener].map((fn) => trace(fn)));
});

export function assertIsContext(obj: any): asserts obj is Context {
	assertIsTraceContext(obj);
	assertIsLogContext(obj);
}

export function assertHasContext<T extends any>(obj: T): asserts obj is T & { context: Context } {
	assertIsContext((obj as any).context);
}
