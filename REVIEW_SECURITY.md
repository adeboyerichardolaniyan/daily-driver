# Security Requirements

## Threat model

- **Users:** one person, three devices (two Macs + phone browser) plus a Mac mini print worker. No multi-tenant concerns yet, but auth and authorization are still required.
- **Primary risks:**
  - Secrets leaking into the browser bundle, logs, QR codes, or printed receipts.
  - Supplied content (attachments, fetched pages, calendar feeds, AI output) being treated as instructions that authorize actions.
  - QR codes on physical paper granting unauthenticated task modification if lost or photographed.
  - The receipt printer being reachable from the public internet.
  - AI responses or sync messages overwriting user edits made during their round trip (integrity, not just correctness).
- **Out of scope initially:** multi-user access control, org/tenant isolation, SSO, compliance regimes (HIPAA/PCI/etc.).

## Authentication and authorization

- Even for a single user, every server-reachable surface must require authentication. When reviewing a new endpoint, worker handler, sync channel, attachment URL, AI job route, or print job route, verify an auth check runs before any read or write. Flag endpoints that rely on obscurity ("no one else knows the URL").
- When reviewing QR-code generation and the task landing page it opens:
  - Flag any QR payload that embeds credentials, long-lived tokens, session cookies, or any value that grants write access without an interactive auth step.
  - Verify the landing page requires the normal user authentication before allowing task completion or edits.
  - Prefer stable task identifiers in the QR payload; the URL itself should not be a capability.
- When reviewing the Mac mini print worker, verify it establishes an **outbound** authenticated connection to the job source. Flag any design that exposes an inbound port on the worker or the printer to the public internet.

## Secrets handling

- Flag any provider credentials (AI, calendar, storage, hosting, weather, auth) shipped to the browser bundle or Tauri front-end. They belong on server/worker surfaces.
- Private calendar subscription URLs (Google/Outlook iCal) are secrets; flag any code that logs them, embeds them in client state beyond what's needed, or exposes them via an unauthenticated endpoint.
- Flag secrets printed on receipts, included in QR codes, or written to client-visible logs.

## Treating content as context, not authority

- When reviewing attachment ingestion, web-page fetching, or AI prompt construction, verify fetched or user-supplied content is passed as data/context only. Flag any code path where instructions found inside attachments or fetched pages can trigger side effects (deleting tasks, approving plans, changing preferences, calling tools, altering permissions).
- When reviewing AI tool-calling or function-calling (if introduced), flag tools that can mutate user data without the proposal → review → approve flow the spec requires.

## Webhooks and inbound integrations

- No webhook surfaces are specified in the current scope. When a PR adds one (e.g., for calendar push notifications, AI provider callbacks, or payment), flag it for explicit review of signature verification, replay protection, and the auth model. Do not approve webhook handlers that lack signature verification tied to a shared secret held server-side.

## Idempotency and data integrity

- Flag approval flows (accepting an AI plan, approving a daily briefing, submitting a print job) that are not idempotent. Retries must not duplicate tasks, plans, or physical prints.
- Flag print retry logic that proceeds automatically through "uncertain" outcomes. Uncertain delivery must surface to the user for an explicit retry decision.

## Privacy

- User task content, attachments, and calendar events are personal data. Flag anything that sends this content to a third party (model provider, analytics, error tracker) without an obvious, user-controllable reason.
- Flag client-side error reporting that includes task titles, attachment contents, or calendar event details by default.

## Accessibility-adjacent safety

- State must never rely solely on sound or color. When reviewing new feedback, confirm there is a non-audio, non-color-only indicator. (Listed here because misuse can hide critical state like "print failed" or "AI proposal needs review".)

## Things NOT to flag

- Lack of multi-user RBAC, roles, or permission matrices. Single-user product.
- Lack of audit logging infrastructure beyond what's needed for user-facing state (proposal history, print job history).
- Allowing the cloud AI to process user-supplied context. The spec explicitly permits this.
- Absence of CSRF protection on pure Tauri-to-local-SQLite paths (there is no browser origin involved). Still required for any browser-reachable server endpoint.
