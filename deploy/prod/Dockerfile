FROM node:20-alpine AS build
WORKDIR /build
ARG NPM_TOKEN
ENV PATH=$PATH:/build/node_modules/.bin

RUN mkdir /artifacts
COPY package.json tools/.yarnclean tools/.npmrc yarn.lock /build/
RUN yarn install --production --frozen-lockfile && mv node_modules /artifacts/ && rm .yarnclean
RUN yarn install --frozen-lockfile

COPY tsconfig.json tslint.json /build/
COPY tools/ /build/tools/

RUN mkdir -p src/artifacts/schemas
COPY typings typings/
COPY src/*.ts src/
COPY src/grafana src/grafana

ENV NODE_ENV=production

RUN tslint -p tsconfig.json
RUN tools/schemas.sh
RUN tsc -p tsconfig.json
RUN mv dist /artifacts/

FROM node:20-alpine
WORKDIR /grafana-unfurl

COPY --from=build /artifacts/ /grafana-unfurl/

ENTRYPOINT ["node", "dist/index.js"]
