// Piano functionality

const NOTE_FREQUENCIES = {
    'C4': 261.63,
    'C#4': 277.18,
    'D4': 293.66,
    'D#4': 311.13,
    'E4': 329.63,
    'F4': 349.23,
    'F#4': 369.99,
    'G4': 392.00,
    'G#4': 415.30,
    'A4': 440.00,
    'A#4': 466.16,
    'B4': 493.88,
    'C5': 523.25
};

const NOTE_NAMES_LETTER = {
    'C4': 'C',
    'C#4': 'C#',
    'D4': 'D',
    'D#4': 'D#',
    'E4': 'E',
    'F4': 'F',
    'F#4': 'F#',
    'G4': 'G',
    'G#4': 'G#',
    'A4': 'A',
    'A#4': 'A#',
    'B4': 'B',
    'C5': 'C'
};

const NOTE_NAMES_SOLFEGE = {
    'C4': 'Do',
    'C#4': 'Do#',
    'D4': 'Re',
    'D#4': 'Re#',
    'E4': 'Mi',
    'F4': 'Fa',
    'F#4': 'Fa#',
    'G4': 'Sol',
    'G#4': 'Sol#',
    'A4': 'La',
    'A#4': 'La#',
    'B4': 'Si',
    'C5': 'Do'
};

let audioContext;
let activeKeys = new Set();

document.addEventListener('DOMContentLoaded', () => {
    initAudio();
    setupKeyListeners();
    setupNotationSelector();
    updateNoteNames('letter');
});

function initAudio() {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
}

function setupKeyListeners() {
    const keys = document.querySelectorAll('.key');

    keys.forEach(key => {
        key.addEventListener('mousedown', () => {
            const note = key.dataset.note;
            playNote(note);
            key.classList.add('active');
        });

        key.addEventListener('mouseup', () => {
            key.classList.remove('active');
        });

        key.addEventListener('mouseleave', () => {
            key.classList.remove('active');
        });
    });

    document.addEventListener('keydown', (e) => {
        const keyPressed = e.key.toLowerCase();

        if (activeKeys.has(keyPressed)) {
            return;
        }

        const keyElement = document.querySelector(`[data-key="${keyPressed}"]`);
        if (keyElement) {
            e.preventDefault();
            activeKeys.add(keyPressed);
            const note = keyElement.dataset.note;
            playNote(note);
            keyElement.classList.add('active');
        }
    });

    document.addEventListener('keyup', (e) => {
        const keyPressed = e.key.toLowerCase();
        activeKeys.delete(keyPressed);

        const keyElement = document.querySelector(`[data-key="${keyPressed}"]`);
        if (keyElement) {
            keyElement.classList.remove('active');
        }
    });
}

function playNote(note) {
    const frequency = NOTE_FREQUENCIES[note];
    if (!frequency) return;

    const now = audioContext.currentTime;

    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    oscillator.frequency.value = frequency;
    oscillator.type = 'sine';

    gainNode.gain.setValueAtTime(0, now);
    gainNode.gain.linearRampToValueAtTime(0.3, now + 0.01);
    gainNode.gain.exponentialRampToValueAtTime(0.01, now + 1.5);

    oscillator.start(now);
    oscillator.stop(now + 1.5);
}

function setupNotationSelector() {
    const selector = document.getElementById('notation-selector');
    selector.addEventListener('change', (e) => {
        updateNoteNames(e.target.value);
    });
}

function updateNoteNames(notation) {
    const noteNames = notation === 'solfege' ? NOTE_NAMES_SOLFEGE : NOTE_NAMES_LETTER;
    const keys = document.querySelectorAll('.key');

    keys.forEach(key => {
        const note = key.dataset.note;
        const noteNameElement = key.querySelector('.note-name');
        if (noteNameElement && noteNames[note]) {
            noteNameElement.textContent = noteNames[note];
        }
    });
}
