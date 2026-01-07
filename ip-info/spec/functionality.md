# IP Info - Functionality Specification

## Purpose

Display public IP address, geolocation, ISP information, and network details using external APIs.

## Features

- Display public IPv4 and IPv6 addresses
- Show geolocation based on IP (country, city, coordinates)
- Display ISP and organization information
- Show timezone information
- Display ASN (Autonomous System Number) details
- Show connection type and proxy detection
- Copy individual values or all information

## Requirements

- Fetch IP address and related information from external API
- Display information in organized categories
- Handle API errors gracefully
- Show loading state while fetching data
- No API key required (use free public APIs)
- All data fetched client-side via JavaScript

## Information Categories

### IP Address
- IPv4 address
- IPv6 address (if available)
- IP version

### Geolocation
- Country (name and code)
- Region/State
- City
- Postal code
- Latitude
- Longitude
- Continent

### ISP Information
- ISP name
- Organization
- ASN (Autonomous System Number)
- AS name

### Network Details
- Timezone
- UTC offset
- Currency
- Calling code
- Mobile network
- Proxy/VPN detection
- Hosting detection

### Additional
- Country flag
- Languages spoken
- Country capital

## API Choice

Use **ip-api.com** free tier:
- No API key required
- Comprehensive data
- 45 requests per minute
- JSON response format
- Supports batch queries

Fallback: Use **ipapi.co** if primary fails

## Behavior

1. On page load, show loading indicator
2. Fetch IP and geolocation data from API
3. Display data organized by category
4. Show error message if API fails
5. Provide "Copy All" button for sharing info
6. Display map link to coordinates (Google Maps)
7. Handle missing/unavailable fields gracefully
