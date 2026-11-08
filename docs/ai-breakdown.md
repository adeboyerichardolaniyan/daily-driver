# AI task breakdown

Open **Assistant** to describe a new goal or select an existing task. Use **Make it easier** in the focus card for a smaller breakdown.

Requests are saved in the existing local event log. They upload when the app is signed in and connectivity returns. Drafts sync back through the same event stream and are available offline after download.

## Review and approval

- Generated steps contain a title, context, estimated minutes, and an observable completion criterion.
- Edit or remove individual steps before approval.
- Approval creates children of the existing task, or a new project for a new goal.
- Choose Today or the inbox when approving.
- Generation never creates active tasks. Approval only adds children; it does not replace source text or existing steps.
- Changed source text triggers a review acknowledgement. Completed/archived source tasks block approval.
- Stable proposed step IDs and terminal approval/cancellation states prevent duplicate tasks on replay.
- Canceling a request suppresses late results. An already-running provider call may still finish.
- Draft edits become durable when saved in the step editor. Unsaved form text is not synchronized.

## Enable generation later

In the Convex dashboard for **dev:harmless-dolphin-909**, add the server environment variable **OPENAI_API_KEY**. Do not put it in a VITE variable or the frontend.

Optional: set **OPENAI_MODEL** to a Responses API model supporting strict structured outputs. Default: **gpt-4.1-mini**.

Missing-key requests stay queued on the server. A scheduled action checks once per minute and resumes up to ten waiting requests once the key exists. Offline requests must first sync from the device.

Invalid credentials, provider errors, invalid output, and timeouts are shown with a retry action. Retry creates a fresh request; the previous request is discarded. No fallback text is presented as generated output.

Implementation uses [OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses), followed by Zod validation. Keys remain in Convex; calls set `store: false`. Current context includes task text, optional instructions, and direct child titles. Calendar-aware planning is implemented separately; see [Calendar planning](calendar-planning.md). Attachment extraction and conversational chat remain future work.

## Architecture

- `src/domain/ai.ts`: shared request/draft schemas.
- `src/domain/workspace.ts`: proposal projection and approval semantics.
- `convex/workspace.ts`: authenticated durable request upload; rejects client-forged generation results.
- `convex/aiJobs.ts`: idempotent enqueue, claim, cancellation, guarded completion and timeout.
- `convex/ai.ts`: bounded structured generation in an internal action.
- `convex/crons.ts`: resume requests after configuration.
- `src/components/ai-panel.tsx`: capture, status, review, editing, and approval.

This is one-shot structured drafting, not a conversational assistant with threads or tools, so it does not require an agent/RAG component or a paid gateway.

## Validation and remaining limitation

43 unit/backend tests and 16 production-browser tests pass. Coverage includes delayed/canceled results, duplicate approval, missing-key resume, forged results, source edits, offline request persistence and deletion, task/calendar regressions, and cross-window focus.

A separate isolated browser fixture exercised draft editing, removal, and approval. Provider responses are mocked in tests; no live generation has been verified because the OpenAI key is intentionally deferred.
