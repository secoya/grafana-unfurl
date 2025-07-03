import { errorHandler, wrapAsyncReqHandler } from '@secoya/context-helpers/express.js';
import bodyParser from 'body-parser';
import { Request, Response } from 'express';
import * as path from 'path';
import * as cacheRequestPayloadSchema from 'src/artifacts/schemas/CacheRequestPayload.json';
import { createImage } from 'src/grafana/cache.js';
import { parseUrl } from 'src/grafana/url.js';
import { assertIsContext, Context, StartupContext } from 'src/index.js';
import { getValidator } from 'src/utils.js';

interface CacheRequestPayload {
	url: string;
}
interface CacheRequestResponse {
	url: string;
}
const validateCacheRequestPayload = getValidator<CacheRequestPayload>(cacheRequestPayloadSchema);

export function setupListener({ express, config }: StartupContext) {
	express.post(
		path.join(config.urlPath, 'api/cache'),
		bodyParser.json({ limit: '10mb' }),
		wrapAsyncReqHandler(assertIsContext, async (context: Context, req: Request, res: Response) => {
			const { trace } = context;
			const body = req.body;
			if (!validateCacheRequestPayload(body)) {
				throw new Error(
					`Unable to validate a cache request that was received:\n${JSON.stringify(
						validateCacheRequestPayload.errors,
					)}`,
				);
			}
			const url = parseUrl(context, body.url);
			if (!url) {
				throw new Error('Unable to parse URL or it does not match the configured matcher');
			}
			if (!('panelId' in url)) {
				throw new Error('The URL does not link to a specific panel ID');
			}
			const cacheUrl = await trace(createImage, url);
			res.status(200);
			res.json({ url: cacheUrl.toString() } as CacheRequestResponse);
			res.end();
		}),
		errorHandler(assertIsContext),
	);
}
