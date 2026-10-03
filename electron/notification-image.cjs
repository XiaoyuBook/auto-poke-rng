// Capture only the shared game source; never the desktop or a settings window.
async function captureTaskImage({ notifications, outcome, getVideo, captureImage, encodeImage, onError = () => {} }) {
  if (!notifications?.wantsTaskImage?.(outcome)) return undefined;
  try {
    let frame;
    if (captureImage) frame = await captureImage();
    else {
      const source = { ...getVideo() };
      if (source.status !== 'connected') throw Error('视频源未连接');
      const response = await fetch(`${source.baseUrl}/snapshot.png?session=${encodeURIComponent(source.session)}`, {
        headers: { Authorization: 'Bearer ' + source.token }, signal: AbortSignal.timeout(4000),
      });
      if (!response.ok) throw Error('读取视频帧失败（HTTP ' + response.status + '）');
      frame = Buffer.from(await response.arrayBuffer());
      const current = getVideo();
      if (current.status !== 'connected' || current.session !== source.session) throw Error('视频源已断开或切换');
    }
    const bytes = Buffer.isBuffer(frame) ? frame : typeof frame === 'string'
      ? Buffer.from(frame.startsWith('data:') ? frame.slice(frame.indexOf(',') + 1) : frame, 'base64') : null;
    if (!bytes?.length) throw Error('截图数据为空');
    const image = encodeImage ? await encodeImage(bytes) : bytes;
    if (!Buffer.isBuffer(image) || !image.length) throw Error('截图编码结果为空');
    if (image.length > 10 * 1024 * 1024) throw Error('截图超过 10 MB');
    return image;
  } catch (error) {
    onError('QQ通知截图失败：' + String(error?.message || error));
    return undefined;
  }
}
module.exports = { captureTaskImage };
