'use strict';

// ═══════════════════════════════════════════════════════════════════════════════
// SENSOR DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════════════
const SENSOR_DEFS = {
  accelerometer: {
    id: 0, name: 'Accelerometer', unit: 'm/s²',
    dataFields: ['x', 'y', 'z'],
    colors: ['#e74c3c', '#2ecc71', '#3498db'],
    apiClass: 'Accelerometer',
    readGeneric: s => [s.x, s.y, s.z],
    motionEvent: 'devicemotion',
    readMotion: e => e.accelerationIncludingGravity
      ? [e.accelerationIncludingGravity.x ?? 0,
         e.accelerationIncludingGravity.y ?? 0,
         e.accelerationIncludingGravity.z ?? 0]
      : null,
    defaultHz: 10, range: [-20, 20]
  },
  gyroscope: {
    id: 1, name: 'Gyroscope', unit: 'rad/s',
    dataFields: ['x', 'y', 'z'],
    colors: ['#e74c3c', '#2ecc71', '#3498db'],
    apiClass: 'Gyroscope',
    readGeneric: s => [s.x, s.y, s.z],
    motionEvent: 'devicemotion',
    readMotion: e => e.rotationRate
      ? [e.rotationRate.alpha * Math.PI / 180,
         e.rotationRate.beta  * Math.PI / 180,
         e.rotationRate.gamma * Math.PI / 180]
      : null,
    defaultHz: 10, range: [-5, 5]
  },
  gravity: {
    id: 2, name: 'Gravity', unit: 'm/s²',
    dataFields: ['x', 'y', 'z'],
    colors: ['#e74c3c', '#2ecc71', '#3498db'],
    apiClass: 'GravitySensor',
    readGeneric: s => [s.x, s.y, s.z],
    motionEvent: null, readMotion: null,
    defaultHz: 10, range: [-12, 12]
  },
  linearAccel: {
    id: 3, name: 'Linear Accel', unit: 'm/s²',
    dataFields: ['x', 'y', 'z'],
    colors: ['#e74c3c', '#2ecc71', '#3498db'],
    apiClass: 'LinearAccelerationSensor',
    readGeneric: s => [s.x, s.y, s.z],
    motionEvent: 'devicemotion',
    readMotion: e => e.acceleration
      ? [e.acceleration.x ?? 0, e.acceleration.y ?? 0, e.acceleration.z ?? 0]
      : null,
    defaultHz: 10, range: [-10, 10]
  },
  orientation: {
    id: 4, name: 'Orientation', unit: '°',
    dataFields: ['alpha', 'beta', 'gamma'],
    colors: ['#9b59b6', '#f39c12', '#1abc9c'],
    apiClass: null,
    motionEvent: 'deviceorientation',
    readMotion: e => [e.alpha ?? 0, e.beta ?? 0, e.gamma ?? 0],
    defaultHz: 10, range: [-180, 180]
  },
  compass: {
    id: 5, name: 'Compass', unit: '°',
    dataFields: ['heading'],
    colors: ['#f39c12'],
    apiClass: null,
    motionEvent: 'deviceorientationabsolute',
    readMotion: e => {
      if (e.alpha == null) return null;
      const h = e.webkitCompassHeading != null
        ? e.webkitCompassHeading
        : (360 - e.alpha) % 360;
      return [h];
    },
    // fallback: listen to deviceorientation for webkitCompassHeading (iOS)
    motionEventAlt: 'deviceorientation',
    readMotionAlt: e => e.webkitCompassHeading != null ? [e.webkitCompassHeading] : null,
    defaultHz: 5, range: [0, 360]
  },
  gps: {
    id: 6, name: 'GPS', unit: '',
    dataFields: ['lat', 'lon', 'alt', 'speed', 'acc'],
    colors: ['#2ecc71', '#3498db', '#e74c3c', '#f39c12', '#9b59b6'],
    apiClass: null, special: 'gps',
    defaultHz: 1, range: [-90, 90]
  }
};

const RING_CAPACITY = 512;
const DRAIN_INTERVAL_MS = 3000;
const FLUSH_INTERVAL_MS = 30000;
const FREQ_OPTIONS = [1, 5, 10, 30, 60];

// ═══════════════════════════════════════════════════════════════════════════════
// RING BUFFER — circular display buffer, never cleared, overwrites oldest
// ═══════════════════════════════════════════════════════════════════════════════
class RingBuffer {
  constructor(capacity, fields) {
    this.capacity = capacity;
    this.fields = fields;
    this.data = new Float64Array(capacity * fields);
    this.head = 0;  // next write slot
    this.size = 0;  // valid sample count
  }

  // row: array of `fields` numbers [timestamp, v1, v2, ...]
  push(row) {
    const base = this.head * this.fields;
    for (let f = 0; f < this.fields; f++) this.data[base + f] = row[f] ?? 0;
    this.head = (this.head + 1) % this.capacity;
    if (this.size < this.capacity) this.size++;
  }

  // Returns ordered Float64Array, oldest first
  getOrdered() {
    const n = this.size;
    if (n === 0) return new Float64Array(0);
    const out = new Float64Array(n * this.fields);
    const start = this.size < this.capacity ? 0 : this.head;
    for (let i = 0; i < n; i++) {
      const src = ((start + i) % this.capacity) * this.fields;
      const dst = i * this.fields;
      for (let f = 0; f < this.fields; f++) out[dst + f] = this.data[src + f];
    }
    return out;
  }

  // Returns last N samples as ordered Float64Array
  getLastN(n) {
    const count = Math.min(n, this.size);
    if (count === 0) return new Float64Array(0);
    const out = new Float64Array(count * this.fields);
    for (let i = 0; i < count; i++) {
      const srcSlot = (this.head - count + i + this.capacity * 2) % this.capacity;
      const src = srcSlot * this.fields;
      const dst = i * this.fields;
      for (let f = 0; f < this.fields; f++) out[dst + f] = this.data[src + f];
    }
    return out;
  }

  getLastValue() {
    if (this.size === 0) return null;
    const last = (this.head - 1 + this.capacity) % this.capacity;
    return Array.from(this.data.subarray(last * this.fields, (last + 1) * this.fields));
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SENSOR MANAGER
// ═══════════════════════════════════════════════════════════════════════════════
class SensorManager {
  constructor(onSample) {
    this.onSample = onSample; // fn(sensorKey, row: number[])
    this._active = {};        // sensorKey → cleanup fn
    this._motionPermGranted = false;
  }

  async requestMotionPermission() {
    if (typeof DeviceMotionEvent !== 'undefined' &&
        typeof DeviceMotionEvent.requestPermission === 'function') {
      const result = await DeviceMotionEvent.requestPermission();
      this._motionPermGranted = result === 'granted';
      return this._motionPermGranted;
    }
    this._motionPermGranted = true;
    return true;
  }

  // Returns {sensorKey: true/false} indicating hardware availability
  async detect() {
    const avail = {};
    for (const [key, def] of Object.entries(SENSOR_DEFS)) {
      if (def.special === 'gps') {
        avail[key] = 'geolocation' in navigator;
        continue;
      }
      if (def.apiClass && def.apiClass in window) {
        avail[key] = true;
        continue;
      }
      if (def.motionEvent) {
        avail[key] = true; // assume available; confirmed on first event
        continue;
      }
      avail[key] = false;
    }
    return avail;
  }

  start(sensorKey, hz) {
    this.stop(sensorKey);
    const def = SENSOR_DEFS[sensorKey];
    if (!def) return;

    if (def.special === 'gps') {
      this._startGPS(sensorKey);
      return;
    }
    if (def.apiClass && def.apiClass in window) {
      this._startGeneric(sensorKey, def, hz);
    } else if (def.motionEvent) {
      this._startLegacy(sensorKey, def, hz);
    }
  }

  stop(sensorKey) {
    const cleanup = this._active[sensorKey];
    if (cleanup) { cleanup(); delete this._active[sensorKey]; }
  }

  stopAll() {
    for (const key of Object.keys(this._active)) this.stop(key);
  }

  _startGeneric(key, def, hz) {
    try {
      const SensorClass = window[def.apiClass];
      const sensor = new SensorClass({ frequency: hz });
      sensor.addEventListener('reading', () => {
        const vals = def.readGeneric(sensor);
        if (vals && vals.every(v => v != null && !isNaN(v))) {
          this.onSample(key, [Date.now(), ...vals]);
        }
      });
      sensor.addEventListener('error', (e) => {
        console.warn(`${def.apiClass} error:`, e.error?.message);
        // Fallback to legacy
        if (def.motionEvent) this._startLegacy(key, def, hz);
      });
      sensor.start();
      this._active[key] = () => sensor.stop();
    } catch (e) {
      console.warn(`${def.apiClass} unavailable, falling back:`, e);
      if (def.motionEvent) this._startLegacy(key, def, hz);
    }
  }

  _startLegacy(key, def, hz) {
    // Determine effective Hz from devicemotion/orientation which fires at ~60Hz
    const skipFactor = Math.max(1, Math.round(60 / hz));
    let counter = 0;
    let gotData = false;

    const handler = (e) => {
      counter++;
      if (counter % skipFactor !== 0) return;
      const vals = def.readMotion(e);
      if (vals && vals.every(v => v != null && !isNaN(v))) {
        gotData = true;
        this.onSample(key, [Date.now(), ...vals]);
      }
    };

    window.addEventListener(def.motionEvent, handler, { passive: true });
    this._active[key] = () => window.removeEventListener(def.motionEvent, handler);

    // For compass, also try the alt event (iOS webkitCompassHeading via deviceorientation)
    if (def.motionEventAlt) {
      let counterAlt = 0;
      const handlerAlt = (e) => {
        if (gotData) return; // already getting data from primary
        counterAlt++;
        if (counterAlt % skipFactor !== 0) return;
        const vals = def.readMotionAlt(e);
        if (vals && vals.every(v => v != null && !isNaN(v))) {
          this.onSample(key, [Date.now(), ...vals]);
        }
      };
      window.addEventListener(def.motionEventAlt, handlerAlt, { passive: true });
      const prevCleanup = this._active[key];
      this._active[key] = () => {
        prevCleanup();
        window.removeEventListener(def.motionEventAlt, handlerAlt);
      };
    }
  }

  _startGPS(key) {
    if (!('geolocation' in navigator)) return;
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude, altitude, speed, accuracy } = pos.coords;
        this.onSample(key, [
          Date.now(),
          latitude,
          longitude,
          altitude ?? 0,
          speed ?? 0,
          accuracy ?? 0
        ]);
      },
      (err) => console.warn('GPS error:', err),
      { enableHighAccuracy: true, maximumAge: 0 }
    );
    this._active[key] = () => navigator.geolocation.clearWatch(watchId);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SENSOR CHART — canvas-based time series for one sensor
// ═══════════════════════════════════════════════════════════════════════════════
class SensorChart {
  constructor(canvas, sensorKey, ringBuf) {
    this.canvas = canvas;
    this.sensorKey = sensorKey;
    this.ring = ringBuf;
    this.def = SENSOR_DEFS[sensorKey];
    this.visible = true;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.dpr = dpr;
    const w = canvas.clientWidth || 300;
    const h = canvas.clientHeight || 120;
    canvas.width = w * dpr;
    canvas.height = h * dpr;

    this.ctx = canvas.getContext('2d', { alpha: false });
    this.ctx.scale(dpr, dpr);
    this.cw = w;
    this.ch = h;

    // Auto-range state (one per series)
    const [lo, hi] = this.def.range;
    this.yMin = lo;
    this.yMax = hi;

    // IntersectionObserver to pause rendering when off-screen
    this._obs = new IntersectionObserver(entries => {
      this.visible = entries[0].isIntersecting;
    }, { threshold: 0.1 });
    this._obs.observe(canvas);
  }

  draw() {
    const { ctx, cw, ch, def } = this;
    const data = this.ring.getOrdered();
    const fields = def.dataFields.length + 1; // +1 for timestamp
    const samples = data.length / fields;

    ctx.fillStyle = '#0d0d1a';
    ctx.fillRect(0, 0, cw, ch);

    // Draw grid line at zero
    ctx.strokeStyle = '#333355';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    const zeroY = ch - ((0 - this.yMin) / ((this.yMax - this.yMin) || 1)) * ch;
    if (zeroY >= 0 && zeroY <= ch) {
      ctx.beginPath();
      ctx.moveTo(0, zeroY);
      ctx.lineTo(cw, zeroY);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    if (samples < 2) {
      // Label
      ctx.fillStyle = '#555';
      ctx.font = '11px system-ui';
      ctx.fillText('Waiting for data…', 8, ch / 2 + 4);
      return;
    }

    // Update auto-range from current data
    let dataMin = Infinity, dataMax = -Infinity;
    for (let i = 0; i < samples; i++) {
      for (let f = 1; f < fields; f++) {
        const v = data[i * fields + f];
        if (v < dataMin) dataMin = v;
        if (v > dataMax) dataMax = v;
      }
    }
    if (isFinite(dataMin)) {
      const pad = (dataMax - dataMin) * 0.1 || 1;
      const alpha = 0.06;
      this.yMin = this.yMin * (1 - alpha) + (dataMin - pad) * alpha;
      this.yMax = this.yMax * (1 - alpha) + (dataMax + pad) * alpha;
    }
    const range = (this.yMax - this.yMin) || 1;

    // Draw each data series
    for (let f = 1; f < fields; f++) {
      ctx.beginPath();
      ctx.strokeStyle = def.colors[f - 1] || '#888';
      ctx.lineWidth = 1.5;
      for (let i = 0; i < samples; i++) {
        const x = (i / (samples - 1)) * cw;
        const v = data[i * fields + f];
        const y = ch - ((v - this.yMin) / range) * ch;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // Y-axis labels
    ctx.fillStyle = '#666';
    ctx.font = '10px system-ui';
    ctx.fillText(this.yMax.toFixed(2), 4, 11);
    ctx.fillText(this.yMin.toFixed(2), 4, ch - 3);

    // Unit label
    if (def.unit) {
      ctx.fillStyle = '#444';
      ctx.textAlign = 'right';
      ctx.fillText(def.unit, cw - 4, 11);
      ctx.textAlign = 'left';
    }
  }

  resize() {
    const dpr = this.dpr;
    const w = this.canvas.clientWidth || 300;
    const h = this.canvas.clientHeight || 120;
    this.canvas.width = w * dpr;
    this.canvas.height = h * dpr;
    this.ctx.scale(dpr, dpr);
    this.cw = w;
    this.ch = h;
  }

  destroy() {
    this._obs.disconnect();
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// BACKGROUND KEEP-ALIVE
// ═══════════════════════════════════════════════════════════════════════════════
class BackgroundKeepAlive {
  constructor() {
    this._wakeLock = null;
    this._audioCtx = null;
    this._oscillator = null;
    this._enabled = false;
  }

  async enable() {
    this._enabled = true;
    await this._acquireWakeLock();
    this._startAudio();
    // Re-acquire wake lock when tab becomes visible again
    document.addEventListener('visibilitychange', this._onVisible);
  }

  disable() {
    this._enabled = false;
    this._releaseWakeLock();
    this._stopAudio();
    document.removeEventListener('visibilitychange', this._onVisible);
  }

  _onVisible = async () => {
    if (document.visibilityState === 'visible' && this._enabled) {
      await this._acquireWakeLock();
    }
  };

  async _acquireWakeLock() {
    if (!('wakeLock' in navigator)) return;
    try {
      this._wakeLock = await navigator.wakeLock.request('screen');
    } catch (e) {
      console.warn('Wake lock failed:', e);
    }
  }

  _releaseWakeLock() {
    if (this._wakeLock) {
      this._wakeLock.release();
      this._wakeLock = null;
    }
  }

  _startAudio() {
    // Silent audio trick for Android Chrome background execution
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    if (isIOS) return; // Does not work on iOS
    try {
      this._audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      this._oscillator = this._audioCtx.createOscillator();
      const gain = this._audioCtx.createGain();
      gain.gain.setValueAtTime(0.001, this._audioCtx.currentTime);
      this._oscillator.frequency.setValueAtTime(1, this._audioCtx.currentTime);
      this._oscillator.connect(gain);
      gain.connect(this._audioCtx.destination);
      this._oscillator.start();
    } catch (e) {
      console.warn('Audio keep-alive failed:', e);
    }
  }

  _stopAudio() {
    if (this._oscillator) { try { this._oscillator.stop(); } catch (_) {} this._oscillator = null; }
    if (this._audioCtx) { try { this._audioCtx.close(); } catch (_) {} this._audioCtx = null; }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════════════════════════════
class App {
  constructor() {
    this.worker = null;
    this.workerReady = false;
    this.recording = false;
    this.currentSessionId = null;
    this.sensorEnabled = {};    // sensorKey → bool
    this.sensorHz = {};         // sensorKey → Hz
    this.rings = {};            // sensorKey → RingBuffer
    this.pending = {};          // sensorKey → Float64Array rows (for storage)
    this.sampleCounts = {};     // sensorKey → number
    this.charts = {};           // sensorKey → SensorChart
    this.keepAlive = new BackgroundKeepAlive();
    this.sensorMgr = new SensorManager(this._onSample.bind(this));
    this.drainTimer = null;
    this.flushTimer = null;
    this.recTimerInterval = null;
    this.recStartTime = 0;
    this.totalSamples = 0;
    this._workerCallbacks = {};
    this._opfsSupported = false;
    this._renderFrameId = null;
    this._frameCount = 0;
  }

  async init() {
    this._checkOPFS();
    this._initWorker();
    this._setupLifecycleListeners();
    this._setupNav();
    this._setupRecordButton();
    this._setupKeepAliveToggle();

    const availability = await this.sensorMgr.detect();
    this._initSensorState(availability);
    this._renderSensorCards(availability);
    this._startRenderLoop();
  }

  // ─── OPFS support ────────────────────────────────────────────────────────────
  _checkOPFS() {
    this._opfsSupported = 'storage' in navigator &&
      typeof FileSystemFileHandle !== 'undefined';
    if (!this._opfsSupported) {
      this._showToast('OPFS not supported. Data will not be saved to disk.', 5000);
    }
  }

  // ─── Worker setup ─────────────────────────────────────────────────────────────
  _initWorker() {
    try {
      this.worker = new Worker('storage-worker.js');
      this.worker.onmessage = (e) => this._handleWorkerMessage(e.data);
      this.worker.onerror = (e) => console.error('Worker error:', e);
      // Ask worker to check for interrupted sessions from previous runs
      this.worker.postMessage({ type: 'checkInterrupted' });
    } catch (e) {
      console.error('Worker init failed:', e);
    }
  }

  _handleWorkerMessage(msg) {
    switch (msg.type) {
      case 'initDone':
        this.workerReady = true;
        break;
      case 'interruptedSessions':
        if (msg.sessions && msg.sessions.length > 0) {
          this._showToast(`${msg.sessions.length} interrupted session(s) found. Check Sessions tab.`, 5000);
        }
        break;
      case 'sessionsList':
        this._renderSessionsList(msg.sessions);
        break;
      case 'sessionData':
        this._exportSessionData(msg);
        break;
      case 'deleteSessionDone':
        this._loadSessions();
        break;
      case 'closeDone':
        this.workerReady = false;
        break;
      case 'sessionSize':
        // handled inline via Promise if needed
        break;
      case 'error':
        console.error('Worker error:', msg.message, 'context:', msg.context);
        break;
    }
    // Resolve any waiting callbacks
    if (msg.type && this._workerCallbacks[msg.type]) {
      this._workerCallbacks[msg.type](msg);
      delete this._workerCallbacks[msg.type];
    }
  }

  _workerRequest(message, responseType) {
    return new Promise(resolve => {
      this._workerCallbacks[responseType] = resolve;
      this.worker.postMessage(message);
    });
  }

  // ─── Sensor state initialization ─────────────────────────────────────────────
  _initSensorState(availability) {
    for (const [key, def] of Object.entries(SENSOR_DEFS)) {
      this.sensorEnabled[key] = false;
      this.sensorHz[key] = def.defaultHz;
      const fields = 1 + def.dataFields.length; // timestamp + values
      this.rings[key] = new RingBuffer(RING_CAPACITY, fields);
      this.pending[key] = [];
      this.sampleCounts[key] = 0;
    }
  }

  // ─── Sensor sample callback ───────────────────────────────────────────────────
  _onSample(key, row) {
    // row: [timestamp, v1, v2, ...]
    this.rings[key].push(row);
    if (this.recording) {
      this.pending[key].push(row);
      this.sampleCounts[key] = (this.sampleCounts[key] || 0) + 1;
      this.totalSamples++;
    }
    // Update card live value
    this._updateCardValue(key, row.slice(1));
  }

  // ─── Recording lifecycle ──────────────────────────────────────────────────────
  async startRecording() {
    if (this.recording) return;

    const activeSensors = Object.keys(this.sensorEnabled).filter(k => this.sensorEnabled[k]);
    if (activeSensors.length === 0) {
      this._showToast('Enable at least one sensor first.');
      return;
    }

    // iOS permission gate
    const needsPermission = typeof DeviceMotionEvent !== 'undefined' &&
      typeof DeviceMotionEvent.requestPermission === 'function';
    if (needsPermission) {
      const granted = await this.sensorMgr.requestMotionPermission();
      if (!granted) {
        this._showToast('Motion permission denied.');
        return;
      }
    }

    this.recording = true;
    this.totalSamples = 0;
    this.sampleCounts = {};
    this.recStartTime = Date.now();
    this.currentSessionId = this.recStartTime.toString();

    // Start sensors
    for (const key of activeSensors) {
      this.sensorMgr.start(key, this.sensorHz[key]);
    }

    // Init worker session
    if (this._opfsSupported && this.worker) {
      const meta = {
        startTime: this.recStartTime,
        sensors: activeSensors,
        frequencies: Object.fromEntries(activeSensors.map(k => [k, this.sensorHz[k]]))
      };
      this.worker.postMessage({ type: 'init', sessionId: this.currentSessionId, meta });
    }

    // Start drain and flush timers
    this.drainTimer = setInterval(() => this._drain(), DRAIN_INTERVAL_MS);
    this.flushTimer = setInterval(() => {
      if (this.worker) this.worker.postMessage({ type: 'flush' });
    }, FLUSH_INTERVAL_MS);

    // Start recording timer UI
    this.recTimerInterval = setInterval(() => this._updateRecTimer(), 500);

    // Build timeline charts
    this._buildTimeline(activeSensors);

    // Auto dark mode
    document.body.classList.add('recording');

    this._updateRecordButton();
    this._showToast('Recording started');
  }

  async stopRecording() {
    if (!this.recording) return;
    this.recording = false;

    // Final drain
    this._drain(true);

    clearInterval(this.drainTimer);
    clearInterval(this.flushTimer);
    clearInterval(this.recTimerInterval);
    this.drainTimer = null;
    this.flushTimer = null;
    this.recTimerInterval = null;

    // Stop all sensors
    this.sensorMgr.stopAll();

    // Close worker session
    if (this._opfsSupported && this.worker) {
      this.worker.postMessage({
        type: 'close',
        endTime: Date.now(),
        sampleCounts: { ...this.sampleCounts }
      });
    }

    this.keepAlive.disable();
    document.body.classList.remove('recording');
    document.getElementById('chk-keepalive').checked = false;

    this._updateRecordButton();
    const duration = Math.floor((Date.now() - this.recStartTime) / 1000);
    this._showToast(`Recording stopped. ${this.totalSamples.toLocaleString()} samples in ${this._formatDuration(duration)}.`);

    // Refresh sessions list
    setTimeout(() => this._loadSessions(), 1000);
  }

  // ─── Drain pending samples to worker ─────────────────────────────────────────
  _drain(final = false) {
    if (!this.worker || !this._opfsSupported) return;
    for (const [key, rows] of Object.entries(this.pending)) {
      if (rows.length === 0) continue;
      const def = SENSOR_DEFS[key];
      const fields = 1 + def.dataFields.length;
      const buf = new Float64Array(rows.length * fields);
      for (let i = 0; i < rows.length; i++) {
        for (let f = 0; f < fields; f++) buf[i * fields + f] = rows[i][f] ?? 0;
      }
      this.worker.postMessage(
        { type: 'writeBatch', buffer: buf.buffer, sensorId: def.id },
        [buf.buffer]  // transfer ownership (zero-copy)
      );
      this.pending[key] = [];
    }
    if (final) {
      this.worker.postMessage({ type: 'flush' });
    }
  }

  // ─── Emergency flush on tab hide/freeze ───────────────────────────────────────
  _emergencyFlush() {
    if (!this.recording) return;
    this._drain(true);
  }

  _setupLifecycleListeners() {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this._emergencyFlush();
    }, { capture: true });
    window.addEventListener('pagehide', () => this._emergencyFlush(), { capture: true });
    document.addEventListener('freeze', () => this._emergencyFlush(), { capture: true });
  }

  // ─── Navigation ───────────────────────────────────────────────────────────────
  _setupNav() {
    const tabs = document.querySelectorAll('.tab');
    const screens = document.querySelectorAll('.screen');

    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const target = tab.dataset.screen;
        tabs.forEach(t => t.classList.toggle('active', t.dataset.screen === target));
        screens.forEach(s => s.classList.toggle('active', s.id === `screen-${target}`));
        if (target === 'sessions') this._loadSessions();
      });
    });
  }

  // ─── Record button ────────────────────────────────────────────────────────────
  _setupRecordButton() {
    const btn = document.getElementById('btn-record');
    btn.addEventListener('click', () => {
      if (this.recording) this.stopRecording();
      else this.startRecording();
    });
  }

  _updateRecordButton() {
    const btn = document.getElementById('btn-record');
    const status = document.getElementById('recording-status');
    if (this.recording) {
      btn.textContent = '⏹ STOP';
      btn.classList.add('recording');
      status.classList.remove('hidden');
    } else {
      btn.textContent = '⏺ RECORD';
      btn.classList.remove('recording');
      status.classList.add('hidden');
    }
  }

  _updateRecTimer() {
    const el = document.getElementById('rec-timer');
    const samplesEl = document.getElementById('rec-samples');
    if (!el) return;
    const elapsed = Math.floor((Date.now() - this.recStartTime) / 1000);
    el.textContent = this._formatDuration(elapsed);
    samplesEl.textContent = `${this.totalSamples.toLocaleString()} samples`;
  }

  _formatDuration(secs) {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    return [h, m, s].map(n => n.toString().padStart(2, '0')).join(':');
  }

  // ─── Keep-alive toggle ────────────────────────────────────────────────────────
  _setupKeepAliveToggle() {
    const chk = document.getElementById('chk-keepalive');
    chk.addEventListener('change', async () => {
      if (chk.checked) {
        await this.keepAlive.enable();
        this._showToast('Screen keep-alive enabled');
      } else {
        this.keepAlive.disable();
      }
    });
  }

  // ─── Sensor cards rendering ───────────────────────────────────────────────────
  _renderSensorCards(availability) {
    const container = document.getElementById('sensors-list');
    container.innerHTML = '';

    for (const [key, def] of Object.entries(SENSOR_DEFS)) {
      const available = availability[key];
      const card = document.createElement('div');
      card.className = `sensor-card${available ? '' : ' unavailable'}`;
      card.dataset.sensor = key;

      const freqOpts = FREQ_OPTIONS
        .filter(hz => hz <= (def.special === 'gps' ? 1 : 60))
        .map(hz => `<option value="${hz}"${hz === def.defaultHz ? ' selected' : ''}>${hz} Hz</option>`)
        .join('');

      card.innerHTML = `
        <div class="card-header">
          <span class="sensor-name">${def.name}</span>
          <label class="toggle-wrap">
            <input type="checkbox" class="sensor-toggle" data-sensor="${key}"${available ? '' : ' disabled'}>
            <span class="toggle-track"><span class="toggle-thumb"></span></span>
          </label>
        </div>
        <div class="card-body">
          <select class="freq-select" data-sensor="${key}"${available ? '' : ' disabled'}>
            ${freqOpts}
          </select>
          <span class="sensor-unit">${def.unit || 'position'}</span>
          <span class="sensor-value" id="val-${key}">—</span>
        </div>
        ${!available ? '<div class="unavailable-badge">Not available on this device</div>' : ''}
      `;

      const toggle = card.querySelector('.sensor-toggle');
      toggle.addEventListener('change', () => {
        this.sensorEnabled[key] = toggle.checked;
        card.classList.toggle('enabled', toggle.checked);
      });

      const select = card.querySelector('.freq-select');
      select.addEventListener('change', () => {
        this.sensorHz[key] = parseInt(select.value, 10);
        // If sensor is already running (during recording), restart it at new rate
        if (this.recording && this.sensorEnabled[key]) {
          this.sensorMgr.start(key, this.sensorHz[key]);
        }
      });

      container.appendChild(card);
    }
  }

  _updateCardValue(key, values) {
    const el = document.getElementById(`val-${key}`);
    if (!el) return;
    const def = SENSOR_DEFS[key];
    if (def.special === 'gps') {
      el.textContent = `${values[0]?.toFixed(4)}, ${values[1]?.toFixed(4)}`;
    } else {
      el.textContent = values.map(v => v != null ? v.toFixed(2) : '—').join('  ');
    }
  }

  // ─── Timeline (canvas charts) ─────────────────────────────────────────────────
  _buildTimeline(activeSensors) {
    const container = document.getElementById('charts-container');
    container.innerHTML = '';

    // Destroy existing charts
    for (const chart of Object.values(this.charts)) chart.destroy();
    this.charts = {};

    for (const key of activeSensors) {
      const def = SENSOR_DEFS[key];
      const wrap = document.createElement('div');
      wrap.className = 'chart-wrap';

      const label = document.createElement('div');
      label.className = 'chart-label';
      label.innerHTML = `<span>${def.name}</span>${def.dataFields.map((f, i) =>
        `<span class="series-dot" style="color:${def.colors[i] || '#888'}">${f}</span>`
      ).join('')}`;

      const canvas = document.createElement('canvas');
      canvas.className = 'sensor-canvas';

      wrap.appendChild(label);
      wrap.appendChild(canvas);
      container.appendChild(wrap);

      this.charts[key] = new SensorChart(canvas, key, this.rings[key]);
    }

    const msg = document.getElementById('no-sensors-msg');
    if (msg) msg.style.display = activeSensors.length ? 'none' : 'block';
  }

  // ─── Render loop ──────────────────────────────────────────────────────────────
  _startRenderLoop() {
    const step = () => {
      this._renderFrameId = requestAnimationFrame(step);
      this._frameCount++;
      if (this._frameCount % 2 !== 0) return; // target ~30fps from 60fps rAF
      for (const chart of Object.values(this.charts)) {
        if (chart.visible) chart.draw();
      }
    };
    this._renderFrameId = requestAnimationFrame(step);
  }

  // ─── Sessions screen ──────────────────────────────────────────────────────────
  _loadSessions() {
    if (this.worker) {
      this.worker.postMessage({ type: 'listSessions' });
    }
  }

  _renderSessionsList(sessions) {
    const container = document.getElementById('sessions-list');
    const msg = document.getElementById('no-sessions-msg');
    if (!container) return;

    if (!sessions || sessions.length === 0) {
      container.innerHTML = '';
      if (msg) msg.style.display = 'block';
      return;
    }
    if (msg) msg.style.display = 'none';

    container.innerHTML = '';
    for (const s of sessions) {
      const item = document.createElement('div');
      item.className = `session-item status-${s.status}`;

      const date = s.startTime ? new Date(s.startTime) : null;
      const dateStr = date ? date.toLocaleDateString() + ' ' + date.toLocaleTimeString() : 'Unknown';
      const duration = s.durationMs ? this._formatDuration(Math.floor(s.durationMs / 1000)) : '—';
      const sensors = (s.sensors || []).join(', ') || '—';
      const statusLabel = { recording: '⚡ Recording', completed: '✓', interrupted: '⚠ Interrupted' }[s.status] || s.status;

      item.innerHTML = `
        <div class="session-meta">
          <span class="session-date">${dateStr}</span>
          <span class="session-status">${statusLabel}</span>
        </div>
        <div class="session-detail">${duration} · ${sensors}</div>
        <div class="session-actions">
          <button class="btn-sm btn-export" data-id="${s.id}">Export CSV</button>
          <button class="btn-sm btn-delete" data-id="${s.id}">Delete</button>
        </div>
      `;

      item.querySelector('.btn-export').addEventListener('click', () => this._requestExport(s.id));
      item.querySelector('.btn-delete').addEventListener('click', () => this._deleteSession(s.id, item));
      container.appendChild(item);
    }
  }

  _requestExport(sessionId) {
    if (this.worker) {
      this._showToast('Preparing export…');
      this.worker.postMessage({ type: 'readSession', sessionId });
    }
  }

  _exportSessionData(msg) {
    if (msg.error) {
      this._showToast(`Export error: ${msg.error}`);
      return;
    }
    const { header, meta, sensorData } = msg;
    const sensors = header.sensors || Object.keys(sensorData || {}).map(id => {
      return Object.keys(SENSOR_DEFS).find(k => SENSOR_DEFS[k].id === parseInt(id));
    }).filter(Boolean);

    // Build one CSV per sensor
    const files = [];
    for (const [sidStr, batches] of Object.entries(sensorData || {})) {
      const sid = parseInt(sidStr);
      const key = Object.keys(SENSOR_DEFS).find(k => SENSOR_DEFS[k].id === sid);
      if (!key) continue;
      const def = SENSOR_DEFS[key];
      const startISO = meta?.startTime ? new Date(meta.startTime).toISOString() : '—';
      const hz = (header.frequencies || meta?.frequencies || {})[key] || '?';

      // Count total samples
      const totalRows = batches.reduce((sum, b) => sum + b.length / (1 + def.dataFields.length), 0);

      const lines = [
        `# SensorLog Export - ${def.name}`,
        `# Session: ${startISO} | Frequency: ${hz}Hz | Samples: ${Math.floor(totalRows)}`,
        `timestamp_ms,${def.dataFields.join(',')}`
      ];
      // UTF-8 BOM for Excel
      const bom = '\uFEFF';

      for (const batch of batches) {
        const fields = 1 + def.dataFields.length;
        const rows = batch.length / fields;
        for (let i = 0; i < rows; i++) {
          const base = i * fields;
          const ts = Math.round(batch[base]);
          const vals = def.dataFields.map((_, f) => batch[base + 1 + f].toFixed(6));
          lines.push(`${ts},${vals.join(',')}`);
        }
      }

      files.push({ name: `sensorlog-${meta?.startTime || 'session'}-${key}.csv`, content: bom + lines.join('\n') });
    }

    if (files.length === 0) {
      this._showToast('No data to export.');
      return;
    }

    // Download each file
    for (const { name, content } of files) {
      const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    }
    this._showToast(`Exported ${files.length} CSV file(s).`);
  }

  _deleteSession(sessionId, itemEl) {
    if (!confirm('Delete this session? This cannot be undone.')) return;
    itemEl.style.opacity = '0.4';
    if (this.worker) {
      this.worker.postMessage({ type: 'deleteSession', sessionId });
    }
  }

  // ─── Toast notifications ──────────────────────────────────────────────────────
  _showToast(msg, ms = 3000) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('visible');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => t.classList.remove('visible'), ms);
  }
}

// ─── Boot ────────────────────────────────────────────────────────────────────
const app = new App();

// Register Service Worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW failed:', e));
  });
}

document.addEventListener('DOMContentLoaded', () => app.init());
