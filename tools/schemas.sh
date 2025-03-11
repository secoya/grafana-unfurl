#!/usr/bin/env sh

PATH=node_modules/.bin:$PATH
tools/generateJSONSchemas.ts src/artifacts/schemas tsconfig.json
