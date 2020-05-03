import * as ajv from 'ajv';

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
