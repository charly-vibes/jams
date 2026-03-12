# Marginalia - Functionality Specification

## Purpose

A PWA for capturing post-it notes and marginalia from physical books, running OCR to extract text, and exporting structured notes to Obsidian-compatible Markdown.

## Features

- **Book Library**: Add, browse, and manage books with note counts and timestamps
- **Photo Capture**: Snap photos of book pages with post-it notes (single or batch mode)
- **Speech-to-Text**: Dictate notes using the Web Speech API — available in capture view and all note modals. Language follows the OCR language setting.
- **OCR Processing**: Tesseract.js v5 runs entirely in-browser with multi-pass OCR — 5 preprocessing/PSM combinations (raw, contrast, binarize, block, sharp), scored by word confidence. User can compare results in a pass picker modal. Supports 17 languages via a Settings dropdown. Individual passes can be enabled/disabled in Settings. A preferred pass is saved when the user picks one; if confidence ≥ 85% on the preferred pass, remaining passes are skipped.
- **Language Selection**: Choose OCR language in Settings (English default); persisted in localStorage. Worker reinitializes automatically when language changes.
- **Crop UI**: Interactive crop modal before OCR lets users select the text region, improving results on cluttered photos
- **Image Adjustment**: Pre-OCR adjustment with brightness, contrast, threshold, invert, and RGB channel isolation. Settings persist across captures and auto-apply in batch mode.
- **Color Deconvolution**: Beer-Lambert based color separation for removing background colors (ruled lines, highlighter marks) before OCR. Tap the preview image to sample up to 2 colors to remove; single-stain projection or two-stain matrix inversion extracts the text channel as grayscale.
- **Note Categorization**: Classify notes as Note, Key/Important, Question, Idea, or Quote with color-coded highlights
- **Tagging**: Add custom tags to notes for organization
- **Search & Filter**: Full-text search and filter notes by highlight type within each book
- **Markdown Export**: Export a book's notes as Obsidian-compatible Markdown, grouped by highlight type
- **Data Management**: Import/export all data as JSON backup with optional inclusion of photos and settings
- **Auto-Backup**: Periodic timed backup downloads (30min–12h intervals) with configurable content. Runs while the app is open; no server required.
- **Help & Tutorial**: Built-in help tab with step-by-step guide covering all features
- **Offline-First PWA**: Service worker caching for offline use, installable on mobile

## Requirements

- Vanilla JavaScript, no frameworks
- IndexedDB for local storage (books, notes, photos)
- Tesseract.js v5 CDN for OCR
- Mobile-first responsive design (max-width 480px app shell)
- Works on GitHub Pages

## Behavior

### Workflow
1. Add a book (title + author)
2. Open the book, tap + to enter capture mode
3. Take/select photos of pages with post-its, or dictate a note via speech
4. OCR extracts text automatically (photo) or speech is transcribed (dictate)
5. Review, categorize, tag, and save notes
6. Export to Markdown when ready

### Capture Modes
- **Single**: Process one photo at a time — crop → adjust → OCR → pass picker → review immediately
- **Batch**: Capture multiple photos, optionally crop thumbnails, then process all with saved adjust settings → step through review with pass comparison

### OCR Pipeline
1. **Crop** (optional): User drags a rectangle to isolate the text region; skip returns the full image
2. **Adjust** (optional): Brightness, contrast, threshold, invert, RGB channels, and color deconvolution. Settings persist in localStorage for reuse.
3. **Multi-pass recognition**: Up to 5 passes run with different preprocessing (disabled passes are skipped):
   - raw: Upscale only, PSM 3
   - contrast: Grayscale + auto-levels, PSM 3
   - binarize: Otsu's threshold, PSM 6
   - block: Upscale only, PSM 6
   - sharp: Grayscale + unsharp mask, PSM 6
4. **Preferred Pass**: When the user selects a pass, it's saved as preferred. On subsequent runs, the preferred pass executes first; if confidence ≥ 85%, remaining passes are skipped. Clearable in Settings.
5. **Pass Picker**: Enabled passes displayed with confidence scores; user selects the best result. "Adjust & Re-OCR" button allows tweaking and re-running from the picker.
5. **Color Deconvolution**: Beer-Lambert optical density decomposition. Converts RGB to OD space, builds a stain matrix from sampled colors, inverts to separate channels. Supports 1-stain (projection subtraction) and 2-stain (3x3 matrix inversion with orthogonal complement) modes.

### Data Storage
All data lives in IndexedDB with three stores: books, notes, photos.
Photos are stored as base64 data URLs alongside notes for future re-OCR.
Settings (OCR language, preferred pass, disabled passes, adjust params, auto-backup config) are stored in localStorage.
