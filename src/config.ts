import { readFile } from 'fs';
import { cloneDeep, merge } from 'lodash';
import { URL } from 'url';
import * as yaml from 'yaml';
import * as configFileSchema from './artifacts/schemas/ConfigFile.json';
import { LogFormat, LogLevel } from './log';
import { RequiredRecursive } from './utils';
import { getValidator } from './utils';

function maskIfDefined(val: any | null | undefined): any | null | undefined {
	return val === undefined ? undefined : val === null ? val : 'XXXX';
}
export function maskSensitiveConfig(config: Config): any {
	const masked = cloneDeep(config);
	masked.s3.accessKeyId = maskIfDefined(masked.s3.accessKeyId);
	masked.s3.secretAccessKey = maskIfDefined(masked.s3.secretAccessKey);
	masked.slack.botToken = maskIfDefined(masked.slack.botToken);
	masked.slack.clientId = maskIfDefined(masked.slack.clientId);
	masked.slack.clientSecret = maskIfDefined(masked.slack.clientSecret);
	masked.slack.clientSigningSecret = maskIfDefined(masked.slack.clientSigningSecret);
	masked.grafana.headers.Cookie = maskIfDefined(masked.grafana.headers.Cookie);
	masked.grafana.headers.Authorization = maskIfDefined(masked.grafana.headers.Authorization);
	return masked;
}

interface ConfigFileBase {
	logFormat?: LogFormat;
	logLevel?: LogLevel;
	grafana?: {
		headers?: { [key: string]: string };
		render?: {
			height?: number;
			width?: number;
		};
	};
	s3?: {
		bucket: string;
		root?: string;
	};
	slack: {
		botToken: string;
		clientId: string;
		clientSecret: string;
		clientSigningSecret: string;
	};
}

interface ConfigFileBaseOptionals {
	s3?: {
		accessKeyId?: string;
		secretAccessKey?: string;
	};
}

export type ConfigFile = ConfigFileBase &
	ConfigFileBaseOptionals & {
		url: string;
		grafana: {
			url: string;
			matchUrl: string;
			retention?: string;
			cleanupInterval?: string;
		};
	};

export type Config = RequiredRecursive<ConfigFileBase> &
	ConfigFileBaseOptionals & {
		url: URL;
		grafana: {
			url: URL;
			matchUrl: URL;
			retention: number;
			cleanupInterval: number;
		};
		webserverPaths: {
			slackEvents: string;
			slackActions: string;
			cacheRequests: string;
		};
	};

export async function loadConfig(configPath: string): Promise<Config> {
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
	const defaults = {
		logFormat: 'text',
		logLevel: 'info',
		s3: {
			root: '',
		},
		grafana: {
			headers: {},
			retention: '30d',
			cleanupInterval: '1d',
			render: {
				height: 500,
				width: 1000,
			},
		},
	};
	const parsedURLs = {
		url: new URL(jsonConfig.url.replace(/([^/])$/, '$1/')),
		grafana: {
			url: new URL(jsonConfig.grafana.url.replace(/([^/])$/, '$1/')),
			matchUrl: new URL(jsonConfig.grafana.matchUrl.replace(/([^/])$/, '$1/')),
		},
	};
	const staticConfig: { webserverPaths: Config['webserverPaths'] } = {
		webserverPaths: {
			slackEvents: new URL('api/slack/events', parsedURLs.url).pathname,
			slackActions: new URL('api/slack/actions', parsedURLs.url).pathname,
			cacheRequests: new URL('api/cache', parsedURLs.url).pathname,
		},
	};
	const mergedConfig = merge(defaults, jsonConfig, parsedURLs, staticConfig);
	const parsedDurations = {
		grafana: {
			retention: parseDuration(mergedConfig.grafana.retention, 'grafana.retention'),
			cleanupInterval: parseDuration(mergedConfig.grafana.cleanupInterval, 'grafana.cleanupInterval'),
		},
	};
	const pathFixes = {
		s3: {
			root: mergedConfig.s3.root.replace(/^\//g, '').replace(/([^/])$/, '$1/'),
		},
	};
	return merge(mergedConfig, parsedDurations, pathFixes);
}

// Convert a duration to seconds.
// Allowed suffixes are "s" (seconds), "m" (minutes), "h" (hours), "d" (days)
function parseDuration(duration: string, path?: string): number {
	const matches = duration.match(/^(?<qty>\d+)(?<suffix>s|m|h|d)$/);
	if (matches === null) {
		throw new Error(
			`The duration '${duration}' specified at ${path} must be a number followed by a suffix (s, m, h, d)`,
		);
	} else {
		const suffixMultipliers = { s: 1, m: 60, h: 3600, d: 86400 };
		const { qty, suffix } = matches.groups as { qty: string; suffix: keyof typeof suffixMultipliers };
		return parseInt(qty, 10) * suffixMultipliers[suffix];
	}
}
