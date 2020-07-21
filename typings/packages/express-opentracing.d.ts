import { RequestHandler } from 'express';
import { Tracer } from 'opentracing';
declare module 'express-opentracing' {
	function middleware(options: { tracer: Tracer }): RequestHandler;
	export default middleware;
}
