// Signal Heatmap — walk-around WiFi signal mapper

const SPEED_TEST_URL = 'https://cdnjs.cloudflare.com/ajax/libs/lodash.js/4.17.21/lodash.min.js';

const STORAGE_KEYS = {
    measurements: 'signal-heatmap-measurements',
    settings: 'signal-heatmap-settings',
    path: 'signal-heatmap-path'
};

// --- State ---

const state = {
    mapping: false,
    sensorsAvailable: false,
    heading: 0,            // compass degrees
    posX: 0,               // canvas-logical pixels
    posY: 0,
    stepCount: 0,
    stepsSinceMeasure: 0,
    measurements: [],
    path: [],              // [{x, y}] for trace
    measuring: false,      // prevent concurrent measurements
    lastStepTime: 0        // debounce
};

// Accelerometer filter state
const accel = {
    samples: [],
    windowSize: 5
};

// --- Settings ---

function getSettings() {
    const defaults = { stepLength: 15, measureInterval: 5, threshold: 12, radius: 40 };
    try {
        const saved = localStorage.getItem(STORAGE_KEYS.settings);
        return saved ? Object.assign(defaults, JSON.parse(saved)) : defaults;
    } catch {
        return defaults;
    }
}

function saveSettings(s) {
    localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(s));
}

function readSettingsFromUI() {
    return {
        stepLength: Number(document.getElementById('setting-step-length').value) || 15,
        measureInterval: Number(document.getElementById('setting-measure-interval').value) || 5,
        threshold: Number(document.getElementById('setting-threshold').value) || 12,
        radius: Number(document.getElementById('setting-radius').value) || 40
    };
}

function applySettingsToUI(s) {
    document.getElementById('setting-step-length').value = s.stepLength;
    document.getElementById('setting-measure-interval').value = s.measureInterval;
    document.getElementById('setting-threshold').value = s.threshold;
    document.getElementById('setting-radius').value = s.radius;
}

// --- Canvas ---

let canvas, ctx, dpr, canvasW, canvasH;

function initCanvas() {
    canvas = document.getElementById('heatmap-canvas');
    ctx = canvas.getContext('2d');
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
}

function resizeCanvas() {
    dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvasW = rect.width;
    canvasH = rect.height;
    canvas.width = canvasW * dpr;
    canvas.height = canvasH * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
}

function draw() {
    ctx.clearRect(0, 0, canvasW, canvasH);
    drawGrid();
    drawHeatmap();
    drawPath();
    drawPosition();
}

function drawGrid() {
    const step = 40;
    ctx.strokeStyle = '#e8e8e8';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    for (let x = step; x < canvasW; x += step) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvasH);
    }
    for (let y = step; y < canvasH; y += step) {
        ctx.moveTo(0, y);
        ctx.lineTo(canvasW, y);
    }
    ctx.stroke();
}

function drawHeatmap() {
    const settings = getSettings();
    const r = settings.radius;

    state.measurements.forEach(m => {
        const color = scoreToColor(m.score);
        const grad = ctx.createRadialGradient(m.x, m.y, 0, m.x, m.y, r);
        grad.addColorStop(0, color.replace(')', ', 0.6)').replace('rgb(', 'rgba('));
        grad.addColorStop(1, color.replace(')', ', 0)').replace('rgb(', 'rgba('));
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(m.x, m.y, r, 0, Math.PI * 2);
        ctx.fill();
    });
}

function drawPath() {
    if (state.path.length < 2) return;
    ctx.strokeStyle = 'rgba(150, 150, 150, 0.4)';
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(state.path[0].x, state.path[0].y);
    for (let i = 1; i < state.path.length; i++) {
        ctx.lineTo(state.path[i].x, state.path[i].y);
    }
    ctx.stroke();
}

function drawPosition() {
    // Outer ring
    ctx.fillStyle = 'rgba(50, 100, 220, 0.25)';
    ctx.beginPath();
    ctx.arc(state.posX, state.posY, 12, 0, Math.PI * 2);
    ctx.fill();
    // Inner dot
    ctx.fillStyle = '#3264dc';
    ctx.beginPath();
    ctx.arc(state.posX, state.posY, 5, 0, Math.PI * 2);
    ctx.fill();
    // Heading indicator
    const rad = (state.heading * Math.PI) / 180;
    const hx = state.posX + Math.sin(rad) * 16;
    const hy = state.posY - Math.cos(rad) * 16;
    ctx.strokeStyle = '#3264dc';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(state.posX, state.posY);
    ctx.lineTo(hx, hy);
    ctx.stroke();
}

function scoreToColor(score) {
    // 0-50: red(200,40,40) → yellow(220,200,40)
    // 50-100: yellow(220,200,40) → green(40,180,40)
    let r, g, b;
    if (score <= 50) {
        const t = score / 50;
        r = Math.round(200 + t * 20);
        g = Math.round(40 + t * 160);
        b = 40;
    } else {
        const t = (score - 50) / 50;
        r = Math.round(220 - t * 180);
        g = Math.round(200 - t * 20);
        b = 40;
    }
    return 'rgb(' + r + ', ' + g + ', ' + b + ')';
}

// --- WiFi Measurement (from wifi-helper) ---

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
        const downlinkScore = Math.min(connectionInfo.downlink / 10, 1) * 40;
        let rttScore = 0;
        if (connectionInfo.rtt !== null) {
            rttScore = Math.max(0, (1 - connectionInfo.rtt / 300)) * 30;
        }
        const speedScore = Math.min(speedResult.mbps / 10, 1) * 30;
        return Math.round(downlinkScore + rttScore + speedScore);
    }
    return Math.round(Math.min(speedResult.mbps / 10, 1) * 100);
}

function getQualityLabel(score) {
    if (score >= 75) return 'Excellent';
    if (score >= 50) return 'Good';
    if (score >= 25) return 'Fair';
    return 'Poor';
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// --- Measurement Logic ---

async function takeMeasurement() {
    if (state.measuring) return;
    state.measuring = true;

    try {
        const connectionInfo = getConnectionInfo();
        const speedResult = await runSpeedTest();
        const score = calculateScore(connectionInfo, speedResult);
        const label = getQualityLabel(score);

        const measurement = {
            id: Date.now(),
            x: state.posX,
            y: state.posY,
            score: score,
            label: label,
            downlink: connectionInfo.downlink,
            rtt: connectionInfo.rtt,
            effectiveType: connectionInfo.effectiveType,
            speedMbps: speedResult.mbps,
            speedMs: speedResult.ms,
            timestamp: new Date().toISOString()
        };

        state.measurements.push(measurement);
        saveMeasurements();
        updateStatusBar(label, score);
        renderMeasurementsList();
        draw();
    } catch (err) {
        console.error('Measurement failed:', err);
    } finally {
        state.measuring = false;
    }
}

// --- Sensor Integration ---

function checkSensors() {
    const hasMotion = 'DeviceMotionEvent' in window;
    const hasOrientation = 'DeviceOrientationEvent' in window;
    state.sensorsAvailable = hasMotion && hasOrientation;

    // iOS 13+ requires permission
    if (typeof DeviceMotionEvent.requestPermission === 'function') {
        document.getElementById('ios-permission').hidden = false;
        document.getElementById('btn-permission').addEventListener('click', requestIOSPermission);
        state.sensorsAvailable = false; // until granted
    }

    if (!state.sensorsAvailable && typeof DeviceMotionEvent.requestPermission !== 'function') {
        showSensorStatus('No motion sensors detected. Use tap mode: tap the canvas to place measurement points.');
    }
}

async function requestIOSPermission() {
    try {
        const motionPerm = await DeviceMotionEvent.requestPermission();
        const orientPerm = await DeviceOrientationEvent.requestPermission();
        if (motionPerm === 'granted' && orientPerm === 'granted') {
            state.sensorsAvailable = true;
            document.getElementById('ios-permission').hidden = true;
            showSensorStatus('Sensors enabled.');
        } else {
            showSensorStatus('Permission denied. Use tap mode: tap the canvas to place measurement points.');
        }
    } catch (err) {
        showSensorStatus('Sensor permission error. Use tap mode.');
    }
}

function showSensorStatus(msg) {
    const el = document.getElementById('sensor-status');
    el.textContent = msg;
    el.hidden = false;
}

function startSensors() {
    if (!state.sensorsAvailable) return;

    window.addEventListener('devicemotion', onDeviceMotion);
    window.addEventListener('deviceorientation', onDeviceOrientation);
}

function stopSensors() {
    window.removeEventListener('devicemotion', onDeviceMotion);
    window.removeEventListener('deviceorientation', onDeviceOrientation);
}

function onDeviceMotion(e) {
    if (!state.mapping) return;

    const a = e.accelerationIncludingGravity;
    if (!a) return;

    const mag = Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);

    // Low-pass filter via moving average
    accel.samples.push(mag);
    if (accel.samples.length > accel.windowSize) {
        accel.samples.shift();
    }
    const avg = accel.samples.reduce((s, v) => s + v, 0) / accel.samples.length;

    // Peak detection
    const settings = getSettings();
    const now = Date.now();
    if (avg > settings.threshold && (now - state.lastStepTime) > 300) {
        state.lastStepTime = now;
        onStep();
    }
}

function onDeviceOrientation(e) {
    // e.alpha is compass heading on most devices
    // On iOS, webkitCompassHeading is more reliable
    if (e.webkitCompassHeading != null) {
        state.heading = e.webkitCompassHeading;
    } else if (e.alpha != null) {
        // alpha is degrees from north (but reversed on some devices)
        state.heading = (360 - e.alpha) % 360;
    }
}

function onStep() {
    const settings = getSettings();
    const rad = (state.heading * Math.PI) / 180;
    state.posX += Math.sin(rad) * settings.stepLength;
    state.posY -= Math.cos(rad) * settings.stepLength;

    // Clamp to canvas
    state.posX = Math.max(0, Math.min(canvasW, state.posX));
    state.posY = Math.max(0, Math.min(canvasH, state.posY));

    state.stepCount++;
    state.stepsSinceMeasure++;
    state.path.push({ x: state.posX, y: state.posY });
    savePath();

    document.getElementById('status-steps').textContent = 'Steps: ' + state.stepCount;

    // Auto-measure every N steps
    if (state.stepsSinceMeasure >= settings.measureInterval) {
        state.stepsSinceMeasure = 0;
        takeMeasurement();
    }

    draw();
}

// --- Canvas Interaction ---

function initCanvasInteraction() {
    canvas.addEventListener('pointerdown', onCanvasTap);
}

function onCanvasTap(e) {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    state.posX = x;
    state.posY = y;
    state.path.push({ x, y });
    savePath();
    draw();

    // In manual mode (no sensors or not mapping), auto-measure on tap
    if (!state.sensorsAvailable || !state.mapping) {
        takeMeasurement();
    }
}

// --- Start/Stop Mapping ---

function initToggle() {
    const btn = document.getElementById('btn-toggle');
    btn.addEventListener('click', () => {
        if (state.mapping) {
            stopMapping();
        } else {
            startMapping();
        }
    });
}

function startMapping() {
    state.mapping = true;
    state.stepsSinceMeasure = 0;
    const btn = document.getElementById('btn-toggle');
    btn.textContent = 'Stop Mapping';
    btn.classList.add('active');
    startSensors();

    if (!state.sensorsAvailable) {
        showSensorStatus('Sensors unavailable. Tap the canvas to place measurement points manually.');
    }
}

function stopMapping() {
    state.mapping = false;
    const btn = document.getElementById('btn-toggle');
    btn.textContent = 'Start Mapping';
    btn.classList.remove('active');
    stopSensors();
}

// --- Persistence ---

function loadMeasurements() {
    try {
        const data = localStorage.getItem(STORAGE_KEYS.measurements);
        return data ? JSON.parse(data) : [];
    } catch {
        return [];
    }
}

function saveMeasurements() {
    localStorage.setItem(STORAGE_KEYS.measurements, JSON.stringify(state.measurements));
}

function loadPath() {
    try {
        const data = localStorage.getItem(STORAGE_KEYS.path);
        return data ? JSON.parse(data) : [];
    } catch {
        return [];
    }
}

function savePath() {
    localStorage.setItem(STORAGE_KEYS.path, JSON.stringify(state.path));
}

// --- Status Bar ---

function updateStatusBar(label, score) {
    document.getElementById('status-signal').textContent = 'Signal: ' + label + ' (' + score + ')';
    document.getElementById('status-measurements').textContent = 'Points: ' + state.measurements.length;
}

// --- Measurements List ---

function renderMeasurementsList() {
    const section = document.getElementById('measurements-section');
    const tbody = document.getElementById('measurements-body');

    if (state.measurements.length === 0) {
        section.hidden = true;
        return;
    }

    section.hidden = false;
    tbody.innerHTML = '';

    const sorted = [...state.measurements].sort((a, b) => b.score - a.score);
    sorted.forEach((m, i) => {
        const tr = document.createElement('tr');
        const qualityClass = 'quality-' + m.label.toLowerCase();
        tr.innerHTML =
            '<td>' + (i + 1) + '</td>' +
            '<td>' + m.score + '</td>' +
            '<td class="' + qualityClass + '">' + escapeHtml(m.label) + '</td>' +
            '<td>' + m.speedMbps + ' Mbps</td>' +
            '<td>' + (m.rtt !== null ? m.rtt + ' ms' : 'N/A') + '</td>';
        tbody.appendChild(tr);
    });
}

// --- Actions ---

function initActions() {
    document.getElementById('btn-clear').addEventListener('click', clearAll);
    document.getElementById('btn-export').addEventListener('click', exportData);
}

function clearAll() {
    if (!confirm('Clear all measurements and path data?')) return;
    state.measurements = [];
    state.path = [];
    state.stepCount = 0;
    state.stepsSinceMeasure = 0;
    localStorage.removeItem(STORAGE_KEYS.measurements);
    localStorage.removeItem(STORAGE_KEYS.path);
    document.getElementById('status-signal').textContent = 'Signal: --';
    document.getElementById('status-steps').textContent = 'Steps: 0';
    document.getElementById('status-measurements').textContent = 'Points: 0';
    renderMeasurementsList();
    draw();
}

function exportData() {
    if (state.measurements.length === 0) {
        alert('No measurements to export.');
        return;
    }

    const data = {
        exported: new Date().toISOString(),
        measurements: state.measurements,
        path: state.path
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'signal-heatmap-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    URL.revokeObjectURL(url);
}

// --- Settings Listeners ---

function initSettingsListeners() {
    const inputs = document.querySelectorAll('.settings-grid input');
    inputs.forEach(input => {
        input.addEventListener('change', () => {
            const s = readSettingsFromUI();
            saveSettings(s);
        });
    });
}

// --- Init ---

document.addEventListener('DOMContentLoaded', () => {
    initCanvas();

    // Restore state
    const settings = getSettings();
    applySettingsToUI(settings);

    state.measurements = loadMeasurements();
    state.path = loadPath();

    // Set initial position to canvas center (or last known path position)
    if (state.path.length > 0) {
        const last = state.path[state.path.length - 1];
        state.posX = last.x;
        state.posY = last.y;
    } else {
        state.posX = canvasW / 2;
        state.posY = canvasH / 2;
        state.path.push({ x: state.posX, y: state.posY });
    }

    // Update status bar from restored data
    if (state.measurements.length > 0) {
        const last = state.measurements[state.measurements.length - 1];
        updateStatusBar(last.label, last.score);
    }

    checkSensors();
    initCanvasInteraction();
    initToggle();
    initActions();
    initSettingsListeners();
    renderMeasurementsList();
    draw();
});
