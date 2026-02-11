# idea-builder - Functionality Specification

## Purpose

A structured thinking workspace (Architekt) for exploring ideas through topics, rhetorical topoi, concept combination, and argumentative frameworks. All data persists locally in the browser.

## Features

- **Topic Management**: Create, list, and delete focused thinking spaces (topics)
- **Idea Capture**: Add atomic thoughts with hashtag tagging and search/filter
- **Topoi (Rhetorical Invention)**: Five classical places of argumentation (Definition, Comparison, Relation, Circumstances, Testimony) with guided prompts
- **Concept Combinator**: Three-ring system (Subjects, Attributes, Contexts) that generates random premise combinations with history
- **Structured Frameworks**: Multiple argumentation models (Toulmin, Polya, Narrative, Free) with slot-based text entry
- **Export/Import**: JSON-based data backup and restore
- **PWA Support**: Installable as a standalone app with service worker

## Requirements

- Vanilla JavaScript (no frameworks)
- localStorage for persistence
- Mobile-first responsive design with safe-area support
- Google Fonts: Instrument Serif, Geist Mono, Outfit
- Works when deployed to GitHub Pages

## Behavior

1. **Home Screen**: Shows list of existing topics and input to create new ones
2. **Topic Workspace**: Four-tab interface (Ideas, Topoi, Combinar, Estructura)
3. **Ideas Tab**: Textarea for capturing thoughts, optional tags, search filtering
4. **Topoi Tab**: Collapsible sections for each rhetorical place with prompt buttons
5. **Combinator Tab**: Token-based rings for adding concepts, random combination generator
6. **Structure Tab**: Model selector with slot-based text areas for structured argumentation
7. **Navigation**: Slide transitions between home and workspace views
8. **Persistence**: All changes auto-save to localStorage immediately
