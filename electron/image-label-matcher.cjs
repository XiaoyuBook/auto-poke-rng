const { spawn } = require('node:child_process');
const path = require('node:path');
const { pythonPath } = require('./automation-worker.cjs');

const METHODS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 13, 14];
const validImage = value => typeof value === 'string' && /^[A-Za-z0-9+/]+={0,2}$/.test(value)
  && Buffer.byteLength(value, 'base64') <= 12 * 1024 * 1024;
const validRect = value => value && ['x', 'y', 'width', 'height'].every(key => Number.isSafeInteger(value[key]))
  && value.x >= 0 && value.y >= 0 && value.width > 0 && value.height > 0;

class ImageLabelMatcher {
  constructor() { this.children = new Set(); this.closed = false; }
  async match({ imageBase64, label } = {}) {
    if (!validImage(imageBase64) || !validImage(label?.imageBase64)) throw Error('匹配图像无效或过大。');
    if (!METHODS.includes(label.searchMethod) || !Number.isFinite(label.threshold)
      || !validRect(label.range) || !validRect(label.target)) throw Error('匹配参数无效。');
    if (this.closed) throw Error('图像匹配服务已关闭。');
    if (this.children.size >= 2) throw Error('图像匹配正在进行，请稍后再试。');
    const child = spawn(pythonPath(), ['-u', path.join(__dirname, '../runtime/python/image_label_preview.py')], {
      windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, PYTHONUTF8: '1', PYTHONDONTWRITEBYTECODE: '1' },
    });
    this.children.add(child);
    return new Promise((resolve, reject) => {
      let output = '', diagnostic = '', settled = false;
      const finish = (error, result) => {
        if (settled) return;
        settled = true; clearTimeout(timer); this.children.delete(child);
        if (error) { child.kill(); reject(error); } else resolve(result);
      };
      const timer = setTimeout(() => finish(Error('图像匹配超时。')), 15000);
      child.once('error', error => finish(error));
      child.stdin.on('error', error => finish(error));
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', data => { diagnostic = (diagnostic + data).slice(-2000); });
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', data => {
        output += data;
        if (output.length > 64 * 1024) finish(Error('图像匹配响应超过限制。'));
      });
      child.once('close', code => {
        if (code !== 0) { finish(Error(diagnostic || `图像匹配进程退出 (${code})`)); return; }
        try {
          const response = JSON.parse(output);
          if (!response.ok) throw Error(response.error || '图像匹配失败。');
          finish(null, response.result);
        } catch (error) { finish(error); }
      });
      // EOF-delimited input; no background stdin reader can lock native imports.
      child.stdin.end(JSON.stringify({ imageBase64, label }));
    });
  }
  close() { this.closed = true; for (const child of this.children) child.kill(); }
}
module.exports = { ImageLabelMatcher };
