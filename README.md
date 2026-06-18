# jams

Single-page web app experiments — small standalone apps built with vanilla JS.

Each jam is a one-day project: a standalone HTML page with no frameworks, no build step. Each includes a **spec** (what it does) and **session notes** (how it was built).

## Apps

| App | Description |
|-----|-------------|
| beads-viewer | Beads issue dependency graph viewer |
| color-tune | Color palette explorer and tuner |
| commit-insights | Git commit history visualizer |
| device-info | Browser and device capability inspector |
| idea-builder | Structured idea development tool |
| ip-info | IP and network information display |
| llm-code-review | LLM-assisted code review interface |
| marginalia | Annotation and margin notes tool |
| nyx | Night-mode display utility |
| ocr-lab | OCR experimentation playground |
| piano | Browser-based piano interface |

## Run locally

```bash
# Serve any app directly — no build step
python3 -m http.server 8080
# then open http://localhost:8080
```

## Structure

Each app lives in its own directory with a self-contained `index.html`. The root `index.html` lists all available apps.
