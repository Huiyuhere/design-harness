# Design Harness

Design Harness is a code-native design canvas for React applications. It imports
an application at an immutable Git SHA, renders its routes as frames, maps DOM
layers back to JSX/CSS, and records validated edits as reversible source
transactions. The source tree—not a canvas override—is the design truth.

## Current foundation

The first working slice includes:

- a resizable, collapsible project and route sidebar;
- isolated workspaces whose route frames, edits, brand tokens, and update times
  never leak into another workspace;
- an infinite pan/zoom canvas with route and saved-state frames;
- visibly distinct Edit, Preview Flow, and Graph modes: Edit selects and changes
  DOM content, Preview Flow exposes destination hotspots and pans to the linked
  frame, and Graph shows those route relationships;
- Design, Layers, Code, and Changes inspector views;
- working inline and inspector text editing with preserved spaces and line
  breaks, typography/layout controls, brand swatches, and a color-wheel picker;
- a shared Page → Navigation / Route content → editable-node hierarchy used by
  the canvas, Layers, Design, Code, and Changes views, including explicit CSS
  units (`px`, `rem`, `em`, and `%`);
- hierarchy-preserving page duplication and blank-page creation;
- prototype flow-gap detection: unresolved controls are logged with click
  counts and timestamps, open as editable context-rich agent drafts, then can
  generate and link a suggested next state;
- direct public GitHub repository inspection with Next.js and React
  Router/Wouter route discovery plus brand token extraction;
- semantic source-change records with timestamps and inverse values;
- a persistent agent surface with frame context, project-scoped D1 history,
  context receipts, progress, stop, copy, timestamps, and duration;
- first-launch personal OpenAI key onboarding with model-access validation and
  a user-bound encrypted HttpOnly cookie; keys never enter project storage;
- brand/design extraction plus reviewable `brand.md` and `design.md`
  improvement proposals;
- typed JSX, CSS, and Tailwind source patch adapters with stale-hash checks;
- route discovery and inferred link edges;
- a scheduler that permits three read/analysis jobs while serializing source
  writes per repository;
- D1 schemas for projects, frames, states, graph edges, edits, sessions, jobs,
  memory, and artifact metadata;
- R2 binding declarations for encrypted patch bundles and frame artifacts;
- WebContainer isolation checks and a single-instance runtime boundary;
- a bounded public-repository archive runtime that mounts one source tree,
  installs only after an explicit trust prompt, and runs one dev server;
- linked desktop (1440×900), tablet (768×1024), and mobile (390×844)
  variants that share route source while retaining independent viewport state;
- an adaptive live-frame scheduler: zero iframes below 65% zoom, normally two
  and never more than three; inactive frames are explicitly labeled static;
- Vite window-scroll snapshots restored through a preview-only, origin-checked
  bridge; arbitrary React state and Next.js demotion restoration still require
  deterministic named fixtures;
- a direct mapped-source editor for copywriting and JSX/TSX changes, with
  syntax validation before the file is written to the running source tree;
- an optional, manually installed GitHub Actions workflow for Playwright
  screenshots, browser smoke checks, and artifact collection;
- a bounded OpenAI Responses API proxy that streams responses and only permits
  inspect/propose tools. The agent cannot apply or publish a patch.

Private GitHub App installation, DOM-to-source instrumentation, generated WebP
thumbnails, screenshot-baseline pixel diffing, HMR geometry/computed-style
proof, encrypted R2 bundle persistence, and explicit push/PR remain integration
milestones. Public repository archives can run after trust is confirmed. Direct
source edits affect the in-browser runtime only until a future draft commit and
explicit push flow is connected. The product never awards a pixel-verified
badge from the canvas or from static representations.

## Safety model

- Imported dependencies never run before explicit project trust.
- GitHub credentials remain server-side. Personal OpenAI keys are accepted once,
  encrypted into a signed-in-user-bound HttpOnly cookie, and never stored in
  D1, R2, localStorage, logs, or source control.
- A GitHub App must be limited to selected repositories with Metadata read,
  Contents read/write, Pull Requests read/write, and no Workflows permission.
- Agent changes are proposals until the user approves a diff.
- Writers are serialized per repository. Up to three read-only jobs may run in
  parallel.
- Published source must never contain preview instrumentation attributes.
- Branch push and pull-request creation are separate explicit actions.

## Local development

Requires Node.js 22.13 or newer and pnpm.

```bash
pnpm install
pnpm dev
```

Then open `http://localhost:3000` in desktop Chromium. The response includes
the COOP/COEP headers required by WebContainer.

Validation:

```bash
pnpm test
pnpm build
node --test tests/rendered-html.test.mjs
```

## Preview and production-verification states

- **Live source synchronized** means a real route is running in a WebContainer
  iframe from the current in-browser source tree. It is interactive and
  scrollable, but is not production proof.
- **Thumbnail may be stale** means the card is static and cannot scroll. The
  current release uses a labeled static representation while generated WebP
  capture is completed.
- **Production pixel verified** is reserved for a pushed, exact Git SHA that
  passes the repository-installed Playwright workflow and approved pixel-diff
  thresholds. The included workflow currently captures screenshots and runs
  browser gates; baseline diff ingestion is not yet connected, so this badge
  remains disabled.

GitHub Actions requires a push and can queue for several minutes. Private
repositories have plan-dependent shared allowances and may incur charges.
Repository source and trusted build scripts execute on a GitHub-hosted Linux
runner, which differs from macOS and actual iOS Safari. Actions can also be
disabled, blocked by policy or budget, unavailable to forks, or missing the
manually installed workflow. Artifacts expire. When verification is unavailable,
editing remains usable, but the project is shown as **Not verified** and no
silent AI-review fallback is permitted.

## Hosted configuration

Copy `.env.example` to `.env` for local secret names. Configure production
values through Sites; never commit `.env`.

- `API_KEY_ENCRYPTION_KEY` (a high-entropy hosted secret used only to seal
  personal key sessions)
- `GITHUB_APP_ID`
- `GITHUB_APP_CLIENT_ID`
- `GITHUB_APP_CLIENT_SECRET`
- `GITHUB_APP_PRIVATE_KEY`
- `PATCH_ENCRYPTION_KEY`

The Site declares D1 as `DB` and R2 as `ARTIFACTS`. The production release must
pass these checks before imported code execution is enabled:

1. `crossOriginIsolated === true` in desktop Chromium.
2. A WebContainer boots with `credentialless` COEP.
3. Installation succeeds only after explicit trust.
4. The imported dev server renders in an origin-checked iframe.
5. `postMessage` traffic rejects unknown origins.
6. A private selected-repository archive can be reconstructed from a base SHA
   and ordered patch bundles.

## Supported first-release targets

- Vite React
- Next.js App Router and Pages Router
- React Router
- npm, pnpm, and Yarn projects
- JSX/TSX text and structure, inline styles, plain CSS, CSS Modules, and
  Tailwind tokens

Dynamic routes require named fixture parameters. CSS-in-JS, generated classes,
i18n-backed copy, and ambiguous structural edits use agent-assisted proposals
with approval instead of direct manipulation.

## License and attribution

Design Harness is MIT licensed. Interaction concepts were informed by the
MIT-licensed [Design Canvas](https://github.com/Huiyuhere/design-canvas); see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
