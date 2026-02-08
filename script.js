// List of app directories
// Add new apps to this array when creating them
const APPS = [
    'url-cleaner',
    'device-info',
    'ip-info',
    'piano',
    'poem-analyzer',
    'postit-wall',
    'spec-viewer',
    'wifi-helper',
    'signal-heatmap'
];

document.addEventListener('DOMContentLoaded', async () => {
    const appsList = document.getElementById('apps-list');

    if (APPS.length === 0) {
        appsList.innerHTML = '<p class="no-apps">No apps available yet.</p>';
        return;
    }

    appsList.innerHTML = '';

    for (const appName of APPS) {
        const appItem = await createAppItem(appName);
        appsList.appendChild(appItem);
    }
});

async function createAppItem(appName) {
    const div = document.createElement('div');
    div.className = 'app-item';

    const link = document.createElement('a');
    link.href = `${appName}/`;

    const nameDiv = document.createElement('div');
    nameDiv.className = 'app-name';
    nameDiv.textContent = formatAppName(appName);

    const descDiv = document.createElement('div');
    descDiv.className = 'app-description';

    const description = await fetchAppDescription(appName);
    descDiv.textContent = description;

    link.appendChild(nameDiv);
    link.appendChild(descDiv);
    div.appendChild(link);

    return div;
}

function formatAppName(name) {
    return name
        .split('-')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}

async function fetchAppDescription(appName) {
    try {
        const response = await fetch(`${appName}/spec/functionality.md`);
        if (!response.ok) {
            return 'No description available';
        }

        const text = await response.text();
        const lines = text.split('\n');

        let purposeIndex = -1;
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].trim() === '## Purpose') {
                purposeIndex = i;
                break;
            }
        }

        if (purposeIndex === -1) {
            return 'No description available';
        }

        for (let i = purposeIndex + 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line && !line.startsWith('#')) {
                return line;
            }
        }

        return 'No description available';
    } catch (error) {
        return 'No description available';
    }
}
