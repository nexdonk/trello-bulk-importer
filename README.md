# Trello Bulk Importer

A local web app for bulk-importing CSV files into Trello with the official Trello REST API.
It groups cards into lists, creates any missing lists and labels, shows real progress while it
imports, and keeps a local history of every import.

Built with Node.js, TypeScript, Express, React, Vite, Tailwind CSS, shadcn/ui-style components and
SQLite (Node's built-in `node:sqlite`, so there are no native modules to compile).

## Requirements

- Node.js **22.13 or newer** (24 recommended)
- A Trello account, plus an API key and token

## Quick start

```bash
npm install
npm run dev
```

Then open **http://localhost:3000**.

1. Go to **Settings** and paste your Trello API key and token, then click **Save & test**.
2. On the **Dashboard**, drop a CSV file onto the upload area.
3. Check the column mapping and the validation results.
4. Pick an existing board or create a new one.
5. Review the preview and click **Start import**.
6. Watch the progress screen, then review the results. You can retry failed cards or export an error report.

### Getting Trello credentials

1. Open https://trello.com/power-ups/admin and create a Power-Up (or open an existing one) to get an **API key**.
2. On the API key page, follow the **Token** link and approve access to generate a **token**.
3. Paste both into the Settings page. The app checks them against Trello (`GET /1/members/me`) before saving.

You can also set them by hand: copy `.env.example` to `.env` and fill in `TRELLO_API_KEY` and `TRELLO_API_TOKEN`.

## CSV format

| Column           | Required | Purpose                                         |
| ---------------- | -------- | ----------------------------------------------- |
| List Name        | yes      | Trello list the card goes into                  |
| Card Name        | yes      | Card title                                      |
| Card Description | no       | Card description (kept verbatim, multiline OK)  |
| Labels           | no       | Labels, separated by commas or semicolons       |

```csv
List Name,Card Name,Card Description,Labels
Combat,Berserk,"On kill: +15% movement speed and +20% fire rate.",V2 Combat
Driving,Fuel Saver,"Reduce fuel consumption by 10%.",V2 Driving
```

- Headers are detected automatically and can be remapped in the UI (for example `Title`, `Tags`, `Details`).
- UTF-8 with or without a BOM, CRLF or LF line endings, quoted commas, escaped quotes (`""`) and multiline fields are supported.
- Lists are detected from the data, in the order they first appear. Nothing is hardcoded.
- Duplicate cards (same list and card name) are flagged and skipped by default.
- Rows missing a list name or card name are reported as errors before anything is sent to Trello.

## How an import works

1. Validate the Trello credentials.
2. Parse and validate the CSV.
3. Load (or create) the destination board.
4. Load the board's open lists and match them to the CSV list names (case-insensitive).
5. Create missing lists, in CSV order.
6. Create missing labels (existing labels with the same name are reused).
7. Create each card in its list, with its description and labels.
8. Save the results to the local history database.

A card is only counted as imported after Trello returns the created card. Temporary failures
(HTTP 429, 5xx, network errors) are retried with exponential backoff, and `Retry-After` is honored.
Permanent errors (400, 401, 403, 404) are not retried. Requests are rate-limited to stay under
Trello's limits of 100 requests per 10 seconds per token.

Progress is streamed to the browser with Server-Sent Events and is based on completed API calls only.
Cancelling stops after the request in flight; that card is reported as failed (it may or may not
exist in Trello) rather than imported.

## Scripts

| Command             | What it does                                         |
| ------------------- | ---------------------------------------------------- |
| `npm run dev`       | Start the server with Vite middleware on port 3000   |
| `npm run build`     | Build the client and compile the server to `dist/`   |
| `npm start`         | Run the production build                             |
| `npm test`          | Run the test suite (Vitest)                          |
| `npm run typecheck` | Type-check client and server                         |

## Configuration (`.env`)

| Variable           | Default     | Notes                                   |
| ------------------ | ----------- | --------------------------------------- |
| `TRELLO_API_KEY`   |             | Set from the Settings page or by hand   |
| `TRELLO_API_TOKEN` |             | Set from the Settings page or by hand   |
| `HOST`             | `127.0.0.1` | Server binds to localhost only          |
| `PORT`             | `3000`      |                                         |
| `MAX_UPLOAD_MB`    | `5`         | CSV upload size limit                   |

## Security

- Credentials live only in `.env` on your machine, which is git-ignored.
- All Trello calls are made by the backend. The browser never receives the key or token; the UI only shows the last four characters of the key.
- Credentials are sent to Trello in the `Authorization` header, not in URLs, and are redacted from logs.
- The import history database (`data/imports.sqlite`) never stores credentials.
- Uploads are size-limited, stored under random file names in `uploads/`, never executed, and removed after 24 hours.
- The server binds to `127.0.0.1` by default.

## Project structure

```text
src/
├── client/            React app (pages, components, hooks, lib)
├── server/
│   ├── routes/        Express routers (settings, trello, csv, imports, stats)
│   ├── services/      trello.service.ts (API client, retries, rate limiting), upload-store.ts
│   ├── imports/       csv-parser.ts, validator.ts, import-engine.ts
│   ├── database/      SQLite setup and import history repository
│   └── utils/         errors, logger
└── shared/            API types shared by client and server
data/                  SQLite database (git-ignored)
uploads/               Uploaded CSVs (git-ignored)
tests/                 Vitest tests and CSV fixtures
```

## Troubleshooting

- **"Trello rejected the API key or token"**: generate a new token from the API key page and save it again in Settings.
- **Port 3000 in use**: set `PORT` in `.env`.
- **`ExperimentalWarning: SQLite`**: harmless on some Node versions; the app hides it.

## Testing without a Trello account

`scripts/mock-trello.mjs` is a small local stand-in for the Trello endpoints the app uses.

```bash
node scripts/mock-trello.mjs 4010
# in another terminal (PowerShell: $env:TRELLO_API_BASE_URL="http://127.0.0.1:4010/1"; npm run dev)
TRELLO_API_BASE_URL=http://127.0.0.1:4010/1 npm run dev
```

Any key/token of the right shape is accepted by the mock. `TRELLO_API_BASE_URL` is only honored
for loopback addresses, so credentials can never be sent to another host. Leave it unset for real use.

`npm test` runs unit tests plus an end-to-end test that imports the sample CSV
(`tests/fixtures/sample-import.csv`) through the full stack against a mock Trello server.

## License

MIT. See [LICENSE](LICENSE).
