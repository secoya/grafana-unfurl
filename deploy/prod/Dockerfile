FROM node:10-alpine AS build
WORKDIR /build
ENV PATH=$PATH:/build/node_modules/.bin

RUN mkdir /artifacts
COPY package.json yarn.lock /build/
RUN yarn install --production --frozen-lockfile && mv node_modules /artifacts/
RUN yarn install --frozen-lockfile

COPY tsconfig.json tslint.json /build/
COPY tools/ /build/tools/

COPY src/ /build/src/

ENV NODE_ENV=production

RUN tslint -p tsconfig.json
RUN tsc -p tsconfig.json
RUN mv dist /artifacts/

FROM node:10-alpine
WORKDIR /grafana-unfurl

COPY --from=build /artifacts/ /grafana-unfurl/

ENTRYPOINT ["node", "dist/index.js"]
