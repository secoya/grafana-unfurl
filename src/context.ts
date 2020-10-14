import { ConfigContext } from '@secoya/context-helpers/config';
import {
	createRequestContextMiddleware,
	ExpressContext,
	RequestContextMiddlewareContext,
} from '@secoya/context-helpers/express';
import { assertIsLogContext, createLogContext, LogContext, RootLogContext } from '@secoya/context-helpers/log';
import { ShutdownHandlingContext } from '@secoya/context-helpers/shutdown';
import { StartupBaseContext } from '@secoya/context-helpers/startup';
import {
	assertIsTraceContext,
	createTraceContext,
	createTraceContextSpawnerContext,
	SpanContext,
	TracerContext,
	TraceContext,
	TraceContextSpawnerContext,
} from '@secoya/context-helpers/trace';
import { WebClient as SlackClient } from '@slack/web-api';
import * as S3 from 'aws-sdk/clients/s3';
import { Span } from 'opentracing';
import { Config } from './config';

type CommonContext = ConfigContext<Config> & S3Context & SlackContext & LogContext;

export type SetupContext = CommonContext & StartupBaseContext & TracerContext & SpanContext & ExpressContext;

export type InitializationContext = CommonContext &
	RootLogContext &
	ShutdownHandlingContext &
	ExpressContext &
	RequestContextMiddlewareContext &
	TraceContext<InitializationContext> &
	TraceContextSpawnerContext<Context>;

export type Context = CommonContext & TraceContext<Context>;

export function initializeContext(setupContext: SetupContext): InitializationContext {
	return {
		...setupContext,
		...createLogContext(setupContext),
		...createTraceContext(setupContext, (child: Span) => initializeContext({ ...setupContext, span: child })),
		...createRequestContextMiddleware((child: Span) => createContext({ ...setupContext, span: child })),
		...createTraceContextSpawnerContext(setupContext, (child: Span) =>
			createContext({ ...setupContext, span: child }),
		),
	};
}

function createContext(setupContext: SetupContext): Context {
	return {
		...setupContext,
		...createLogContext(setupContext),
		...createTraceContext(setupContext, (child: Span) => createContext({ ...setupContext, span: child })),
	};
}

export interface SlackContext {
	readonly slack: SlackClient;
}

export function createSlackContext({
	config: {
		slack: { botToken },
	},
}: ConfigContext<Config>): SlackContext {
	return { slack: new SlackClient(botToken) };
}

export interface S3Context {
	readonly s3: S3;
	readonly s3UrlSigning: S3;
}

export function createS3Context({ config }: ConfigContext<Config>): S3Context {
	return {
		s3: new S3(
			config.s3.accessKeyId && config.s3.secretAccessKey
				? {
						credentials: {
							accessKeyId: config.s3.accessKeyId,
							secretAccessKey: config.s3.secretAccessKey,
						},
						// tslint:disable-next-line: indent
				  }
				: {},
		),
		s3UrlSigning: new S3({
			credentials: {
				accessKeyId: config.s3.urlSigning.accessKeyId,
				secretAccessKey: config.s3.urlSigning.secretAccessKey,
			},
		}),
	};
}

export function assertIsContext(obj: any): asserts obj is Context {
	assertIsTraceContext(obj);
	assertIsLogContext(obj);
}
