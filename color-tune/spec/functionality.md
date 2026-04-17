# color-tune - Projector Color Calibration & Correction

## Purpose

Correct color distortion from projectors. A projector may shift colors due to lamp aging, ambient light, or hardware issues — making presentations hard to read. color-tune lets you calibrate the projector, extract colors from your content, and present with real-time corrections applied.

## Workflow Overview

```
[Laptop] shows calibration chart on projector
        |
[Phone]  photographs the projected chart
        |
[Phone]  app detects patches, computes correction
        |
[Phone]  transfers correction to laptop (QR code / short code / paste)
        |
[Laptop] loads PDF/webpage/image, applies correction, presents fullscreen
```

## Build Phases

### Phase 1 — MVP
- Manual calibration: user uploads a photo of the projected chart and manually aligns a grid overlay to the patches
- CSS filter correction model only (brightness, contrast, saturate, hue-rotate)
- Image upload for presentation with correction applied
- Copy-paste transfer of correction parameters (short base64 string)
- Basic color extraction from uploaded images

### Phase 2 — Full Calibration
- Auto patch detection with perspective correction
- All 4 correction models (CSS filters, SVG color matrix, per-channel curves, 3D LUT)
- PDF rendering via pdf.js with canvas-level correction
- QR code generation and scanning for transfer
- Delta-E error metrics and model comparison

### Phase 3 — Analysis & Extras
- Full Extract mode with contrast analysis
- Validation workflow (re-photograph to confirm improvement)
- Multiple calibration profiles
- Experimental features (ambient light, color blindness simulation, etc.)

## Dependencies

External libraries loaded from CDN (no npm/bundler):

| Library | Purpose | Phase |
|---------|---------|-------|
| pdf.js (Mozilla CDN) | PDF rendering to canvas | Phase 2 |
| qrcode.js | QR code generation | Phase 2 |
| jsQR | QR code scanning from camera | Phase 2 |

All other functionality (color science, correction models, UI) is vanilla JS.

## Terminology

- **Distortion model:** the color transform the projector applies (what it does to your intended colors). Computed by comparing intended patch RGB vs captured patch RGB.
- **Correction model:** the inverse of the distortion model. Applied to content so that *after* the projector distorts it, the result matches the original intent.
- **Forward prediction:** applying the distortion model to a color to predict how the projector will display it (used in Extract mode).

## Three Modes

### 1. Calibrate

**Goal:** Determine how the projector distorts colors.

#### Calibration Chart
- Display a fullscreen grid of known color patches on the projector
- 36 patches arranged in a 6x6 grid:

| Category | Patches | Hex Values |
|----------|---------|------------|
| Primaries | Red, Green, Blue | #FF0000, #00FF00, #0000FF |
| Secondaries | Cyan, Magenta, Yellow | #00FFFF, #FF00FF, #FFFF00 |
| Grayscale (8) | Black to White ramp | #000000, #242424, #484848, #6D6D6D, #919191, #B6B6B6, #DADADA, #FFFFFF |
| Presentation colors (8) | Common chart/slide colors | #1F77B4, #FF7F0E, #2CA02C, #D62728, #9467BD, #8C564B, #E377C2, #17BECF |
| Skin tones (6) | Representative range | #F5D6B4, #D4A574, #A0724A, #6B4226, #3B2413, #FCDEC0 |
| Saturated (4) | High chroma test | #FF4444, #44FF44, #4444FF, #FFAA00 |
| Desaturated (4) | Low chroma test | #CCAAAA, #AACCAA, #AAAACE, #CCBB99 |

- Each patch is labeled with its intended hex value
- Four fiducial markers at the corners (high-contrast geometric shapes) for perspective detection in Phase 2
- A QR code is embedded in the chart linking to the app's capture mode (Phase 2; in Phase 1, a short URL is displayed instead)

#### Capture (runs on phone or any device with a camera)

**Routing:** The app detects context via URL fragment:
- `#capture` or `#capture?session=<id>` — launches mobile capture UI (camera viewfinder + upload)
- No fragment or `#calibrate` / `#present` / `#extract` — launches desktop three-tab UI

**Phone camera bias mitigation:**
The phone camera introduces its own color distortion (white balance, tone mapping). To mitigate:
- Use the 8 grayscale patches as reference: compute white balance correction (von Kries chromatic adaptation) from the gray patches first, normalizing out the phone camera's color cast
- Instruct the user to disable HDR/night mode and use a neutral photo mode if available
- Document the limitation: calibration accuracy is bounded by phone camera accuracy. Gray-patch normalization handles the dominant error (white balance shift) but cannot correct for per-channel nonlinearity in the phone sensor

**Phase 1 (manual):**
- User takes a photo of the projected chart and uploads it
- App displays the photo with a draggable 6x6 grid overlay
- User aligns the grid to the patches by dragging corners (perspective transform)
- App samples the average color from each grid cell

**Phase 2 (auto):**
- Open via QR code scanned from the projected chart
- Two capture methods:
  - **Live camera:** getUserMedia stream with viewfinder overlay guiding alignment
  - **Photo upload:** take a photo separately and upload it
- Auto-detect the 4 corner fiducial markers for perspective correction
- Sample patch colors from the corrected grid
- Fall back to manual grid alignment if auto-detection fails

**Projector non-uniformity:**
Projectors have brighter centers and darker edges (hotspot effect). To mitigate:
- Normalize each color patch relative to its nearest grayscale reference patch (the grayscale ramp is distributed across the grid, not clustered)
- This removes spatially-varying brightness from the calibration data
- Document as a known limitation: correction is optimized for average projector behavior, not per-pixel

#### Correction Computation

**Pre-processing:**
1. White balance normalization from gray patches (von Kries adaptation) — applied to all captured values before model fitting
2. Grayscale ramp analysis to measure projector gamma

**Model fitting** — compare intended RGB vs captured RGB for all 36 patches:

1. **CSS filters** (Phase 1): numerical optimization (Nelder-Mead simplex) minimizing mean delta-E across patches, searching the space of brightness [0.5-2.0], contrast [0.5-2.0], saturate [0-2.0], hue-rotate [-180, 180]
2. **SVG feColorMatrix** (Phase 2): least-squares linear regression fitting a 5x4 affine color matrix (20 values) from the 36 patch pairs
3. **Per-channel curves** (Phase 2): per-channel least-squares fit of gamma (exponent), gain (amplitude), and offset — 9 parameters total, maps to SVG `feComponentTransfer` with `type="gamma"`
4. **3D LUT** (Phase 2): tetrahedral interpolation from the 36 sample points to populate an 8x8x8 lookup table (1,536 RGB triplets). Larger LUTs (16^3) possible but only stored locally, never transferred via QR

- Show error metrics for each model (average delta-E CIE2000)
- Let user preview each correction side-by-side on a sample image

### 2. Present

**Goal:** Display content with color correction applied in real-time.

#### Content Loading
- **Image** (Phase 1): upload PNG/JPG, display on canvas with correction applied
- **PDF** (Phase 2): render via pdf.js onto canvas
  - Page navigation (prev/next, keyboard arrows, presenter view)
  - Fullscreen mode for projection
  - Note: canvas rendering loses text selectability and link interactivity. This is a known tradeoff for pixel-level correction. For presentations where interactivity matters more than color accuracy, use CSS filter correction on the pdf.js text layer instead.
- **Webpage** (Phase 2):
  - Upload saved HTML file — render in sandboxed iframe with CSS filter overlay
  - Enter URL — load in iframe with CSS filter overlay. Note: many sites block iframing via X-Frame-Options/CSP. The app will show an error message with instructions to save the page as HTML and upload it instead.

#### Correction Application
- Depending on the active correction model:
  - **CSS filters:** applied as CSS `filter` property on the content container (works on all content types)
  - **SVG feColorMatrix:** applied as CSS `filter: url(#correction)` referencing an inline SVG filter
  - **Per-channel curves:** applied via inline SVG filter with `feComponentTransfer`
  - **3D LUT:** applied by post-processing canvas pixels directly (PDF/image mode only, not available for iframe content)
- Toggle correction on/off for A/B comparison (keyboard shortcut: `Space`)
- Adjustment sliders to fine-tune the correction in real-time
- Fullscreen mode (Fullscreen API) for projection

### 3. Extract (Phase 3)

**Goal:** Analyze content colors and predict how they'll look through the projector.

**Requires:** an active calibration (distortion model). If none is loaded, prompt user to calibrate first or load a saved profile.

#### Color Extraction
- Load a PDF or image
- Render to canvas and extract dominant colors (median cut quantization)
- Display a palette of all significant colors found (~8-20 colors)
- For each color, show:
  - Original intended color (swatch)
  - Predicted projected color (applying the *distortion model* forward)
  - Corrected projected color (what it will look like with correction active)
  - Delta-E distance (perceptual difference from intended)

#### Contrast Analysis
- Extract all dominant colors and compute pairwise contrast ratios for all combinations
- Flag any pair that falls below WCAG AA threshold (4.5:1 for text, 3:1 for large text)
- Show contrast ratios both before projection (intended) and after projection (predicted)
- Highlight pairs where projection causes contrast to drop below threshold
- Suggest alternative colors: find the nearest perceptually-similar color that maintains contrast after projection

## Data Transfer (Phone <-> Laptop)

### Method 1: Copy-Paste Short Code (Phase 1, always available)
- Phone computes correction and displays a compact base64-encoded string
- User types or pastes it into the laptop app's "Import Calibration" field
- CSS filter model: ~40 characters. Channel curves: ~60 characters. Color matrix: ~120 characters.
- LUT data is NOT included in the short code (too large)

### Method 2: QR Code Round-Trip (Phase 2)
1. Laptop projects calibration chart with embedded QR code (contains app URL + session fragment)
2. Phone scans QR, opens calibration capture mode
3. Phone computes correction parameters
4. Phone displays a QR code encoding the correction data (CSS filters + channel curves + color matrix only — LUT excluded due to QR size limits of ~3KB)
5. Laptop scans QR via webcam to import, or user falls back to typing the short code displayed below the QR

### Method 3: File Download/Upload (Phase 2)
- Phone exports full calibration data as a JSON file (includes LUT)
- User transfers the file to laptop (AirDrop, email, cloud drive, USB)
- Laptop imports the JSON file
- Only method that supports LUT transfer

### Correction Data Payload
```json
{
  "version": 1,
  "timestamp": "ISO-8601",
  "models": {
    "cssFilters": { "brightness": 1.1, "contrast": 1.2, "saturate": 0.9, "hueRotate": -5 },
    "colorMatrix": [1.05, -0.02, 0.01, 0, 0.02, -0.01, 1.03, -0.01, 0, 0.01, 0.02, 0.01, 0.98, 0, -0.01, 0, 0, 0, 1, 0],
    "channelCurves": {
      "r": { "gamma": 1.1, "gain": 0.95, "offset": 0.02 },
      "g": { "gamma": 1.0, "gain": 1.0, "offset": 0.0 },
      "b": { "gamma": 0.9, "gain": 1.05, "offset": -0.01 }
    },
    "lut": "base64-encoded-compressed (only in file export, omitted from QR/short code)"
  },
  "patchData": {
    "intended": ["#FF0000", "#00FF00", "..."],
    "captured": ["#E84422", "#11DD08", "..."]
  },
  "errorMetrics": {
    "cssFilters": { "avgDeltaE": 5.2 },
    "colorMatrix": { "avgDeltaE": 3.1 },
    "channelCurves": { "avgDeltaE": 2.8 },
    "lut": { "avgDeltaE": 1.2 }
  }
}
```

### Stretch Goal: WebRTC Peer Connection
- Phone and laptop establish direct P2P connection via short pairing code
- Live camera stream from phone to laptop
- Real-time calibration updates as camera moves

## Validation (Phase 3)

After calibration, the user can verify the correction is working:

1. App displays a **validation chart** (different colors from the calibration chart — avoids overfitting confirmation)
2. User photographs the corrected projection
3. App compares the validation patches: shows delta-E before correction vs after correction
4. Summary: "Correction reduced average color error from X to Y (Z% improvement)"
5. If improvement is < 20%, suggest re-calibrating with better lighting or camera settings

## UI Layout

### Desktop View (Laptop)
- Top bar: mode tabs (Calibrate | Present | Extract) + settings + profile selector
- **Calibrate mode:** fullscreen chart button + "Import calibration" input (paste code or scan QR or upload JSON) + status indicator
- **Present mode:** content viewer with collapsible correction controls sidebar (model selector, adjustment sliders, A/B toggle)
- **Extract mode:** split view — content on left, color palette + contrast matrix on right

### Mobile View (Phone)
- Detected via `#capture` URL fragment or screen width < 768px with camera available
- Camera viewfinder with alignment guide overlay (Phase 2) or upload button (Phase 1)
- Capture button + upload button
- Results screen: correction preview + export options (QR code, short code, file download)

### Keyboard Shortcuts (Present mode)
| Key | Action |
|-----|--------|
| Left/Right arrows | Previous/next page (PDF) |
| Space | Toggle correction on/off (A/B compare) |
| F | Enter fullscreen |
| Escape | Exit fullscreen |
| 1-4 | Switch correction model |
| S | Toggle sidebar |

## States & Error Handling

### Empty States
- **No calibration loaded:** Present and Extract modes show content without correction. A banner suggests calibrating first. All features work — correction is just inactive.
- **No content loaded:** Present/Extract show a drop zone for file upload with format hints.

### Error States
- **Auto-detection fails (Phase 2):** Fall back to manual grid alignment with a toast notification explaining why.
- **PDF load fails:** Show error with common causes (corrupted file, password-protected). Suggest re-exporting the PDF.
- **Iframe blocked:** Show error explaining X-Frame-Options/CSP restriction. Offer "Save page as HTML and upload" as alternative.
- **Camera access denied:** Show upload-only UI with explanation of how to grant camera permission.
- **localStorage full:** Warn user, offer to export and clear old profiles. Use IndexedDB for LUT storage (larger quota).

## Technical Constraints

- Vanilla JS only (no frameworks)
- CDN-loaded libraries: pdf.js, qrcode.js, jsQR (see Dependencies table)
- All computation client-side
- Works on GitHub Pages (no server)
- Responsive: desktop layout for presenting, mobile layout for calibrating
- Settings and active correction profile stored in localStorage
- LUT data and saved profiles stored in IndexedDB (larger storage quota than localStorage)

## Color Science Notes

- Use CIE Lab color space for perceptual comparisons
- Delta-E (CIE2000) for measuring color difference
- sRGB assumed for both source and capture
- White balance: computed first from grayscale patches via von Kries chromatic adaptation, applied as pre-processing before model fitting
- Gamma: measured from grayscale ramp, informs per-channel curve initialization

## Experimental Features (explore as time permits)

- Ambient light compensation (use light patches to estimate room light contribution)
- Multiple calibration profiles (save/load for different projectors or rooms)
- Presentation annotation overlay (draw on projected content)
- Color blindness simulation combined with projector correction
- Export corrected PDF (re-render with corrected colors and download)
