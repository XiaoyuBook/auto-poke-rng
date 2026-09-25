function fetchRepositoryResource(url, { maximumBytes, ...options }) {
  const { net } = require('electron');
  if (options.redirect !== 'manual') return net.fetch(url, options);

  // Electron's net.fetch rejects manual redirects instead of returning the 3xx
  // response. Expose that response so the repository can validate the CDN URL.
  return new Promise((resolve, reject) => {
    options.signal.throwIfAborted();
    const request = net.request({ url, method: 'GET', redirect: 'manual', headers: options.headers });
    const fail = error => { reject(error); request.abort(); };
    const abort = () => fail(options.signal.reason);
    options.signal.addEventListener('abort', abort, { once: true });
    request.once('close', () => options.signal.removeEventListener('abort', abort));
    request.on('error', reject);
    request.once('redirect', (status, method, location) => {
      resolve(new Response(null, { status, headers: { location } }));
      request.abort();
    });
    request.once('response', response => {
      const headers = new Headers();
      for (const [name, values] of Object.entries(response.headers)) {
        for (const value of Array.isArray(values) ? values : [values]) headers.append(name, value);
      }
      if (Number(headers.get('content-length')) > maximumBytes) {
        fail(new RangeError('仓库下载大小超限。'));
        return;
      }
      const chunks = [];
      let size = 0;
      response.on('data', chunk => {
        size += chunk.length;
        if (size > maximumBytes) { fail(new RangeError('仓库下载大小超限。')); return; }
        chunks.push(Buffer.from(chunk));
      });
      response.on('error', reject);
      response.once('aborted', () => reject(options.signal.reason || Error('仓库下载已中断。')));
      response.once('end', () => {
        const body = [204, 205, 304].includes(response.statusCode) ? null : Buffer.concat(chunks);
        resolve(new Response(body, { status: response.statusCode, headers }));
      });
    });
    request.end();
  });
}

module.exports = { fetchRepositoryResource };
