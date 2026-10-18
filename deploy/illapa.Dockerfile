# syntax=docker/dockerfile:1

FROM node:24-slim AS build
RUN corepack enable
WORKDIR /app
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
	pnpm install --frozen-lockfile --store-dir /pnpm/store

ARG PUBLIC_APP_URL
ARG PUBLIC_API_URL
RUN test -n "$PUBLIC_APP_URL" \
	|| { echo "PUBLIC_APP_URL is required; set --build-arg PUBLIC_APP_URL for this environment" >&2; exit 1; }
RUN test -n "$PUBLIC_API_URL" \
	|| { echo "PUBLIC_API_URL is required; set --build-arg PUBLIC_API_URL for this environment" >&2; exit 1; }
RUN pnpm --filter illapa build

FROM nginx:stable-alpine
COPY deploy/illapa.nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/illapa/dist /usr/share/nginx/html
EXPOSE 80
