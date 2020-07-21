import { ShutdownOptions } from '@secoya/shutdown-manager';
import { assertHasSpan, createTraceContext, newSpan, TraceContext } from '@secoya/tracing-helpers';
import { WebClient as SlackClient } from '@slack/web-api';
import * as S3 from 'aws-sdk/clients/s3';
import * as express from 'express';
import { NextFunction, Request, RequestHandler, Response } from 'express';
import { Server } from 'http';
import { Span } from 'opentracing';
import { Config } from './config';

export interface ConfigContext {
	readonly config: Config;
}

export interface SlackContext {
	readonly slack: SlackClient;
}
function createSlackContext({ slack: { botToken } }: Config): SlackContext {
	return { slack: new SlackClient(botToken) };
}

export interface S3Context {
	readonly s3: S3;
	readonly s3UrlSigning: S3;
}

export interface RuntimeContext extends ConfigContext, SlackContext, S3Context, TraceContext {}

export interface InitializationContext extends ConfigContext, TraceContext {
	readonly app: express.Express;
	readonly server: Server;
	readonly shutdown: ShutdownOptions;
	readonly requestContextMiddleware: RequestHandler;
	readonly invokeWithIntervalContext: (fn: (context: IntervalContext) => Promise<void>) => Promise<void>;
}

export function initializeContext({
	config,
	app,
	server,
	shutdown,
	span,
}: {
	config: Config;
	app: express.Express;
	server: Server;
	shutdown: ShutdownOptions;
	span: Span;
}): InitializationContext {
	const s3 = new S3({
		accessKeyId: config.s3.accessKeyId,
		secretAccessKey: config.s3.secretAccessKey,
	});
	const s3UrlSigning = new S3({
		accessKeyId: config.s3.urlSigning.accessKeyId,
		secretAccessKey: config.s3.urlSigning.secretAccessKey,
	});
	return createInitContext({
		config,
		...createSlackContext(config),
		app,
		server,
		s3,
		s3UrlSigning,
		shutdown,
		span,
	});
}

function createInitContext(
	setupContext: ConfigContext &
		SlackContext &
		S3Context & {
			app: express.Express;
			server: Server;
			shutdown: ShutdownOptions;
			span: Span;
		},
): InitializationContext {
	const createContext = (child: Span) => createInitContext({ ...setupContext, span: child });
	const { span } = setupContext;
	const initializationContext = {
		...setupContext,
		...createTraceContext(span, createContext),
	};
	return Object.assign(
		initializationContext,
		createInvokeWithIntervalContext(initializationContext),
		createRequestContextMiddleware(initializationContext),
	);
}

export interface IntervalContext extends ConfigContext, SlackContext, S3Context, TraceContext {}

function createIntervalContext(parentContext: ConfigContext & SlackContext & S3Context, span: Span): IntervalContext {
	const createContext = (child: Span) => createIntervalContext(parentContext, child);
	return {
		...parentContext,
		...createTraceContext(span, createContext),
	};
}

function createInvokeWithIntervalContext(parentContext: ConfigContext & SlackContext & S3Context) {
	return {
		invokeWithIntervalContext: (jobFn: (context: IntervalContext) => Promise<void>): Promise<void> =>
			newSpan(
				({ span }: TraceContext) => jobFn(createIntervalContext(parentContext, span)),
				`interval: ${jobFn.name}`,
			)(),
	};
}

export interface RequestContext extends ConfigContext, SlackContext, S3Context, TraceContext {}

function createRequestContext(parentContext: ConfigContext & SlackContext & S3Context, span: Span): RequestContext {
	const createContext = (child: Span) => createRequestContext(parentContext, child);
	return {
		...parentContext,
		...createTraceContext(span, createContext),
	};
}

function createRequestContextMiddleware(
	parentContext: ConfigContext & SlackContext & S3Context,
): { requestContextMiddleware: RequestHandler } {
	return {
		requestContextMiddleware: (req: Request, _res: Response, next: NextFunction) => {
			assertHasSpan(req);
			req.context = createRequestContext(parentContext, req.span);
			next();
		},
	};
}

export function assertHasRequestContext(obj: { context?: any }): asserts obj is { context: RuntimeContext } {
	if (!obj.context) {
		throw new Error('Key `context` not found on object');
	} else {
		if (!obj.context.span) {
			throw new Error('Key `context` is not a RuntimeContext');
		}
	}
}
