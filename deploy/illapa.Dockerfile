# syntax=docker/dockerfile:1

FROM node:24-slim AS build
RUN corepack enable
WORKDIR /app
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
	pnpm install --frozen-lockfile --store-dir /pnpm/store

ARG PUBLIC_APP_URL
ARG PUBLIC_API_URL
# Vite bakes any PUBLIC_* variable present in the environment over the .env
# files, even an empty one, so an empty build arg would ship an empty URL.
# Unset, apps/illapa/.env.production supplies the production URLs instead.
RUN if [ -z "$PUBLIC_APP_URL" ]; then unset PUBLIC_APP_URL; fi \
	&& if [ -z "$PUBLIC_API_URL" ]; then unset PUBLIC_API_URL; fi \
	&& pnpm --filter illapa build

FROM nginx:stable-alpine
COPY deploy/illapa.nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/illapa/dist /usr/share/nginx/html
EXPOSE 80
