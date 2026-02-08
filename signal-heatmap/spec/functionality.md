# Signal Heatmap

## Purpose

Walk around with your phone to automatically map WiFi signal strength as a visual heatmap using motion sensors and dead reckoning.

## Features

### Automatic Position Tracking
- Uses device accelerometer for step detection via peak detection algorithm
- Uses device compass (deviceorientation) for heading direction
- Dead reckoning: each detected step advances position by configurable step length in compass direction
- Starts at canvas center, traces path as user walks

### WiFi Signal Measurement
- Automatically measures WiFi quality every N steps (configurable)
- Uses Network Information API (downlink, RTT) when available
- Falls back to CDN speed test (fetches known file, measures throughput)
- Composite scoring: 40pts downlink + 30pts RTT + 30pts speed test (or 100% speed test if API unavailable)
- Quality labels: Excellent (75+), Good (50+), Fair (25+), Poor (<25)

### Heatmap Visualization
- Full-width canvas with square aspect ratio
- Each measurement renders as a colored radial gradient
- Color scale: red (poor) → yellow (fair) → green (excellent)
- Semi-transparent gradients blend naturally at overlapping regions
- Grid overlay for spatial reference
- Blue dot shows current position
- Gray path trace shows walking history

### Canvas Interaction
- Tap/click canvas to correct position drift (relocate position dot)
- Start/Stop Mapping toggle button overlaid on canvas

### Manual Tap Mode (Fallback)
- When sensors unavailable (desktop, permission denied): tap canvas to place measurement points
- App auto-measures WiFi at each tapped location
- Still produces a full heatmap, just not automatic

### Persistence
- All measurements saved to localStorage
- Heatmap restores on page reload
- Settings persist across sessions

### Data Management
- Measurements list sorted by score below canvas
- Clear All button to reset everything
- Export Data button downloads measurements as JSON

## UI Structure

1. **Permission gate** (iOS only) — button to request motion sensor access
2. **Status bar** — current signal quality, step count, measurement count
3. **Canvas** — heatmap + position dot + path trace + grid
4. **Floating button** — Start/Stop Mapping overlay on canvas
5. **Settings** (collapsible) — step length, measure interval, acceleration threshold, dot radius
6. **Actions** — Clear All, Export Data
7. **Measurements list** — table of all measurements sorted by score

## Technical Constraints

- Vanilla JavaScript, no frameworks
- Single page application
- GitHub Pages compatible
- Mobile-first, responsive design
