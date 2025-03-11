import * as S3 from 'aws-sdk/clients/s3';
import { AWSError } from 'aws-sdk/lib/error';
import { addSeconds, format, isBefore, subSeconds } from 'date-fns';
import { FORMAT_HTTP_HEADERS, globalTracer } from 'opentracing';
import * as request from 'request-promise-native';
import { URL } from 'url';
import { Context, InitializationContext } from '../context';
import { messageOrError, stackOrError } from '../errors';
import { getPanelImageUrl, GrafanaPanelUrl } from './url';

export async function createImage(context: Context, urlParts: GrafanaPanelUrl): Promise<URL> {
	const { config, s3, s3UrlSigning, childSpan, log } = context;
	const imageUrl = getPanelImageUrl(context, urlParts);
	log.debug(`Caching ${imageUrl}`);
	let image: Buffer;
	try {
		image = await childSpan(function downloadImage({ span }): Promise<Buffer> {
			const headers = { ...config.grafana.headers };
			globalTracer().inject(span, FORMAT_HTTP_HEADERS, headers);
			return request({
				encoding: null,
				followRedirect: false,
				headers,
				method: 'GET',
				uri: imageUrl.toString(),
			});
		})();
	} catch (e) {
		throw new Error(`Grafana returned an error when rendering ${imageUrl}: ${messageOrError(e).substr(0, 30)}...`);
	}
	const now = new Date();
	const key = format(now, 'yyyyMMddHHmmssSSS');
	const cachedGraphImagePath = `${config.s3.root}${key}.png`;
	await childSpan(function uploadImage() {
		return new Promise((resolve, reject) => {
			s3.upload(
				{
					Body: image,
					Bucket: config.s3.bucket,
					ContentType: 'image/png',
					Expires: addSeconds(now, config.grafana.retention),
					Key: cachedGraphImagePath,
				},
				(err: Error, data: S3.ManagedUpload.SendData) => {
					if (err) {
						reject(err);
					} else {
						resolve(data);
					}
				},
			);
		});
	})();
	const s3url = await (new Promise((resolve, reject) => {
		s3UrlSigning.getSignedUrl(
			'getObject',
			{
				...(config.s3.endpoint ? { endpoint: config.s3.endpoint } : {}),
				...(config.s3.region ? { region: config.s3.region } : {}),
				Bucket: config.s3.bucket,
				Expires: config.grafana.retention,
				Key: cachedGraphImagePath,
			},
			(err: Error, url: string) => {
				if (err) {
					reject(err);
				} else {
					resolve(url);
				}
			},
		);
	}) as Promise<string>);
	return new URL(s3url);
}

export async function setupCleanup({ config, shutdownHandlers, newSpan, log }: InitializationContext): Promise<void> {
	log.verbose('setup cleanup');
	let cleanupInProgress = false;
	let interval: NodeJS.Timeout;
	interval = setInterval(
		newSpan(async (context) => {
			const { log: intvLog, span } = context;
			try {
				if (cleanupInProgress) {
					intvLog.warn('Cleanup already in progress, not starting another one.');
				}
				cleanupInProgress = true;
				await deleteExpiredImages(context);
			} catch (e) {
				span.log({ stack: stackOrError(e) });
				span.setTag('error', true);
				span.setTag('sampling.priority', 1);
				intvLog.error(e);
			} finally {
				cleanupInProgress = false;
			}
		}),
		config.grafana.cleanupInterval * 1000,
	);
	shutdownHandlers.append('teardown cleanup', () => clearInterval(interval));
}

async function deleteExpiredImages(context: Context): Promise<void> {
	const { config, s3, log } = context;
	const now = new Date();
	const expireCutoff = subSeconds(now, config.grafana.retention);
	const objects = await new Promise<S3.ListObjectsOutput>((resolve, reject) =>
		s3.listObjects(
			{
				Bucket: config.s3.bucket,
				Prefix: config.s3.root,
			},
			(err: AWSError, response: S3.ListObjectsOutput) => {
				if (err) {
					reject(err);
				} else {
					resolve(response);
				}
			},
		),
	);
	if (!objects.Contents) {
		return;
	}
	const deletionPromises = objects.Contents.filter(
		(o) => o.Key !== config.s3.root && o.LastModified && isBefore(o.LastModified, expireCutoff),
	).map(
		(o) =>
			new Promise<S3.DeleteObjectOutput>((resolve, reject) => {
				if (!o.Key) {
					log.warn(`Cleanup: Received object without key ${JSON.stringify(o)}`);
					return;
				}
				s3.deleteObject(
					{
						Bucket: config.s3.bucket,
						Key: o.Key,
					},
					(err: AWSError, response: S3.DeleteObjectOutput) => {
						if (err) {
							reject(err);
						} else {
							resolve(response);
						}
					},
				);
			}),
	);
	await Promise.all(deletionPromises);
	log.info(`Cleanup: Deleted ${deletionPromises.length} images`);
}
