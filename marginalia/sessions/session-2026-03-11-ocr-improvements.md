# Session 2026-03-11 — OCR Quality Improvements

## Problem

Tesseract.js OCR on raw phone photos of book pages and post-it notes produced poor results. Phone camera images have uneven lighting, low contrast, color noise, and often include surrounding context (fingers, table, adjacent pages) that confuse the OCR engine.

## Changes

### 1. Canvas Image Preprocessing (`preprocessImage`)

Added a preprocessing pipeline that runs before Tesseract receives the image:

- **Upscale**: If the shorter image dimension is under 1000px, scale 2x. Tesseract performs best around 300 DPI; phone crops can be too small.
- **Grayscale**: Weighted luminance conversion (0.299R + 0.587G + 0.114B) — matches human perception and removes color noise from post-it backgrounds.
- **Auto-levels**: Histogram scan to find 1st and 99th percentile values, then remap the full range to 0–255. This normalizes photos taken in different lighting conditions.
- **Adaptive threshold**: Uses an integral image (summed area table) for O(1) block-mean lookups with a 15×15 window and offset of 10. This binarizes the image while handling uneven lighting across the page — critical for book photos where one side is shadowed by the spine.

The integral image approach was chosen over simpler global thresholding because book photos almost always have lighting gradients.

### 2. Tesseract PSM 6

Changed `recognize()` to pass `{ tessedit_pageseg_mode: '6' }` — "assume a single uniform block of text." The default PSM tries to detect page layout (columns, headers, etc.) which is wrong for post-it notes and short text passages. PSM 6 is the right fit for these small, single-block captures.

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

## Files Modified

- `marginalia/script.js` — `preprocessImage`, `openCropModal`, PSM 6 config, capture flow integration
- `marginalia/style.css` — `.crop-container`, `.crop-hint` styles
- `marginalia/sw.js` — cache version bump to `v2`
- `marginalia/spec/functionality.md` — documented OCR pipeline and crop UI
