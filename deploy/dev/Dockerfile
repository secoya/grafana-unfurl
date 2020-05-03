FROM node:10-alpine
ENV PATH=$PATH:/grafana-unfurl/node_modules/.bin
WORKDIR /grafana-unfurl
VOLUME /grafana-unfurl

RUN apk --no-cache add parallel
USER node
CMD \
  mkdir -p dist && \
  touch dist/index.js && \
  parallel --jobs 0 --line-buffer --halt now,fail=1 '{}' ::: \
  "tsc --watch --preserveWatchOutput --project tsconfig.json" \
  "nodemon --config deploy/dev/nodemon.json -- dist/index.js --config deploy/dev/config.yaml"
