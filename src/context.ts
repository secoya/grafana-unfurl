import { Logger, LogContext } from '@secoya/log-helpers';
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

export interface InitializationContext extends ConfigContext, TraceContext, LogContext {
	readonly app: express.Express;
	readonly server: Server;
	readonly shutdown: ShutdownOptions;
	readonly rootLog: Logger;
	readonly requestContextMiddleware: RequestHandler;
	readonly invokeWithIntervalContext: (fn: (context: IntervalContext) => Promise<void>) => Promise<void>;
}

export function initializeContext(init: {
	config: Config;
	app: express.Express;
	server: Server;
	shutdown: ShutdownOptions;
	rootLog: Logger;
	log: Logger;
	span: Span;
}): InitializationContext {
	return createInitContext({
		config: init.config,
		...createSlackContext(init.config),
		app: init.app,
		server: init.server,
		s3: new S3({
			accessKeyId: init.config.s3.accessKeyId,
			secretAccessKey: init.config.s3.secretAccessKey,
		}),
		s3UrlSigning: new S3({
			accessKeyId: init.config.s3.urlSigning.accessKeyId,
			secretAccessKey: init.config.s3.urlSigning.secretAccessKey,
		}),
		shutdown: init.shutdown,
		rootLog: init.rootLog,
		log: init.log,
		span: init.span,
	});
}

interface SetupContext extends ConfigContext, SlackContext, S3Context, LogContext {
	app: express.Express;
	server: Server;
	shutdown: ShutdownOptions;
	rootLog: Logger;
	span: Span;
}
function createInitContext(setupContext: SetupContext): InitializationContext {
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

export interface RuntimeContext extends ConfigContext, SlackContext, S3Context, TraceContext, LogContext {}

export interface IntervalContext extends ConfigContext, SlackContext, S3Context, TraceContext, LogContext {}
function createIntervalContext(setupContext: SetupContext & SlackContext & S3Context, span: Span): IntervalContext {
	const createContext = (child: Span) => createIntervalContext(setupContext, child);
	return {
		...setupContext,
		...createTraceContext(span, createContext),
	};
}
function createInvokeWithIntervalContext(setupContext: SetupContext) {
	return {
		invokeWithIntervalContext: (jobFn: (context: IntervalContext) => Promise<void>): Promise<void> =>
			newSpan(
				({ span }: TraceContext) => jobFn(createIntervalContext(setupContext, span)),
				`interval: ${jobFn.name}`,
			)(),
	};
}

export interface RequestContext extends ConfigContext, SlackContext, S3Context, TraceContext, LogContext {}
function createRequestContext(setupContext: SetupContext, span: Span): RequestContext {
	const createContext = (child: Span) => createRequestContext(setupContext, child);
	return {
		...setupContext,
		...createTraceContext(span, createContext),
	};
}
function createRequestContextMiddleware(setupContext: SetupContext): { requestContextMiddleware: RequestHandler } {
	return {
		requestContextMiddleware: (req: Request, _res: Response, next: NextFunction) => {
			assertHasSpan(req);
			req.context = createRequestContext(setupContext, req.span);
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
