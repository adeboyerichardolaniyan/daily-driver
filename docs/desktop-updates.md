# Desktop updates

Daily Driver 0.2.0 adds Settings & connections → App updates:
Check for updates → Download & install → Restart app.

Install 0.2.0 manually once on each Apple Silicon Mac. Earlier versions do not contain an updater. Put the app in Applications (or ~/Applications if that is the writable location), not inside a mounted image or Downloads archive. Later desktop releases install in place. Local SQLite data, login and settings stay in the application data directory; the updater does not delete them. The Mac mini print worker is a separate installation and is not updated by this feature.

## Trust and hosting

The official Tauri updater verifies signed packages and signed version metadata before installation. HTTPS is required and downgrade support is disabled. Only the main window has updater/restart permissions. Update checks and installation are user-triggered; installation does not automatically restart macOS apps.

Manifest: https://daily-driver-liard.vercel.app/updates/latest.json

Packages use versioned URLs under /updates/. The manifest is served with no-store. It is excluded from the SPA rewrite. The updater uses native networking, not browser eval or arbitrary downloaded JavaScript.

The updater signature is distinct from the app bundle's ad-hoc macOS code signature. The bundle uses Tauri's `signingIdentity: "-"` setting, and the release script verifies it with `codesign --verify --deep --strict` before staging the update. First installation can still require macOS's Open Anyway approval. Apple Developer signing/notarization is not configured. See [Tauri's ad-hoc signing guidance](https://v2.tauri.app/distribute/sign/macos/#ad-hoc-signing).

The signing key was generated locally at ~/.config/daily-driver/updater.key, outside this repository, with private permissions. Only its public key is embedded in the app. Back up the private key securely: losing it prevents publishing updates accepted by installed copies. Do not commit or upload it, or copy it to client Macs.

## Publishing the next release

1. Set the same new version in package.json, src-tauri/tauri.conf.json and src-tauri/Cargo.toml; update lockfiles.
2. Write release notes, for example docs/releases/0.2.1.md.
3. Run checks and prepare the signed optimized native build:

```sh
npm run typecheck
npm test
TEST_PRODUCTION=1 npx playwright test tests/e2e/command-layout.spec.ts
npm run desktop:release -- docs/releases/0.2.1.md
```

The release script uses the key above, or TAURI_SIGNING_PRIVATE_KEY and optional TAURI_SIGNING_PRIVATE_KEY_PASSWORD from the publishing environment. It builds the Apple Silicon .app, generates the signed .app.tar.gz, stages public/updates/latest.json and its archive in .desktop-releases, and creates a first-install ZIP in src-tauri/target/release/bundle/macos.

Run the command palette layout check against the production build: CSS optimization can change positioning even when the development view passes. The check covers fully visible controls, horizontal centering, and small Mac windows in Chromium and WebKit.

4. Publish through the existing Vercel project:

```sh
vercel build --prod
vercel deploy --prebuilt --prod --yes
```

Do not reuse a version number for a published release. Installed apps only offer newer versions. A web-only deployment does not become a desktop update until a new native package is built and published.

Commit the manifest with the corresponding source changes when committing a release. Binary archives in .desktop-releases are git-ignored. The web postbuild step copies them to dist/updates; native builds omit them. Ordinary web builds restore a missing referenced archive from the published site and verify its SHA-256, so a clean checkout deployment preserves the desktop download. A brand-new unpublished release must be deployed from the checkout containing its generated archive. Missing or mismatched archives fail the build rather than publishing a broken update feed.

The release script does not publish automatically. It requires macOS/Apple Silicon and currently produces only darwin-aarch64 packages. Intel/universal builds and remote CI signing are not configured.

## Verification

Unit tests cover explicit install/restart, offline checks, duplicate requests, and failed installation/signature verification behavior. Native release compilation and updater package generation are checked separately. Signature verification must reject a changed artifact. An actual in-place upgrade on a second Mac still needs validation with the next version; do not treat mocked UI tests as proof of OS-level replacement.
