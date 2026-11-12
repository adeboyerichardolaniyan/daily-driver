# Hosted web app

Public URL: https://daily-driver-liard.vercel.app

Vercel project: `daily-driver` in `adeboye-richard-olaniyans-projects`.
The Vercel production frontend connects to the existing **development** Convex deployment, `harmless-dolphin-909`, to retain the personal workspace and Mac mini connection. This is not a migration to a separate Convex production database.

Open Settings & connections and sign in with the existing workspace account. An unsigned browser starts with local data; it does not automatically show the synced account. Public account registration remains disabled.

Vercel production and preview configuration:
- `VITE_CONVEX_URL=https://harmless-dolphin-909.convex.cloud`
- `VITE_PUBLIC_APP_URL=https://daily-driver-liard.vercel.app`

Both are public configuration. OpenAI keys and worker secrets stay in Convex / the mini, not Vercel's browser environment.

Convex `SITE_URL` uses this public URL. Scheduled briefings originally configured with a placeholder URL fall back to it for future snapshots. Previously saved receipts remain immutable.

Deployments currently use the authenticated Vercel CLI. Automatic GitHub linking failed during setup; pushes do not automatically deploy this project. To deploy current local code:

```sh
vercel pull --yes --environment=production
vercel build --prod
vercel deploy --prebuilt --prod --yes
```

`.vercelignore` excludes environment files, local worker data, the native build, and tool folders. `.vercel` is git-ignored. The frontend build includes the SQLite/worker assets and PWA files. Browser smoke checks passed on Chromium and WebKit at phone size; account sign-in itself still requires the user's credentials.

## Web updates

The offline service worker activates new builds without leaving them waiting behind an old open tab. The app shows **An update is ready → Refresh app** instead of automatically reloading and discarding unsaved edits. It checks again when a tab becomes visible, when connectivity returns, and every five minutes while visible. Saved local data and offline access are preserved. Native builds use the Mac updater and omit the web service worker.

The legacy `/registerSW.js` URL remains available so older cached pages can register the new worker. Both registration and worker scripts are served with `no-cache`. `/updates/` downloads are excluded from offline navigation fallback. Production browser tests exercise migration from a waiting worker, an explicit refresh after saving a draft, and an offline reload in Chromium and WebKit.
