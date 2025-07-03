import { ConfigContext } from '@secoya/context-helpers/config.js';
import { WebClient as SlackClient } from '@slack/web-api';
import S3 from 'aws-sdk/clients/s3.js';
import { Config } from 'src/config.js';

export interface SlackContext {
	readonly slack: SlackClient;
}

export function createSlackContext({
	config: {
		slack: { botToken },
	},
}: ConfigContext<Config>): SlackContext {
	return { slack: new SlackClient(botToken) };
}

export interface S3Context {
	readonly s3: S3;
	readonly s3UrlSigning: S3;
}

export function createS3Context({ config }: ConfigContext<Config>): S3Context {
	return {
		s3: new S3({
			...(config.s3.endpoint ? { endpoint: config.s3.endpoint } : {}),
			...(config.s3.region ? { region: config.s3.region } : {}),
			...(config.s3.accessKeyId && config.s3.secretAccessKey
				? {
						credentials: {
							accessKeyId: config.s3.accessKeyId,
							secretAccessKey: config.s3.secretAccessKey,
						},
						// tslint:disable-next-line: indent
				  }
				: {}),
		}),
		s3UrlSigning: new S3({
			...(config.s3.endpoint ? { endpoint: config.s3.endpoint } : {}),
			...(config.s3.region ? { region: config.s3.region } : {}),
			credentials: {
				accessKeyId: config.s3.urlSigning.accessKeyId,
				secretAccessKey: config.s3.urlSigning.secretAccessKey,
			},
		}),
	};
}
