// Device Info functionality

document.addEventListener('DOMContentLoaded', async () => {
    const infoContainer = document.getElementById('info-container');
    const copyAllBtn = document.getElementById('copy-all-btn');
    const copyFeedback = document.getElementById('copy-feedback');

    const deviceInfo = await collectDeviceInfo();
    displayDeviceInfo(deviceInfo, infoContainer);

    copyAllBtn.addEventListener('click', () => {
        const text = formatDeviceInfoAsText(deviceInfo);
        navigator.clipboard.writeText(text).then(() => {
            copyFeedback.textContent = 'Copied!';
            setTimeout(() => {
                copyFeedback.textContent = '';
            }, 2000);
        }).catch(() => {
            copyFeedback.textContent = 'Failed to copy';
        });
    });
});

async function collectDeviceInfo() {
    const info = {
        browser: collectBrowserInfo(),
        screen: collectScreenInfo(),
        hardware: collectHardwareInfo(),
        network: collectNetworkInfo(),
        battery: await collectBatteryInfo(),
        system: collectSystemInfo(),
        apis: collectAPISupport()
    };

    return info;
}

function collectBrowserInfo() {
    const nav = navigator;
    return {
        'User Agent': nav.userAgent,
        'Platform': nav.platform,
        'Language': nav.language,
        'Languages': nav.languages ? nav.languages.join(', ') : 'N/A',
        'Cookies Enabled': nav.cookieEnabled ? 'Yes' : 'No',
        'Do Not Track': nav.doNotTrack || 'N/A',
        'Online Status': nav.onLine ? 'Online' : 'Offline',
        'Vendor': nav.vendor || 'N/A',
        'Product': nav.product || 'N/A'
    };
}

function collectScreenInfo() {
    const screen = window.screen;
    return {
        'Screen Resolution': `${screen.width} × ${screen.height}`,
        'Available Size': `${screen.availWidth} × ${screen.availHeight}`,
        'Color Depth': `${screen.colorDepth} bit`,
        'Pixel Depth': `${screen.pixelDepth} bit`,
        'Pixel Ratio': window.devicePixelRatio || 'N/A',
        'Orientation': screen.orientation ? screen.orientation.type : 'N/A',
        'Touch Support': 'ontouchstart' in window ? 'Yes' : 'No',
        'Window Size': `${window.innerWidth} × ${window.innerHeight}`
    };
}

function collectHardwareInfo() {
    const nav = navigator;
    return {
        'CPU Cores': nav.hardwareConcurrency || 'N/A',
        'Device Memory': nav.deviceMemory ? `${nav.deviceMemory} GB` : 'N/A',
        'Max Touch Points': nav.maxTouchPoints || 0
    };
}

function collectNetworkInfo() {
    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;

    if (!conn) {
        return {
            'Network Information': 'Not available'
        };
    }

    return {
        'Effective Type': conn.effectiveType || 'N/A',
        'Type': conn.type || 'N/A',
        'Downlink': conn.downlink ? `${conn.downlink} Mbps` : 'N/A',
        'RTT': conn.rtt ? `${conn.rtt} ms` : 'N/A',
        'Save Data': conn.saveData ? 'Enabled' : 'Disabled'
    };
}

async function collectBatteryInfo() {
    if (!navigator.getBattery) {
        return {
            'Battery API': 'Not available'
        };
    }

    try {
        const battery = await navigator.getBattery();
        return {
            'Battery Level': `${Math.round(battery.level * 100)}%`,
            'Charging': battery.charging ? 'Yes' : 'No',
            'Charging Time': battery.chargingTime !== Infinity ? `${battery.chargingTime} seconds` : 'N/A',
            'Discharging Time': battery.dischargingTime !== Infinity ? `${battery.dischargingTime} seconds` : 'N/A'
        };
    } catch (error) {
        return {
            'Battery API': 'Permission denied or not available'
        };
    }
}

function collectSystemInfo() {
    const now = new Date();
    return {
        'Platform': navigator.platform,
        'User Agent': navigator.userAgent.split(' ')[0],
        'Timezone': Intl.DateTimeFormat().resolvedOptions().timeZone,
        'Timezone Offset': `UTC${now.getTimezoneOffset() > 0 ? '-' : '+'}${Math.abs(now.getTimezoneOffset() / 60)}`,
        'Current Date/Time': now.toLocaleString(),
        'Locale': Intl.DateTimeFormat().resolvedOptions().locale
    };
}

function collectAPISupport() {
    return {
        'Service Worker': 'serviceWorker' in navigator ? 'Yes' : 'No',
        'WebGL': detectWebGL() ? 'Yes' : 'No',
        'WebRTC': detectWebRTC() ? 'Yes' : 'No',
        'Local Storage': typeof Storage !== 'undefined' ? 'Yes' : 'No',
        'Session Storage': typeof sessionStorage !== 'undefined' ? 'Yes' : 'No',
        'IndexedDB': 'indexedDB' in window ? 'Yes' : 'No',
        'Geolocation': 'geolocation' in navigator ? 'Yes' : 'No',
        'Notifications': 'Notification' in window ? 'Yes' : 'No',
        'Clipboard API': 'clipboard' in navigator ? 'Yes' : 'No',
        'Web Workers': typeof Worker !== 'undefined' ? 'Yes' : 'No',
        'WebSockets': 'WebSocket' in window ? 'Yes' : 'No',
        'WebAssembly': typeof WebAssembly !== 'undefined' ? 'Yes' : 'No'
    };
}

function detectWebGL() {
    try {
        const canvas = document.createElement('canvas');
        return !!(canvas.getContext('webgl') || canvas.getContext('experimental-webgl'));
    } catch (e) {
        return false;
    }
}

function detectWebRTC() {
    return !!(navigator.getUserMedia || navigator.webkitGetUserMedia ||
              navigator.mozGetUserMedia || navigator.msGetUserMedia ||
              (navigator.mediaDevices && navigator.mediaDevices.getUserMedia));
}

function displayDeviceInfo(info, container) {
    container.innerHTML = '';

    const sections = [
        { title: 'Browser', data: info.browser },
        { title: 'Screen & Display', data: info.screen },
        { title: 'Hardware', data: info.hardware },
        { title: 'Network', data: info.network },
        { title: 'Battery', data: info.battery },
        { title: 'System', data: info.system },
        { title: 'Web APIs Support', data: info.apis }
    ];

    sections.forEach(section => {
        const sectionDiv = document.createElement('div');
        sectionDiv.className = 'info-section';

        const title = document.createElement('div');
        title.className = 'section-title';
        title.textContent = section.title;
        sectionDiv.appendChild(title);

        const grid = document.createElement('div');
        grid.className = 'info-grid';

        Object.entries(section.data).forEach(([key, value]) => {
            const label = document.createElement('div');
            label.className = 'info-label';
            label.textContent = key + ':';

            const valueDiv = document.createElement('div');
            valueDiv.className = 'info-value';

            if (value === 'N/A' || value === 'Not available' || value === 'Permission denied or not available') {
                valueDiv.classList.add('not-available');
            }

            if (key === 'User Agent' || key.includes('Resolution') || key.includes('Size')) {
                valueDiv.classList.add('monospace');
            }

            valueDiv.textContent = value;

            grid.appendChild(label);
            grid.appendChild(valueDiv);
        });

        sectionDiv.appendChild(grid);
        container.appendChild(sectionDiv);
    });
}

function formatDeviceInfoAsText(info) {
    let text = 'DEVICE INFORMATION\n\n';

    const sections = [
        { title: 'BROWSER', data: info.browser },
        { title: 'SCREEN & DISPLAY', data: info.screen },
        { title: 'HARDWARE', data: info.hardware },
        { title: 'NETWORK', data: info.network },
        { title: 'BATTERY', data: info.battery },
        { title: 'SYSTEM', data: info.system },
        { title: 'WEB APIs SUPPORT', data: info.apis }
    ];

    sections.forEach(section => {
        text += `${section.title}\n`;
        text += '='.repeat(section.title.length) + '\n';
        Object.entries(section.data).forEach(([key, value]) => {
            text += `${key}: ${value}\n`;
        });
        text += '\n';
    });

    return text;
}
