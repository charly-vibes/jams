# Nyx — Night Reader

A grayscale, low-brightness PWA reader for blog posts. Built for reading in complete darkness.

## Purpose

Nyx extracts article content from any URL using Mozilla's Readability library and renders it in a minimal, ultra-dark grayscale interface — optimized for nighttime reading without eye strain.

## Features

- **Article extraction**: Paste a URL to extract readable content via CORS proxies (corsproxy.io, allorigins.win)
- **Dark themes**: Two grayscale themes — "void" (pure black) and "ash" (slightly elevated)
- **Text size control**: Four sizes (S, M, L, XL) for comfortable reading
- **PWA / Installable**: Web app manifest with share target support — share URLs directly from mobile browsers
- **Offline shell**: Service worker caches the app shell, fonts, and Readability library
- **Privacy-first**: Nothing is stored — articles vanish when you leave the page

## Technical Details

- Uses Mozilla Readability for content extraction
- Fonts: Newsreader (serif) + JetBrains Mono (monospace) via Google Fonts
- Full grayscale filter applied to the page
- Safe area insets for notched devices
- Reduced motion support
