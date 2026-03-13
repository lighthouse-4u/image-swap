document.addEventListener('__proxyFetch', (e) => {
  const { id, url, attr } = e.detail;
  chrome.runtime.sendMessage({ type: 'fetchImage', url }, (res) => {
    if (res?.dataUrl) {
      document.dispatchEvent(new CustomEvent('__proxyReady', { detail: { id, dataUrl: res.dataUrl, attr: attr || 'src' } }));
    }
  });
});
