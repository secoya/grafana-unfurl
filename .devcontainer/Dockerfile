FROM node:10-alpine3.9

RUN apk --no-cache add git bash zsh libressl libressl-dev zlib zlib-dev libgcc libstdc++
COPY --from=icalialabs/watchman:alpine3.9 /usr/local/bin/watchman* /usr/local/bin/
RUN mkdir -p /usr/local/var/run/watchman && \
	touch /usr/local/var/run/watchman/.not-empty && \
	chown -R node:node /usr/local/var/run/watchman
