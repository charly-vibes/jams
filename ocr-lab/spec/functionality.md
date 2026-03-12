# OCR Lab — Functionality Spec

## Purpose

A standalone OCR parameter tuning workbench for book margin photos. Users load an image, tweak preprocessing and Tesseract settings with live auto-preview, run OCR, and export a JSON config. Designed as a companion to Marginalia — all tuning happens here, then the config can be imported into Marginalia (follow-up task).

## Workflow

1. Load a book margin photo (file upload or camera capture)
2. Tweak preprocessing pipeline parameters — each change auto-previews the processed image (debounced)
3. Run OCR and review results (confidence + text)
4. Save/load named profiles (localStorage)
5. Export config as JSON file

## Preprocessing Pipeline

Fixed order, 12 steps in 3 groups. Each step has an enable/disable checkbox.

### Section 1: Image Preparation
1. **Scale** — upscale factor (1x, 1.5x, 2x, 3x)
2. **Shadow removal** — morphological max-filter background estimation + normalization (kernel 11-41)
3. **Denoise** — median blur (kernel 3/5/7)

### Section 2: Contrast & Color
4. **Channel selection** — R/G/B toggles
5. **Color deconvolution** — Beer-Lambert stain separation, click to sample colors
6. **Auto-levels** — 2nd/98th percentile remap
7. **Brightness/Contrast** — linear adjustments (-100 to +100)

### Section 3: Binarization & Output
8. **Sharpen** — unsharp mask (strength 0.5-3.0)
9. **Binarize** — None / Otsu / Adaptive Gaussian (blockSize 11-51, C -20 to +20)
10. **Morphology** — none/opening/closing (kernel 2/3)
11. **Invert** — toggle
12. **Border padding** — white border (0-30px)

## Tesseract Configuration
- PSM mode: 3, 4, 6, 7, 8, 11, 13
- Language: 17 languages (same as Marginalia)

## UI Layout (mobile-first)
- Header with home link
- Image input (file + optional camera)
- Preview canvas (tap to toggle original/processed)
- Processing overlay/spinner
- Pipeline controls in 3 collapsible `<details>` groups
- Tesseract config dropdowns
- Run OCR button
- Results: confidence badge + textarea
- Profiles: save/load/delete
- Export Config button

## Export Format
Single JSON format with version field. See implementation plan for schema.

## Technical Constraints
- Vanilla JS + Canvas API only (no OpenCV)
- Tesseract.js v5 via CDN
- All preprocessing client-side
- Preview capped at 1200px, OCR at 2000px
- Debounced auto-preview (150ms)
