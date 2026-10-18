# syntax=docker/dockerfile:1

# One image per Worker app run as a Node service (see deploy/README.md):
#   docker build -f deploy/node-service.Dockerfile --build-arg APP=server .

FROM node:24-slim AS build
RUN corepack enable
WORKDIR /app
COPY . .
# Same steps as web.Dockerfile up to here so both builds share this layer.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
	pnpm install --frozen-lockfile --store-dir /pnpm/store

ARG APP
RUN case "$APP" in \
		server|scraper|fleet-sync) ;; \
		*) echo "Build with --build-arg APP=server|scraper|fleet-sync" >&2; exit 1 ;; \
	esac \
	&& pnpm --filter "$APP" build:node

FROM node:24-slim
ARG APP
ENV NODE_ENV=production
ENV PORT=3000
WORKDIR /app
COPY --from=build /app/apps/$APP/dist-node ./
USER node
EXPOSE 3000
CMD ["node", "node.mjs"]
