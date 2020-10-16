FROM node:10-alpine3.9

RUN apk --no-cache add git bash zsh
RUN wget -O- https://github.com/koalaman/shellcheck/releases/download/v0.7.1/shellcheck-v0.7.1.linux.x86_64.tar.xz | \
	tar -xJC /usr/local/bin --strip-components 1 shellcheck-v0.7.1/shellcheck
