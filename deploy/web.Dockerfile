# syntax=docker/dockerfile:1

FROM node:24-slim AS build
RUN corepack enable
WORKDIR /app
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
	pnpm install --frozen-lockfile --store-dir /pnpm/store

ARG VITE_SERVER_URL
# Vite bakes any VITE_* variable present in the environment over the .env
# files, even an empty one, so an empty build arg would ship an empty API URL.
# Unset, apps/web/.env.production supplies the production URL instead.
RUN if [ -z "$VITE_SERVER_URL" ]; then unset VITE_SERVER_URL; fi \
	&& pnpm --filter web build

FROM nginx:stable-alpine
COPY deploy/web.nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
