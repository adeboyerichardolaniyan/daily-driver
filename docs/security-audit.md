# Security audit and hardening — 2026-11-07

Scope: current working tree, React web/PWA, Tauri shell, Convex backend, and Mac mini receipt worker. This is a source-led security review with local regression tests, not a penetration test or certification. Existing unrelated changes were retained.

## Results

No critical/high remotely exploitable issue was demonstrated in the reviewed paths. The personal workspace requires a provisioned owner; public registration is disabled. An authenticated non-member cannot read or modify the workspace. The worker secret grants print-job access, not general workspace access.

### Medium: missing web browser containment — fixed

The Vercel configuration only set nosniff. The hosted app had no application-defined CSP or anti-framing policy. This was a missing defense, not evidence of an existing XSS exploit.

Added CSP restricting scripts, connections, workers, images, frames and fonts; denied objects, base URL changes and framing by other sites. Added X-Frame-Options, no-referrer and camera/microphone/geolocation restrictions. Inline styles remain necessary for the UI and receipt preview; arbitrary inline scripts and JavaScript eval are not allowed. WebAssembly compilation remains allowed for SQLite. Zod uses interpreted validators to avoid eval under this policy.

Validation: the production build starts its local database and renders the sandboxed receipt preview in Chromium and WebKit with no page errors or CSP violations. The test uses the exact Vercel header configuration. It does not cover every UI interaction or an authenticated live session.

### Medium: unbounded aggregate manual receipt size — fixed

An authenticated owner could submit a receipt containing many individually valid large fields. Schema limits alone allowed a very large aggregate input to the renderer. Added a 500,000-byte submission limit before parsing/storage. Scheduled receipts already have a smaller aggregate limit. This is resource-abuse containment, not an authentication bypass.

### Low: cloud identifiers used directly as worker paths — hardened

The worker constructed PDF/JSON paths from the claimed job ID. Public enqueue already validates UUIDs and scheduled jobs generate UUIDs, so no public path traversal was demonstrated. The worker now validates IDs itself before constructing either output path, protecting against malformed administrative/imported records.

### Low: worker rendering and filesystem isolation — hardened

Rendering now disables page JavaScript and service workers in addition to blocking network requests. Receipt text was already HTML-escaped and the UI preview sandboxed.

The worker and installer now use a private umask. Existing state/log directories are tightened to 0700; installation tightens the worker env file to 0600 and sets the LaunchAgent umask. Worker errors uploaded to Convex pass through secret redaction. Existing historical file permissions inside the state directory are not recursively rewritten.

### Low: AI output resource bounds — hardened

Collection and planning generation now have explicit 8,000-token output limits, alongside existing timeouts, no SDK retries and schema validation. Task breakdown already limits output to 4,500 tokens. AI has no shell, arbitrary fetch, printing, or other action tools. Results remain reviewable drafts; plan fitting accepts only known task IDs.

This does not impose an account-level spend quota. A compromised owner session can still request repeated generations. Provider-side spending controls and MFA for administrative accounts remain useful.

## Endpoint inventory

| Surface | Authorization / review |
| --- | --- |
| workspace account, bootstrapPage, head, changes, appendEvents | requireOwner; owner-scoped indexed reads; UUID collision checks; server result events rejected |
| calendars add, refresh, remove | requireOwner; source ownership checked; max 10 sources |
| briefings status | requireOwner; owner-scoped state |
| printing enqueue, list | requireOwner; immutable IDs; validated bounded receipt |
| printing claim, interrupted, finish | server worker secret; owner association; claimant matching; terminal states immutable |
| admin provisionOwner / grantOwner, PDF retry | internal functions only |
| AI, planning, calendar fetching, scheduled briefings | internal functions only; user entry points owner-authorized |
| authentication HTTP routes / signIn | Convex Auth; password sign-in only; registration disabled; installed library throttles failed attempts per identifier |
| Tauri | no custom Rust commands; limited window/webview capabilities; native CSP already configured |

## Other checks

- Calendar SSRF: HTTPS with exact Google/Outlook hostname allowlist, no credentials/custom ports, every redirect revalidated; response size and timeout limits. No arbitrary URL fetch tool for AI.
- Injection: local SQLite uses parameterized values; printer dispatch uses execFile argument arrays, not a shell. HTML receipt fields escaped; UI renders text through React.
- Print replay: output-specific claims, durable local journal, terminal state protection; uncertain physical dispatch is never automatically retried.
- Secrets: pattern-only scan of 409 unique historical Git blobs and current source/build files found no matches for tested private-key/OpenAI/GitHub/AWS credential patterns. Only .env.example appeared in committed env-file history. This is not a full entropy scan or proof that no credential exists.
- Dependency audit: npm audit --omit=dev reports zero vulnerabilities. Full npm audit reports 10 low/moderate dependency nodes in development tooling (deepmerge, glob, minimatch and their shadcn/PWA parent chains); no high/critical findings. Automatic fixes proposed major parent downgrades, so none were applied blindly. Review compatible upstream updates separately.
- No file-upload HTTP endpoint, billing, custom webhook, container or infrastructure configuration was found in the reviewed application paths.
- No analytics/session replay integration found. Calendar subscription URLs remain server-side. AI requests necessarily send supplied task/content context to OpenAI; agent threads also persist in Convex.
- Browser-local workspace data intentionally survives loss of cloud authentication for offline use. The app is not an encrypted vault or a local lock screen. Anyone using the same unlocked OS/browser profile can access cached data. No local data was deleted.
- The public frontend currently uses the existing Convex development deployment. Separate production/dev environments remain an operational follow-up, not an automatic migration performed by this audit.

## Validation and limitations

- 93 unit/backend tests passed, including six new security tests covering anonymous/non-owner access, worker credentials, claimant ownership, terminal replay, receipt size, path traversal, calendar URL bypasses and HTML escaping.
- Separate browser policy test passed in Chromium and WebKit.
- TypeScript checks and production build passed.
- Real Chromium PDF generation/recovery regression passed with scripting disabled.
- gitleaks, semgrep and cargo-audit were unavailable; manual/pattern fallback used. Rust dependency advisory scan, full entropy secrets scan, authenticated live browser testing, infrastructure permissions and Mac mini filesystem inspection were not performed.
- No active vulnerability scanner was run against live hosts.
- Browser/backend changes are deployed; worker filesystem/rendering changes require installing the updated worker bundle on the Mac mini.

## Mac mini update

Download the updated daily-driver-worker.tar.gz, then run in Terminal:

```sh
cd ~/daily-driver-worker
npm run print:service -- stop
tar -xzf ~/Downloads/daily-driver-worker.tar.gz -C ~/daily-driver-worker
npm run print:service -- install
npm run print:preview
```

The archive excludes secrets and state. Extraction preserves your existing .env.worker and output directory. Do not start a separate manual worker alongside the service.
