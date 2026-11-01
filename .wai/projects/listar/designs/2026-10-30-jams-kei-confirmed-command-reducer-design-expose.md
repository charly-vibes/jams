---
tags: [pipeline-run:epic-orchestrator-2026-10-30-listar-typed-attributes-jams-gab, pipeline-step:verify]
---

jams-kei confirmed command reducer design: expose pure applyCommands(snapshot, commands) over listId/version/items; accept explicit intent records only. Mutations resolve by stable targetItemId and add commands supply a complete item with a new ID. Attribute commands use operation append, replace, or remove plus item ID, key, and assertion ID. Query/noop return the original state object. Quantity updates require positive finite values, recognized existing units, compatible unit families, and a baseline for increment; conversions are not implicit. Attribute maps reuse db.js typed validation, assertion ID uniqueness is item-local, and replace preserves ID/role. Keep snapshot version unchanged; jams-obu owns durable version advancement and replay protection. analyze() candidate arrays are proposals and cannot be passed as a confirmed reducer codec.
