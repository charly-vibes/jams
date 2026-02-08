// WiFi Helper - Signal testing, auto-diagnostics, and placement guide

const STORAGE_KEYS = {
    measurements: 'wifi-helper-measurements',
    checklist: 'wifi-helper-checklist'
};

// Speed test resource (~73KB gzipped, public CDN)
const SPEED_TEST_URL = 'https://cdnjs.cloudflare.com/ajax/libs/lodash.js/4.17.21/lodash.min.js';

// --- Activity Definitions ---

const ACTIVITIES = [
    { name: 'Web Browsing',       minSpeed: 1,  maxRtt: 200, minScore: 10 },
    { name: 'Email & Social',     minSpeed: 2,  maxRtt: 200, minScore: 15 },
    { name: 'SD Streaming',       minSpeed: 3,  maxRtt: 150, minScore: 20 },
    { name: 'HD Streaming',       minSpeed: 5,  maxRtt: 100, minScore: 35 },
    { name: 'Video Calls',        minSpeed: 3,  maxRtt: 50,  minScore: 50 },
    { name: '4K Streaming',       minSpeed: 25, maxRtt: 100, minScore: 60 },
    { name: 'Online Gaming',      minSpeed: 3,  maxRtt: 30,  minScore: 65 },
    { name: 'Large Downloads',    minSpeed: 10, maxRtt: 200, minScore: 30 }
];

// --- Checklist Data ---

const CHECKLIST_DATA = [
    {
        title: 'Physical Placement',
        items: [
            { id: 'height', text: 'Place the extender at waist height or higher — avoid floor level' },
            { id: 'halfway', text: 'Position halfway between the router and the dead zone' },
            { id: 'line-of-sight', text: 'Maintain line of sight to the main router if possible' },
            { id: 'open-area', text: 'Place in an open area, not inside a cabinet or closet' },
            { id: 'central', text: 'Choose a central location relative to the area you want to cover' },
            { id: 'ext-signal', text: 'Verify the extender has strong signal to the router (target -50 to -60 dBm or 80+ signal)' },
            { id: 'test-spots', text: 'Test at least 3 candidate spots before choosing a final position' }
        ]
    },
    {
        title: 'Interference Avoidance',
        items: [
            { id: 'microwave', text: 'Keep away from microwaves (they use the 2.4 GHz band)' },
            { id: 'bluetooth', text: 'Minimize nearby Bluetooth devices during use' },
            { id: 'walls', text: 'Avoid thick concrete or brick walls between router and extender' },
            { id: 'mirrors', text: 'Keep away from large mirrors and metal surfaces that reflect signals' },
            { id: 'other-electronics', text: 'Distance from baby monitors, cordless phones, and other 2.4 GHz devices' },
            { id: 'diff-channel', text: 'Ensure router and extender use different WiFi channels (e.g. router on 1, extender on 6 or 11)' }
        ]
    },
    {
        title: 'Configuration',
        items: [
            { id: 'ssid', text: 'Use a different SSID for the extender to control which network you connect to' },
            { id: 'channel', text: 'Set the extender to a non-overlapping channel (1, 6, or 11 for 2.4 GHz)' },
            { id: 'band', text: 'Use 5 GHz for speed in close range, 2.4 GHz for better range through walls' },
            { id: 'firmware', text: 'Update the extender firmware to the latest version' },
            { id: 'security', text: 'Use WPA3 or WPA2-AES encryption — disable WEP, WPA1, and TKIP' },
            { id: 'pmf', text: 'Enable Protected Management Frames (802.11w/PMF) on the router to prevent deauth attacks' },
            { id: 'wps-off', text: 'Disable WPS (WiFi Protected Setup) — it is vulnerable to brute-force attacks' },
            { id: 'router-pw', text: 'Change the router admin password from the default' }
        ]
    },
    {
        title: 'Advanced / Upgrades',
        items: [
            { id: 'ethernet-backhaul', text: 'If the extender has an ethernet port, connect it to the router with a cable and use Access Point mode' },
            { id: 'mesh', text: 'Consider upgrading to a mesh WiFi system for seamless roaming and dedicated backhaul' },
            { id: 'dns-tls', text: 'Enable DNS-over-TLS on your system to encrypt DNS queries from your ISP' },
            { id: 'firewall', text: 'Ensure your device firewall is enabled (e.g. firewalld on Linux, built-in on macOS/Windows)' }
        ]
    }
];

// --- Reference Data ---

const SIGNAL_STRENGTH_TABLE = [
    { dbm: '-30 to -40', quality: 'Excellent', desc: 'Maximum performance, right next to router' },
    { dbm: '-40 to -50', quality: 'Very Good', desc: 'Excellent for all activities' },
    { dbm: '-50 to -60', quality: 'Good', desc: 'Suitable for most activities' },
    { dbm: '-60 to -67', quality: 'Fair', desc: 'May affect video calls and gaming' },
    { dbm: '-67 to -70', quality: 'Weak', desc: 'Slow, basic browsing only' },
    { dbm: '-70 to -80', quality: 'Very Weak', desc: 'Unstable, frequent disconnects' },
    { dbm: '-80 to -90', quality: 'Unusable', desc: 'No reliable connection' }
];

const ACTIVITY_REQ_TABLE = [
    { activity: 'Web Browsing',        speed: '1 Mbps',  latency: '< 200 ms', loss: '< 5%' },
    { activity: 'Email / Social Media', speed: '2 Mbps',  latency: '< 200 ms', loss: '< 5%' },
    { activity: 'SD Streaming (480p)',  speed: '3 Mbps',  latency: '< 150 ms', loss: '< 2%' },
    { activity: 'HD Streaming (1080p)', speed: '5 Mbps',  latency: '< 100 ms', loss: '< 1%' },
    { activity: 'Video Calls (Zoom/Teams)', speed: '3 Mbps', latency: '< 50 ms', loss: '< 1%' },
    { activity: '4K Streaming',         speed: '25 Mbps', latency: '< 100 ms', loss: '< 1%' },
    { activity: 'Online Gaming',        speed: '3 Mbps',  latency: '< 30 ms',  loss: '0%' },
    { activity: 'Large Downloads',      speed: '10+ Mbps', latency: 'Any',     loss: '< 2%' }
];

const TARGET_METRICS = [
    { metric: 'Signal Strength', target: '-60 dBm or better', poor: '-70 dBm or worse' },
    { metric: 'Router Ping (avg)', target: '< 10 ms', poor: '> 30 ms' },
    { metric: 'Router Ping (max)', target: '< 20 ms', poor: '> 50 ms' },
    { metric: 'Jitter', target: '< 5 ms', poor: '> 15 ms' },
    { metric: 'Packet Loss', target: '0%', poor: '> 2%' },
    { metric: 'TX Retry Rate', target: '< 10%', poor: '> 30%' }
];

// --- Init ---

document.addEventListener('DOMContentLoaded', () => {
    initTabs();
    initSignalTester();
    initChecklist();
    initReference();
});

// --- Tabs ---

function initTabs() {
    const tabs = document.querySelectorAll('.tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            tab.classList.add('active');
            document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
        });
    });
}

// --- Signal Tester ---

function initSignalTester() {
    const testBtn = document.getElementById('test-btn');
    const locationInput = document.getElementById('location-name');

    testBtn.addEventListener('click', runTest);
    locationInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') runTest();
    });

    renderResults();
}

async function runTest() {
    const locationInput = document.getElementById('location-name');
    const testBtn = document.getElementById('test-btn');
    const name = locationInput.value.trim();

    if (!name) {
        showStatus('Please enter a location name.');
        locationInput.focus();
        return;
    }

    testBtn.disabled = true;
    clearDiagnostics();
    clearActivityCompat();
    showStatus('Reading connection info...');

    try {
        const connectionInfo = getConnectionInfo();
        showStatus('Running speed test...');
        const speedResult = await runSpeedTest();
        const score = calculateScore(connectionInfo, speedResult);
        const label = getQualityLabel(score);

        const measurement = {
            id: Date.now(),
            name: name,
            score: score,
            label: label,
            downlink: connectionInfo.downlink,
            rtt: connectionInfo.rtt,
            effectiveType: connectionInfo.effectiveType,
            speedMbps: speedResult.mbps,
            speedMs: speedResult.ms,
            timestamp: new Date().toISOString()
        };

        saveMeasurement(measurement);
        renderResults();
        locationInput.value = '';
        showStatus('Test complete \u2014 ' + name + ': ' + label + ' (' + score + '/100)');

        // Auto-diagnostics
        renderDiagnostics(connectionInfo, speedResult, score);
        renderActivityCompat(score, speedResult.mbps, connectionInfo.rtt);
    } catch (err) {
        showStatus('Test failed: ' + err.message);
    } finally {
        testBtn.disabled = false;
    }
}

function getConnectionInfo() {
    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (conn) {
        return {
            downlink: conn.downlink != null ? conn.downlink : null,
            rtt: conn.rtt != null ? conn.rtt : null,
            effectiveType: conn.effectiveType || null
        };
    }
    return { downlink: null, rtt: null, effectiveType: null };
}

async function runSpeedTest() {
    const cacheBuster = '?_=' + Date.now();
    const url = SPEED_TEST_URL + cacheBuster;

    const start = performance.now();
    const response = await fetch(url, { cache: 'no-store' });
    const blob = await response.blob();
    const elapsed = performance.now() - start;

    const bytes = blob.size;
    const seconds = elapsed / 1000;
    const mbps = ((bytes * 8) / seconds) / 1000000;

    return { mbps: Math.round(mbps * 10) / 10, ms: Math.round(elapsed) };
}

function calculateScore(connectionInfo, speedResult) {
    const hasConnection = connectionInfo.downlink !== null;

    if (hasConnection) {
        // Full scoring: 40pts downlink + 30pts RTT + 30pts speed test
        const downlinkScore = Math.min(connectionInfo.downlink / 10, 1) * 40;

        let rttScore = 0;
        if (connectionInfo.rtt !== null) {
            rttScore = Math.max(0, (1 - connectionInfo.rtt / 300)) * 30;
        }

        const speedScore = Math.min(speedResult.mbps / 10, 1) * 30;

        return Math.round(downlinkScore + rttScore + speedScore);
    } else {
        return Math.round(Math.min(speedResult.mbps / 10, 1) * 100);
    }
}

function getQualityLabel(score) {
    if (score >= 75) return 'Excellent';
    if (score >= 50) return 'Good';
    if (score >= 25) return 'Fair';
    return 'Poor';
}

function getBadgeClass(label) {
    return 'badge badge-' + label.toLowerCase();
}

function showStatus(msg) {
    const el = document.getElementById('status');
    el.textContent = msg;
    el.hidden = false;
}

// --- Auto-Diagnostics ---

function runDiagnostics(connectionInfo, speedResult, score) {
    const items = [];

    // Browser API check
    if (connectionInfo.downlink === null) {
        items.push({
            level: 'info',
            text: 'Network Information API not available in this browser. Scoring relies on speed test only. For richer diagnostics, use Chrome, Edge, or Opera.'
        });
    }

    // Connection type
    if (connectionInfo.effectiveType) {
        if (['slow-2g', '2g'].includes(connectionInfo.effectiveType)) {
            items.push({
                level: 'critical',
                text: 'Very slow connection detected (' + connectionInfo.effectiveType + '). You are likely too far from the router or extender.'
            });
        } else if (connectionInfo.effectiveType === '3g') {
            items.push({
                level: 'warn',
                text: 'Moderate connection (' + connectionInfo.effectiveType + '). Consider moving closer to the router or repositioning the extender.'
            });
        }
    }

    // RTT analysis
    if (connectionInfo.rtt !== null) {
        if (connectionInfo.rtt > 100) {
            items.push({
                level: 'critical',
                text: 'Very high latency (' + connectionInfo.rtt + ' ms). Video calls will freeze and gaming will lag badly. This often indicates a weak extender connection or heavy interference.'
            });
        } else if (connectionInfo.rtt > 50) {
            items.push({
                level: 'warn',
                text: 'Elevated latency (' + connectionInfo.rtt + ' ms). Video calls may have hiccups. Target under 50 ms for real-time apps.'
            });
        } else {
            items.push({
                level: 'ok',
                text: 'Latency is good (' + connectionInfo.rtt + ' ms).'
            });
        }
    }

    // Downlink analysis
    if (connectionInfo.downlink !== null) {
        if (connectionInfo.downlink < 2) {
            items.push({
                level: 'critical',
                text: 'Very low reported bandwidth (' + connectionInfo.downlink + ' Mbps). Even basic streaming will struggle.'
            });
        } else if (connectionInfo.downlink < 5) {
            items.push({
                level: 'warn',
                text: 'Low reported bandwidth (' + connectionInfo.downlink + ' Mbps). HD streaming and video calls may buffer.'
            });
        }
    }

    // Speed test analysis
    if (speedResult.mbps < 2) {
        items.push({
            level: 'critical',
            text: 'Speed test measured only ' + speedResult.mbps + ' Mbps. This spot has very poor connectivity.'
        });
    } else if (speedResult.mbps < 5) {
        items.push({
            level: 'warn',
            text: 'Speed test measured ' + speedResult.mbps + ' Mbps. May struggle with HD video and large downloads.'
        });
    } else {
        items.push({
            level: 'ok',
            text: 'Speed test measured ' + speedResult.mbps + ' Mbps (' + speedResult.ms + ' ms download time).'
        });
    }

    // Possible double-hop / extender bottleneck detection
    if (connectionInfo.rtt !== null && connectionInfo.rtt > 40 && speedResult.mbps < 8) {
        items.push({
            level: 'warn',
            text: 'High latency combined with low speed may indicate a WiFi extender bottleneck (double-hop problem). Try connecting directly to your router to compare.'
        });
    }

    // Overall assessment
    if (score >= 75) {
        items.push({ level: 'ok', text: 'This is an excellent spot for a WiFi extender or device.' });
    } else if (score >= 50) {
        items.push({ level: 'ok', text: 'This spot is good for most activities. See activity compatibility below.' });
    } else if (score >= 25) {
        items.push({ level: 'warn', text: 'This spot is marginal. Basic browsing will work but real-time apps will suffer.' });
    } else {
        items.push({ level: 'critical', text: 'This spot is too weak for reliable use. Try a location closer to the router.' });
    }

    return items;
}

function renderDiagnostics(connectionInfo, speedResult, score) {
    const el = document.getElementById('diagnostics');
    const items = runDiagnostics(connectionInfo, speedResult, score);

    el.className = 'diagnostics';
    el.innerHTML = '';
    el.hidden = false;

    items.forEach(item => {
        const div = document.createElement('div');
        let cls = 'diag-item';
        let icon = '\u2022';

        if (item.level === 'critical') {
            cls += ' diag-critical';
            icon = '!!';
        } else if (item.level === 'warn') {
            cls += ' diag-warn';
            icon = '!';
        } else if (item.level === 'ok') {
            cls += ' diag-ok';
            icon = '\u2713';
        }

        div.className = cls;
        div.innerHTML = '<span class="diag-icon">' + icon + '</span><span>' + escapeHtml(item.text) + '</span>';
        el.appendChild(div);
    });
}

function clearDiagnostics() {
    const el = document.getElementById('diagnostics');
    el.innerHTML = '';
    el.hidden = true;
}

// --- Activity Compatibility ---

function getActivityResults(score, speedMbps, rtt) {
    return ACTIVITIES.map(act => {
        const speedOk = speedMbps >= act.minSpeed;
        const rttOk = rtt === null || rtt <= act.maxRtt;
        const scoreOk = score >= act.minScore;

        let status;
        if (scoreOk && speedOk && rttOk) {
            status = 'good';
        } else if ((scoreOk && speedOk) || (speedOk && rttOk)) {
            status = 'fair';
        } else {
            status = 'poor';
        }

        return { name: act.name, status: status };
    });
}

function renderActivityCompat(score, speedMbps, rtt) {
    const el = document.getElementById('activity-compat');
    const results = getActivityResults(score, speedMbps, rtt);

    el.className = 'activity-compat';
    el.innerHTML = '';
    el.hidden = false;

    const title = document.createElement('div');
    title.className = 'activity-compat-title';
    title.textContent = 'Activity Compatibility at This Location';
    el.appendChild(title);

    const grid = document.createElement('div');
    grid.className = 'activity-grid';

    results.forEach(r => {
        const item = document.createElement('div');
        item.className = 'activity-item';

        const verdictLabels = { good: 'OK', fair: 'Maybe', poor: 'No' };

        item.innerHTML =
            '<span class="activity-dot dot-' + r.status + '"></span>' +
            '<span class="activity-label">' + escapeHtml(r.name) + '</span>' +
            '<span class="activity-verdict">' + verdictLabels[r.status] + '</span>';

        grid.appendChild(item);
    });

    el.appendChild(grid);
}

function clearActivityCompat() {
    const el = document.getElementById('activity-compat');
    el.innerHTML = '';
    el.hidden = true;
}

// --- Storage ---

function loadMeasurements() {
    try {
        const data = localStorage.getItem(STORAGE_KEYS.measurements);
        return data ? JSON.parse(data) : [];
    } catch {
        return [];
    }
}

function saveMeasurement(measurement) {
    const measurements = loadMeasurements();
    measurements.push(measurement);
    localStorage.setItem(STORAGE_KEYS.measurements, JSON.stringify(measurements));
}

function deleteMeasurement(id) {
    const measurements = loadMeasurements().filter(m => m.id !== id);
    localStorage.setItem(STORAGE_KEYS.measurements, JSON.stringify(measurements));
    renderResults();
}

// --- Render Results ---

function renderResults() {
    const measurements = loadMeasurements();
    const table = document.getElementById('results-table');
    const tbody = document.getElementById('results-body');
    const bestSpot = document.getElementById('best-spot');

    if (measurements.length === 0) {
        table.hidden = true;
        bestSpot.hidden = true;
        return;
    }

    // Sort by score descending
    const sorted = [...measurements].sort((a, b) => b.score - a.score);
    const bestId = sorted[0].id;

    table.hidden = false;
    tbody.innerHTML = '';

    sorted.forEach(m => {
        const tr = document.createElement('tr');
        if (m.id === bestId) tr.className = 'best-row';

        tr.innerHTML =
            '<td>' + escapeHtml(m.name) + '</td>' +
            '<td>' + m.score + '</td>' +
            '<td><span class="' + getBadgeClass(m.label) + '">' + m.label + '</span></td>' +
            '<td>' + (m.downlink !== null ? m.downlink + ' Mbps' : 'N/A') + '</td>' +
            '<td>' + (m.rtt !== null ? m.rtt + ' ms' : 'N/A') + '</td>' +
            '<td>' + m.speedMbps + ' Mbps</td>' +
            '<td><button class="btn-delete" title="Delete">&#215;</button></td>';

        tr.querySelector('.btn-delete').addEventListener('click', () => deleteMeasurement(m.id));
        tbody.appendChild(tr);
    });

    // Best spot banner
    if (sorted.length >= 2) {
        bestSpot.innerHTML = 'Best spot: <strong>' + escapeHtml(sorted[0].name) + '</strong> (score: ' + sorted[0].score + ')';
        bestSpot.hidden = false;
    } else {
        bestSpot.hidden = true;
    }
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// --- Checklist ---

function initChecklist() {
    const container = document.getElementById('checklist');
    const state = loadChecklistState();

    CHECKLIST_DATA.forEach(category => {
        const section = document.createElement('div');
        section.className = 'checklist-category';

        const heading = document.createElement('h2');
        heading.textContent = category.title;
        section.appendChild(heading);

        category.items.forEach(item => {
            const row = document.createElement('div');
            row.className = 'checklist-item';
            if (state[item.id]) row.classList.add('checked');

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.id = 'check-' + item.id;
            checkbox.checked = !!state[item.id];

            const label = document.createElement('label');
            label.className = 'checklist-label';
            label.htmlFor = 'check-' + item.id;
            label.textContent = item.text;

            checkbox.addEventListener('change', () => {
                row.classList.toggle('checked', checkbox.checked);
                saveChecklistItem(item.id, checkbox.checked);
            });

            row.appendChild(checkbox);
            row.appendChild(label);
            section.appendChild(row);
        });

        container.appendChild(section);
    });
}

function loadChecklistState() {
    try {
        const data = localStorage.getItem(STORAGE_KEYS.checklist);
        return data ? JSON.parse(data) : {};
    } catch {
        return {};
    }
}

function saveChecklistItem(id, checked) {
    const state = loadChecklistState();
    state[id] = checked;
    localStorage.setItem(STORAGE_KEYS.checklist, JSON.stringify(state));
}

// --- Reference Section ---

function initReference() {
    const container = document.getElementById('reference');

    const section = document.createElement('div');
    section.className = 'reference-section';

    const heading = document.createElement('h2');
    heading.textContent = 'Reference';
    section.appendChild(heading);

    // Signal strength table
    section.appendChild(buildRefBlock(
        'WiFi Signal Strength (dBm)',
        'Use your device or router admin panel to check signal strength in dBm. Lower absolute values are better.',
        buildTable(
            ['dBm Range', 'Quality', 'Experience'],
            SIGNAL_STRENGTH_TABLE.map(r => [r.dbm, r.quality, r.desc])
        )
    ));

    // Activity requirements table
    section.appendChild(buildRefBlock(
        'Activity Requirements',
        'Minimum network requirements for common activities. The signal test checks these automatically.',
        buildTable(
            ['Activity', 'Min Speed', 'Max Latency', 'Max Packet Loss'],
            ACTIVITY_REQ_TABLE.map(r => [r.activity, r.speed, r.latency, r.loss])
        )
    ));

    // Target metrics table
    section.appendChild(buildRefBlock(
        'Target Metrics for Extender Placement',
        'When repositioning your extender, aim for the "Target" column. If you see "Poor" values, the extender needs to move.',
        buildTable(
            ['Metric', 'Target', 'Poor'],
            TARGET_METRICS.map(r => [r.metric, r.target, r.poor])
        )
    ));

    // Double-hop explanation
    var doubleHopBlock = document.createElement('div');
    doubleHopBlock.className = 'reference-block';

    var dhTitle = document.createElement('h3');
    dhTitle.textContent = 'The Double-Hop Problem';
    doubleHopBlock.appendChild(dhTitle);

    var dhDesc = document.createElement('p');
    dhDesc.textContent = 'A WiFi extender creates two separate wireless links. Every packet must travel over WiFi twice \u2014 once from your device to the extender, and again from the extender to the router. If either link is weak, the entire connection suffers.';
    doubleHopBlock.appendChild(dhDesc);

    var diagram = document.createElement('div');
    diagram.className = 'diagram';
    diagram.textContent =
        'Your Device <---WiFi---> Extender <---WiFi---> Router\n' +
        '              [hop 1]                [hop 2]\n' +
        '\n' +
        'Both hops share the same airtime.\n' +
        'Weak signal on either hop = retransmissions = lag.';
    doubleHopBlock.appendChild(diagram);

    var dhFix = document.createElement('p');
    dhFix.textContent = 'Fixes: (1) Move the extender closer to the router so the backhaul link is strong. (2) Use an ethernet cable between router and extender (eliminates hop 2 over WiFi). (3) Upgrade to a mesh system with a dedicated backhaul radio.';
    doubleHopBlock.appendChild(dhFix);

    section.appendChild(doubleHopBlock);

    // Same-channel interference
    var channelBlock = document.createElement('div');
    channelBlock.className = 'reference-block';

    var chTitle = document.createElement('h3');
    chTitle.textContent = 'Same-Channel Interference';
    channelBlock.appendChild(chTitle);

    var chDesc = document.createElement('p');
    chDesc.textContent = 'If your router and extender both use the same WiFi channel, they compete for airtime. This halves your effective throughput and causes packet retransmissions. For 2.4 GHz, channels 1, 6, and 11 are the only non-overlapping options \u2014 put your router on one and extender on another.';
    channelBlock.appendChild(chDesc);

    var chDiagram = document.createElement('div');
    chDiagram.className = 'diagram';
    chDiagram.textContent =
        '2.4 GHz non-overlapping channels:\n' +
        '\n' +
        '  Ch 1          Ch 6          Ch 11\n' +
        '  |___|          |___|          |___|\n' +
        '2.412 GHz     2.437 GHz     2.462 GHz\n' +
        '\n' +
        'Use one for the router, a different one for the extender.';
    channelBlock.appendChild(chDiagram);

    section.appendChild(channelBlock);

    container.appendChild(section);
}

function buildRefBlock(title, description, tableEl) {
    var block = document.createElement('div');
    block.className = 'reference-block';

    var h3 = document.createElement('h3');
    h3.textContent = title;
    block.appendChild(h3);

    if (description) {
        var p = document.createElement('p');
        p.textContent = description;
        block.appendChild(p);
    }

    var wrapper = document.createElement('div');
    wrapper.className = 'ref-table-wrapper';
    wrapper.appendChild(tableEl);
    block.appendChild(wrapper);

    return block;
}

function buildTable(headers, rows) {
    var table = document.createElement('table');
    table.className = 'ref-table';

    var thead = document.createElement('thead');
    var headerRow = document.createElement('tr');
    headers.forEach(function(h) {
        var th = document.createElement('th');
        th.textContent = h;
        headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);

    var tbody = document.createElement('tbody');
    rows.forEach(function(row) {
        var tr = document.createElement('tr');
        row.forEach(function(cell) {
            var td = document.createElement('td');
            td.textContent = cell;
            tr.appendChild(td);
        });
        tbody.appendChild(tr);
    });
    table.appendChild(tbody);

    return table;
}
