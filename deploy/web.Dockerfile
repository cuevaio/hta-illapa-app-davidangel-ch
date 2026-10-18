# syntax=docker/dockerfile:1

FROM node:24-slim AS build
RUN corepack enable
WORKDIR /app
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
	pnpm install --frozen-lockfile --store-dir /pnpm/store

ARG VITE_SERVER_URL
RUN test -n "$VITE_SERVER_URL" \
	|| { echo "VITE_SERVER_URL is required; set --build-arg VITE_SERVER_URL for this environment" >&2; exit 1; }
RUN pnpm --filter web build

FROM nginx:stable-alpine
COPY deploy/web.nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
