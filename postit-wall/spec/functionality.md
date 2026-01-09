# postit-wall - Functionality Specification

## Purpose

An infinite scrollable wall where users can create, edit, and organize post-it notes with markdown text. Notes are positioned freely on a large canvas and persist locally in the browser.

## Features

- **Infinite Scrollable Canvas**: Large 2D surface that users can scroll/pan to explore
- **Click to Create**: Click anywhere on the canvas to create a new post-it note at that position
- **Note Properties**:
  - Position (x, y coordinates on the canvas)
  - Timestamp (automatically generated on creation)
  - Pattern (selected from grayscale patterns: solid, dots, horizontal lines, vertical lines, grid)
  - Markdown text content (supports basic formatting)
- **Inline Editing**: Click on a note to edit its text and change its pattern
- **Delete Notes**: Remove individual notes from the wall
- **Local Persistence**: All notes automatically save to localStorage

## Requirements

- Vanilla JavaScript (no frameworks)
- Basic markdown rendering (bold, italic, links, lists)
- Grayscale design with pattern-differentiated notes
- Responsive to different screen sizes
- Works when deployed to GitHub Pages

## Behavior

1. **Initial Load**: Canvas displays with any previously saved notes in their positions
2. **Creating a Note**:
   - User clicks on empty canvas area
   - New post-it appears at click position with default solid pattern
   - Note enters edit mode immediately
   - Timestamp is auto-generated
3. **Editing a Note**:
   - Click on existing note to enter edit mode
   - Text area becomes editable
   - Pattern picker appears for changing note pattern
   - Click outside or press Escape to save and exit edit mode
4. **Deleting a Note**:
   - Delete button appears when note is in edit mode
   - Confirmation before deletion (optional for MVP)
5. **Persistence**:
   - Notes save automatically to localStorage on any change
   - Notes reload on page refresh
6. **Navigation**:
   - Use browser scroll (horizontal and vertical) to explore the canvas
   - Canvas is sufficiently large (e.g., 5000x5000px) to feel infinite
