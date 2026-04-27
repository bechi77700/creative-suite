# Creative Suite — Project Guide for Claude

This file is the contract between Claude and the codebase. Read it first, every session.

## What this is

Creative Suite is a **Next.js 14 SaaS** for generating Meta Ads creative briefs (statics, video scripts, hooks, native ads) with Claude + fal.ai. Brand-scoped — each `BrandProject` owns its docs, generations, and winners.

- **Stack** — Next 14.2.35 App Router · React 18 · TypeScript · Tailwind · Prisma + Postgres
- **AI** — `@anthropic-ai/sdk` (Claude) for text · `@fal-ai/client` for images · `@google/generative-ai` for video analysis
- **Storage** — Cloudflare R2 mirror via `@aws-sdk/client-s3` for image persistence
- **Deploy** — Railway, Node 18. **Push to `main` = auto-deploy.** No CI gates.
- **Dev port** — 3001 (`npm run dev`)

## Repo layout (only what matters)

```
app/
  api/
    generate/
      static-brief/        statics from scratch + clone-and-adapt + iterate
      video-script/        video angles → script flow
      video-angles/        SSE stream — extracts angles from Saint Graal
      hooks/               from_brand / from_video / from_script modes
      iterate/             refine an existing static
      iterate-video/       refine a script + regenerate sub-routes
      clone-and-adapt-video/   take a video, write a new script in the brand voice
      variations/          5 variants of a hook/static
      native-ad/           long-form editorial native ads (SSE)
      image/               fal.ai bridge — nano-banana-2/pro, flux, recraft, imagen4
    projects/[id]/         CRUD on BrandProject + nested docs
    knowledge/             CRUD on GlobalKnowledge
    winners/               per-asset winners library
  projects/[id]/
    page.tsx               project overview + doc upload
    static-brief/          statics UI (scratch / clone)
    video-script/          video flow (angles → script)
    hooks/                 hooks UI (3 modes)
    native-ads/            native ads UI (long-form + auto-image via fal)
    iterate/               iterate a static
    winners/               winners library page
    history/               all generations for this project
  knowledge/page.tsx       global KB upload UI
  page.tsx                 home — list of projects
components/
  Sidebar.tsx              nav (Logo + per-project module links)
  Logo.tsx                 violet→fuchsia plate, white "C". noGlow prop for compact placements.
  SaintGraalGate.tsx       blocks generation pages until a saint_graal_doc is uploaded
  FunnelStageSelector.tsx  TOFU / MOFU / BOFU chip toggle (used in scratch flows only)
  VideoReferenceInput.tsx  upload a video for clone-and-adapt
lib/
  anthropic.ts             getAnthropic(), MODEL_SMART (Opus), MODEL_FAST (Sonnet), GENERATION_RULES
  prompt-cache.ts          buildCachedUserContent() — wraps prefix+suffix with cache_control
  knowledge.ts             buildGlobalKnowledgeBlock(rows, module) + buildBrandDocumentsBlock(docs)
  funnel-stage.ts          FUNNEL_STAGES, buildFunnelStageInstruction(stage|null)
  streaming.ts             parseSSE() + extractClosedCodeBlocks()
  r2.ts                    mirrorRemoteImageToR2() + isR2Configured()
  winners.ts               addWinner / removeWinner client helpers
  prisma.ts                prisma client singleton
  gemini-video.ts          video transcription + scene analysis
prisma/schema.prisma       BrandProject, BrandDocument, GlobalKnowledge, Generation, Winner
```

## Hard rules — do not violate

### Models — pick by route, not by default
- `MODEL_SMART = 'claude-opus-4-7'` → **strategy** routes (creative direction, angles, scripts from scratch, native ads).
- `MODEL_FAST = 'claude-sonnet-4-6'` → **execution** routes (variations, iterate, clone, batch, headlines, long-form generation where Opus is too expensive).
- `MODEL` (legacy alias) = `MODEL_SMART`. Avoid in new code; pick explicitly.
- For mixed routes (e.g. static-brief: scratch=SMART, clone=FAST), branch on the mode.
- `max_tokens`: native ads use 32k. Other routes 3-4k unless they output long lists.

### Saint Graal gate — every generation route
Every `/api/generate/*` route MUST check that the project has a `BrandDocument` with `type === 'saint_graal_doc'` before generating. Return 403 if missing. The `<SaintGraalGate />` component shows the upsell on the page side.

```ts
if (!project.documents.some((d) => d.type === 'saint_graal_doc')) {
  return NextResponse.json({ error: 'Saint Graal document required before generating.' }, { status: 403 });
}
```

### Prompt caching — every long route
Wrap heavy prefixes (KB + brand docs + Saint Graal + GENERATION_RULES) with `buildCachedUserContent(stablePrefix, variableSuffix)`. The cache TTL is 5 minutes. The variable suffix is everything that changes per request (user inputs, feedback, mode flags).

### Knowledge injection — module-scoped
`buildGlobalKnowledgeBlock(rows, module)` filters by `MODULE_CATEGORIES[module]` + `UNIVERSAL_CATEGORIES`. Modules:
- `'static'` → `static_ads`
- `'video'` → `video_frameworks`
- `'hooks'` → `hook_swipe_file`
- `'native'` → `native_ads`
- universals (always injected): `copywriting_books`, `meta_ads_principles`

When you add a new module, add it to `MODULE_CATEGORIES` AND to the dropdown in `app/knowledge/page.tsx` (`CATEGORIES` + `CAT_COLORS`).

`buildBrandDocumentsBlock(docs)` injects ALL brand docs (no filter — the project owns them all).

### Streaming routes — SSE pattern
For long generations, stream via `anthropic.messages.stream()` and `ReadableStream`. Use the helper at the top of `video-angles/route.ts` as the canonical template:

```ts
function sse(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}
```

Events: `text` ({text}), `done` ({generationId?}), `error` ({error}). Set `maxDuration = 300` for native ads / video scripts. Headers: `text/event-stream`, `Cache-Control: no-cache, no-transform`, `X-Accel-Buffering: no` (Railway/Nginx).

Client side: use `parseSSE(res.body)` from `lib/streaming.ts`.

### Image generation — `/api/generate/image`
Single bridge to fal.ai. Accepts:
- `prompt` (required), `model` (default `nano-banana`)
- `referenceImages: [{ base64, mimeType }]` for clone-and-adapt (nano-banana models accept multiple via `image_urls[]`)
- `feedback` — appended to the prompt as "USER FEEDBACK ON PREVIOUS GENERATION" (used by iterate buttons)
- `projectId` — when set, persists a `Generation` row (`module: 'static-image'`)

Mirrors the fal-hosted URL to R2 (when configured) and returns the persisted URL. Falls back to the fal URL silently if R2 is missing. `module === 'static-image'` rows surface in the History page.

For native ads: model is `nano-banana-2`, prompt must start with `1:1 square format,` (no other aspect ratio allowed).

### Saint Graal vs Brand docs vs KB
- **Saint Graal** = the brand brief — required, gates everything.
- **Other brand docs** = avatar, winning_ad, validated_script — auto-injected via `buildBrandDocumentsBlock`. NO type filter on injection.
- **Global KB** = the SOPs and reference libraries shared across all projects — filtered by module.

### Funnel stage selector
Used only in **scratch generation** of statics + video. NOT in hooks (UI removed). NOT in native ads (always TOFU). The route helper `buildFunnelStageInstruction(stage)` returns an empty string when no stage is selected, so default behavior is preserved.

### Sidebar nav
When you add a new module page, add an entry to `moduleItems` in `components/Sidebar.tsx`. Icons are inline Lucide-style SVGs at the top of the file — match the existing stroke-1.8 style.

## Conventions

### TypeScript
Run `npx tsc --noEmit` after every meaningful change. **Two pre-existing errors are known and ignored**:
- `app/api/generate/static-brief/route.ts:89` (`parseInt` on `string | number`)
- `app/projects/[id]/winners/page.tsx:168-174` (Type `unknown`)

If new errors appear, fix them before committing.

### Commits
- Multi-line message with HEREDOC.
- End with `Co-Authored-By: Claude <model> <noreply@anthropic.com>` (use the model that did the work — Sonnet 4.6, Opus 4.7).
- Push to `main` ships to Railway. No PRs in this repo.

### UI conventions
- Tailwind. Custom tokens: `bg-bg-base` / `bg-bg-elevated` / `bg-bg-hover` / `text-text-primary` / `text-text-secondary` / `text-text-muted` / `accent-violet` (primary brand) / `accent-gold` / `accent-red` / `accent-green`.
- Buttons: `.btn-primary`, `.btn-secondary`, `.btn-danger`.
- Inputs: `.input-field`.
- Cards: `.card` (rounded, border, bg-elevated).
- Shimmer skeletons: `.shimmer` class.
- Mobile: sidebar collapses to a top bar (md breakpoint). All generation pages must work on mobile.

### Output rendering
Markdown outputs use `react-markdown` with `prose prose-invert`. The full prose class string is repeated in each generation page — keep it consistent (see `native-ads/page.tsx` for the canonical version).

## Native Ads specifics (the heaviest module)

- KB category `native_ads` holds `NATIVE_ADS_COMPLETE.md` (the SOP + 7 gold standard references). User uploads it once via `/knowledge`.
- The route hardcodes a thin scaffold ON TOP of the SOP — it restates the 9-block architecture (per SOP v1.1: A=Hook, B=Mise en scène, C=Parcours d'échec, D=Bascule, E=Révélation mécaniste, F=Découverte produit, G=Preuve par expérience, H=Adresse directe, I=CTA + projection) and the 2 most-important rules (visual formatting + image-not-product) with extra emphasis.
- **Visual formatting rule (RULE #0)**: line break after almost every sentence, 1 sentence = 1 paragraph in ~80% of the copy, impact lines isolated. If the output looks like dense blog paragraphs → rewrite.
- **Image rule (RULE #0 BIS)**: never the product as star. 1:1 square only (no 4:5, no 16:9). Must trigger one of 4 reflexes: "what is this" / "could be me" / "yuck-wow" / "not an ad". Must respect the 5 systemic principles from SOP §6.
- Output contract: text first, then `# IMAGE BRIEF` H1, then 3 fields (Concept / Prompt Nanobanana in fenced code block / Pourquoi). The page parses this contract — don't break it.
- Page auto-fires `/api/generate/image` once the text stream ends, extracting the prompt from the first fenced code block.

## R2 (image persistence)

- Free tier: 10GB storage, 1M Class A ops/mo, 10M Class B ops/mo. Currently <1% usage.
- `lib/r2.ts` exports `mirrorRemoteImageToR2(url, prefix)` and `isR2Configured()`.
- Image route mirrors silently: if R2 is missing, returns the fal URL as-is.
- Env vars (Railway): `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_URL`.

## Env vars

- `POSTGRES_URL` — Railway-provided
- `ANTHROPIC_API_KEY` — paid API, **NOT the Claude Max subscription** (subscriptions don't authenticate API calls)
- `FAL_KEY` — fal.ai
- `GEMINI_API_KEY` — Google AI Studio (video analysis)
- `R2_*` — Cloudflare R2 mirror (optional, falls back to fal URLs)

## Things to NOT do

- Don't add per-module GENERATION_RULES — there's one shared `GENERATION_RULES` in `lib/anthropic.ts`. Module-specific rules go in the route's variable suffix.
- Don't bypass the Saint Graal gate.
- Don't use `MODEL` (legacy alias) in new routes — pick `MODEL_SMART` or `MODEL_FAST` explicitly.
- Don't break the SSE event names (`text`, `done`, `error`) — the client parser is shared.
- Don't add a CLAUDE.md per subdirectory — keep this single root file as the source of truth.
- Don't commit `.env*`. Don't commit R2 keys. (Some have leaked in chat — they should be rotated.)

## Open follow-ups

- **Rotate R2 keys** — they were pasted in chat earlier; rotate before relying on them in prod.
- Pre-existing typecheck errors (see Conventions) — low priority but worth fixing eventually.
- Image generation 502 (rare) — root cause was Railway timeout vs fal latency. R2 mirror happens inline; making it fire-and-forget would eliminate this.
