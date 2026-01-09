// postit-wall functionality

const STORAGE_KEY = 'postit-wall-notes';
const COLORS = ['solid', 'dots', 'lines-h', 'lines-v', 'grid'];

let notes = [];
let currentlyEditing = null;

// Load notes from localStorage
function loadNotes() {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
}

// Save notes to localStorage
function saveNotes() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
}

// Simple markdown parser for basic formatting
function parseMarkdown(text) {
    return text
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" target="_blank">$1</a>')
        .replace(/^- (.+)$/gm, '<ul><li>$1</li></ul>')
        .replace(/^(\d+)\. (.+)$/gm, '<ol><li>$2</li></ol>')
        .replace(/<\/ul>\n<ul>/g, '\n')
        .replace(/<\/ol>\n<ol>/g, '\n');
}

// Create note element
function createNoteElement(note) {
    const noteEl = document.createElement('div');
    noteEl.className = 'note';
    noteEl.dataset.id = note.id;
    noteEl.dataset.color = note.color;
    noteEl.style.left = `${note.x}px`;
    noteEl.style.top = `${note.y}px`;

    const timestamp = new Date(note.timestamp).toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });

    noteEl.innerHTML = `
        <div class="note-header">
            <span class="note-timestamp">${timestamp}</span>
            <div class="note-controls">
                <div class="color-picker">
                    ${COLORS.map(c => `
                        <div class="color-option ${c === note.color ? 'selected' : ''}"
                             data-color="${c}"></div>
                    `).join('')}
                </div>
                <button class="delete-btn">Delete</button>
            </div>
        </div>
        <div class="note-content" contenteditable="false">${parseMarkdown(note.text)}</div>
    `;

    // Click to edit
    noteEl.addEventListener('click', (e) => {
        if (e.target.classList.contains('delete-btn')) {
            deleteNote(note.id);
            return;
        }
        if (e.target.classList.contains('color-option')) {
            changeNoteColor(note.id, e.target.dataset.color);
            return;
        }
        if (!noteEl.classList.contains('editing')) {
            editNote(noteEl, note);
        }
    });

    return noteEl;
}

// Get color value for inline styles (not needed anymore, patterns use CSS)
function getColorValue(color) {
    return '#f5f5f5';
}

// Edit note
function editNote(noteEl, note) {
    if (currentlyEditing) {
        saveCurrentEdit();
    }

    currentlyEditing = { noteEl, note };
    noteEl.classList.add('editing');

    const contentEl = noteEl.querySelector('.note-content');
    contentEl.textContent = note.text;
    contentEl.contentEditable = 'true';
    contentEl.focus();

    // Place cursor at end
    const range = document.createRange();
    const sel = window.getSelection();
    range.selectNodeContents(contentEl);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
}

// Save current edit
function saveCurrentEdit() {
    if (!currentlyEditing) return;

    const { noteEl, note } = currentlyEditing;
    const contentEl = noteEl.querySelector('.note-content');

    note.text = contentEl.textContent;
    contentEl.contentEditable = 'false';
    contentEl.innerHTML = parseMarkdown(note.text);

    noteEl.classList.remove('editing');
    saveNotes();
    currentlyEditing = null;
}

// Change note color
function changeNoteColor(id, color) {
    const note = notes.find(n => n.id === id);
    if (note) {
        note.color = color;
        const noteEl = document.querySelector(`[data-id="${id}"]`);
        noteEl.dataset.color = color;

        // Update color picker selection
        noteEl.querySelectorAll('.color-option').forEach(opt => {
            opt.classList.toggle('selected', opt.dataset.color === color);
        });

        saveNotes();
    }
}

// Delete note
function deleteNote(id) {
    notes = notes.filter(n => n.id !== id);
    const noteEl = document.querySelector(`[data-id="${id}"]`);
    noteEl.remove();
    saveNotes();
    currentlyEditing = null;
}

// Render all notes
function renderNotes() {
    const canvas = document.getElementById('canvas');
    canvas.innerHTML = '';
    notes.forEach(note => {
        canvas.appendChild(createNoteElement(note));
    });
}

// Create new note at position
function createNote(x, y) {
    const note = {
        id: Date.now().toString(),
        x,
        y,
        color: 'solid',
        timestamp: new Date().toISOString(),
        text: ''
    };

    notes.push(note);
    saveNotes();

    const noteEl = createNoteElement(note);
    document.getElementById('canvas').appendChild(noteEl);

    // Start editing immediately
    setTimeout(() => editNote(noteEl, note), 10);
}

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
    notes = loadNotes();
    renderNotes();

    // Canvas click handler
    const canvas = document.getElementById('canvas');
    canvas.addEventListener('click', (e) => {
        if (e.target === canvas) {
            const rect = canvas.getBoundingClientRect();
            const x = e.clientX - rect.left + canvas.parentElement.scrollLeft;
            const y = e.clientY - rect.top + canvas.parentElement.scrollTop;
            createNote(x, y);
        }
    });

    // Click outside to save edit
    document.addEventListener('click', (e) => {
        if (currentlyEditing && !e.target.closest('.note')) {
            saveCurrentEdit();
        }
    });

    // Escape key to save edit
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && currentlyEditing) {
            saveCurrentEdit();
        }
    });
});
