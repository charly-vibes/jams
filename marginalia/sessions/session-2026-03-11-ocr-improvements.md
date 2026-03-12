# Session 2026-03-11 — OCR Quality Improvements

## Problem

Tesseract.js OCR on raw phone photos of book pages and post-it notes produced poor results. Phone camera images have uneven lighting, low contrast, color noise, and often include surrounding context (fingers, table, adjacent pages) that confuse the OCR engine.

## Changes

### 1. Canvas Image Preprocessing (`preprocessImage`)

Added a preprocessing pipeline that runs before Tesseract receives the image:

- **Upscale**: If the shorter image dimension is under 1000px, scale 2x. Tesseract performs best around 300 DPI; phone crops can be too small.
- **Grayscale**: Weighted luminance conversion (0.299R + 0.587G + 0.114B) — matches human perception and removes color noise from post-it backgrounds.
- **Auto-levels**: Histogram scan to find 1st and 99th percentile values, then remap the full range to 0–255. This normalizes photos taken in different lighting conditions.
- **Unsharp mask**: Mild sharpening (3×3 box blur, 0.5 strength) to crisp up text edges without destroying grayscale information.

An earlier iteration used adaptive thresholding (integral-image summed area table, 15×15 window) to binarize the image, but this was counterproductive — it destroyed anti-aliasing and grayscale gradients that Tesseract's own internal Otsu binarization relies on. Removing it and letting Tesseract handle binarization produced significantly better results.

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
