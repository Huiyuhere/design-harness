# Design Harness

Design Harness is an in-development code-native canvas for React applications.
The intended source of truth is the imported repository, not a visual override.
The complete import → DOM selection → validated source patch → production
verification journey is **not yet proven end to end**. Do not use the demo
inspector or a successful runtime start as evidence of source synchronization.

## Current implementation and evidence

| Area | Current state |
| --- | --- |
| Setup and shell | Compact GitHub/AI onboarding and accessible toolbar hints; browser-tested at desktop, tablet and mobile widths |
| GitHub import | Private App flow, read-scoped installation tokens and immutable-SHA archive/metadata inspection; unit-tested, live selected-repository acceptance still outstanding |
| Live pages | Actual application iframes, not headless captures; one selected frame by default, explicit pins up to three |
| Focus and zoom | Focus replaces other live instances; no fourth iframe. Below 65% zoom, no canvas iframe. Browser fixture covers a 90-frame schedule |
| Scroll | Window and stable named nested-container offsets saved through a sender-window/origin-checked bridge. Scroll saves do not change the iframe URL. Tested with actual cross-origin browser iframes |
| Inactive cards | Explicit placeholders until actual thumbnails exist. Imported cards no longer display fabricated page layouts |
| DOM and visual edits | Real imported DOM-to-JSX/CSS anchoring is not integrated. Legacy Design/Layers values describe the demo projection, not trustworthy imported source |
| Source editor | Workspace-bound reads and serialized writes with exact expected-content checks. Source deltas are saved before writes; failed file batches restore previous contents. Runtime-failure/HMR/style validation and full transactional approval remain incomplete |
| Patch adapters | Parsed static JSX/class spans, exact hash-bound forward/inverse patches and CSS declaration guards; unit and real React/HMR fixture tests. These are not proof of the whole inspector/agent path |
| Agent | Personal-key streaming and approved proposals exist; selected-element execution, durable jobs and cross-workspace application need end-to-end validation |
| Concurrency | Scheduling primitives are unit-tested. Comprehensive repository-wide write serialization is not yet integrated across every mutation path |
| Persistence | Approved source deltas use browser-local IndexedDB, keyed by workspace, repository and full base SHA, and replay after restart with conflict checks. They are not a server backup. Schema/R2 bindings alone do not prove encrypted patch persistence |
| Production | No production pixel-verification claim. Exact-SHA baseline ingestion, managed push/PR and production publishing remain incomplete |

### Legacy/demo functionality

The following UI and primitives exist, but imported-application integration
must be assessed against the table above:

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
- GitHub App-authenticated repository inspection with Next.js and React
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
- a bounded GitHub App-authenticated archive runtime that mounts one source tree,
  installs only after an explicit trust prompt, and runs one dev server;
- cancellable downloads/installations, bounded startup waits, clean process/listener
  teardown, and serialized workspace switching; late requests cannot mount a
  different workspace or change its source;
- linked desktop (1440×900), tablet (768×1024), and mobile (390×844)
  variants that share route source while retaining independent viewport state;
- a live-frame scheduler: zero canvas iframes below 65% zoom, normally one
  and up to three with explicit pins; focus uses one instance;
- window and stable named nested-scroll snapshots restored through a
  preview-only bridge; arbitrary React state still requires named fixtures;
- a direct mapped-source editor for copywriting and JSX/TSX changes, with
  syntax validation before the file is written to the running source tree;
- an optional, manually installed GitHub Actions workflow for Playwright
  screenshots, browser smoke checks, and artifact collection;
- a bounded OpenAI Responses API proxy that streams responses and only permits
  inspect/propose tools. The agent cannot apply or publish a patch.

End-to-end private GitHub import, DOM-to-source instrumentation, generated WebP
thumbnails, screenshot-baseline pixel diffing, HMR geometry/computed-style
proof, encrypted R2 bundle persistence, and explicit push/PR remain integration
milestones. Archive imports require a GitHub App connection; dependency execution
requires separate explicit trust. Direct
source edits remain in the in-browser runtime and a local source-delta journal
until a future draft commit and explicit push flow is connected. Clearing Site
data or using another browser loses access to that local journal; it is not D1/R2
backup. Deltas are capped at 10 MiB per workspace/revision and storage failure
blocks the write. Unapplied editor text is not part of the approved journal.
The product never awards a pixel-verified
badge from the canvas or from static representations.

## Safety model

- Imported dependencies never run before explicit project trust.
- GitHub credentials remain server-side. Personal OpenAI keys are accepted once,
  encrypted into a signed-in-user-bound HttpOnly cookie, and never stored in
  D1, R2, localStorage, logs, or source control.
- A GitHub App must be limited to selected repositories with Metadata read,
  Contents read/write, Pull Requests read/write, and no Workflows permission.
- Agent changes are proposals until the user approves a diff.
- The intended policy is repository-serialized writes and bounded analysis.
  The live source editor and agent file batches now share a serialized runtime
  queue. The separate scheduler library is not connected to every other
  metadata mutation path.
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

### Browser runtime compatibility

Next.js 16's default Turbopack requires native bindings. For an uncustomized
`next dev` script, the browser runner passes `--webpack` and shows that choice
in startup status; it does not edit `package.json`. Custom dev commands are not
silently rewritten. See the [Next.js CLI documentation](https://nextjs.org/docs/app/api-reference/cli/next).
This is a development-runtime adapter, not evidence of production screenshot
parity. Native modules and application-specific services can still fail and
require visible diagnostics or user-approved fixtures.

A real browser-runner audit reached a Next.js 16.2.10 request-context invariant
(`Expected workStore to be initialized`) after successful installation and server
startup. That application did **not** render. Webpack is not a universal Next.js
compatibility fix. A [related upstream report](https://github.com/stackblitz/webcontainer-core/issues/1978)
describes a similar storage invariant with Next.js 15.5; it does not establish
the cause or a fix for the audited 16.2 case. No framework downgrade or replacement
is performed automatically.

Next 16 App Router imports now run a tiny request-context capability check before
source transfer and dependency installation. If the runtime loses the context
after `await`, the preview stops with an explicit incompatibility message. This
does **not** fix or replace Next.js: it prevents a known-failing startup from
spending minutes and allocating dependencies. The test is behavioral, so a fixed
runtime can pass it without a hard-coded release allowlist. Both API 1.6.1 and
the separately tested 1.6.4 failed this probe and a minimal Next 16.2.10 app on
the audited runtime; the project dependency remains unchanged at 1.6.1.

The importer transfers raw file buffers using `fs.writeFile`, bypassing the
API 1.6.1 tree serializer's Windows-1252 byte conversion. Exact UTF-8 source
transfer was verified through the real runtime; binary roundtrip regression
tests cover all 256 byte values. This check is distinct from page rendering.

Classic Yarn uses `--frozen-lockfile`; modern Yarn uses `--immutable`. Repositories
without a lockfile are explicitly labeled as such instead of claiming a locked
installation. The original repository is not modified to manufacture a lockfile.

Validation:

```bash
pnpm test
pnpm run test:preview
pnpm run test:patcher
pnpm build
node --test tests/rendered-html.test.mjs
```

`test:preview` requires local desktop Chrome at the standard macOS application
path. It launches a separate headless test browser, exercises real iframe and
bridge behavior using synthetic pages, blocks non-fixture requests, and writes
ignored results under `outputs/audit`. It does not log into GitHub or certify
private-import, WebContainer compatibility, production pixels or renderer RAM.

### Direct source-patch boundaries

`replaceJsxText` edits an exact static JSX child, not a matching comment,
JavaScript string, dynamic expression or attribute. Duplicate copy requires an
explicit current source range. JSX-looking copy is escaped as literal text;
intentional spaces/newlines use a literal expression so the JSX compiler does
not fold them. A visible hard line break still depends on the text's CSS or an
explicit structural `<br>` edit; this helper does not silently change layout.

Static quoted `className` edits preserve whitespace and quotation style, support
entity-escaped tokens and reject ambiguous tokens or later overriding spreads.
Dynamic class expressions remain assisted work. CSS edits reject duplicate
declarations, ambiguous selectors and injected extra declarations/rules.
PostCSS syntax parsing is not a browser CSS-value or responsive-intent check.

Each result contains a single exact source span with before/after hashes and an
inverse patch. Replaying on stale or altered text fails closed. Offsets use
JavaScript UTF-16 units (Babel's convention), not byte offsets. Direct parsing is
bounded to 1,048,576 source units per file; large files need a different reviewed
editing path. These helpers are not yet connected to imported DOM selection.

The agent's text-approval path now calls the shared JSX planner in the browser
with Web Crypto hash checks. Edit requests capture a source hash before sending;
approval rejects missing snapshots and subsequent file changes. A final
compare-before-write still runs inside the serialized preview session. Literal
navigation edits use parsed anchors or recognized Next/React Router imports;
spread, dynamic and ambiguous props are refused. This is not yet proof that the
canvas selected the correct imported DOM node, that a new route has rendered, or
that the full agent-to-frame interaction works. UI undo/redo remains unfinished.

`test:patcher` runs the browser agent helper in Chromium, then uses its actual
output in an isolated synthetic React fixture with Vite HMR. It checks literal
text, href updates, button rounding, computed CSS and exact inverses, with no
page reload during edits or lost component state. Initial development dependency
optimization is recorded separately from source-edit navigation. It does **not**
claim that an API prompt changes a private imported frame, that Tailwind itself
compiled, or that a production screenshot matches.

## Preview and production-verification states

- **Live page · not verified** means a real iframe is running. Starting a
  server or writing a file does not establish source/HMR/geometry parity.
  “Live source synchronized” is not awarded by this path.
- **Preview paused / not started** means there is no live iframe for that card.
  There is no actual thumbnail capture yet; a placeholder is not a screenshot.
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
- `GITHUB_APP_SLUG`
- `GITHUB_APP_CLIENT_ID`
- `GITHUB_APP_CLIENT_SECRET`
- `GITHUB_APP_PRIVATE_KEY`
- `PATCH_ENCRYPTION_KEY`

The GitHub App is installed only on repositories selected by their owner. Its
repository permissions are **Metadata: read**, **Contents: write**, and **Pull
requests: write**; it requests no Workflows, Administration, Secrets, or
organization permissions. Import requests mint a repository-scoped token
downscoped to **Contents: read**. Only an explicit, reviewed “Create draft PR”
action may mint a separate short-lived token with Contents and Pull requests
write access. Installation tokens are never returned to browser JavaScript.

The Site declares D1 as `DB` and R2 as `ARTIFACTS`. The production release must
pass these checks before imported code execution is enabled:

1. `crossOriginIsolated === true` in desktop Chromium.
2. A WebContainer boots with `credentialless` COEP.
3. Installation succeeds only after explicit trust.
4. The imported dev server renders in an origin-checked iframe.
5. `postMessage` traffic rejects unknown origins.
6. A private selected-repository archive can be reconstructed from a base SHA
   and ordered patch bundles.

## Intended first-release targets (not a compatibility certification)

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
