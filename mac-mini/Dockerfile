FROM node:22-alpine

RUN apk add --no-cache openssh-client
WORKDIR /app
COPY server.mjs ./
COPY public ./public
EXPOSE 9081
CMD ["node", "server.mjs"]
