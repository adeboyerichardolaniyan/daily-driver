# UI polish — November 6, 2026

Keep the Linear-inspired charcoal workspace, Geist typography, shadcn primitives, and restrained warm accent. Prioritize task content over decorative copy.

## Guidance applied

Combined the relevant guidance from better-ui, better-typography, better-colors, Emil design engineering, web-animation-design, frontend-design, redesign-existing-projects, and shadcn: readable hierarchy, consistent surfaces, usable targets, responsive forms, keyboard behavior, and restrained motion. Marketing-page layouts, brutalist restyling, generated imagery, and cinematic animation do not fit this existing productivity app. React Doctor checks implementation health.

## Copy and information hierarchy

| Before | After |
| --- | --- |
| Promotional headings across all six pages | Today, Inbox, Projects, Briefings, Settings, Archive |
| Repeated page descriptions, workspace eyebrow, motivational footer | Date on Today; task content and actions elsewhere |
| Fake brand dropdown, duplicate plus hint, decorative collapse icon | Only working navigation controls |
| Static workspace profile and status decoration | Actual local/sync status remains visible |
| Generic fallback context in focus panel | Notes and ancestry appear only when provided |
| Long focus eyebrow and secondary action | Next step / In focus; Add a smaller step |
| Multi-paragraph assistant pitch | One explanation of approval-based AI planning, coming-soon status, manual action |
| Full ancestry repeated on every queue row | Immediate parent; full path available as a title and in focus |
| Promotional settings, empty-state, and receipt copy | Short functional labels and instructions |
| Receipt slogans | Today’s steps and step count |
| Stage-number implementation language | Plain coming-soon labels for unavailable features |

## Typography, surfaces, and controls

| Before | After |
| --- | --- |
| 9–11px secondary UI labels | Mostly 12–14px; mobile focus eyebrow remains 10px |
| Small task titles and notes | 14px queue titles and focus notes; notes use 1.65 line height |
| Varied low-contrast neutral text | Shared muted foreground token |
| Gradient focus surface and tight corners | Solid card token, 12px outer radius, inset completion criterion |
| Uneven page padding and large decorative header | 36px/44px desktop content padding, 28px header gap |
| 22–36px actions | 40px desktop buttons; 44px mobile/coarse-pointer buttons |
| Faded play affordance | Always-visible queue play action |
| Narrow task editor | Up to 520px, heading clearance for close control |
| Small mobile fields | 16px form/search input text, avoiding automatic iOS zoom |
| Single-line mobile row compressed around controls | Grid with separate duration row and fixed touch-control columns |
| Long text could stretch layouts | Wrapping in task, focus, project heading, settings, and receipt content |
| Sidebar and mobile drawer could run out of space | Scrollable navigation and safe-area bottom padding |
| Broad button transition | Explicit color, background, border, shadow, transform transitions at 150ms |
| Weak overlay separation | 48% black overlay; existing reduced-motion behavior retained |
| No custom text selection | Warm translucent selection with readable foreground |

## Token changes

Values are in `src/workspace.css`; these feed the existing shadcn theme.

| Before | After |
| --- | --- |
| Background #111112 | oklch(0.18 0.003 285) |
| Foreground #e8e8e9 | oklch(0.93 0.003 285) |
| Card #181819 | oklch(0.21 0.004 285) |
| Popover #202022 | oklch(0.25 0.005 285) |
| Primary #e4dcb7 | oklch(0.89 0.05 94) |
| Primary foreground #242219 | oklch(0.25 0.018 94) |
| Muted foreground #919197 and scattered dim neutral labels | oklch(0.70 0.012 285) |
| Focus ring #bcb391 | oklch(0.80 0.06 94) |
| Independent card/popover text and sidebar colors | Foreground/background/muted token aliases |
| Active task #ffffff02 | oklch(0.89 0.05 94 / 0.045) |

## Accessibility and interaction

| Before | After |
| --- | --- |
| Assistant overlay with no modal focus behavior | Radix Sheet with Escape, containment, trigger focus restoration |
| Manual task creation from open assistant | Assistant closes before task editor opens |
| Navigation selection only visual; Archive lacked selection | aria-current and consistent selected appearance |
| Main/project navigation could both appear selected | Only the current destination is selected |
| Search open state not exposed | aria-expanded on search trigger |
| Loading text without announcement role | role=status |
| No keyboard skip link | Skip to content, including immersive focus |

## Verification

- TypeScript application and Convex checks pass.
- 30 unit tests pass.
- 12 production-browser tests pass across Chromium and WebKit.
- Added regression coverage for assistant focus containment, Escape/restoration, editor handoff, 320px layout, 44px focus controls, and 16px mobile fields.
- Existing offline reload, persistence, cross-window focus, hierarchy, and QR-link tests remain passing.
- Visually inspected desktop Today, Projects, Settings, Briefings and mobile Today/assistant using isolated sample data.
- React Doctor: 87/100, unchanged; four existing maintainability warnings.
- Existing Vite bundle-size warning remains; no new runtime dependencies.
