import * as ajv from 'ajv';
import { NextFunction, Request, RequestHandler, Response } from 'express';

interface Validator<T> {
	(data: any): data is T;
	errors?: null | ajv.ErrorObject[];
}

export function getValidator<T>(schema: object): Validator<T> {
	const validate = new ajv().compile(schema);
	const validator: Validator<T> = (data: any): data is T => {
		if (validate(data)) {
			return true;
		} else {
			validator.errors = validate.errors;
			return false;
		}
	};
	return validator;
}

export type RequiredRecursive<T> = T extends object
	? { [P in keyof T]-?: RequiredRecursive<T[P]> }
	: T extends undefined
	? never
	: Required<T>;

export function filteredMiddleware(
	filter: { exclude: (string | RegExp)[] } | { include: (string | RegExp)[] },
	middleware: RequestHandler,
): RequestHandler {
	const lambdas = ('exclude' in filter ? filter.exclude : filter.include).map((matcher) =>
		matcher instanceof RegExp
			? (path: string) => path.match(matcher) !== null
			: (path: string) => path.startsWith(matcher),
	);
	const match = (path: string) => lambdas.some((fn) => fn(path));
	const include = 'exclude' in filter ? (path: string) => !match(path) : (path: string) => match(path);
	return (req: Request, res: Response, next: NextFunction) => {
		return include(req.path) ? middleware(req, res, next) : next();
	};
}
