# URL Cleaner - Functionality Specification

## Purpose

Remove tracking parameters (UTM, fbclid, etc.) from URLs to create clean, shareable links.

## Features

- Input field for pasting URLs
- Automatic detection and removal of tracking parameters
- One-click copy to clipboard
- Visual feedback for successful operations
- Support for multiple tracking parameter types

## Requirements

- Remove UTM parameters (utm_source, utm_medium, utm_campaign, utm_term, utm_content)
- Remove Facebook click ID (fbclid)
- Remove Google click ID (gclid)
- Remove other common tracking parameters (ref, mc_eid, etc.)
- Preserve non-tracking query parameters
- Preserve URL structure (protocol, domain, path, hash)
- Handle malformed URLs gracefully

## Tracking Parameters to Remove

- `utm_source`
- `utm_medium`
- `utm_campaign`
- `utm_term`
- `utm_content`
- `fbclid`
- `gclid`
- `mc_eid`
- `ref`
- `_ga`

## Behavior

1. User pastes a URL into the input field
2. App automatically detects and removes tracking parameters
3. Cleaned URL is displayed in the output field
4. User can click "Copy" button to copy cleaned URL to clipboard
5. Visual feedback confirms copy action
6. If URL has no tracking parameters, original URL is displayed
7. If URL is invalid, error message is shown
