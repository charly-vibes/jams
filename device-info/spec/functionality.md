# Device Info - Functionality Specification

## Purpose

Display comprehensive device and browser information for debugging, testing, and system analysis.

## Features

- Display browser information (name, version, user agent)
- Show screen and display properties
- Display device hardware information
- Show network information
- Display battery status (if available)
- Show geolocation capabilities
- Display supported web APIs
- Show date/time and timezone information
- Copy individual values or all information

## Requirements

- Gather all available device information via browser APIs
- Organize information into logical categories
- Display information in a clear, readable format
- Handle missing/unavailable information gracefully
- No external API calls required
- All data collected client-side only

## Information Categories

### Browser
- User Agent
- Browser name and version
- Engine name
- Platform
- Language
- Cookies enabled
- Do Not Track setting
- Online status

### Screen & Display
- Screen resolution
- Available screen size
- Color depth
- Pixel ratio
- Orientation
- Touch support

### Hardware
- CPU cores
- Device memory (if available)
- Max touch points
- Hardware concurrency

### Network
- Connection type
- Effective connection type
- Downlink speed
- RTT (Round Trip Time)
- Save data preference

### Battery (if available)
- Battery level
- Charging status
- Charging time
- Discharging time

### System
- Platform
- Operating system
- Timezone
- Current date/time
- Locale

### Web APIs Support
- Service Worker
- WebGL
- WebRTC
- Local Storage
- Session Storage
- IndexedDB
- Geolocation
- Notifications
- Clipboard

## Behavior

1. On page load, automatically collect all available device information
2. Display information grouped by category
3. Show "Not available" for information that cannot be accessed
4. Update dynamic information (battery, online status) in real-time if applicable
5. Provide copy functionality for sharing device info
