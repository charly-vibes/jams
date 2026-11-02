# Listar browser harness (jams-8be.12)

Real-chromium acceptance gate for the workspace checklist. Complements — never
replaces — the node suite: `npm test` proves persistence semantics on
fake-indexeddb; this harness proves real DOM focus, real reload durability, and
cross-tab IndexedDB contention.

## Run

```bash
npm run test:browser --prefix listar            # chromium project (the only one)
npx playwright test --config playwright.config.mjs -g "A13"   # single scenario
```

`test/browser/serve.mjs` is a zero-dependency static server on
`http://127.0.0.1:4173/`; Playwright starts it via `webServer`. Browsers come
from the shared `~/.cache/ms-playwright` install (CI: `npx playwright install
chromium`).

## Scenarios (workspace.browser.spec.mjs)

- **A01** typing captures one literal unassigned item; read back from real IndexedDB
- **A02** multiline paste opens the inline draft; confirm commits one atomic batch
- **keyboard** Escape returns real focus to the row label; Enter saves
- **A07** capture from Completados yields a pending item + `Ver en Pendientes` receipt
- **A16/I3** durable intake survives a real reload; committed intake finishes
  cleanup exactly once with zero duplicate items
- **A13** two tabs: a stale-revision edit is rejected, keeps input, never
  overwrites the newer capture

## Not proven here (human/device gates)

Transcription on device (WebGPU/wasm model download), WebShare target from the
OS share sheet, WhatsApp flow, real screen readers (VoiceOver/TalkBack), 320 CSS
px and 200% zoom layout judgment, paste normalization on Android — these remain
on `jams-0rt.1` and the `jams-8be.13` usability study. Headless chromium cannot
stand in for them.

## Artifacts

`test-results/` and `playwright-report/` are gitignored scratch output.
