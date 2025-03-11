#!/usr/bin/env bash

set -eo pipefail; shopt -s inherit_errexit
eval "$(bitwarden-fields --cache-for=$((60 * 60 * 8)) "npm - User" NPM_TOKEN_RO || echo return 1)"
exec buildx build --platform linux/amd64 --platform linux/arm64 --build-arg "NPM_TOKEN=$NPM_TOKEN_RO" --file deploy/prod/Dockerfile --tag cr.orbit.dev/ops/grafana-unfurl:latest "$@" .
