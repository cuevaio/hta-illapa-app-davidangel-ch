# DB
When working with drizzle, change the schema folder, then run `pnpm db:generate --name <change>` and commit the migration it writes in the same PR. Never hand-write or edit files in the migrations folder, and never `db:push` to a shared database.
# Code rules

- Never write a function that will be called only once and is small enough to be inlined. Prefer legibility over encapsulation.
- Dont over normalize strings, always try to see if we are already enforcing the constraints elsewhere or we are certain this datapoint is not going to be malformed.
- If some shared logic or some business/money related logic is inserted in some app, it should be noted withing the business package, not loose on an app
- If a ui component or new icon is used or created, it should be extracted to the ui shared package.
- MUST: Use TypeScript interfaces over types.
- MUST: Default to NO comments. Only add a comment when the user explicitly asks, or when the "why" is truly non-obvious - browser quirks, platform bugs, performance tradeoffs, fragile internal patching, or counter-intuitive design decisions. Never add comments that restate what the code does or what a well-named function/variable already conveys. When in doubt, leave the comment out.
- NEVER delete existing comments that explain "why" something exists (diagnostic logs, workaround rationale, design decisions, etc.). When refactoring around commented code, preserve the comment in its new location.
- MUST: Use descriptive names for variables (avoid shorthands, or 1-2 character names).
- MUST: Frequently re-evaluate and refactor variable names to be more accurate and descriptive.
- MUST: Do not type cast ("as") unless absolutely necessary
- MUST: Remove unused code and don't repeat yourself.
- MUST: Always search the codebase, think of many solutions, then implement the most _elegant_ solution.
- MUST: Put all magic numbers in `constants.ts` using `SCREAMING_SNAKE_CASE` with unit suffixes (`_MS`, `_PX`).
- MUST: Use Boolean over !!.

# Git commits

- Commits should be atomic, meaning that they should not contain multiple changes.
- Commits summary should have a scope, following the format `{type}({scope}): {description}`.
- Commit types:
  - feat: new feature
  - fix: bug fix
  - docs: documentation
  - style: formatting, missing semi colons, etc; no code change
  - refactor: refactoring production code
  - test: adding missing tests, refactoring tests; no production code change
  - chore: updating build tasks, package manager configs, etc; no production code change
  - ci: updating CI configs, github actions, etc; no production code change

# After code changes

- Run `pnpm format:write` to format the code.
- Run `pnpm check-types` to check the types.

# Architecture

- Server env is read through `apps/server/src/env.server.ts`, never `process.env` or `c.env`. It imports `env` from `cloudflare:workers`, which the Node bundles alias to `process.env` (`packages/node-runtime`). Add a variable in four places: the app's `.env.schema`, its `.env` (secret) or `.env.production` (public URL), the alchemy `env` map in `packages/infra` (local `pnpm dev`), and the Dokploy env of both the staging and production service. The Node images don't run varlock, so `.env.schema` defaults never apply on Dokploy.
- Every server route is protected by the global auth guard in `apps/server/src/index.ts`. Public routes must be added explicitly to `PUBLIC_PATHS` (server) or `PUBLIC_PROCEDURE_PATHS` (`packages/api/src/constants.ts`).
- Trusted origins (CORS + better-auth) come from the comma-separated `ALLOWED_ORIGINS`.
- db, auth and session are built once per request in the guard middleware and shared via `c.set`/oRPC context. Never create a db connection or auth instance in module scope.
- Logging is evlog: one wide event per request. Use `context.log.set({ <domain>: {...} })` in procedures and `c.get("log")` in Hono routes; never `console.log`.
- The MySQL 8.4 on the Dokploy server holds `illapa` (production) and `illapa_staging`. Every table goes through `mysqlTable` from `packages/db/src/schema/_table.ts` (`hack_the_andes_` prefix) and has no FOREIGN KEY constraints.
- mysql2 batching shares one connection per request: never use `db.transaction()` in app code.
