import * as bodyParser from 'body-parser';
import * as express from 'express';
import * as cacheRequestPayloadSchema from './artifacts/schemas/CacheRequestPayload.json';
import { Context } from './context';
import { errorHandler } from './errors';
import { createImage } from './grafana/cache';
import { parseUrl } from './grafana/url';
import { getValidator } from './utils';

interface CacheRequestPayload {
	url: string;
}
interface CacheRequestResponse {
	url: string;
}
const validateCacheRequestPayload = getValidator<CacheRequestPayload>(cacheRequestPayloadSchema);

export function setupListener(context: Context, app: express.Express) {
	const { config } = context;
	app.post(
		config.webserverPaths.cacheRequests,
		bodyParser.json({ limit: '10mb' }),
		async (req: express.Request, res: express.Response, next: express.NextFunction) => {
			try {
				const request = req.body;
				if (!validateCacheRequestPayload(request)) {
					throw new Error(
						`Unable to validate a cache request that was received:\n${JSON.stringify(
							validateCacheRequestPayload.errors,
						)}`,
					);
				}
				const url = parseUrl(context, request.url);
				if (!url) {
					throw new Error('Unable to parse URL or it does not match the configured matcher');
				}
				if (!('panelId' in url)) {
					throw new Error('The URL does not link to a specific panel ID');
				}
				const cacheUrl = await createImage(context, url);
				res.status(200);
				res.json({ url: cacheUrl.toString() } as CacheRequestResponse);
				res.end();
			} catch (e) {
				next(e);
			}
		},
		errorHandler,
	);
}
