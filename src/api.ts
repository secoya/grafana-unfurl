import * as bodyParser from 'body-parser';
import * as express from 'express';
import * as cacheRequestPayloadSchema from './artifacts/schemas/CacheRequestPayload.json';
import { assertHasRequestContext, InitializationContext } from './context';
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

export function setupListener({ app, config }: InitializationContext) {
	app.post(
		config.webserverPaths.cacheRequests,
		bodyParser.json({ limit: '10mb' }),
		async (req: express.Request, res: express.Response, next: express.NextFunction) => {
			try {
				assertHasRequestContext(req);
				const { childSpan } = req.context;
				const body = req.body;
				if (!validateCacheRequestPayload(body)) {
					throw new Error(
						`Unable to validate a cache request that was received:\n${JSON.stringify(
							validateCacheRequestPayload.errors,
						)}`,
					);
				}
				const url = parseUrl(req.context, body.url);
				if (!url) {
					throw new Error('Unable to parse URL or it does not match the configured matcher');
				}
				if (!('panelId' in url)) {
					throw new Error('The URL does not link to a specific panel ID');
				}
				const cacheUrl = await childSpan(createImage)(url);
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
