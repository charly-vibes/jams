---
tags: [pipeline-run:epic-orchestrator-2026-10-30-listar-pwa-polish-jams-rte, pipeline-step:claim]
---

ORIENT jams-rte: claimed after jams-4ud; ticket files manifest.json/sw.js/icon.svg. Existing manifest has text-only GET share_target and an empty icons array; existing sw precaches app shell and has scoped cache prefix. This ticket must finish PWA metadata, icons, audio file share handling and verify same-origin static path. Baseline node --test listar/test/ expected 84/84. No remote deploy authorized; record local scope and HITL release gap.
