import { WebClient as SlackClient } from '@slack/web-api';
import * as S3 from 'aws-sdk/clients/s3';
import { Config } from './config';

export class Context {
	public readonly config: Config;
	public readonly slack: SlackClient;
	public readonly s3: S3;
	public constructor(config: Config) {
		this.config = config;
		this.slack = new SlackClient(config.slack.botToken);
		this.s3 = new S3({
			accessKeyId: this.config.s3.accessKeyId,
			secretAccessKey: this.config.s3.secretAccessKey,
		});
	}
}
