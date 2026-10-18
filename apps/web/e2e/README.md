# web E2E (Maestro)

Maestro flows that drive the web app in Chromium against a deployed stack. They default to staging (`https://app-staging.52-21-151-223.sslip.io`, deployed from `develop`). Every run starts a fresh browser.

## Run

Maestro needs Java 17+ (`JAVA_HOME`). From `apps/web/e2e`:

```bash
maestro test --headless --screen-size 1440x3000 \
  -e APP_URL=https://app-staging.52-21-151-223.sslip.io \
  -e EMAIL=<fleet user> -e PASSWORD=<password> \
  flows/fleet/revisar-ruta-golden-path.yaml
```

- Credentials are always passed with `-e EMAIL` / `-e PASSWORD` and never written into a flow. The engineer flows need an account with the engineer role.
- Long pages need a tall `--screen-size`. Maestro can only reach elements inside the viewport and can't scroll the app's inner panels. Phone flows use `--screen-size 390x844`.
- `flows/fleet/revisar-ruta-demo.yaml` signs in through the public `/demo`, which shares the demo org and its sign-in rate limit with everyone, so don't loop it.

## Data

The fleet flows connect the demo GPS fleet if the account has no vehicles, then plan, start and cancel their own trips. Run them against staging only: they write to the account they sign in with.
