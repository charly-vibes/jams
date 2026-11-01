---
tags: [pipeline-run:epic-orchestrator-2026-10-30-listar-typed-attributes-jams-gab, pipeline-step:verify]
---

jams-gab lead review: tested explicit replacement ID and role mismatch rejection plus price basis dimension/unit validation. Red tests failed before fixes; green suite node --test listar/test/ passed 94/94, node --check listar/db.js and git diff --check passed. Canonical accepted units are documented in listar/spec/contextual-commands.md; conversion is not implied.
