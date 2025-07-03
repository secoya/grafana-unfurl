#!/usr/bin/env bash

set -eo pipefail; shopt -s inherit_errexit
PKGROOT=$(realpath "$(dirname "$(realpath "${BASH_SOURCE[0]}")")/..")
exec node \
  --import 'data:text/javascript,import { register } from "node:module"; import { pathToFileURL } from "node:url"; register("ts-node/esm", pathToFileURL("./"));' \
  "$PKGROOT/tools/generateJSONSchemas.ts" "$PKGROOT/src/artifacts/schemas" "$PKGROOT/tsconfig.json"
