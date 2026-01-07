# Poem Analyzer - Functionality Specification

## Purpose

Analyze poems by splitting text into syllables and counting them, useful for understanding meter, rhythm, and poetic structure.

## Features

- Paste or type poem text into input area
- Automatic syllable splitting for each word
- Display syllabified text with visual separators
- Count syllables per line
- Count total syllables in poem
- Real-time analysis as user types
- Toggle between two display modes
- Clear formatting for easy reading

## Requirements

- Textarea for poem input
- Syllable counting algorithm
- Display syllabified version of poem
- Show syllable count per line
- Show total syllable count
- Toggle button for display mode
- Handle punctuation correctly
- Preserve line breaks from original poem
- Clean, minimalist grayscale design

## Display Modes

### Mode 1: Inline Syllables
Display syllables with hyphen separator within each word:
```
Roses are red [4]
Vi-o-lets are blue [5]
```

### Mode 2: Center-Aligned Dots
Each line split into syllables with center dots:
```
Ro · ses · are · red [4]
Vi · o · lets · are · blue [5]
```

Toggle button switches between these modes.

## Syllable Counting Algorithm

Implement heuristic-based English syllable counting:

1. **Count vowel groups**: Consecutive vowels count as one syllable
2. **Silent E**: Remove silent 'e' at end of words (except in words like "the")
3. **Vowel clusters**: Handle diphthongs (ai, ea, ou, etc.)
4. **Minimum syllables**: Every word has at least 1 syllable
5. **Common patterns**:
   - Words ending in "-ed" (walked = 1, wanted = 2)
   - Words ending in "-le" preceded by consonant (table, simple)
   - Common prefixes and suffixes

## Line Analysis

For each line show:
- Syllabified text (in selected mode)
- Syllable count in brackets
- Total for entire poem at bottom

## Behavior

1. User pastes or types poem into textarea
2. App analyzes text in real-time (with debounce)
3. Display syllabified version below
4. Show syllable count per line
5. Show total syllable count
6. Toggle button switches display mode
7. Handle empty input gracefully
8. Preserve original formatting and line breaks
