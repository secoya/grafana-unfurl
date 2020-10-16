#!/usr/bin/env sh

NPM_TOKEN=$(cut -d= -f 2 < "$HOME/.npmrc" | tail -n1)
docker build --build-arg "NPM_TOKEN=$NPM_TOKEN" --file deploy/prod/Dockerfile --tag cr.orbit.dev/ops/grafana-unfurl:latest .
