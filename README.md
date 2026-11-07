# Daily Driver

A personal, local-first workspace for small steps, focused work, and printed daily briefings. Built with React, shadcn/ui, Tauri, Convex, and SQLite/PowerSync.

## Run locally

Requires Node.js 24+. The Mac build also requires Rust and Xcode command-line tools.

```sh
npm ci
npm run dev
```

Open `http://127.0.0.1:1420`. No cloud credentials are needed for local tasks and focus. Use **Use portfolio example** for the editable sample workflow.

```sh
npm run desktop
```

Build an unsigned local Mac bundle:

```sh
npm run tauri -- build --debug --bundles app
```

## Current capabilities

- Persistent local tasks, project hierarchy, editing, completion, archive/restore, and Today/backlog organization.
- Focus timer, pause/resume, switching, later-today deferral, immersive view, and a separate focus window.
- Same-device window continuity, append-only edit history, and JSON export.
- Responsive browser interface and cached production app shell for offline reloads.
- Convex Auth and direct reactive synchronization with a durable local upload queue.
- Receipt preview, stable task QR links, print queue, and a persistent Mac mini worker using the macOS print spooler.

Cloud synchronization uses ordinary Convex queries/mutations and works on the Free plan within its quotas. The PowerSync library is used only for local SQLite; no PowerSync service is required. Cloud synchronization and physical printing require setup and have not yet been verified against the user's deployed services or printer. AI generation, calendar integration, automatic daily planning, scheduled printing, the visual receipt editor, and sound feedback are later stages.

## Documentation

- [Project specification](docs/project-spec.md)
- [Stage 1 architecture, setup, and verification](docs/stage-one.md)

## Validation

```sh
npm run typecheck
npm test
npx playwright install chromium webkit
npm run test:e2e
npm run test:offline
cargo check --manifest-path src-tauri/Cargo.toml
```

`test:offline` builds and tests the production service worker in Chromium and WebKit. Tests use isolated browser profiles; they do not clear the installed app's data.
