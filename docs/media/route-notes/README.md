# Route notes: local demo evidence

Recorded on 2026-10-20 against the real app running locally, not a mock page:

- Server: the Node bundle (`pnpm --filter server build:node`, then `node dist-node/node.mjs`) on `127.0.0.1:4713`. It ran its migrations against a local MySQL 8.4 on `127.0.0.1:4714`.
- Dashboard: `apps/web` running on `vite dev` at `127.0.0.1:4718`, signed in through the real `/demo` flow.
- Atomic Memory: **`atomic-memory-demo-fixture.mjs`, a labelled local fixture, not Atomic Memory Cloud.** It runs on `127.0.0.1:4716` and implements only the routes the feature calls (`POST /v1/memories/ingest/quick`, `GET /v1/memories/by-external-id/:id`, `DELETE /v1/memories/:id`).

| File | What it shows |
| --- | --- |
| `route-notes-flow.webm` | Save, reload and recall, correct, reload, delete, reload |
| `route-notes-flow.contact-sheet.png` | Frames from that video |
| `01-empty-card.png` | Revisar ruta, Lima → Huancayo, with no note yet |
| `02-saved.png` / `03-recalled-after-reload.png` | The note after it is saved, and again after a reload |
| `04-corrected.png` / `05-correction-after-reload.png` | The corrected note replaces the first one, and stays after a reload |
| `06-deleted.png` / `07-deleted-after-reload.png` | After deletion the card is empty again, including after a reload |
| `08-second-demo-visitor-no-note.png` | A second demo visitor in a separate browser session does not see the first visitor's note |
| `09-memory-down-unavailable.png` | With the fixture stopped, the card says the note could not be read, and route review still works |
