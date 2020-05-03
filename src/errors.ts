import * as express from 'express';
import { log } from './log';

export function errorHandler(err: any, req: express.Request, res: express.Response, __: express.NextFunction): void {
	if (err.statusCode != null) {
		res.writeHead(err.statusCode);
	} else {
		res.writeHead(500);
	}
	log.error(`An error occurred on ${req.path}: ${err.message}`);
	res.write('An internal server error occurred.');
	res.end();
}
