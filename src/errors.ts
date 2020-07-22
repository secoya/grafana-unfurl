import { Logger } from '@secoya/log-helpers';
import * as express from 'express';

export function errorHandler(
	log: Logger,
): (err: any, req: express.Request, res: express.Response, __: express.NextFunction) => void {
	return (err, req, res, _) => {
		if (err.statusCode != null) {
			res.writeHead(err.statusCode);
		} else {
			res.writeHead(500);
		}
		log.error(`An error occurred on ${req.path}: ${err.message}`);
		res.write('An internal server error occurred.');
		res.end();
	};
}
