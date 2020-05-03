import { TransformableInfo } from 'logform';
import { MESSAGE } from 'triple-beam';
import * as winston from 'winston';

export enum LogLevel {
	ERROR = 'error',
	WARN = 'warn',
	INFO = 'info',
	VERBOSE = 'verbose',
	DEBUG = 'debug',
}

export enum LogFormat {
	JSON = 'json',
	TEXT = 'text',
}
const errorFormatter = {
	transform: (info: TransformableInfo) =>
		info instanceof Error
			? Object.assign({}, info, {
					[MESSAGE]: `${info.stack}`,
					message: `${info.stack}`,
					// tslint:disable-next-line: indent
			  })
			: info,
};

const timestampFormatter = {
	transform: (info: TransformableInfo) =>
		Object.assign({}, info, {
			level: `${info.timestamp} ${info.level}`,
			timestamp: undefined,
		}),
};
const logFormats = {
	json: winston.format.combine(
		winston.format.timestamp(),
		winston.format.errors({ stack: true }),
		winston.format.json(),
	),
	text: winston.format.combine(
		winston.format.timestamp({ format: 'HH:mm:ss' }),
		errorFormatter,
		winston.format.cli(),
		timestampFormatter,
		winston.format.simple(),
	),
};

export const log = winston.createLogger({
	exceptionHandlers: [
		new winston.transports.Console({ stderrLevels: Object.keys(LogLevel), handleExceptions: true }),
	],
	format: logFormats.json,
	level: 'info',
	transports: [new winston.transports.Console()],
});

export function setLogFormat(format: LogFormat) {
	log.format = logFormats[format];
}

export function setLogLevel(level: LogLevel) {
	log.level = level;
	if (level === 'debug') {
		process.env.DEBUG = '*';
	}
}
