# Marginalia - Functionality Specification

## Purpose

A PWA for capturing post-it notes and marginalia from physical books, running OCR to extract text, and exporting structured notes to Obsidian-compatible Markdown.

## Features

- **Book Library**: Add, browse, and manage books with note counts and timestamps
- **Photo Capture**: Snap photos of book pages with post-it notes (single or batch mode)
- **OCR Processing**: Tesseract.js v5 runs entirely in-browser to extract text from photos, with canvas preprocessing (upscale, grayscale, auto-levels, unsharp mask) for improved accuracy. Supports 17 languages via a Settings dropdown.
- **Language Selection**: Choose OCR language in Settings (English default); persisted in localStorage. Worker reinitializes automatically when language changes.
- **Crop UI**: Interactive crop modal before OCR lets users select the text region, improving results on cluttered photos
- **Note Categorization**: Classify notes as Note, Key/Important, Question, Idea, or Quote with color-coded highlights
- **Tagging**: Add custom tags to notes for organization
- **Search & Filter**: Full-text search and filter notes by highlight type within each book
- **Markdown Export**: Export a book's notes as Obsidian-compatible Markdown, grouped by highlight type
- **Data Management**: Import/export all data as JSON backup
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
3. Take/select photos of pages with post-its
4. OCR extracts text automatically
5. Review, categorize, tag, and save notes
6. Export to Markdown when ready

### Capture Modes
- **Single**: Process one photo at a time — crop modal → OCR → review immediately
- **Batch**: Capture multiple photos — crop modal per image → OCR all → step through review

### OCR Pipeline
1. **Crop** (optional): User drags a rectangle to isolate the text region; skip returns the full image
2. **Preprocessing**: Upscale small images (2x if shorter dimension < 1000px), grayscale conversion, auto-levels (1st/99th percentile histogram stretch), unsharp mask (3×3, 0.5 strength)
3. **Recognition**: Tesseract.js with default PSM (automatic page segmentation), using the language selected in Settings

### Data Storage
All data lives in IndexedDB with three stores: books, notes, photos.
Photos are stored as base64 data URLs.
