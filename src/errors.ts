// copy & paste from newer context-helpers version
export function stackOrError(e: unknown): string {
	return isErrorWithStack(e) ? `${e.stack.replace('\\n', '\n')}` : `${e}`;
}

export function messageOrError(e: unknown): string {
	return isErrorWithMessage(e) ? `${e.message}` : `${e}`;
}

export function isErrorWithStack<T>(e: T): e is T & { stack: string } {
	return e !== null && typeof e === 'object' && 'stack' in e && typeof (e as any).stack === 'string';
}

export function isErrorWithMessage<T>(e: T): e is T & { message: string } {
	return e !== null && typeof e === 'object' && 'message' in e && typeof (e as any).message === 'string';
}
