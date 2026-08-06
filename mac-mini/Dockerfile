FROM node:22-alpine

RUN apk add --no-cache openssh-client
WORKDIR /app
COPY server.mjs ./
COPY public ./public
# Stamp both UIs while the Docker image is built.  The source files retain a
# stable fallback value, but every rebuilt image exposes its own build ID.
# An explicit KHNC_BUILD/KHNC_BUILT_AT can be supplied for reproducible builds.
ARG KHNC_BUILD
ARG KHNC_BUILT_AT
RUN build="${KHNC_BUILD:-$(date -u +%Y%m%d.%H%M%S)}"; \
    built_at="${KHNC_BUILT_AT:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"; \
    BUILD_ID="$build" BUILT_AT="$built_at" node -e 'for (const file of process.argv.slice(1)) { const fs = require("fs"); const value = JSON.parse(fs.readFileSync(file, "utf8")); value.build = process.env.BUILD_ID; value.builtAt = process.env.BUILT_AT; fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\\n"); }' public/version.json public/mobile/version.json
EXPOSE 9081
CMD ["node", "server.mjs"]
