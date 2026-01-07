// Poem Analyzer functionality

let centerDotsMode = false;

document.addEventListener('DOMContentLoaded', () => {
    const poemInput = document.getElementById('poem-input');
    const output = document.getElementById('output');
    const totalCount = document.getElementById('total-count');
    const toggleButton = document.getElementById('toggle-display');

    poemInput.addEventListener('input', () => {
        analyzePoem();
    });

    toggleButton.addEventListener('click', () => {
        centerDotsMode = !centerDotsMode;
        toggleButton.textContent = centerDotsMode ? 'Inline Mode' : 'Center Dots Mode';
        analyzePoem();
    });
});

function analyzePoem() {
    const poemInput = document.getElementById('poem-input');
    const output = document.getElementById('output');
    const totalCount = document.getElementById('total-count');
    const text = poemInput.value;

    if (!text.trim()) {
        output.innerHTML = '<p class="empty-message">Enter a poem to analyze</p>';
        totalCount.textContent = '';
        return;
    }

    const lines = text.split('\n');
    let totalSyllables = 0;
    let html = '';

    lines.forEach(line => {
        if (line.trim()) {
            const { syllabified, count } = analyzeLine(line);
            totalSyllables += count;

            const lineClass = centerDotsMode ? 'poem-line center-dots' : 'poem-line';
            html += `<div class="${lineClass}">`;
            html += `<span class="line-text">${syllabified}</span>`;
            html += ` <span class="syllable-count">[${count}]</span>`;
            html += `</div>`;
        } else {
            html += '<div class="poem-line">&nbsp;</div>';
        }
    });

    output.innerHTML = html;
    totalCount.textContent = `Total: ${totalSyllables} syllables`;
}

function analyzeLine(line) {
    const words = line.match(/\b[\w']+\b/g) || [];
    let lineSyllables = 0;
    let syllabifiedWords = [];

    words.forEach(word => {
        const syllables = splitIntoSyllables(word);
        lineSyllables += syllables.length;

        if (centerDotsMode) {
            syllabifiedWords.push(...syllables);
        } else {
            syllabifiedWords.push(syllables.join('-'));
        }
    });

    let result;
    if (centerDotsMode) {
        result = syllabifiedWords.join(' · ');
    } else {
        result = line;
        let wordIndex = 0;
        result = result.replace(/\b[\w']+\b/g, () => {
            return syllabifiedWords[wordIndex++] || '';
        });
    }

    return { syllabified: result, count: lineSyllables };
}

function splitIntoSyllables(word) {
    word = word.toLowerCase();

    if (word.length <= 2) {
        return [word];
    }

    const syllables = [];
    let current = '';

    const vowels = 'aeiouy';
    const chars = word.split('');

    for (let i = 0; i < chars.length; i++) {
        current += chars[i];

        if (vowels.includes(chars[i])) {
            while (i + 1 < chars.length && vowels.includes(chars[i + 1])) {
                current += chars[++i];
            }

            if (i === chars.length - 1) {
                syllables.push(current);
                current = '';
            } else if (chars[i + 1] && chars[i + 1] === 'e' && i === chars.length - 2) {
                const exceptions = ['the', 'be', 'he', 'she', 'we', 'me'];
                if (exceptions.includes(word)) {
                    current += chars[++i];
                    syllables.push(current);
                } else {
                    syllables.push(current);
                }
                current = '';
                break;
            } else {
                let consonantCount = 0;
                let j = i + 1;
                while (j < chars.length && !vowels.includes(chars[j])) {
                    consonantCount++;
                    j++;
                }

                if (consonantCount >= 2) {
                    current += chars[++i];
                    syllables.push(current);
                    current = '';
                } else if (consonantCount === 1 && j < chars.length) {
                    syllables.push(current);
                    current = '';
                }
            }
        }
    }

    if (current) {
        if (syllables.length > 0) {
            syllables[syllables.length - 1] += current;
        } else {
            syllables.push(current);
        }
    }

    if (syllables.length === 0) {
        return [word];
    }

    return syllables;
}
