'use strict';
(() => {
const $ = (id) => document.getElementById(id);
const STORAGE_KEY = 'phomemomuma-draft-v1';
const WIDTH = 384;
const MAX_HEIGHT = 7000;
const SERVICE = '0000ff00-0000-1000-8000-00805f9b34fb';
const CHARACTERISTIC = '0000ff02-0000-1000-8000-00805f9b34fb';
const defaults = { text: 'Hello from PhomemoMuma!', size: '24', font: 'sans', align: 'left', bold: true, margin: '16', density: '4', footer: true, image: null, imagePlace: 'above', imageWidth: '100', imageMode: 'dither', imageContrast: '0' };
let state = { ...defaults }, image = null, device = null, writer = null, busy = false, saveTimer = null;
const canvas = $('preview');
const log = (message) => { $('log').textContent += '\n' + message; };
const message = (value) => { $('message').textContent = value; };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function readState() {
  try {
    const json = localStorage.getItem(STORAGE_KEY);
    if (json) {
      const stored = JSON.parse(json);
      if (stored && typeof stored === 'object') state = { ...defaults, ...stored };
    }
  } catch (error) { log('Draft storage unavailable: ' + error.message); }
}
function syncForm() {
  $('receipt-text').value = state.text;
  $('font-size').value = state.size;
  $('font-family').value = state.font;
  $('align').value = state.align;
  $('bold').checked = state.bold;
  $('margin').value = state.margin;
  $('density').value = state.density;
  $('footer-line').checked = state.footer;
  $('image-place').value = state.imagePlace;
  $('image-width').value = state.imageWidth;
  $('image-mode').value = state.imageMode;
  $('image-contrast').value = state.imageContrast;
  $('contrast-output').textContent = state.imageContrast;
  $('image-controls').hidden = !state.image;
  $('image-name').textContent = state.image ? 'Image added to receipt.' : 'No image selected. Photos are processed on your phone.';
  $('image-remove').disabled = !state.image;
}
function syncState() {
  state.text = $('receipt-text').value;
  state.size = $('font-size').value;
  state.font = $('font-family').value;
  state.align = $('align').value;
  state.bold = $('bold').checked;
  state.margin = $('margin').value;
  state.density = $('density').value;
  state.footer = $('footer-line').checked;
  state.imagePlace = $('image-place').value;
  state.imageWidth = $('image-width').value;
  state.imageMode = $('image-mode').value;
  state.imageContrast = $('image-contrast').value;
  $('contrast-output').textContent = state.imageContrast;
}
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      message('Draft saved automatically on this device.');
    } catch (error) {
      message('Draft works, but device storage is full or unavailable. Save a receipt image to keep a copy.');
      log('Save error: ' + error.message);
    }
  }, 350);
}
function fontFor(ctx) {
  const families = { sans: 'Arial, sans-serif', serif: 'Georgia, serif', mono: 'monospace' };
  ctx.font = (state.bold ? 'bold ' : '') + Number(state.size) + 'px ' + (families[state.font] || families.sans);
}
// Separate word wrapper that preserves ordinary spaces and uses character breaks only when needed.
function layoutLines(ctx, text, maxWidth) {
  const result = [];
  for (const paragraph of String(text).split(/\r?\n/)) {
    if (!paragraph.trim()) { result.push(''); continue; }
    let line = '';
    for (const word of paragraph.trim().split(/\s+/)) {
      const next = line ? line + ' ' + word : word;
      if (ctx.measureText(next).width <= maxWidth) { line = next; continue; }
      if (line) { result.push(line); line = ''; }
      for (const char of word) {
        if (line && ctx.measureText(line + char).width > maxWidth) {
          result.push(line); line = char;
        } else { line += char; }
      }
    }
    result.push(line);
  }
  return result;
}
function convertImage(source, targetWidth, targetHeight) {
  const tmp = document.createElement('canvas');
  tmp.width = targetWidth; tmp.height = targetHeight;
  const ctx = tmp.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = 'white'; ctx.fillRect(0, 0, targetWidth, targetHeight);
  ctx.drawImage(source, 0, 0, targetWidth, targetHeight);
  const data = ctx.getImageData(0, 0, targetWidth, targetHeight);
  const raw = data.data;
  const lum = new Float32Array(targetWidth * targetHeight);
  const contrast = 1 + (Number(state.imageContrast) / 100);
  for (let i = 0; i < lum.length; i++) {
    const at = i * 4, alpha = raw[at + 3] / 255;
    const grey = (raw[at] * .299 + raw[at + 1] * .587 + raw[at + 2] * .114) * alpha + 255 * (1 - alpha);
    lum[i] = Math.max(0, Math.min(255, (grey - 128) * contrast + 128));
  }
  const dither = state.imageMode === 'dither';
  for (let y = 0; y < targetHeight; y++) {
    for (let x = 0; x < targetWidth; x++) {
      const i = y * targetWidth + x;
      const old = lum[i];
      const value = old < 128 ? 0 : 255;
      if (dither) {
        const err = old - value;
        if (x + 1 < targetWidth) lum[i + 1] += err * 7 / 16;
        if (y + 1 < targetHeight) {
          if (x > 0) lum[i + targetWidth - 1] += err * 3 / 16;
          lum[i + targetWidth] += err * 5 / 16;
          if (x + 1 < targetWidth) lum[i + targetWidth + 1] += err / 16;
        }
      }
      raw[i * 4] = raw[i * 4 + 1] = raw[i * 4 + 2] = value;
      raw[i * 4 + 3] = 255;
    }
  }
  ctx.putImageData(data, 0, 0);
  return tmp;
}
function renderReceipt() {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  fontFor(ctx);
  const margin = Number(state.margin);
  const maxTextWidth = WIDTH - margin * 2;
  const lines = state.text ? layoutLines(ctx, state.text, maxTextWidth) : [];
  const step = Math.ceil(Number(state.size) * 1.35);
  const textHeight = lines.length ? lines.length * step + 14 : 0;
  let picture = null, pictureHeight = 0;
  if (state.image && image) {
    const w = Math.round(maxTextWidth * Number(state.imageWidth) / 100);
    pictureHeight = Math.max(1, Math.round(w * image.naturalHeight / image.naturalWidth));
    picture = { width: w, height: pictureHeight };
  }
  const gap = picture && lines.length ? 14 : 0;
  const contentHeight = textHeight + pictureHeight + gap;
  const height = Math.max(72, 18 + contentHeight + (state.footer ? 30 : 14));
  if (height > MAX_HEIGHT) throw new Error('Receipt exceeds 7000 dots. Shorten the text or image.');
  canvas.width = WIDTH; canvas.height = height;
  const paint = canvas.getContext('2d', { willReadFrequently: true });
  paint.fillStyle = '#fff'; paint.fillRect(0, 0, WIDTH, height);
  paint.fillStyle = '#000';
  let y = 18;
  const drawPicture = () => {
    if (!picture) return;
    const monochrome = convertImage(image, picture.width, picture.height);
    paint.drawImage(monochrome, Math.round((WIDTH - picture.width) / 2), y);
    y += picture.height;
  };
  const drawText = () => {
    if (!lines.length) return;
    fontFor(paint); paint.textBaseline = 'top';
    for (const line of lines) {
      let x = margin;
      if (state.align === 'center') x = WIDTH / 2;
      if (state.align === 'right') x = WIDTH - margin;
      paint.textAlign = state.align;
      paint.fillText(line, x, y);
      y += step;
    }
    y += 14;
  };
  if (state.imagePlace === 'above') { drawPicture(); if (picture && lines.length) y += gap; drawText(); }
  else { drawText(); if (picture && lines.length) y += gap; drawPicture(); }
  if (state.footer) paint.fillRect(margin, height - 17, WIDTH - margin * 2, 2);
  // Render in the same one-bit black/white palette sent over Bluetooth.
  const pixels = paint.getImageData(0, 0, WIDTH, height);
  for (let i = 0; i < pixels.data.length; i += 4) {
    const v = pixels.data[i] < 128 ? 0 : 255;
    pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = v;
    pixels.data[i + 3] = 255;
  }
  paint.putImageData(pixels, 0, 0);
  $('dimensions').textContent = WIDTH + ' × ' + height + ' dots';
}
function updatePreview() {
  syncState();
  try { renderReceipt(); scheduleSave(); }
  catch (error) { message(error.message); log('Preview: ' + error.message); }
}
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const candidate = new Image();
    candidate.onload = () => { image = candidate; $('image-name').textContent = 'Image ready (' + candidate.naturalWidth + ' × ' + candidate.naturalHeight + ' original dots)'; renderReceipt(); resolve(); };
    candidate.onerror = () => reject(new Error('This image could not be decoded by Bluefy.'));
    candidate.src = src;
  });
}
async function importImage(file) {
  if (!file) return;
  try {
    const objectUrl = URL.createObjectURL(file);
    const candidate = new Image();
    try {
      await new Promise((resolve, reject) => {
        candidate.onload = resolve;
        candidate.onerror = () => reject(new Error('Unsupported image format'));
        candidate.src = objectUrl;
      });
    } finally { URL.revokeObjectURL(objectUrl); }
    // Normalize large phone images to a compact, locally stored source.
    const factor = Math.min(1, 768 / candidate.naturalWidth, 4500 / candidate.naturalHeight);
    const w = Math.max(1, Math.round(candidate.naturalWidth * factor));
    const h = Math.max(1, Math.round(candidate.naturalHeight * factor));
    const work = document.createElement('canvas');
    work.width = w; work.height = h;
    const c = work.getContext('2d');
    c.fillStyle = 'white'; c.fillRect(0, 0, w, h);
    c.drawImage(candidate, 0, 0, w, h);
    const dataUrl = work.toDataURL('image/jpeg', .84);
    state.image = dataUrl;
    $('image-controls').hidden = false; $('image-remove').disabled = false;
    await loadImage(dataUrl);
    updatePreview();
    message('Image added. Processing stays on this iPhone.');
  } catch (error) { message('Image import failed: ' + error.message); log('Image import: ' + error.message); }
}
function rasterBytes() {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const height = canvas.height, pixels = ctx.getImageData(0, 0, WIDTH, height).data;
  const bytes = new Uint8Array(48 * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < WIDTH; x++) {
    if (pixels[(y * WIDTH + x) * 4] === 0) bytes[y * 48 + (x >> 3)] |= 128 >> (x & 7);
  }
  return bytes;
}
function connected() { return Boolean(device && device.gatt && device.gatt.connected && writer); }
function updateConnection() {
  const ready = connected();
  $('connection-status').textContent = ready ? 'Connected to ' + device.name : 'Disconnected';
  $('print').disabled = !ready || busy;
  $('print').textContent = busy ? 'Printing…' : ready ? 'Print receipt' : 'Connect printer to print';
  $('connect').disabled = busy;
}
async function connect() {
  try {
    if (!navigator.bluetooth) throw new Error('Web Bluetooth is unavailable. Open in Bluefy.');
    device = await navigator.bluetooth.requestDevice({ filters: [{ namePrefix: 'Mr.in_' }, { namePrefix: 'M02' }, { namePrefix: 'Phomemo' }], optionalServices: [SERVICE] });
    const server = await device.gatt.connect();
    const service = await server.getPrimaryService(SERVICE);
    writer = await service.getCharacteristic(CHARACTERISTIC);
    device.addEventListener('gattserverdisconnected', () => { writer = null; updateConnection(); log('Disconnected'); });
    log('Connected to ' + device.name + ' / FF00 / FF02');
    message('Printer connected. Ready to print.');
  } catch (error) { writer = null; log('Connection failed: ' + (error.message || error)); message('Connection failed: ' + (error.message || error)); }
  updateConnection();
}
async function printReceipt() {
  if (!connected() || busy) return;
  busy = true; updateConnection();
  const progress = $('print-progress'); progress.hidden = false; progress.value = 0;
  try {
    renderReceipt();
    const height = canvas.height;
    const raster = rasterBytes();
    let sent = 0;
    const expected = raster.length + 9 + Math.ceil(height / 240) * 8 + 17;
    const send = async (bytes) => {
      for (let offset = 0; offset < bytes.length; offset += 20) {
        if (!connected()) throw new Error('Printer disconnected during transmission');
        const part = bytes.slice(offset, offset + 20);
        if (writer.writeValueWithoutResponse) await writer.writeValueWithoutResponse(part);
        else await writer.writeValue(part);
        sent += part.length;
        progress.value = Math.min(99, Math.floor(sent / expected * 100));
        await sleep(35);
      }
    };
    const density = Number(state.density);
    log('Printing ' + WIDTH + ' × ' + height + ' dots at density ' + density);
    await send(new Uint8Array([0x1b, 0x40, 0x1b, 0x61, 0x00, 0x1f, 0x11, 0x02, density]));
    for (let start = 0; start < height; start += 240) {
      const rows = Math.min(240, height - start);
      await send(new Uint8Array([0x1d, 0x76, 0x30, 0x00, 48, 0, rows & 255, rows >> 8]));
      await send(raster.subarray(start * 48, (start + rows) * 48));
      if (start + rows < height) await sleep(350);
    }
    await send(new Uint8Array([0x1b, 0x64, 0x02, 0x1f, 0x11, 0x08, 0x1f, 0x11, 0x0e, 0x1f, 0x11, 0x07, 0x1f, 0x11, 0x09]));
    progress.value = 100;
    message('Data sent. Confirm the physical receipt before relying on this version.');
    log('Transmission complete (' + raster.length + ' bitmap bytes)');
  } catch (error) {
    message('Printing stopped: ' + (error.message || error));
    log('Print failed: ' + (error.message || error));
  } finally {
    busy = false; updateConnection();
    setTimeout(() => { progress.hidden = true; }, 2500);
  }
}
function downloadImage() {
  try {
    renderReceipt();
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = 'PhomemoMuma-receipt.png';
    document.body.appendChild(a); a.click(); a.remove();
    message('Receipt image prepared. Check your browser downloads or Files.');
  } catch (error) { message('Export failed: ' + error.message); }
}
readState();
syncForm();
renderReceipt();
if (state.image) loadImage(state.image).catch((error) => { log('Saved image: ' + error.message); message('Saved photo could not be restored.'); });
for (const id of ['receipt-text','font-size','font-family','align','bold','margin','density','footer-line','image-place','image-width','image-mode','image-contrast']) {
  $(id).addEventListener(id === 'receipt-text' || id === 'image-contrast' ? 'input' : 'change', updatePreview);
}
$('connect').addEventListener('click', connect);
$('print').addEventListener('click', printReceipt);
$('save-png').addEventListener('click', downloadImage);
$('import-text').addEventListener('click', () => $('text-file').click());
$('text-file').addEventListener('change', async (event) => {
  const file = event.target.files && event.target.files[0]; if (!file) return;
  try { $('receipt-text').value = await file.text(); updatePreview(); message('Text imported from ' + file.name); }
  catch (error) { message('Text import failed: ' + error.message); }
  event.target.value = '';
});
$('paste-text').addEventListener('click', async () => {
  try { const text = await navigator.clipboard.readText(); $('receipt-text').value = text; updatePreview(); message('Pasted text from clipboard.'); }
  catch (error) { message('Clipboard access was blocked. Long-press the text box and choose Paste instead.'); }
});
$('image-add').addEventListener('click', () => $('image-file').click());
$('image-file').addEventListener('change', async (event) => { await importImage(event.target.files && event.target.files[0]); event.target.value = ''; });
$('image-remove').addEventListener('click', () => { state.image = null; image = null; syncForm(); updatePreview(); });
$('copy-log').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('log').textContent); message('Log copied.'); }
  catch (error) { message('Could not copy log: ' + error.message); }
});
$('reset').addEventListener('click', () => {
  if (!confirm('Clear the saved receipt draft and remove the image?')) return;
  state = { ...defaults, text: '' }; image = null;
  try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
  syncForm(); updatePreview(); message('Draft cleared.');
});
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('./sw.js').catch((error) => log('Offline caching unavailable: ' + error.message));
}
updateConnection();
})();