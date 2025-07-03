import { ConfigContext } from '@secoya/context-helpers/config.js';
import { readFile } from 'fs';
import lodash from 'lodash';
import * as configFileSchema from 'src/artifacts/schemas/ConfigFile.json';
import { getValidator } from 'src/utils.js';
import { URL } from 'url';
import yaml from 'yaml';

function maskIfDefined(val: any | null | undefined): any | null | undefined {
	return val === undefined ? undefined : val === null ? val : 'XXXX';
}
export function maskSensitiveConfig(config: Config): any {
	const masked = lodash.cloneDeep(config);
	masked.s3.accessKeyId = maskIfDefined(masked.s3.accessKeyId);
	masked.s3.secretAccessKey = maskIfDefined(masked.s3.secretAccessKey);
	masked.s3.urlSigning.accessKeyId = maskIfDefined(masked.s3.urlSigning.accessKeyId);
	masked.s3.urlSigning.secretAccessKey = maskIfDefined(masked.s3.urlSigning.secretAccessKey);
	masked.slack.botToken = maskIfDefined(masked.slack.botToken);
	masked.slack.clientId = maskIfDefined(masked.slack.clientId);
	masked.slack.clientSecret = maskIfDefined(masked.slack.clientSecret);
	masked.slack.clientSigningSecret = maskIfDefined(masked.slack.clientSigningSecret);
	masked.grafana.headers.Cookie = maskIfDefined(masked.grafana.headers.Cookie);
	masked.grafana.headers.Authorization = maskIfDefined(masked.grafana.headers.Authorization);
	return masked;
}

declare const durationSym: unique symbol;
export type Duration = number & { [durationSym]: never };

export type ConfigFile = OptionalKeysExceptIndexed<Config>;
export interface Config {
	grafana: {
		cleanupInterval: Duration;
		headers: { [key: string]: string };
		matchUrl: URL;
		render: {
			height: number;
			width: number;
		};
		retention: Duration;
		url: URL;
	};
	s3: {
		accessKeyId?: string;
		bucket: string;
		endpoint?: string;
		region?: string;
		root: string;
		secretAccessKey?: string;
		urlSigning: {
			accessKeyId: string;
			secretAccessKey: string;
		};
	};
	slack: {
		botToken: string;
		clientId: string;
		clientSecret: string;
		clientSigningSecret: string;
	};
	urlPath: string;
}

type AsConfigFileValue<V> = V extends Duration
	? string
	: V extends URL
	? string
	: V extends number | string | boolean
	? V
	: V extends Iterable<infer E>
	? AsConfigFileValue<E>[]
	: V extends Record<any, any>
	? OptionalKeysExceptIndexed<V>
	: string;
type Prettify<T> = {
	[K in keyof T]: T[K];
	// eslint-disable-next-line @typescript-eslint/ban-types
} & {};
// tslint:disable
type OptionalKeysExceptIndexed<V> = Prettify<
	{
		[K in keyof V as string extends K
			? never
			: number extends K
			? never
			: symbol extends K
			? never
			: K]?: AsConfigFileValue<V[K]>;
	} & {
		[K in keyof V as string extends K ? K : number extends K ? K : symbol extends K ? K : never]: AsConfigFileValue<
			V[K]
		>;
	}
>;
// tslint:enable

export async function loadConfig(configPath: string): Promise<ConfigContext<Config>> {
	const validateConfig = getValidator<ConfigFile>(configFileSchema);
	const configData: string = await new Promise(async (resolve, reject) => {
		readFile(configPath, (err, data) => {
			if (err) {
				reject(err);
			} else {
				resolve(data.toString());
			}
		});
	});
	const jsonConfig = yaml.parse(configData);
	if (!validateConfig(jsonConfig)) {
		throw new Error(`Unable to validate config, errors were: ${JSON.stringify(validateConfig.errors)}`);
	}
	const config: Config = {
		urlPath: (jsonConfig.urlPath ?? '/').replace(/([^/])$/, '$1/'),
		grafana: {
			headers: {},
			url: new URL(
				required(
					jsonConfig.grafana?.url ?? process.env.GRAFANA_URL,
					'grafana.url is required or must be set via $GRAFANA_URL',
				).replace(/([^/])$/, '$1/'),
			),
			matchUrl: new URL(
				required(
					jsonConfig.grafana?.matchUrl ?? process.env.GRAFANA_MATCH_URL,
					'grafana.matchUrl is required or must be set via $GRAFANA_MATCH_URL',
				).replace(/([^/])$/, '$1/'),
			),
			retention: parseDuration(jsonConfig.grafana?.retention ?? '30d', 'grafana.retention'),
			cleanupInterval: parseDuration(jsonConfig.grafana?.cleanupInterval ?? '1d', 'grafana.cleanupInterval'),
			render: {
				height: 500,
				width: 1000,
			},
		},
		s3: {
			bucket: required(
				jsonConfig.s3?.bucket ?? process.env.S3_BUCKET,
				's3.bucket is required or must be set via $S3_BUCKET',
			),
			root: (jsonConfig.s3?.root ?? process.env.S3_ROOT ?? '').replace(/^\//g, '').replace(/([^/])$/, '$1/'),
			endpoint: jsonConfig.s3?.endpoint ?? process.env.S3_ENDPOINT,
			region: jsonConfig.s3?.region ?? process.env.S3_REGION,
			accessKeyId: jsonConfig.s3?.accessKeyId ?? process.env.S3_ACCESS_KEY_ID,
			secretAccessKey: jsonConfig.s3?.secretAccessKey ?? process.env.S3_SECRET_ACCESS_KEY,
			urlSigning: {
				accessKeyId: required(
					jsonConfig.s3?.accessKeyId ??
						process.env.S3_ACCESS_KEY_ID ??
						process.env.S3_URL_SIGNING_ACCESS_KEY_ID,
					's3.accessKeyId is required or must be set via $S3_URL_SIGNING_ACCESS_KEY_ID',
				),
				secretAccessKey: required(
					jsonConfig.s3?.secretAccessKey ??
						process.env.S3_SECRET_ACCESS_KEY ??
						process.env.S3_URL_SIGNING_SECRET_ACCESS_KEY,
					's3.secretAccessKey is required or must be set via $S3_URL_SIGNING_SECRET_ACCESS_KEY',
				),
			},
		},
		slack: {
			botToken: required(
				jsonConfig.slack?.botToken ?? process.env.SLACK_BOT_TOKEN,
				'slack.botToken is required or must be set via $SLACK_BOT_TOKEN',
			),
			clientId: required(
				jsonConfig.slack?.clientId ?? process.env.SLACK_CLIENT_ID,
				'slack.clientId is required or must be set via $SLACK_CLIENT_ID',
			),
			clientSecret: required(
				jsonConfig.slack?.clientSecret ?? process.env.SLACK_CLIENT_SECRET,
				'slack.clientSecret is required or must be set via $SLACK_CLIENT_SECRET',
			),
			clientSigningSecret: required(
				jsonConfig.slack?.clientSigningSecret ?? process.env.SLACK_CLIENT_SIGNING_SECRET,
				'slack.clientSigningSecret is required or must be set via $SLACK_CLIENT_SIGNING_SECRET',
			),
		},
	};
	return { config };
}

// Convert a duration to seconds.
// Allowed suffixes are "s" (seconds), "m" (minutes), "h" (hours), "d" (days)
function parseDuration(duration: string, path?: string): Duration {
	const matches = duration.match(/^(?<qty>\d+)(?<suffix>s|m|h|d)$/);
	if (matches === null) {
		throw new Error(
			`The duration '${duration}' specified at ${path} must be a number followed by a suffix (s, m, h, d)`,
		);
	} else {
		const suffixMultipliers = { s: 1, m: 60, h: 3600, d: 86400 };
		const { qty, suffix } = matches.groups as { qty: string; suffix: keyof typeof suffixMultipliers };
		return (parseInt(qty, 10) * suffixMultipliers[suffix]) as Duration;
	}
}

function required<T>(val: T | undefined, message: string): T {
	if (val === undefined) {
		throw new Error(message);
	}
	return val;
}
