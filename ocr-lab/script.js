// ═══════════════════════════════════════════════════════
//  OCR Lab — Parameter Tuning Workbench
//  Vanilla JS • Canvas API • Tesseract.js v5
// ═══════════════════════════════════════════════════════

const PREVIEW_MAX = 1200;
const OCR_MAX = 2000;
const DEBOUNCE_MS = 150;

// ─── State ───

const state = {
  originalImg: null,   // HTMLImageElement
  originalBlob: null,
  showOriginal: false,
  debounceTimer: null,
  processing: false,
  ocrWorker: null,
  ocrReady: false,
  ocrLoadedLang: null,
  sampling: null,      // 'stain1' | 'stain2' | null
  stain1: null,        // [r, g, b]
  stain2: null,
};

// ─── DOM refs ───

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

document.addEventListener('DOMContentLoaded', () => {
  const canvas = $('#preview-canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  // Camera button — show only if mediaDevices available
  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    $('#camera-btn').style.display = '';
  }

  // ═══════════════════════════════════════════════════════
  //  IMAGE LOADING
  // ═══════════════════════════════════════════════════════

  $('#file-upload').addEventListener('change', (e) => {
    if (e.target.files[0]) loadFile(e.target.files[0]);
  });

  $('#camera-btn').addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.capture = 'environment';
    input.onchange = (e) => { if (e.target.files[0]) loadFile(e.target.files[0]); };
    input.click();
  });

  function loadFile(file) {
    $('#file-name').textContent = file.name;
    state.originalBlob = file;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      state.originalImg = img;
      enableControls();
      schedulePreview();
    };
    img.src = url;
  }

  function enableControls() {
    $('#pipeline-controls').disabled = false;
    $('#tess-config').disabled = false;
    $('#run-ocr').disabled = false;
    $('#preview-wrap').style.display = 'block';
    $('#empty-prompt').style.display = 'none';
    $('#actions').classList.remove('disabled-section');
  }

  // ═══════════════════════════════════════════════════════
  //  PREVIEW TOGGLE (tap to see original)
  // ═══════════════════════════════════════════════════════

  $('#preview-wrap').addEventListener('click', (e) => {
    // Don't toggle when sampling stains
    if (state.sampling) return;
    state.showOriginal = !state.showOriginal;
    if (state.showOriginal) {
      drawOriginal(canvas, ctx);
      $('#preview-hint').textContent = 'Showing original — tap to toggle';
    } else {
      schedulePreview();
      $('#preview-hint').textContent = 'Tap image to toggle original';
    }
  });

  function drawOriginal(cvs, context) {
    const img = state.originalImg;
    if (!img) return;
    const { w, h } = fitDimensions(img.naturalWidth, img.naturalHeight, PREVIEW_MAX);
    cvs.width = w; cvs.height = h;
    context.drawImage(img, 0, 0, w, h);
  }

  // ═══════════════════════════════════════════════════════
  //  STAIN SAMPLING
  // ═══════════════════════════════════════════════════════

  canvas.addEventListener('click', (e) => {
    if (!state.sampling) return;
    e.stopPropagation();
    const rect = canvas.getBoundingClientRect();
    const sx = (e.clientX - rect.left) / rect.width;
    const sy = (e.clientY - rect.top) / rect.height;

    // Sample from original image
    const img = state.originalImg;
    const tmpCvs = document.createElement('canvas');
    tmpCvs.width = img.naturalWidth;
    tmpCvs.height = img.naturalHeight;
    const tmpCtx = tmpCvs.getContext('2d');
    tmpCtx.drawImage(img, 0, 0);
    const px = Math.min(img.naturalWidth - 1, Math.max(0, Math.round(sx * img.naturalWidth)));
    const py = Math.min(img.naturalHeight - 1, Math.max(0, Math.round(sy * img.naturalHeight)));
    const pixel = tmpCtx.getImageData(px, py, 1, 1).data;
    const rgb = [pixel[0], pixel[1], pixel[2]];

    if (state.sampling === 'stain1') {
      state.stain1 = rgb;
      $('#stain1-swatch').style.background = `rgb(${rgb.join(',')})`;
    } else {
      state.stain2 = rgb;
      $('#stain2-swatch').style.background = `rgb(${rgb.join(',')})`;
    }

    // End sampling
    $$('.stain-btn').forEach(b => b.classList.remove('sampling'));
    state.sampling = null;
    canvas.style.cursor = 'pointer';
    schedulePreview();
  });

  $('#sample-stain1').addEventListener('click', (e) => {
    e.stopPropagation();
    startSampling('stain1');
  });
  $('#sample-stain2').addEventListener('click', (e) => {
    e.stopPropagation();
    startSampling('stain2');
  });
  $('#clear-stains').addEventListener('click', (e) => {
    e.stopPropagation();
    state.stain1 = null;
    state.stain2 = null;
    state.sampling = null;
    $$('.stain-btn').forEach(b => b.classList.remove('sampling'));
    canvas.style.cursor = 'pointer';
    $('#stain1-swatch').style.background = '';
    $('#stain2-swatch').style.background = '';
    schedulePreview();
  });

  function startSampling(which) {
    state.sampling = which;
    $$('.stain-btn').forEach(b => b.classList.remove('sampling'));
    $(`#sample-${which}`).classList.add('sampling');
    canvas.style.cursor = 'crosshair';
    // Show original so user can pick colors from the unprocessed image
    drawOriginal(canvas, ctx);
  }

  // ═══════════════════════════════════════════════════════
  //  AUTO-PREVIEW ON PARAMETER CHANGE
  // ═══════════════════════════════════════════════════════

  // Range value display
  $$('input[type="range"]').forEach(input => {
    const valSpan = $(`.range-val[data-for="${input.id}"]`);
    if (valSpan) {
      input.addEventListener('input', () => { valSpan.textContent = input.value; });
    }
  });

  // Binarize method — show/hide adaptive params
  $('#binarize-method').addEventListener('change', () => {
    const isAdaptive = $('#binarize-method').value === 'adaptiveGaussian';
    $('#adaptive-params').classList.toggle('hidden', !isAdaptive);
    schedulePreview();
  });

  // Listen for changes on all pipeline controls
  const pipelineEl = $('#pipeline-controls');
  pipelineEl.addEventListener('change', () => schedulePreview());
  pipelineEl.addEventListener('input', () => schedulePreview());

  function schedulePreview() {
    if (state.showOriginal) return;
    if (!state.originalImg) return;
    clearTimeout(state.debounceTimer);
    state.debounceTimer = setTimeout(() => runPreview(), DEBOUNCE_MS);
  }

  async function runPreview() {
    if (!state.originalImg) return;
    if (state.processing) {
      // Re-schedule so we pick up the latest params after current run
      schedulePreview();
      return;
    }
    state.processing = true;
    $('#processing-overlay').classList.remove('hidden');
    try {
      const config = readConfig();
      const result = runPipeline(state.originalImg, config.pipeline, PREVIEW_MAX);
      if (!state.showOriginal) {
        canvas.width = result.width;
        canvas.height = result.height;
        ctx.putImageData(result, 0, 0);
      }
    } catch (err) {
      console.error('Preview error:', err);
    }
    state.processing = false;
    $('#processing-overlay').classList.add('hidden');
  }

  // ═══════════════════════════════════════════════════════
  //  RUN OCR
  // ═══════════════════════════════════════════════════════

  $('#run-ocr').addEventListener('click', async () => {
    if (!state.originalImg) return;
    const btn = $('#run-ocr');
    btn.disabled = true;
    btn.textContent = 'Initializing OCR…';
    $('#results').classList.remove('hidden');
    $('#ocr-text').value = '';
    $('#confidence-badge').className = '';
    $('#confidence-badge').textContent = '';

    try {
      const config = readConfig();
      const lang = config.tesseract.lang;

      // Init worker if needed
      if (!state.ocrReady || state.ocrLoadedLang !== lang) {
        if (state.ocrWorker) {
          await state.ocrWorker.terminate();
          state.ocrWorker = null;
        }
        btn.textContent = `Loading ${lang} model…`;
        state.ocrWorker = await Tesseract.createWorker(lang);
        state.ocrReady = true;
        state.ocrLoadedLang = lang;
      }

      btn.textContent = 'Processing image…';
      const imageData = await runPipeline(state.originalImg, config.pipeline, OCR_MAX);

      // Convert ImageData to blob
      const tmpCanvas = document.createElement('canvas');
      tmpCanvas.width = imageData.width;
      tmpCanvas.height = imageData.height;
      tmpCanvas.getContext('2d').putImageData(imageData, 0, 0);
      const blob = await new Promise(r => tmpCanvas.toBlob(r, 'image/png'));

      btn.textContent = 'Running OCR…';
      const result = await state.ocrWorker.recognize(blob, {
        tessedit_pageseg_mode: config.tesseract.psm,
      });

      const text = result.data.text.trim();
      const words = result.data.words || [];
      const confidence = words.length > 0
        ? words.reduce((sum, w) => sum + w.confidence, 0) / words.length
        : 0;

      $('#ocr-text').value = text;
      const badge = $('#confidence-badge');
      badge.textContent = `${Math.round(confidence)}% confidence`;
      badge.className = confidence >= 80 ? 'good' : confidence >= 50 ? 'ok' : 'poor';
    } catch (err) {
      console.error('OCR error:', err);
      $('#ocr-text').value = `Error: ${err.message}`;
    }

    btn.disabled = false;
    btn.textContent = 'Run OCR';
  });

  // ═══════════════════════════════════════════════════════
  //  PROFILES
  // ═══════════════════════════════════════════════════════

  const PROFILES_KEY = 'ocr-lab-profiles';

  function loadProfiles() {
    try { return JSON.parse(localStorage.getItem(PROFILES_KEY)) || {}; }
    catch { return {}; }
  }

  function saveProfiles(profiles) {
    localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles));
  }

  function refreshProfileList() {
    const sel = $('#profile-list');
    const profiles = loadProfiles();
    sel.innerHTML = '<option value="">— select —</option>';
    for (const name of Object.keys(profiles).sort()) {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      sel.appendChild(opt);
    }
  }

  $('#profile-save').addEventListener('click', () => {
    const name = $('#profile-name').value.trim();
    if (!name) return;
    const profiles = loadProfiles();
    profiles[name] = readConfig();
    saveProfiles(profiles);
    refreshProfileList();
    $('#profile-list').value = name;
    $('#profile-name').value = '';
  });

  $('#profile-load').addEventListener('click', () => {
    const name = $('#profile-list').value;
    if (!name) return;
    const profiles = loadProfiles();
    if (profiles[name]) {
      applyConfig(profiles[name]);
      schedulePreview();
    }
  });

  $('#profile-delete').addEventListener('click', () => {
    const name = $('#profile-list').value;
    if (!name) return;
    const profiles = loadProfiles();
    delete profiles[name];
    saveProfiles(profiles);
    refreshProfileList();
  });

  refreshProfileList();

  // ═══════════════════════════════════════════════════════
  //  EXPORT
  // ═══════════════════════════════════════════════════════

  $('#export-btn').addEventListener('click', () => {
    const config = readConfig();
    const json = JSON.stringify({ ocrLab: { version: 1, ...config } }, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ocr-lab-config.json';
    a.click();
    URL.revokeObjectURL(url);
  });

  // ═══════════════════════════════════════════════════════
  //  CONFIG READ / APPLY
  // ═══════════════════════════════════════════════════════

  function isEnabled(step) {
    const cb = $(`input[data-step="${step}"]`);
    return cb ? cb.checked : false;
  }

  function readConfig() {
    return {
      pipeline: {
        scale:      { enabled: isEnabled('scale'),      factor: parseFloat($('#scale-factor').value) },
        shadow:     { enabled: isEnabled('shadow'),     kernelSize: parseInt($('#shadow-kernel').value) },
        denoise:    { enabled: isEnabled('denoise'),    kernelSize: parseInt($('#denoise-kernel').value) },
        channels:   { enabled: isEnabled('channels'),   chR: $('#ch-r').checked, chG: $('#ch-g').checked, chB: $('#ch-b').checked },
        deconv:     { enabled: isEnabled('deconv'),     stain1: state.stain1, stain2: state.stain2 },
        autoLevels: { enabled: isEnabled('autoLevels') },
        brightness: { enabled: isEnabled('brightness'), value: parseInt($('#brightness-val').value) },
        contrast:   { enabled: isEnabled('brightness'), value: parseInt($('#contrast-val').value) },
        sharpen:    { enabled: isEnabled('sharpen'),    strength: parseFloat($('#sharpen-strength').value) },
        binarize:   { enabled: isEnabled('binarize'),   method: $('#binarize-method').value, blockSize: parseInt($('#binarize-block').value), C: parseInt($('#binarize-c').value) },
        morphology: { enabled: isEnabled('morphology'), operation: $('#morph-op').value, kernelSize: parseInt($('#morph-kernel').value) },
        invert:     { enabled: isEnabled('invert') },
        padding:    { enabled: isEnabled('padding'),    size: parseInt($('#padding-size').value) },
      },
      tesseract: {
        psm:  $('#psm-mode').value,
        lang: $('#ocr-lang').value,
      },
    };
  }

  function applyConfig(config) {
    const p = config.pipeline;
    function setEnabled(step, val) {
      const cb = $(`input[data-step="${step}"]`);
      if (cb) cb.checked = val;
    }
    function setVal(id, val) {
      const el = $(`#${id}`);
      if (el) {
        el.value = val;
        // Update range display
        const span = $(`.range-val[data-for="${id}"]`);
        if (span) span.textContent = val;
      }
    }

    setEnabled('scale', p.scale.enabled);
    setVal('scale-factor', p.scale.factor);
    setEnabled('shadow', p.shadow.enabled);
    setVal('shadow-kernel', p.shadow.kernelSize);
    setEnabled('denoise', p.denoise.enabled);
    setVal('denoise-kernel', p.denoise.kernelSize);
    setEnabled('channels', p.channels.enabled);
    $('#ch-r').checked = p.channels.chR;
    $('#ch-g').checked = p.channels.chG;
    $('#ch-b').checked = p.channels.chB;
    setEnabled('deconv', p.deconv.enabled);
    state.stain1 = p.deconv.stain1;
    state.stain2 = p.deconv.stain2;
    if (state.stain1) $('#stain1-swatch').style.background = `rgb(${state.stain1.join(',')})`;
    else $('#stain1-swatch').style.background = '';
    if (state.stain2) $('#stain2-swatch').style.background = `rgb(${state.stain2.join(',')})`;
    else $('#stain2-swatch').style.background = '';
    setEnabled('autoLevels', p.autoLevels.enabled);
    setEnabled('brightness', p.brightness.enabled);
    setVal('brightness-val', p.brightness.value);
    setVal('contrast-val', p.contrast.value);
    setEnabled('sharpen', p.sharpen.enabled);
    setVal('sharpen-strength', p.sharpen.strength);
    setEnabled('binarize', p.binarize.enabled);
    setVal('binarize-method', p.binarize.method);
    setVal('binarize-block', p.binarize.blockSize);
    setVal('binarize-c', p.binarize.C);
    $('#adaptive-params').classList.toggle('hidden', p.binarize.method !== 'adaptiveGaussian');
    setEnabled('morphology', p.morphology.enabled);
    setVal('morph-op', p.morphology.operation);
    setVal('morph-kernel', p.morphology.kernelSize);
    setEnabled('invert', p.invert.enabled);
    setEnabled('padding', p.padding.enabled);
    setVal('padding-size', p.padding.size);

    const t = config.tesseract;
    setVal('psm-mode', t.psm);
    setVal('ocr-lang', t.lang);
  }

}); // end DOMContentLoaded


// ═══════════════════════════════════════════════════════
//  PREPROCESSING PIPELINE
// ═══════════════════════════════════════════════════════

function fitDimensions(w, h, maxDim) {
  if (w <= maxDim && h <= maxDim) return { w, h };
  const scale = maxDim / Math.max(w, h);
  return { w: Math.round(w * scale), h: Math.round(h * scale) };
}

function runPipeline(img, pipeline, maxDim) {
  // Draw source image scaled
  const factor = pipeline.scale.enabled ? pipeline.scale.factor : 1;
  let srcW = Math.round(img.naturalWidth * factor);
  let srcH = Math.round(img.naturalHeight * factor);

  // Cap dimensions
  const { w, h } = fitDimensions(srcW, srcH, maxDim);
  srcW = w; srcH = h;

  const cvs = document.createElement('canvas');
  cvs.width = srcW; cvs.height = srcH;
  const ctx = cvs.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, srcW, srcH);

  let imageData = ctx.getImageData(0, 0, srcW, srcH);

  // 2. Shadow removal
  if (pipeline.shadow.enabled) {
    imageData = shadowRemoval(imageData, pipeline.shadow.kernelSize);
  }

  // 3. Denoise (median blur)
  if (pipeline.denoise.enabled) {
    imageData = medianBlur(imageData, pipeline.denoise.kernelSize);
  }

  // 4. Channel selection
  if (pipeline.channels.enabled) {
    applyChannelSelection(imageData, pipeline.channels.chR, pipeline.channels.chG, pipeline.channels.chB);
  }

  // 5. Color deconvolution
  if (pipeline.deconv.enabled && pipeline.deconv.stain1) {
    imageData = applyDeconvolution(imageData, pipeline.deconv.stain1, pipeline.deconv.stain2);
  }

  // 6. Auto-levels
  if (pipeline.autoLevels.enabled) {
    imageData = applyAutoLevels(imageData);
  }

  // 7. Brightness / Contrast
  if (pipeline.brightness.enabled || pipeline.contrast?.enabled) {
    const bVal = pipeline.brightness.enabled ? pipeline.brightness.value : 0;
    const cVal = pipeline.contrast?.enabled !== false ? pipeline.contrast.value : 0;
    if (bVal !== 0 || cVal !== 0) {
      applyBrightnessContrast(imageData, bVal, cVal);
    }
  }

  // 8. Sharpen
  if (pipeline.sharpen.enabled) {
    imageData = applyUnsharpMask(imageData, pipeline.sharpen.strength);
  }

  // 9. Binarize
  if (pipeline.binarize.enabled && pipeline.binarize.method !== 'none') {
    imageData = applyBinarize(imageData, pipeline.binarize.method, pipeline.binarize.blockSize, pipeline.binarize.C);
  }

  // 10. Morphology
  if (pipeline.morphology.enabled) {
    imageData = applyMorphology(imageData, pipeline.morphology.operation, pipeline.morphology.kernelSize);
  }

  // 11. Invert
  if (pipeline.invert.enabled) {
    applyInvert(imageData);
  }

  // 12. Border padding
  if (pipeline.padding.enabled && pipeline.padding.size > 0) {
    imageData = applyPadding(imageData, pipeline.padding.size);
  }

  return imageData;
}


// ─── Shadow Removal ───
// Separable max-filter (dilation), median blur for background, then normalize

function shadowRemoval(imageData, kernelSize) {
  const { width: w, height: h, data } = imageData;
  const len = w * h;
  const gray = toGrayscale(data, len);

  const half = (kernelSize - 1) >> 1;

  // Separable max-filter: row pass
  const rowMax = new Uint8Array(len);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let mx = 0;
      const x0 = Math.max(0, x - half);
      const x1 = Math.min(w - 1, x + half);
      for (let xx = x0; xx <= x1; xx++) {
        const v = gray[row + xx];
        if (v > mx) mx = v;
      }
      rowMax[row + x] = mx;
    }
  }

  // Column pass
  const dilated = new Uint8Array(len);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let mx = 0;
      const y0 = Math.max(0, y - half);
      const y1 = Math.min(h - 1, y + half);
      for (let yy = y0; yy <= y1; yy++) {
        const v = rowMax[yy * w + x];
        if (v > mx) mx = v;
      }
      dilated[y * w + x] = mx;
    }
  }

  // Median blur the dilated result for a smoother background estimate
  const bgEst = medianBlurGray(dilated, w, h, Math.max(3, kernelSize >> 1 | 1));

  // Normalize: result = 255 - abs(pixel - background), mapped to [0,255]
  const out = new ImageData(w, h);
  const od = out.data;
  for (let i = 0; i < len; i++) {
    const bg = Math.max(bgEst[i], 1);
    const v = Math.max(0, Math.min(255, Math.round((gray[i] / bg) * 255)));
    const j = i * 4;
    od[j] = od[j + 1] = od[j + 2] = v;
    od[j + 3] = 255;
  }
  return out;
}

function toGrayscale(data, len) {
  const gray = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    const j = i * 4;
    gray[i] = Math.round(0.299 * data[j] + 0.587 * data[j + 1] + 0.114 * data[j + 2]);
  }
  return gray;
}

// ─── Median Blur (on ImageData) ───

function medianBlur(imageData, kernelSize) {
  const { width: w, height: h, data } = imageData;
  const len = w * h;
  // Work on each channel separately
  const out = new ImageData(w, h);
  const od = out.data;
  const half = (kernelSize - 1) >> 1;

  for (let ch = 0; ch < 3; ch++) {
    const src = new Uint8Array(len);
    for (let i = 0; i < len; i++) src[i] = data[i * 4 + ch];
    const dst = medianBlurGray(src, w, h, kernelSize);
    for (let i = 0; i < len; i++) od[i * 4 + ch] = dst[i];
  }
  for (let i = 0; i < len; i++) od[i * 4 + 3] = 255;
  return out;
}

function medianBlurGray(gray, w, h, kernelSize) {
  const half = (kernelSize - 1) >> 1;
  const out = new Uint8Array(w * h);
  const buf = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      buf.length = 0;
      const y0 = Math.max(0, y - half);
      const y1 = Math.min(h - 1, y + half);
      const x0 = Math.max(0, x - half);
      const x1 = Math.min(w - 1, x + half);
      for (let yy = y0; yy <= y1; yy++) {
        for (let xx = x0; xx <= x1; xx++) {
          buf.push(gray[yy * w + xx]);
        }
      }
      buf.sort((a, b) => a - b);
      out[y * w + x] = buf[buf.length >> 1];
    }
  }
  return out;
}

// ─── Channel Selection ───

function applyChannelSelection(imageData, chR, chG, chB) {
  const d = imageData.data;
  for (let i = 0; i < d.length; i += 4) {
    if (!chR) d[i] = 0;
    if (!chG) d[i + 1] = 0;
    if (!chB) d[i + 2] = 0;
  }
}

// ─── Color Deconvolution (Beer-Lambert) — ported from marginalia ───

function rgbToOD(r, g, b) {
  return [
    -Math.log(Math.max(r, 1) / 255) / Math.LN10,
    -Math.log(Math.max(g, 1) / 255) / Math.LN10,
    -Math.log(Math.max(b, 1) / 255) / Math.LN10,
  ];
}

function normalizeVec(v) {
  const len = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
  return len > 1e-6 ? [v[0] / len, v[1] / len, v[2] / len] : [1, 0, 0];
}

function crossProduct(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function invert3x3(m) {
  const [a, b, c] = m;
  const det = a[0] * (b[1] * c[2] - b[2] * c[1])
            - a[1] * (b[0] * c[2] - b[2] * c[0])
            + a[2] * (b[0] * c[1] - b[1] * c[0]);
  if (Math.abs(det) < 1e-10) return null;
  const d = 1 / det;
  return [
    [(b[1]*c[2] - b[2]*c[1])*d, (a[2]*c[1] - a[1]*c[2])*d, (a[1]*b[2] - a[2]*b[1])*d],
    [(b[2]*c[0] - b[0]*c[2])*d, (a[0]*c[2] - a[2]*c[0])*d, (a[2]*b[0] - a[0]*b[2])*d],
    [(b[0]*c[1] - b[1]*c[0])*d, (a[1]*c[0] - a[0]*c[1])*d, (a[0]*b[1] - a[1]*b[0])*d],
  ];
}

function buildDeconvParams(stain1, stain2) {
  const od1 = normalizeVec(rgbToOD(stain1[0], stain1[1], stain1[2]));
  if (stain2) {
    const od2 = normalizeVec(rgbToOD(stain2[0], stain2[1], stain2[2]));
    const od3 = normalizeVec(crossProduct(od1, od2));
    const inv = invert3x3([od1, od2, od3]);
    return inv ? { mode: 2, inv } : null;
  }
  return { mode: 1, vec: od1 };
}

function applyDeconvolution(imageData, stain1, stain2) {
  const dp = buildDeconvParams(stain1, stain2);
  if (!dp) return imageData;
  const d = imageData.data;
  const len = d.length;

  for (let i = 0; i < len; i += 4) {
    let val;
    if (dp.mode === 2) {
      const od = rgbToOD(d[i], d[i + 1], d[i + 2]);
      const c = dp.inv[2][0] * od[0] + dp.inv[2][1] * od[1] + dp.inv[2][2] * od[2];
      val = Math.max(0, Math.min(255, 255 * Math.pow(10, -Math.max(0, c))));
    } else {
      const od = rgbToOD(d[i], d[i + 1], d[i + 2]);
      const dot = od[0] * dp.vec[0] + od[1] * dp.vec[1] + od[2] * dp.vec[2];
      const rx = od[0] - dot * dp.vec[0];
      const ry = od[1] - dot * dp.vec[1];
      const rz = od[2] - dot * dp.vec[2];
      const mag = Math.sqrt(rx * rx + ry * ry + rz * rz);
      val = Math.max(0, Math.min(255, 255 * Math.pow(10, -mag)));
    }
    d[i] = d[i + 1] = d[i + 2] = val;
  }
  return imageData;
}

// ─── Auto-Levels (2nd/98th percentile remap) — ported from marginalia ───

function applyAutoLevels(imageData) {
  const { width: w, height: h, data } = imageData;
  const len = w * h;
  const gray = toGrayscale(data, len);

  const hist = new Uint32Array(256);
  for (let i = 0; i < len; i++) hist[gray[i]]++;

  const loTarget = len * 0.02;
  const hiTarget = len * 0.98;
  let lo = 0, hi = 255, cumul = 0;
  for (let v = 0; v < 256; v++) {
    cumul += hist[v];
    if (cumul >= loTarget) { lo = v; break; }
  }
  cumul = 0;
  for (let v = 0; v < 256; v++) {
    cumul += hist[v];
    if (cumul >= hiTarget) { hi = v; break; }
  }
  const range = hi - lo || 1;

  // Build LUT
  const lut = new Uint8Array(256);
  for (let v = 0; v < 256; v++) {
    lut[v] = Math.max(0, Math.min(255, Math.round((v - lo) * 255 / range)));
  }

  for (let i = 0; i < len; i++) {
    const j = i * 4;
    data[j] = lut[data[j]];
    data[j + 1] = lut[data[j + 1]];
    data[j + 2] = lut[data[j + 2]];
  }
  return imageData;
}

// ─── Brightness / Contrast ───

function applyBrightnessContrast(imageData, brightness, contrast) {
  const cf = (259 * (contrast + 255)) / (255 * (259 - contrast));
  const d = imageData.data;
  for (let i = 0; i < d.length; i += 4) {
    for (let ch = 0; ch < 3; ch++) {
      let v = d[i + ch] + brightness;
      v = cf * (v - 128) + 128;
      d[i + ch] = Math.max(0, Math.min(255, Math.round(v)));
    }
  }
}

// ─── Unsharp Mask ─── ported from marginalia, with configurable strength

function applyUnsharpMask(imageData, strength) {
  const { width: w, height: h, data } = imageData;
  const len = w * h;
  const gray = toGrayscale(data, len);

  // 3x3 box blur
  const blurred = new Uint8Array(len);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0, cnt = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const ny = y + dy, nx = x + dx;
          if (ny >= 0 && ny < h && nx >= 0 && nx < w) {
            sum += gray[ny * w + nx]; cnt++;
          }
        }
      }
      blurred[y * w + x] = Math.round(sum / cnt);
    }
  }

  const out = new ImageData(w, h);
  const od = out.data;
  for (let i = 0; i < len; i++) {
    const v = Math.max(0, Math.min(255, Math.round(gray[i] + strength * (gray[i] - blurred[i]))));
    const j = i * 4;
    od[j] = od[j + 1] = od[j + 2] = v;
    od[j + 3] = 255;
  }
  return out;
}

// ─── Binarize ───

function applyBinarize(imageData, method, blockSize, C) {
  const { width: w, height: h, data } = imageData;
  const len = w * h;
  const gray = toGrayscale(data, len);

  const out = new ImageData(w, h);
  const od = out.data;

  if (method === 'otsu') {
    const threshold = otsuThreshold(gray, len);
    for (let i = 0; i < len; i++) {
      const v = gray[i] > threshold ? 255 : 0;
      const j = i * 4;
      od[j] = od[j + 1] = od[j + 2] = v;
      od[j + 3] = 255;
    }
  } else if (method === 'adaptiveGaussian') {
    // Separable Gaussian blur for local mean
    const sigma = blockSize / 6;
    const blurred = separableGaussianBlur(gray, w, h, blockSize, sigma);

    for (let i = 0; i < len; i++) {
      const v = gray[i] > (blurred[i] - C) ? 255 : 0;
      const j = i * 4;
      od[j] = od[j + 1] = od[j + 2] = v;
      od[j + 3] = 255;
    }
  }

  return out;
}

function otsuThreshold(gray, len) {
  const hist = new Uint32Array(256);
  for (let i = 0; i < len; i++) hist[gray[i]]++;
  let sumAll = 0;
  for (let i = 0; i < 256; i++) sumAll += i * hist[i];
  let sumBg = 0, wBg = 0;
  let bestVariance = 0, threshold = 128;
  for (let t = 0; t < 256; t++) {
    wBg += hist[t];
    if (wBg === 0) continue;
    const wFg = len - wBg;
    if (wFg === 0) break;
    sumBg += t * hist[t];
    const diff = sumBg / wBg - (sumAll - sumBg) / wFg;
    const variance = wBg * wFg * diff * diff;
    if (variance > bestVariance) {
      bestVariance = variance;
      threshold = t;
    }
  }
  return threshold;
}

function separableGaussianBlur(gray, w, h, blockSize, sigma) {
  const half = (blockSize - 1) >> 1;
  // Build 1D kernel
  const kernel = new Float32Array(blockSize);
  let ksum = 0;
  for (let i = 0; i < blockSize; i++) {
    const x = i - half;
    kernel[i] = Math.exp(-(x * x) / (2 * sigma * sigma));
    ksum += kernel[i];
  }
  for (let i = 0; i < blockSize; i++) kernel[i] /= ksum;

  const len = w * h;
  // Horizontal pass
  const tmp = new Float32Array(len);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let k = 0; k < blockSize; k++) {
        const xx = Math.min(w - 1, Math.max(0, x + k - half));
        sum += gray[row + xx] * kernel[k];
      }
      tmp[row + x] = sum;
    }
  }

  // Vertical pass
  const out = new Float32Array(len);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let sum = 0;
      for (let k = 0; k < blockSize; k++) {
        const yy = Math.min(h - 1, Math.max(0, y + k - half));
        sum += tmp[yy * w + x] * kernel[k];
      }
      out[y * w + x] = sum;
    }
  }
  return out;
}

// ─── Morphology ───

function applyMorphology(imageData, operation, kernelSize) {
  const { width: w, height: h, data } = imageData;
  const len = w * h;
  const gray = toGrayscale(data, len);
  const half = (kernelSize - 1) >> 1;

  let result;
  if (operation === 'opening') {
    // Erode then dilate
    result = dilateGray(erodeGray(gray, w, h, half), w, h, half);
  } else {
    // Closing: dilate then erode
    result = erodeGray(dilateGray(gray, w, h, half), w, h, half);
  }

  const out = new ImageData(w, h);
  const od = out.data;
  for (let i = 0; i < len; i++) {
    const j = i * 4;
    od[j] = od[j + 1] = od[j + 2] = result[i];
    od[j + 3] = 255;
  }
  return out;
}

function erodeGray(gray, w, h, half) {
  const len = w * h;
  const out = new Uint8Array(len);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let mn = 255;
      for (let dy = -half; dy <= half; dy++) {
        for (let dx = -half; dx <= half; dx++) {
          const ny = y + dy, nx = x + dx;
          if (ny >= 0 && ny < h && nx >= 0 && nx < w) {
            const v = gray[ny * w + nx];
            if (v < mn) mn = v;
          }
        }
      }
      out[y * w + x] = mn;
    }
  }
  return out;
}

function dilateGray(gray, w, h, half) {
  const len = w * h;
  const out = new Uint8Array(len);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let mx = 0;
      for (let dy = -half; dy <= half; dy++) {
        for (let dx = -half; dx <= half; dx++) {
          const ny = y + dy, nx = x + dx;
          if (ny >= 0 && ny < h && nx >= 0 && nx < w) {
            const v = gray[ny * w + nx];
            if (v > mx) mx = v;
          }
        }
      }
      out[y * w + x] = mx;
    }
  }
  return out;
}

// ─── Invert ───

function applyInvert(imageData) {
  const d = imageData.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = 255 - d[i];
    d[i + 1] = 255 - d[i + 1];
    d[i + 2] = 255 - d[i + 2];
  }
}

// ─── Border Padding ───

function applyPadding(imageData, size) {
  const { width: w, height: h, data } = imageData;
  const nw = w + size * 2;
  const nh = h + size * 2;
  const out = new ImageData(nw, nh);
  const od = out.data;
  // Fill white
  od.fill(255);
  // Copy original into center
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const si = (y * w + x) * 4;
      const di = ((y + size) * nw + (x + size)) * 4;
      od[di] = data[si];
      od[di + 1] = data[si + 1];
      od[di + 2] = data[si + 2];
      od[di + 3] = data[si + 3];
    }
  }
  return out;
}
