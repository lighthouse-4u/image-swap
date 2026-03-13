chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'fetchImage') {
    fetch(msg.url)
      .then((r) => r.arrayBuffer())
      .then((buf) => {
        const bytes = new Uint8Array(buf);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        sendResponse({ dataUrl: `data:image/png;base64,${btoa(binary)}` });
      })
      .catch((err) => {
        console.error(err);
        sendResponse({ error: String(err) });
      });
    return true;
  }
});
