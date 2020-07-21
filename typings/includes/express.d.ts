import 'express';
import { RequestContext } from '../../src/context';
import { Span } from 'opentracing';

declare module 'express' {
	interface Request {
		span?: Span;
		context?: RequestContext;
	}
}
