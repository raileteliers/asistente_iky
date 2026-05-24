# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Iky** — a Manifest V3 Chrome extension + a local Express/Groq backend that helps **older Chilean adults** use the web. Two surfaces, decided at runtime by the page:

- **Google Search** (`google.com` / `google.cl`): highlights the search bar, guides searches, explains results, and offers simple actions — always with user confirmation.
- **External pages** (everything else): a voice-first chat that explains the page and visually points at elements, **never interacting** with it.

The content script matches `https://*/*` (`run_at: document_idle`); the manifest also overrides the new tab (`chrome_url_overrides` → `newtab.html` → `newtab.js`) to redirect to `google.cl`.

The product is voice-first and for non-technical elderly users. All UI text and code comments are in **Spanish (Chilean)**; keep messages short and plain.

## Commands

```bash
# Extension: load unpacked at chrome://extensions (Developer mode) → select repo root.
# Reload the extension there after editing content.js / background.js / manifest.json.

# Backend (Node ESM, no build step):
cd backend
cp .env.example .env        # add real GROQ_API_KEY (gsk_...); ELEVENLABS_* optional
npm install
npm start                   # Express on http://localhost:3000

# Backend eval (makes REAL Groq calls — consumes quota, can hit rate limits):
cd backend && npm run eval  # runs eval-intenciones.json against /interpretar

# Frontend tests — zero-dependency, run individually with plain node:
node test-hito2e.js         # external-page memory + backend validation
node test-hito2f.js         # deterministic visual-guide ranking + DOM integration
node test-hito2g.js         # sensitive-mode detection + routing
node test-cursor-guia.js    # virtual cursor / auto-compact panel
node test-hito-voz.js       # Google voice flow: direct-search tiers + conversational confirm
node -c content.js && node -c background.js && node -c backend/server.js   # syntax check
```

There is **no test runner and no root `package.json`** — each `test-*.js` is standalone. Run all of them after any change to `content.js` / `backend/server.js`.

## Architecture (the parts that span files)

**Backend calls always go through the service worker.** `content.js` never fetches `localhost` directly — Chrome 142+ blocks loopback fetches from content scripts (Local Network Access). Instead it does `chrome.runtime.sendMessage({tipo, ...})` → `background.js` (which lives in the `chrome-extension://` origin and holds `host_permissions`) → `fetch` → response. Message types: `INTERPRETAR`, `TTS`, `EXPLICAR_PAGINA`. **If the backend is down or slow, every flow falls back gracefully and the extension keeps working** — never break this property.

**`content.js` is one large IIFE (~3500 lines).** The top-level split is `esPaginaExterna()` (`= !esGoogleSoportado()`), routed from `manejarPregunta()`:

- **Google flow:** `interpretarPrincipal()` calls `/interpretar` (with a local heuristic fallback `interpretarLocal()` when the backend fails) → `clasificarRiesgoAccion()` assigns **BAJO / MEDIO / ALTO** → `ejecutarIntencion()`. Risk tier decides confirmation depth: BAJO runs directly, MEDIO confirms once, ALTO blocks. **The AI only classifies intent and writes copy; the client decides the flow and the user confirms every action.**

- **External-page flow:** `responderPreguntaSobrePagina()` is the decision tree. Order matters:
  1. **ALTO block** (upstream in `manejarPregunta` via `contieneTerminosSensibles`): pay/clave/banco → blocked before this function is even reached.
  2. **Correction (2F):** "no es ese" / "otro" / directional → cycle cached candidates, no backend.
  3. **`actualiza`/`relee`** → invalidate caches.
  4. **Sensitive mode (2G):** `actualizarModoSensible()` is computed up top; if `modo.esSensible`, route through `responderEnModoSensible()` (conservative: explain + warn, block login/pay/confirm guidance, highlight only safe sections).
  5. **Deterministic visual guide (2F):** `detectarIntentGuiaExterna()` → `rankearElementosParaIntent()` scores elements 0–100; ≥60 resolves locally (high confidence), 40–59 locally with a hedge, <40 falls back to the LLM passing top-5 `candidatos`.
  6. **Backend explanation:** `consultarExplicarPagina()` → `/explicar-pagina`.

**Highlighting is idx-based and read-only.** `construirResumenPaginaExterna()` builds a privacy-safe DOM summary (title, headings, capped visible text, up to 30 interactive elements with `texto/ariaLabel/placeholder/tag/rol/rect`) and an in-memory `idx → Element` map (`_elementosResaltablesMap`). The AI or the local ranker returns an **idx**; `resaltarElementoExternoPorIdx(idx)` looks it up and adds `.ag-resaltado` + a virtual cursor. The summary **never includes `input.value`, passwords, sensitive fields, HTML, cookies, or the query string**. Element highlighting never clicks, types, or submits.

**Sensitive mode (2G)** — `detectarSensibilidadPaginaExterna()` returns `{esSensible, razones[], nivel: BAJO|MEDIO|ALTO}` from non-invasive URL + DOM/ARIA signals (visible `input[type=password]`, `cc-*`/`current-password` autocomplete, card/CVV visible text, payment iframes, login/checkout/bank URLs) — **never reading values**, and **not using the LLM to classify**. In sensitive mode: LOGIN/CONTINUAR intents are disabled, only safe sections (ayuda/contacto/volver/cerrar/menú) may be highlighted, and the backend receives a `seguridad` flag that reinforces the prompt and forces `elementoAResaltar = null`.

**Per-tab memory (2E):** chat history persists in `sessionStorage` (`AG_CHAT_PAGINA_V1`, capped); the DOM summary is cached in memory keyed by `urlKey` (`origin + pathname`). Changing URL resets history, guide candidates, and sensitive mode.

**Backend (`backend/server.js`, ESM):** endpoints `/interpretar` (Google intent JSON), `/explicar-pagina` (external chat, separate 32 kb body parser), `/tts` (ElevenLabs → returns base64 audio; empty `ELEVENLABS_*` makes the client fall back to Web Speech), `/health`. The Groq response shape is enforced **post-hoc** in code, not by the model: `validarRespuesta` / `validarRespuestaPagina` coerce bad types/out-of-range idx to safe defaults; `sanitizarTextoBase` strips executable tags / `on*=` handlers and caps length. Model is `GROQ_MODEL` (default `llama-3.3-70b-versatile`); `DEBUG_INTERPRETAR` / `DEBUG_PERF` env flags gate verbose logging.

**`backend/safety-rules.js` is shared** between the server and the eval suite so they can never diverge. `esSolicitudFueraDeAlcance()` (pay/bank/credentials/install) forces `DESCONOCIDO` deterministically; `contieneAccionPrematura()` rejects AI messages claiming it already acted ("ya hice clic", "voy a abrir").

**Performance instrumentation (HITO S1)** is `console.debug`-only behind flags, never external telemetry. Frontend: `const AG_DEBUG_PERF` + `perfLog/perfNow/perfDuracion` emit `[Iky][perf] <evento> {…}` (events like `pregunta_recibida`, `interpretacion_fin`, `backend_request_fin`, `resumen_pagina_*`, `ranking_fin`, `mensaje_mostrado`, `tts_*`, `guia_visual_*`). Backend: `perfLogBackend` (gated by env `DEBUG_PERF=true`) logs `request_fin` per endpoint. **Logs carry only lengths/counts/durations/levels** — never user text, page summary, history, or API keys (the same privacy bar as the invariants below).

## Non-negotiable invariants

These hold across all current and future milestones — do not regress them:

- **No click, no typing, no form/login/payment, no submit** on external pages. Read-only: explain + highlight by idx only.
- **Never read `input.value`; never use `innerHTML`; never send HTML, cookies, storage, or the query string** to the backend.
- **The AI never returns JavaScript, HTML, CSS selectors, or executes actions.** It returns a closed enum + an idx + short copy; the client validates and decides.
- **Sensitivity and risk are classified deterministically on the client** (`contieneTerminosSensibles`, `detectarSensibilidadPaginaExterna`), not by the LLM.
- **Google flow (`/interpretar`) is for Google only**; external-page work must not touch it.
- Secrets live only in `backend/.env` (gitignored) — never in the extension.

## Conventions

- **Text matching uses `normalizar()`** (lowercase, strip accents) — always compare against normalized text, and keep keyword lists lowercase/accent-free.
- **CSS is prefixed `ag-`** (`style.css`); the panel can auto-compact (`setCompacto`/`autoCompactarSiTapa`) so the cursor target isn't covered. Respect `prefers-reduced-motion` (already handled in the cursor code).
- **TTS auto-reads assistant messages**; pass `{leer:false}` to `agregarMensaje` to suppress (used for error/diagnostic notices to avoid loops). Avoid showing two read-aloud messages back-to-back (the second cancels the first).

## Testing convention (read before adding tests or functions)

Tests are **zero-dependency**: they read `content.js` / `backend/server.js` as text, extract the **exact production block** via `entre(src, anchorA, anchorB)` (string `indexOf`), and run it on hand-rolled stubs (`ok`/`eq` asserters, faked DOM). No Groq, no browser.

Consequence: when adding a production function, **place it outside the text ranges other suites already extract**, or you will break their `entre()` anchors. Example range to avoid splitting: the `test-hito2e` "memoria" block runs from `let chatPagina = obtenerChatPaginaInicial();` to `function esCampoSensiblePagina(el) {`. Add a `test-hito<N>.js` per milestone in the same style, and re-run all four suites.

Same rule for cross-cutting code (e.g. the S1 perf logging): do **not** add calls inside functions other suites extract-and-run (`rankearElementosParaIntent`, `construirResumenPaginaExterna`, `obtenerResumenCacheadoOFresco`, the cursor block) — a free `perfLog`/`perfNow` reference there throws `ReferenceError` when the extracted block runs on stubs. Instrument at the **call site** (e.g. `responderPreguntaSobrePagina`) instead.

## Docs & product context

Non-code context not derivable from the source lives in Markdown files:

- `CHECKLIST.md` — manual in-browser QA run before each delivery (covers what `npm run eval` and the `test-*.js` suites can't).
- `docs/test-abuela.md` — usability-test protocol with the first user (the founder's grandmother); `docs/entrevistas.md` — user-interview guides.
- `GTM.md` — go-to-market strategy.
- **`README.md` is stale on scope** — it still describes the product as Google-only with "the rest of the internet out of scope". The external-pages flow contradicts that; trust this file over the README for current scope.
