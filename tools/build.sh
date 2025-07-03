#!/usr/bin/env bash

set -eo pipefail; shopt -s inherit_errexit
export NPM_TOKEN
NPM_TOKEN=$(bitwarden-value --cache-for=$((60 * 60 * 8)) "npm - User" NPM_TOKEN_RO)
exec buildx build --platform linux/amd64 --platform linux/arm64 --secret id=NPM_TOKEN --file deploy/prod/Dockerfile --tag cr.orbit.dev/ops/grafana-unfurl:latest "$@" .
