// Use real editor input so Electron checks exercise selection, undo and folded text.
const readEditor = `Array.from(document.querySelectorAll('.cm-content .cm-line')).map(line => line.textContent).join('\\n')`;
function editorHelpers(window) {
  const js = code => window.webContents.executeJavaScript(code, true);
  const key = async (keyCode, modifiers = []) => {
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
    await js('new Promise(resolve => requestAnimationFrame(resolve))');
  };
  const edit = async text => {
    await js('document.querySelector(".cm-content").focus()');
    await key('A', ['control']);
    await window.webContents.insertText(text);
    await js('new Promise(resolve => requestAnimationFrame(resolve))');
  };
  return { edit, key, read: () => js(readEditor) };
}
module.exports = { editorHelpers, readEditor };
