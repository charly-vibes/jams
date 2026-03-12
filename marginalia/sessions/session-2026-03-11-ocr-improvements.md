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

### 5. Speech-to-Text

Added Web Speech API (`SpeechRecognition`) as an alternative input method:

- **Capture view**: Side-by-side zones for camera and dictation (hidden if browser doesn't support speech)
- **Note modals**: Dictate button below textarea in new note, edit note, and dictate-only modals. Toggles between recording/stopped state.
- `startDictation(textarea, btn)` — creates a recognition session with `continuous: true`, `interimResults: true`. Maps `state.ocrLang` Tesseract codes to BCP-47 locale tags for speech recognition language.
- `openDictateNoteModal()` — standalone modal for creating notes without photos, accessible from the capture view dictate zone.
- Recording state shown with red pulsing button via `.dictate-btn.recording` CSS class.

### 6. Help & Tutorial Tab

- New nav tab with `?` icon, renders a static help view with step-by-step sections
- Covers: adding books, capture modes, crop tool, OCR, speech-to-text, search/filter, markdown export, settings, OCR tips, offline use
- Styled with `.help-section` cards (white background, amber left border)
- Content-aware: shows dictation sections only when `speechSupported` is true, includes dynamic language count from `OCR_LANGUAGES`

### 7. Code Review Bug Fixes

After a full code review, fixed the following issues:

- **Speech recognition leak on modal close**: Active `SpeechRecognition` instances are now tracked globally (`_activeRecognition`) and stopped in `closeModal()`, preventing detached event handlers.
- **Multi-pass OCR accept-early**: After pass 1 completes with below-threshold confidence, a "Use this" button appears in the OCR status bar. Tapping it sets `state._ocrCancelled` to break the loop and use the best result so far. Eliminates worst-case 40s waits.
- **Cached image across passes**: `loadImage()` is called once in `runOCR` and the `Image` object is passed through to `preprocessImage`, avoiding 4x object URL creation/revocation per OCR run.
- **Batch crop UX**: Removed forced sequential crop modals in batch mode. Instead, users can optionally tap any thumbnail to crop it before processing. Uncropped images are processed as-is.
- **Capture view back button**: Added `←` back button and current book title to capture view header so users can navigate back to book detail without going through the Books tab.
- **Dictate null book guard**: `openDictateNoteModal` now checks `state.currentBookId` before opening, preventing orphaned notes.
- **Dead code**: Removed unused `originalText` variable in `startDictation`.
- **Tab width**: Reduced tab font to 0.78rem with `white-space: nowrap; overflow: hidden` to prevent truncation on narrow phones with 4 tabs.
- **Thumbnail cursor**: Added `cursor: pointer` to `.capture-thumb` to indicate tappability.

## Files Modified

- `marginalia/index.html` — added help tab and view panel
- `marginalia/script.js` — all OCR, speech, crop, capture, and help changes
- `marginalia/style.css` — all layout, animation, and help styles
- `marginalia/sw.js` — cache version bump to `v5`
- `marginalia/spec/functionality.md` — full feature documentation
