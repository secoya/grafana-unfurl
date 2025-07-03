#!/usr/bin/env -S node --loader ts-node/esm
import { docopt } from 'docopt';
import fs from 'node:fs/promises';
import path from 'path';
import TJS from 'typescript-json-schema';

const doc = `Generate a GraphQL schema
Usage:
	generateJSONSchemas.ts <output> <tsconfig> [<symbols>...]

Note:
	[<symbols>...] default to the built-in symbolList if none are given`;

export const symbolList = [
	'ConfigFile',
	'LinkShareEvent',
	'InteractionPayload',
	'GrafanaAPIDashboardResponse',
	'CacheRequestPayload',
];

export async function generateSchemas(
	output: string,
	tsconfig: string,
	symbols: string[],
	previousManifests?: { [key: string]: string },
): Promise<{ [key: string]: string } | null> {
	const newManifests: { [key: string]: string } = {};
	try {
		const generator = TJS.buildGenerator(TJS.programFromConfig(path.resolve(process.cwd(), tsconfig)), {
			defaultProps: false,
			ignoreErrors: true,
			required: true,
		});
		if (generator === null) {
			throw new Error('JSONSchemaGenerator: generator is null');
		}
		if (symbols.length === 0) {
			symbols = symbolList;
		}
		const writePromises: Promise<void>[] = [];
		for (const schemaSymbol of symbols) {
			const manifestPath = path.join(path.resolve(process.cwd(), output), `${schemaSymbol}.json`);
			const schema = generator.getSchemaForSymbol(schemaSymbol);
			const manifest = JSON.stringify(schema, null, 2);
			if (!previousManifests || manifest !== previousManifests[schemaSymbol]) {
				writePromises.push(fs.writeFile(manifestPath, manifest));
			}
			newManifests[schemaSymbol] = manifest;
		}
		await Promise.all(writePromises);
		return newManifests;
	} catch (e) {
		// tslint:disable-next-line: no-console
		// eslint-disable-next-line no-console
		console.error(e);
	}
	return null;
}

const params = docopt(doc, {});
generateSchemas(params['<output>'], params['<tsconfig>'], params['<symbols>']);
