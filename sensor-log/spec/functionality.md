# SensorLog — Functionality Specification

## Purpose

Crash-resilient Progressive Web App for recording smartphone sensor data (accelerometer, gyroscope, gravity, linear acceleration, orientation, compass, GPS) with automatic persistence to OPFS every 2–5 seconds, live canvas visualization, and CSV export. Replaces Arduino Science Journal with zero-dependency vanilla JS.

## Features

- **7 sensors**: accelerometer, gyroscope, gravity, linear acceleration, orientation, compass, GPS
- **Per-sensor frequency selector**: 1, 5, 10, 30, 60 Hz
- **OPFS crash-resilient storage**: binary writes to Origin Private File System via dedicated Web Worker every 3 seconds, never loses more than 3 seconds of data
- **Live timeline**: 30fps canvas charts per active sensor with auto-ranging Y axis
- **Background keep-alive**: Screen Wake Lock API + silent sub-audible audio (Android) to prevent throttling
- **CSV export**: per-sensor CSV files with timestamp + values, UTF-8 BOM for Excel compatibility
- **Interrupted session recovery**: detects sessions from previous crashes and marks them for export
- **PWA installable**: manifest + service worker, works fully offline, Add to Home Screen

## Technical Architecture

### Files

| File | Responsibility |
|------|---------------|
| `index.html` | App shell, inline dark CSS, 3-screen layout, tab navigation |
| `app.js` | RingBuffer, SensorManager, SensorChart, BackgroundKeepAlive, App coordinator |
| `storage-worker.js` | Dedicated Web Worker: OPFS binary writes, IndexedDB session metadata |
| `sw.js` | Service Worker: cache-first for offline support |
| `manifest.json` | PWA manifest for installability |

### Data Flow

```
[Sensor Hardware] → [Browser API @ 1–60Hz]
       ↓
[Main Thread: RingBuffer (display)] + [pending[] array (storage)]
       ↓ (every 3s via setInterval)
[postMessage + Transferable Float64Array] → [Storage Worker]
       ↓
[OPFS SyncAccessHandle.write()]  ← flush every 30s or on visibility:hidden

[Canvas Renderer @ 30fps] ← reads RingBuffer directly
```

### Binary File Format

```
[4 bytes: header_json_len][header JSON bytes]
[...blocks:
  [4 bytes: block_len][1 byte: sensor_id][Float64Array bytes]
]
```

Each sample row: `[timestamp_ms, field1, field2, ...]`

## Sensor Support

| Sensor | API Primary | Fallback | Fields | Max Hz |
|--------|------------|---------|--------|--------|
| Accelerometer | `Accelerometer` | `devicemotion` | x, y, z m/s² | 60 Hz |
| Gyroscope | `Gyroscope` | `devicemotion` | x, y, z rad/s | 60 Hz |
| Gravity | `GravitySensor` | — | x, y, z m/s² | 60 Hz |
| Linear Accel | `LinearAccelerationSensor` | `devicemotion` | x, y, z m/s² | 60 Hz |
| Orientation | — | `deviceorientation` | alpha, beta, gamma ° | 60 Hz |
| Compass | — | `deviceorientationabsolute` | heading ° | 60 Hz |
| GPS | `Geolocation.watchPosition` | — | lat, lon, alt, speed, acc | ~1 Hz |

## Platforms

- **Android Chrome**: Full support (Generic Sensor API + Wake Lock + audio keep-alive)
- **iOS Safari**: Fallback path (DeviceMotionEvent + requestPermission + Wake Lock only)
- **Firefox Android**: Fallback path (DeviceMotionEvent)
- **Desktop browsers**: Works for orientation/GPS sensors available in desktop browsers

## Design Constraints

- Zero dependencies, vanilla JS only
- No build step, no bundler, no node_modules
- Single HTML file with inline CSS
- Offline-first via service worker
- Dark mode always on (minimizes OLED power consumption during recording)
