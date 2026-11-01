# Local diagnostic log

Listar's optional diagnostic log is off by default and stays on the current device. It records semantic app and storage events to help reproduce failures; it does not send events over the network and never records microphone samples, audio blobs, or file contents.

In **Configuración → Diagnóstico local**, enable event logging and save. Text capture is a separate opt-in. Without text capture, transcript, edited labels/input values, error messages, and other arbitrary text fields are redacted; metadata fields are allowlisted. Disabling text capture also redacts older captured text in exports. Disabling event logging stops new event writes. The in-app controls download a versioned JSON export or clear the local buffer.

The local buffer is limited to 500 events and 256 KiB; oldest records are dropped first and the export reports the dropped count. If browser storage is unavailable or full, diagnostics fall back to a session-only in-memory buffer and never interrupt list or transcription work. Clearing the buffer does not change lists or saved audio.

Events include a timestamp, session ID, ordered sequence, and correlation/request/operation IDs where available. Hooks cover app navigation/settings, microphone/decode/transcription and worker protocol, analyzer/preview confirmation, database transactions, and uncaught window errors. Events from the service worker and browser internals are not captured or relayed. This is application-level instrumentation, not a record of every browser-internal event. Environment details in exports include browser user agent, language, platform, and online state; review the JSON before sharing it.
