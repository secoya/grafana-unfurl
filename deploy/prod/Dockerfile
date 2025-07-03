FROM node:20-alpine AS build
RUN apk add --no-cache --update bash
SHELL ["/bin/bash", "-ec"]
WORKDIR /service
ENV PATH=$PATH:/service/node_modules/.bin

RUN mkdir /artifacts
COPY package.json tools/.npmrc yarn.lock /service/
RUN --mount=type=secret,id=NPM_TOKEN NPM_TOKEN=$(cat /run/secrets/NPM_TOKEN) \
  yarn install --network-timeout 1000000 --production --frozen-lockfile && \
  mv node_modules /artifacts/
RUN --mount=type=secret,id=NPM_TOKEN NPM_TOKEN=$(cat /run/secrets/NPM_TOKEN) \
  yarn install --network-timeout 1000000 --frozen-lockfile

COPY tsconfig.json tslint.json .eslintrc.cjs /service/
COPY tools/ /service/tools/

RUN mkdir -p src/artifacts/schemas
COPY src/*.ts src/
COPY src/grafana src/grafana

ENV NODE_ENV=production

RUN <<EOR
eslint .
tools/schemas.sh
tsc -p tsconfig.json
esbuild --bundle --format=esm --platform=node "--log-level=${LOGLEVEL:-info}" --sourcemap=linked \
  --packages=external "--external:/run/*" --alias:src=/service/src \
  --outdir=dist src/index.ts
mv dist /artifacts/
cp package.json /artifacts/
EOR

FROM node:20-alpine
WORKDIR /grafana-unfurl

COPY --from=build /artifacts/ /grafana-unfurl/

ENTRYPOINT ["node", "dist/index.js"]
