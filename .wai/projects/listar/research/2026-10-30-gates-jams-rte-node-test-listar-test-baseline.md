---
tags: [pipeline-run:epic-orchestrator-2026-10-30-listar-pwa-polish-jams-rte, pipeline-step:gates]
---

GATES jams-rte: node --test listar/test/ baseline passed 84/84 before PWA changes. Static folder  is served alongside ; no remote deploy authorization, browser, or device runtime available. Add test criteria for manifest portrait/icon/file_handlers/audio share_target, SW precache/cache scoping, and same-origin file HTTP serving. For shared audio, manifest POST alone is insufficient for a static SPA: SW must persist incoming multipart audio and redirect to GET; app consumes it after user selects a list.
