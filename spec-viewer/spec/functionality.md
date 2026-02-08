# SpecReader - OpenSpec Document Viewer

## Purpose

A self-contained web application for reading OpenSpec documents from GitHub repositories in a clean, tablet-optimized reading experience. Designed to make reviewing specs easier by providing beautiful typography and intuitive navigation, especially useful when reviewing specs on tablets instead of directly from GitHub.

## Features

### Repository Loading
- Accept GitHub repository URLs in multiple formats:
  - Full URLs: `https://github.com/owner/repo`
  - Short format: `owner/repo`
- Parse and validate repository input
- Fetch repository file tree via GitHub API
- Filter and display spec-related files (.md, .yaml, .json, .toml, .txt, .rst)

### Branch Navigation
- Automatic detection of repository default branch
- Dropdown selector showing all available branches
- Display branch count
- Mark default branch in selector
- Switch between branches while maintaining context
- Attempt to reload the same file when switching branches

### File Browser
- Hierarchical file tree display with folder structure
- Auto-expand first level of folders
- Collapsible folder navigation
- File type icons for different formats
- Search/filter functionality to quickly find specific files
- Active file highlighting in sidebar

### Reading Experience
- Clean typography optimized for reading:
  - Source Serif 4 for body text
  - JetBrains Mono for code blocks
  - DM Sans for UI elements
- Warm, readable color palette
- Markdown rendering with GitHub Flavored Markdown support
- Syntax highlighting for code blocks
- Proper handling of tables, lists, blockquotes
- Relative image resolution (images load from GitHub raw content)

### Table of Contents
- Auto-generated from document headings
- Floating sidebar on wider screens
- Smooth scroll navigation
- Only appears for documents with 3+ headings

### Responsive Design
- Tablet-optimized with generous touch targets
- Collapsible sidebar on smaller screens
- Mobile menu toggle
- Responsive typography and spacing

### Theme Support
- Light and dark themes
- Toggle button in the header bar (moon/sun icons)
- Respects system preference (prefers-color-scheme) on first visit
- Persists preference in localStorage
- All UI elements adapt via CSS custom properties

### Deep Linking
- URL query parameters for shareable links:
  - `?repo=owner/repo` - auto-loads repository
  - `&branch=name` - loads specific branch
  - `&file=path/to/file.md` - opens specific file
- URL updates automatically as user navigates
- Share button on article header copies current URL to clipboard

### User Experience
- Auto-load README on repository load
- Remember current file when switching branches
- Loading states with spinner and status text
- Error handling with toast notifications
- URL parsing with fallback logic

## Technical Implementation

### Technology Stack
- Vanilla JavaScript (no frameworks)
- GitHub API (unauthenticated - 60 requests/hour limit)
- Marked.js for Markdown parsing
- Google Fonts (Source Serif 4, JetBrains Mono, DM Sans)

### API Integration
- Uses GitHub REST API v3
- Endpoints used:
  - Repository info: `/repos/{owner}/{repo}`
  - Branches list: `/repos/{owner}/{repo}/branches` (paginated)
  - File tree: `/repos/{owner}/{repo}/git/trees/{branch}?recursive=1`
  - File contents: `/repos/{owner}/{repo}/contents/{path}?ref={branch}`
- Raw content for images: `raw.githubusercontent.com`

### State Management
- Repository state (owner, name, branch)
- File tree data structure
- Current file tracking
- Branch list caching

### File Organization
Single self-contained HTML file with embedded:
- CSS styles (custom properties for light/dark theming)
- JavaScript logic
- Inline SVG icons

### Theme Architecture
- All colors defined as CSS custom properties on `:root` (light) and `[data-theme="dark"]`
- Header, loading overlay, and TOC backgrounds use `--header-bg` variable
- Code blocks use dedicated `--code-block-bg` and `--code-block-text` variables
- Theme preference stored in `localStorage` under `specreader-theme` key

## Limitations

- Uses unauthenticated GitHub API (rate limit: ~60 requests/hour)
- Cannot access private repositories without token
- Large files may fail to load
- No offline support
- Branch pagination capped at 1000 branches (safety limit)

## Use Cases

- Reviewing OpenSpec documents on tablets
- Browsing documentation repositories with better UX than GitHub UI
- Quick access to spec files across different branches
- Reading technical documentation with optimized typography
- Searching through large spec repositories
