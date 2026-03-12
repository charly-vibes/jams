document.addEventListener('DOMContentLoaded', async () => {
    const appsList = document.getElementById('apps-list');

    let apps;
    try {
        const response = await fetch('apps-metadata.json');
        apps = await response.json();
    } catch {
        appsList.innerHTML = '<p class="no-apps">Could not load apps.</p>';
        return;
    }

    if (apps.length === 0) {
        appsList.innerHTML = '<p class="no-apps">No apps available yet.</p>';
        return;
    }

    appsList.innerHTML = '';
    for (const app of apps) {
        appsList.appendChild(createAppItem(app));
    }

    setupOverlay();
});

function createAppItem(app) {
    const div = document.createElement('div');
    div.className = 'app-item';

    const link = document.createElement('a');
    link.href = `${app.name}/`;

    const nameDiv = document.createElement('div');
    nameDiv.className = 'app-name';
    nameDiv.textContent = formatAppName(app.name);

    const descDiv = document.createElement('div');
    descDiv.className = 'app-description';
    descDiv.textContent = app.description || 'No description available';

    link.appendChild(nameDiv);
    link.appendChild(descDiv);
    div.appendChild(link);

    const meta = document.createElement('div');
    meta.className = 'app-meta';

    const specLink = document.createElement('a');
    specLink.href = '#';
    specLink.textContent = 'Spec';
    specLink.addEventListener('click', (e) => {
        e.preventDefault();
        showMarkdown(formatAppName(app.name) + ' — Spec', `${app.name}/spec/functionality.md`);
    });
    meta.appendChild(specLink);

    if (app.sessions && app.sessions.length > 0) {
        const sessionsLink = document.createElement('a');
        sessionsLink.href = '#';
        sessionsLink.textContent = 'Session notes';
        sessionsLink.addEventListener('click', (e) => {
            e.preventDefault();
            showSessions(app.name, app.sessions);
        });
        meta.appendChild(sessionsLink);
    }

    div.appendChild(meta);
    return div;
}

function formatAppName(name) {
    return name
        .split('-')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}

// --- Overlay / Markdown viewer ---

function setupOverlay() {
    const overlay = document.getElementById('md-overlay');
    const closeBtn = document.getElementById('overlay-close');

    closeBtn.addEventListener('click', closeOverlay);
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeOverlay();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeOverlay();
    });
}

function openOverlay(title, html) {
    const overlay = document.getElementById('md-overlay');
    document.getElementById('overlay-title').textContent = title;
    document.getElementById('overlay-body').innerHTML = html;
    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';
}

function closeOverlay() {
    const overlay = document.getElementById('md-overlay');
    overlay.classList.remove('open');
    document.body.style.overflow = '';
}

async function showMarkdown(title, url) {
    openOverlay(title, '<p class="overlay-loading">Loading...</p>');
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error('Not found');
        const text = await response.text();
        document.getElementById('overlay-body').innerHTML = renderMarkdown(text);
    } catch {
        document.getElementById('overlay-body').innerHTML =
            '<p style="color:#999">Could not load this file.</p>';
    }
}

function showSessions(appName, sessions) {
    const title = formatAppName(appName) + ' — Sessions';

    if (sessions.length === 1) {
        showMarkdown(title, `${appName}/sessions/${sessions[0]}`);
        return;
    }

    const html = sessions.map(file => {
        const label = file.replace('session-', '').replace('.md', '');
        return `<a href="#" class="md-file-link" data-url="${appName}/sessions/${file}">${label}</a>`;
    }).join('');

    openOverlay(title, html);

    document.getElementById('overlay-body').querySelectorAll('.md-file-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            showMarkdown(title + ' — ' + link.textContent, link.dataset.url);
        });
    });
}

// --- Minimal Markdown renderer ---

function renderMarkdown(text) {
    let html = text.replace(/\r\n/g, '\n');

    // Code blocks
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
        return `<pre><code>${escapeHtml(code.trimEnd())}</code></pre>`;
    });

    const blocks = html.split(/\n\n+/);
    return blocks.map(block => {
        block = block.trim();
        if (!block) return '';
        if (block.startsWith('<pre>')) return block;

        if (block.startsWith('# ')) return `<h1>${inline(block.slice(2))}</h1>`;
        if (block.startsWith('## ')) return `<h2>${inline(block.slice(3))}</h2>`;
        if (block.startsWith('### ')) return `<h3>${inline(block.slice(4))}</h3>`;

        if (block.startsWith('> ')) {
            const content = block.replace(/^> ?/gm, '');
            return `<blockquote><p>${inline(content)}</p></blockquote>`;
        }

        if (/^[-*] /.test(block)) {
            const lis = block.split(/\n/).filter(l => l.trim()).map(item => {
                return `<li>${inline(item.replace(/^[-*] /, '').replace(/^ {2,}[-*] /, ''))}</li>`;
            }).join('');
            return `<ul>${lis}</ul>`;
        }

        if (/^\d+\. /.test(block)) {
            const lis = block.split(/\n/).filter(l => l.trim()).map(item => {
                return `<li>${inline(item.replace(/^\d+\. /, ''))}</li>`;
            }).join('');
            return `<ol>${lis}</ol>`;
        }

        return `<p>${inline(block)}</p>`;
    }).join('\n');
}

function inline(text) {
    return text
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
        .replace(/\n/g, '<br>');
}

function escapeHtml(text) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}
