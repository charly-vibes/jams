# WiFi Helper

## Purpose

A tool to help optimize WiFi extender placement by combining real-time signal quality testing with an interactive placement best-practices checklist.

## Features

### Signal Tester
- Name each location being tested (e.g., "Living Room Corner", "Hallway")
- Run a signal quality test that measures:
  - Downlink speed via Network Information API (Chrome/Edge/Opera)
  - Round-trip time (RTT) via Network Information API
  - Download speed via a timed fetch of a small public resource
- Compute a quality score (0-100) with label: Excellent, Good, Fair, Poor
- Store measurements in localStorage for comparison
- Display a sorted results table with the best spot highlighted
- Delete individual measurements

### Placement Guide
- Interactive checklist organized into three categories:
  - Physical Placement (height, distance, line of sight, etc.)
  - Interference Avoidance (microwaves, Bluetooth, thick walls, etc.)
  - Configuration Tips (SSID, channel selection, band choice, firmware)
- Checkbox state persisted in localStorage
- Checked items get visual de-emphasis (strikethrough + fade)

## Technical Requirements

- Vanilla JavaScript, CSS, HTML only
- No frameworks or build tools
- Works on GitHub Pages
- Mobile-friendly (users walk around testing spots)
- Graceful fallback when Network Information API is unavailable (Firefox, Safari)

## Browser API Notes

- `navigator.connection` (Network Information API) is only available in Chromium browsers
- When unavailable, downlink and RTT show "N/A" and scoring relies on speed test timing alone
- Speed test fetches a small public CDN resource (~150KB) with cache-busting query param

## User Flow

1. Open the app on a phone or laptop
2. Go to the Signal Test tab
3. Walk to a candidate extender location
4. Enter a location name and tap "Test Signal"
5. Review results, repeat from other locations
6. Compare all results in the table; best spot is highlighted
7. Switch to Placement Guide tab for optimization tips
8. Check off tips as they are applied

## localStorage Keys

- `wifi-helper-measurements` — array of measurement objects
- `wifi-helper-checklist` — object mapping tip IDs to checked state
