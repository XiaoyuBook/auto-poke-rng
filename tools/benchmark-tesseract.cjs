// Evaluation-only dependency: npm install --prefix .deps/ocr-eval tesseract.js@7.0.0
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createWorker, PSM } = require('../.deps/ocr-eval/node_modules/tesseract.js');
const root = path.join(__dirname, '..', '.deps', 'ocr-eval');
const suite = process.argv[2] || 'screen';
if (!['screen', 'challenge'].includes(suite)) throw new Error('Unknown suite');
(async () => {
  const samples = JSON.parse(await fs.readFile(path.join(root, suite, 'samples.json'), 'utf8'));
  const rows = [];
  const route = sample => sample.language === 'zh'
    ? ((suite === 'screen' ? /^zh-3-/ : /^zh-[56]-/).test(sample.id) ? 'zh-Hant' : 'zh') : sample.language;
  // Monolingual CJK models include Latin/digits; grant this baseline the known language.
  for (const [lang, model] of [['zh', 'chi_sim'], ['zh-Hant', 'chi_tra'], ['ja', 'jpn'], ['en', 'eng'], ['digits', 'eng'], ['blank', 'eng']]) {
    const group = samples.filter(s => route(s) === lang);
    const start = performance.now();
    const worker = await createWorker(model, 1, { cachePath: root });
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE });
    const initMs = performance.now() - start;
    await worker.recognize(group[0].inputPath);
    for (const sample of group) {
      const times = []; let result;
      for (let i = 0; i < 2; i++) {
        const started = performance.now();
        result = await worker.recognize(sample.inputPath);
        times.push(performance.now() - started);
      }
      rows.push({ ...sample, route: lang, actual: result.data.confidence >= 50 ? result.data.text.trim() : '', raw: result.data.text, confidence: result.data.confidence, ms: (times[0] + times[1]) / 2, initMs });
    }
    await worker.terminate();
    console.log('Finished ' + lang);
  }
  const models = [];
  for (const file of ['chi_sim', 'chi_tra', 'jpn', 'eng']) {
    const buffer = await fs.readFile(path.join(root, file + '.traineddata'));
    models.push({ file: file + '.traineddata', bytes: buffer.length, sha256: createHash('sha256').update(buffer).digest('hex') });
  }
  await fs.writeFile(path.join(root, suite, 'tesseract-line.json'), JSON.stringify({ model: 'Tesseract.js 7 / LSTM best_int', suite, detection: false, models, samples: rows }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
