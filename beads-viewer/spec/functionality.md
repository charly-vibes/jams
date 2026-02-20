# Beads Viewer - Issue Tracker Visualization

## Purpose

A single-page web application for visualizing `.beads/issues.jsonl` files from GitHub repositories. Provides a clean interface to browse, filter, and explore issues tracked with the `bd` CLI tool.

## Features

### Repository Loading
- Accept GitHub repository URLs or `owner/repo` format
- Fetch `.beads/issues.jsonl` via GitHub API
- Support branch selection
- Handle missing or empty issue files gracefully

### Issue List
- Display all issues in a sidebar
- Show issue ID, title, status, and type
- Filter by:
  - Status (open, closed, all)
  - Type (task, bug, feature, epic)
  - Priority (1-3)
- Search by title/description
- Sort by created date, updated date, or priority

### Issue Details
- Display full issue metadata:
  - ID, title, description
  - Status, priority, type
  - Owner, created/updated timestamps
  - Close reason (if closed)
- Show dependencies:
  - Issues this depends on (blocked by)
  - Issues that depend on this (blocks)
- Linkable URLs for direct issue access

### Dependency Visualization
- Show dependency graph for selected issue
- Highlight blocked/blocking relationships
- Navigate between related issues

## Technical Constraints
- Single HTML file with inline CSS/JS
- No frameworks (vanilla JavaScript)
- Works with GitHub Pages
- Uses GitHub API for data fetching
- Minimalist grayscale design
