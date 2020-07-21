import { ShutdownOptions } from '@secoya/shutdown-manager';
import { initTracerFromEnv, Logger } from 'jaeger-client';
import { followsFrom, globalTracer, initGlobalTracer, Span } from 'opentracing';

export function setupTracing(
	shutdown: ShutdownOptions,
	serviceName: string,
	logger: Logger,
	logSpans: boolean = false,
): void {
	const tracer = initTracerFromEnv(
		{
			serviceName,
			reporter: {
				logSpans,
			},
			sampler: {
				type: 'const',
				param: 1,
			},
		},
		{ logger },
	);
	shutdown.handlers.push(() => new Promise((resolve) => tracer.close(resolve)));
	initGlobalTracer(tracer);
}

export interface TraceContext {
	readonly span: Span;
	readonly childSpan: <T extends (...args: any[]) => any>(fn: T, spanName?: string) => SpanReceiver<T>;
	readonly followSpan: <T extends (...args: any[]) => any>(fn: T, spanName?: string) => SpanReceiver<T>;
}
type Promisify<T> = T extends Promise<infer R> ? Promise<R> : Promise<T>;
type SpanReceiver<T extends (...args: any[]) => any> = T extends () => infer R
	? () => Promisify<R>
	: T extends (arg1: infer A1, ...rest: infer P) => infer R
	? A1 extends object
		? (...rest: P) => Promisify<R>
		: never
	: never;

// newSpan() wraps a function call in a new span.
// If the passed function accepts parameters the first parameter must be an object.
// The returned function is async, if it wasn't already.
// The passed function is invoked with the same arguments as the wrapped function,
// with the addition of a TraceContext that is prepended to the argument list
export function newSpan<T extends (...args: any[]) => any>(fn: T, spanName?: string): SpanReceiver<T> {
	return ((...rest: any[]): Promise<any> => {
		const span = globalTracer().startSpan(spanName || fn.name || '[anonymous function]');
		return completeSpan(span, () => fn(createTraceContext(span), ...rest));
	}) as SpanReceiver<T>;
}

// followSpan() and childSpan() wrap a function call in a follow span and child span respectively.
// If the passed function accepts parameters the first parameter must be an object.
// The returned function is async, if it wasn't already.
export function createTraceContext(
	current: Span,
	contextCreator: (parent: Span) => TraceContext = (span: Span) => createTraceContext(span, createTraceContext),
) {
	return {
		span: current,
		childSpan: <T extends (...args: any[]) => any>(fn: T, spanName?: string): SpanReceiver<T> => {
			return ((...args: any[]): Promise<any> => {
				const child = globalTracer().startSpan(spanName || fn.name || '[anonymous function]', {
					childOf: current.context(),
				});
				return completeSpan(child, () => fn({ ...contextCreator(child) }, ...args));
			}) as SpanReceiver<T>;
		},
		followSpan: <T extends (...args: any[]) => any>(fn: T, spanName?: string): SpanReceiver<T> => {
			return ((...args: any[]): Promise<any> => {
				const follower = globalTracer().startSpan(spanName || fn.name || '[anonymous function]', {
					references: [followsFrom(current.context())],
				});
				return completeSpan(follower, () => fn({ ...contextCreator(follower) }, ...args));
			}) as SpanReceiver<T>;
		},
	};
}

// Takes a started span and a function.
// Invokes the function and finishes the span once the function has returned.
export async function completeSpan<R>(span: Span, fn: () => Promise<R>): Promise<R> {
	try {
		return await fn();
	} catch (e) {
		span.log({ stack: e.stack });
		span.setTag('error', true);
		span.setTag('sampling.priority', 1);
		throw e;
	} finally {
		span.finish();
	}
}

export function assertHasSpan(obj: { span?: any }): asserts obj is { span: Span } {
	if (!obj.span) {
		throw new Error('Key `span` not found on object');
	} else {
		if (obj.span instanceof Span) {
			throw new Error('Key `span` is not an opentracing Span');
		}
	}
}
