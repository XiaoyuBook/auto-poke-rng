// An independently supervised input; capture lifetime is unrelated to dialog lifetime.
function registerAudio({ client, handle, publish, level }) {
  let state = { status: 'idle' }, connecting = null, disconnecting = null;
  let timer, healthTimer, healthBusy = false, wanted = false, closing = false, generation = 0;
  const update = value => { state = value; publish(value); };
  const clearTimers = () => { clearTimeout(timer); clearInterval(healthTimer); };
  const fail = error => {
    clearTimers(); wanted = false;
    update({ status: 'failed', code: error.code, message: error.message });
  };
  client.on('offline', error => { clearTimers(); if (!closing && wanted) fail(error); });
  client.on('event', message => {
    if (closing) return;
    if (message.event === 'audio.level') {
      if (wanted && state.status === 'connected' && message.session === state.session) level(message);
      return;
    }
    if (message.event !== 'audio.state' || !wanted) return;
    // audio.start internally stops the old source first; don't flash an idle state.
    if (message.state.status === 'idle') return;
    update(message.state);
    if (state.status === 'failed') { clearTimers(); wanted = false; return; }
    if (state.status !== 'connected') return;
    clearTimers();
    const source = state;
    let sequence = '', changed = Date.now();
    healthTimer = setInterval(async () => {
      if (healthBusy || state.session !== source.session) return;
      healthBusy = true;
      try {
        const response = await fetch(`${source.baseUrl}/audio?session=${encodeURIComponent(source.session)}`, {
          method: 'HEAD', headers: { Authorization: 'Bearer ' + source.token }, signal: AbortSignal.timeout(2000),
        });
        if (state.session !== source.session) return;
        const current = response.headers.get('x-audio-sequence');
        if (response.ok && current && current !== sequence) { sequence = current; changed = Date.now(); }
        if (!response.ok || Date.now() - changed > 3500) throw Error('音频输入没有新数据，请检查连接后重新连接。');
      } catch (error) {
        if (state.session === source.session) { fail(error); client.terminate(); }
      } finally { healthBusy = false; }
    }, 1000);
  });
  handle('audio:list', () => client.call('audio.list', {}, 10000));
  handle('audio:connect', args => {
    if (!args || typeof args.deviceId !== 'string' || !args.deviceId.trim()) throw Error('请选择音频输入设备。');
    if (connecting || disconnecting || ['connecting', 'connected'].includes(state.status)) {
      throw Object.assign(Error('音频源正在使用，请先断开当前音频源。'), { code: 'BUSY' });
    }
    const version = ++generation;
    clearTimers(); wanted = true;
    update({ status: 'connecting', deviceId: args.deviceId, backend: 'wasapi' });
    // Timer covers driver initialization after audio.start has been accepted.
    timer = setTimeout(() => {
      if (generation === version && state.status === 'connecting') {
        fail(Error('打开音频输入超时，请检查设备连接和 Windows 麦克风权限。')); client.terminate();
      }
    }, 15000);
    connecting = client.call('audio.start', { deviceId: args.deviceId }, 5000).catch(error => {
      if (generation === version && state.status !== 'connected') fail(error);
      throw error;
    }).finally(() => { connecting = null; });
    return connecting;
  });
  handle('audio:disconnect', () => {
    if (disconnecting) return disconnecting;
    ++generation; wanted = false; clearTimers();
    disconnecting = (async () => {
      // Wait for a pending startup before sending stop, so it cannot reconnect later.
      if (connecting) await connecting.catch(() => {});
      try { if (client.child) await client.call('audio.stop', {}, 3000); }
      catch (error) { client.terminate(); update({ status: 'failed', message: error.message }); throw error; }
      update({ status: 'idle' });
    })().finally(() => { disconnecting = null; });
    return disconnecting;
  });
  return {
    close: async () => { closing = true; wanted = false; ++generation; clearTimers(); await client.close(); },
  };
}
module.exports = { registerAudio };
