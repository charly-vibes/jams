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

let audioContext;
let activeKeys = new Set();

document.addEventListener('DOMContentLoaded', () => {
    initAudio();
    setupKeyListeners();
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
