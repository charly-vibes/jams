# Session 2026-03-11 — OCR Quality Improvements

## Problem

Tesseract.js OCR on raw phone photos of book pages and post-it notes produced poor results. Phone camera images have uneven lighting, low contrast, color noise, and often include surrounding context (fingers, table, adjacent pages) that confuse the OCR engine.

## Changes

### 1. Canvas Image Preprocessing (`preprocessImage`)

After several iterations, the preprocessing was stripped down to **upscale only**:

- **Upscale**: 3x if shorter dimension < 750px, 2x if < 1500px, passthrough if already large enough. Uses `imageSmoothingQuality: 'high'` for clean interpolation.
- **No color/contrast manipulation**: Tesseract's internal preprocessing is better than anything we can do on canvas.

### What didn't work (removed)

- **Adaptive threshold** (integral-image SAT, 15×15 window): Binarized to pure black/white, destroying anti-aliasing and grayscale gradients Tesseract needs. Made OCR significantly worse.
- **Grayscale + auto-levels**: Histogram stretching (1st/99th percentile remap) interfered with Tesseract's own contrast normalization.
- **Unsharp mask** (3×3 box blur, 0.5 strength): Added noise without meaningful benefit on phone photos.
- **PSM 6**: "Single uniform block" assumption failed on full book pages.

**Lesson**: No single preprocessing setting works for all photos. The solution is to try multiple variants and let confidence scores decide.

### Iteration 3: Multi-pass OCR

Rather than finding one perfect preprocessing, run up to 4 passes with different combinations and pick the best:

| Pass | Preprocessing | PSM | Rationale |
|------|--------------|-----|-----------|
| 1 | Upscale only | 3 (auto) | Clean photos, automatic layout |
| 2 | Grayscale + auto-levels | 3 (auto) | Low contrast / uneven lighting |
| 3 | Upscale only | 6 (single block) | Post-it notes, short text |
| 4 | Grayscale + unsharp mask | 6 (single block) | Blurry photos of small text |

Each result is scored by average word confidence from `result.data.words[].confidence`. Stops early if confidence exceeds 65%. Progress label updates to show which pass is running.

This reuses the single Tesseract worker — no extra memory overhead, just sequential `recognize()` calls with different inputs and PSM params.

### 2. Tesseract PSM (default / auto)

Initially tried PSM 6 ("single uniform block of text") but reverted to the default PSM 3 (fully automatic page segmentation). PSM 6 failed on full book pages; PSM 3 handles both post-it notes and full pages correctly.

### 3. Crop UI (`openCropModal`)

Promise-based modal that appears before OCR processing in both capture modes:

- Displays the captured photo on a canvas
- User drags a rectangle using pointer events (works with both mouse and touch)
- Semi-transparent dark overlay outside the selected region with an amber border on the crop rect
- "Skip Crop" resolves with the original blob; "Crop & Process" extracts only the selected region at full image resolution
- Edge cases: zero-area clicks treated as skip, backwards drag normalized with min/max
- `touch-action: none` on the container prevents browser scroll/zoom interference on mobile
- Canvas sized to display dimensions for performance (not natural image size)

### Integration Points

- **Single mode**: Crop modal opens immediately after file selection, before `processSingleCapture`
- **Batch mode**: Crop modal opens sequentially for each pending capture before its OCR run

## Implementation Decisions

- Preprocessing is applied inside `runOCR` rather than in the capture flow, so any future code path that calls `runOCR` gets the benefit automatically.
- The crop modal reuses the existing `openModal`/`closeModal` pattern for consistency.
- Crop coordinates are scaled back to natural image dimensions before extraction, so the cropped output is full resolution regardless of the display canvas size.
- Service worker cache bumped to `v2` to ensure clients pick up the new code.

### 4. OCR Language Selection

Added multi-language support:

- `OCR_LANGUAGES` constant with 17 languages (English, French, German, Spanish, Italian, Portuguese, Russian, Polish, Dutch, Japanese, Chinese Simplified/Traditional, Korean, Arabic, Hindi, Turkish, Ukrainian)
- `state.ocrLang` persisted in `localStorage` under `marginalia-ocr-lang`, defaults to `eng`
- `setOCRLang(code)` updates state and localStorage; marks the worker as stale so it reinitializes with the new language on next use
- `initOCR` now accepts an optional `lang` parameter and checks `state._ocrLoadedLang` to avoid redundant reinits
- Settings view has a `<select>` dropdown; changing it calls `setOCRLang` and resets the pre-load button
- Lazy reinit: the worker isn't recreated until the next OCR run (or if the user taps "Pre-load OCR Engine")

## Files Modified

- `marginalia/script.js` — `preprocessImage`, `openCropModal`, PSM 6 config, capture flow integration, language selection
- `marginalia/style.css` — `.crop-container`, `.crop-hint` styles
- `marginalia/sw.js` — cache version bump to `v2`
- `marginalia/spec/functionality.md` — documented OCR pipeline, crop UI, and language selection
