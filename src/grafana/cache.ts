import { ShutdownOptions } from '@secoya/shutdown-manager';
import * as S3 from 'aws-sdk/clients/s3';
import { AWSError } from 'aws-sdk/lib/error';
import { addSeconds, format, isBefore, subSeconds } from 'date-fns';
import * as request from 'request-promise-native';
import { URL } from 'url';
import { Context } from '../context';
import { log } from '../log';
import { getPanelImageUrl, GrafanaPanelUrl } from './url';

export async function createImage(context: Context, urlParts: GrafanaPanelUrl): Promise<URL> {
	const { config, s3 } = context;
	const imageUrl = getPanelImageUrl(context, urlParts);
	log.debug(`Caching ${imageUrl}`);
	const image = await request({
		encoding: null,
		followRedirect: false,
		headers: config.grafana.headers,
		method: 'GET',
		uri: imageUrl.toString(),
	});
	const now = new Date();
	const key = format(now, 'yyyyMMddHHmmssSSS');
	const cachedGraphImagePath = `${config.s3.root}${key}.png`;
	await new Promise((resolve, reject) => {
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
	const s3url = await (new Promise((resolve, reject) => {
		s3.getSignedUrl(
			'getObject',
			{
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

export async function setupCleanup(context: Context, shutdown: ShutdownOptions): Promise<void> {
	const { config } = context;
	let cleanupInProgress = false;
	let interval: NodeJS.Timeout;
	interval = setInterval(async () => {
		try {
			if (cleanupInProgress) {
				log.warn('Cleanup already in progress, not starting another one.');
			}
			cleanupInProgress = true;
			await deleteExpiredImages(context);
		} catch (e) {
			log.error(e);
		} finally {
			cleanupInProgress = false;
		}
	}, config.grafana.cleanupInterval * 1000);
	shutdown.handlers.push(() => clearInterval(interval));
	log.verbose('cleanup setup complete');
}

async function deleteExpiredImages(context: Context): Promise<void> {
	const { config, s3 } = context;
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
					log.warn(`Cleanup: Received ubject without key ${JSON.stringify(o)}`);
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
