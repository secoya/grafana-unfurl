import * as S3 from 'aws-sdk/clients/s3';
import { AWSError } from 'aws-sdk/lib/error';
import { addSeconds, format, isBefore, subSeconds } from 'date-fns';
import { messageOrError } from 'src/errors.js';
import { getPanelImageUrl, GrafanaPanelUrl } from 'src/grafana/url.js';
import { Context, StartupContext } from 'src/index.js';
import { URL } from 'url';

export async function createImage(context: Context, urlParts: GrafanaPanelUrl): Promise<URL> {
	const { config, s3, s3UrlSigning, fetchInternal, log, trace } = context;
	const imageUrl = getPanelImageUrl(context, urlParts);
	log.debug(`Caching ${imageUrl}`);
	let image: Blob;
	try {
		image = await (
			await fetchInternal(imageUrl.toString(), {
				method: 'GET',
			})
		).blob();
	} catch (e) {
		throw new Error(`Grafana returned an error when rendering ${imageUrl}: ${messageOrError(e).substr(0, 30)}...`);
	}
	const now = new Date();
	const key = format(now, 'yyyyMMddHHmmssSSS');
	const cachedGraphImagePath = `${config.s3.root}${key}.png`;
	await trace(
		{ name: 'uploadImage', containErrors: true },
		() =>
			new Promise((resolve, reject) => {
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
			}),
	);
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

export async function setupCleanup({ log, createUntracedContext, shutdown, config }: StartupContext): Promise<void> {
	log.verbose('setup cleanup');
	let cleanupInProgress = false;
	const { trace: newTrace } = createUntracedContext();
	const interval = setInterval(
		() =>
			newTrace({ name: 'deleteExpiredImages', containErrors: true }, async ({ trace, log: subLog }) => {
				if (cleanupInProgress) {
					subLog.warning('Cleanup already in progress, not starting another one.');
				} else {
					try {
						cleanupInProgress = true;
						await trace(deleteExpiredImages);
					} finally {
						cleanupInProgress = false;
					}
				}
			}),
		config.grafana.cleanupInterval * 1000,
	);
	shutdown.handlers.append('teardown cleanup', () => clearInterval(interval));
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
					log.warning(`Cleanup: Received object without key ${JSON.stringify(o)}`);
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
