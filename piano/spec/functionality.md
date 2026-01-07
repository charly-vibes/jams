# Piano - Functionality Specification

## Purpose

Interactive piano keyboard that can be played with mouse clicks or computer keyboard, generating realistic piano sounds.

## Features

- Visual piano keyboard with white and black keys
- Mouse click interaction to play notes
- Computer keyboard mapping to piano keys
- Real-time sound generation using Web Audio API
- Visual feedback when keys are pressed
- One octave of piano notes (C to C)
- No external audio files required

## Requirements

- Display standard piano keyboard layout
- Map computer keyboard keys to piano notes
- Generate piano tones programmatically
- Show active key state visually
- Handle multiple simultaneous key presses
- Support both mouse and keyboard input
- Clean, minimalist grayscale design

## Keyboard Mapping

Map one octave of piano keys to computer keyboard:

**White Keys:**
- A = C (Do)
- S = D (Re)
- D = E (Mi)
- F = F (Fa)
- G = G (Sol)
- H = A (La)
- J = B (Si)
- K = C (Do - upper octave)

**Black Keys:**
- W = C# (Do#)
- E = D# (Re#)
- T = F# (Fa#)
- Y = G# (Sol#)
- U = A# (La#)

## Piano Notes and Frequencies

Using standard A4 = 440Hz tuning:

- C4: 261.63 Hz
- C#4: 277.18 Hz
- D4: 293.66 Hz
- D#4: 311.13 Hz
- E4: 329.63 Hz
- F4: 349.23 Hz
- F#4: 369.99 Hz
- G4: 392.00 Hz
- G#4: 415.30 Hz
- A4: 440.00 Hz
- A#4: 466.16 Hz
- B4: 493.88 Hz
- C5: 523.25 Hz

## Sound Generation

Use **Web Audio API** to generate piano-like tones:
- OscillatorNode for tone generation
- GainNode for amplitude envelope (ADSR)
- Attack: Quick rise to simulate hammer strike
- Decay: Gradual fade to simulate string dampening
- No external audio files needed

## Visual Feedback

- Keys change appearance when pressed
- Different styling for white and black keys
- Active state visible during key press
- Keyboard hints displayed on keys

## Behavior

1. Display piano keyboard on page load
2. Show keyboard letter hints on piano keys
3. On mouse click: Play corresponding note with visual feedback
4. On keyboard press: Play corresponding note with visual feedback
5. On key release: Stop visual feedback
6. Prevent keyboard repeat delay issues
7. Allow multiple keys to be pressed simultaneously
8. Generate sound using Web Audio API
