// Dependency-free regression checks for the static iPhone document printer.
// Run with: node scripts/check.mjs
import fs from 'node:fs';
import assert from 'node:assert/strict';

const file = (path) => fs.readFileSync(path, 'utf8');
const html = file('index.html');
const js = file('documents.js');
const sw = file('sw.js');
const manifest = JSON.parse(file('manifest.webmanifest'));

function check(name, fn) {
  try { fn(); console.log('PASS', name); }
  catch (error) { console.error('FAIL', name, error.message); process.exitCode = 1; }
}

check('JavaScript parses', () => {
  new Function(js);
  new Function(sw);
  new Function(file('muma.js'));
});

check('All DOM identifiers referenced by the document printer exist', () => {
  const ids = [...new Set([...js.matchAll(/\$\('([A-Za-z][\w-]*)'\)/g)].map((m) => m[1]))];
  const missing = ids.filter((id) => !html.includes('id="' + id + '"'));
  assert.deepEqual(missing, []);
  assert.ok(ids.length >= 20);
});

check('Document imports and Bluetooth printing are present', () => {
  for (const required of [
    'getDocument(', 'pdfPage.render(', 'getTextContent(', 'canvas.width',
    'writeValueWithoutResponse', 'getPrimaryService(SERVICE)',
    'getCharacteristic(WRITE)', 'oneBitRaster', 'printPages(',
    "['preview-page','page-from','page-to']"
  ]) assert.ok(js.includes(required), required);
});

check('Malicious PDF font evaluation disabled', () => {
  assert.match(js, /isEvalSupported:\s*false/);
  assert.match(js, /enableScripting:\s*false/);
});

check('In-browser PDF fixture is structurally valid', () => {
  const begin = js.indexOf('function makeSamplePDF()');
  const end = js.indexOf('async function loadDocument(file)', begin);
  assert.ok(begin >= 0 && end > begin);
  const extract = new Function('File', js.slice(begin, end) + '\nreturn makeSamplePDF()');
  function FakeFile(parts, name, opts) {
    this.content = parts.join('');
    this.name = name;
    this.type = opts.type;
  }
  const pdf = extract(FakeFile).content;
  assert.ok(pdf.startsWith('%PDF-1.4\n'));
  assert.equal((pdf.match(/\/Type \/Page\b/g) || []).length, 2);
  const xref = pdf.indexOf('xref\n');
  assert.ok(xref > 0);
  assert.equal(Number(pdf.split('startxref\n')[1].split('\n')[0]), xref);
  const entries = pdf.slice(xref).split('\n').slice(3, 10);
  assert.equal(entries.length, 7);
  entries.forEach((entry, index) => {
    const offset = Number(entry.slice(0, 10));
    assert.ok(pdf.slice(offset).startsWith((index + 1) + ' 0 obj'));
  });
  const streams = [...pdf.matchAll(/<< \/Length (\d+) >>\nstream\n/g)];
  assert.equal(streams.length, 2);
  for (const stream of streams) {
    assert.equal(pdf.slice(stream.index + stream[0].length).indexOf('\nendstream'), Number(stream[1]));
  }
});

check('Entry point and offline asset links are internally consistent', () => {
  for (const asset of ['documents.js','documents.css','muma.css','manifest.webmanifest']) {
    assert.ok(html.includes('./' + asset));
    assert.ok(fs.existsSync(asset));
  }
  assert.equal(manifest.start_url, './');
  for (const asset of ['documents.js', 'documents.css', 'muma.css', 'diagnostic.html', 'print.html']) {
    assert.ok(sw.includes('./' + asset));
  }
});

check('Printer has known density controls and no untested calibration required to load PDFs', () => {
  assert.ok(html.includes('value="4" selected'));
  assert.ok(html.includes('Open sample PDF'));
  assert.ok(html.includes('print-one'));
});

if (process.exitCode) process.exit(process.exitCode);
console.log('All PhomemoMuma static checks passed.');
