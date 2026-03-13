(function () {
  const PROXY_BASE = 'https://images.fusion-tech.dev/fetch';
  const PLACEHOLDER = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  const MEDIA_TYPES = ['img', 'video', 'source'];
  const pending = new Map();

  document.addEventListener('__proxyReady', (e) => {
    const { id, dataUrl, attr = 'src' } = e.detail;
    const el = pending.get(id);
    if (el) {
      el[attr] = dataUrl;
      pending.delete(id);
    }
  });

  function getProxyUrl(originalUrl) {
    if (!originalUrl || originalUrl.startsWith(PROXY_BASE) || originalUrl.startsWith('data:')) return originalUrl;
    return `${PROXY_BASE}?url=${encodeURIComponent(originalUrl)}`;
  }

  function proxyMediaElement(el) {
    if (el.tagName === 'IMG' && el.src) {
      el.removeAttribute('crossorigin');
      const proxyUrl = getProxyUrl(el.src);
      if (proxyUrl.startsWith('data:')) return;
      const id = 'p' + Math.random().toString(36).slice(2);
      pending.set(id, el);
      el.src = PLACEHOLDER;
      document.dispatchEvent(new CustomEvent('__proxyFetch', { detail: { id, url: proxyUrl } }));
    }
    if (el.tagName === 'VIDEO') {
      el.removeAttribute('crossorigin');
      if (el.poster) {
        const proxyUrl = getProxyUrl(el.poster);
        if (!proxyUrl.startsWith('data:')) {
          const id = 'p' + Math.random().toString(36).slice(2);
          pending.set(id, el);
          el.poster = PLACEHOLDER;
          document.dispatchEvent(new CustomEvent('__proxyFetch', { detail: { id, url: proxyUrl, attr: 'poster' } }));
        }
      }
      if (el.src) {
        const proxyUrl = getProxyUrl(el.src);
        const id = 'p' + Math.random().toString(36).slice(2);
        pending.set(id, el);
        el.src = PLACEHOLDER;
        document.dispatchEvent(new CustomEvent('__proxyFetch', { detail: { id, url: proxyUrl } }));
      }
      el.querySelectorAll('source').forEach((s) => {
        s.removeAttribute('crossorigin');
        if (s.src) {
          const proxyUrl = getProxyUrl(s.src);
          const id = 'p' + Math.random().toString(36).slice(2);
          pending.set(id, s);
          s.src = PLACEHOLDER;
          document.dispatchEvent(new CustomEvent('__proxyFetch', { detail: { id, url: proxyUrl } }));
        }
      });
    }
    if (el.tagName === 'SOURCE' && el.src) {
      el.removeAttribute('crossorigin');
      const proxyUrl = getProxyUrl(el.src);
      const id = 'p' + Math.random().toString(36).slice(2);
      pending.set(id, el);
      el.src = PLACEHOLDER;
      document.dispatchEvent(new CustomEvent('__proxyFetch', { detail: { id, url: proxyUrl } }));
    }
  }

  function processExisting() {
    document.querySelectorAll('img, video, source').forEach(proxyMediaElement);
  }

  const imgSrcDesc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src') ||
    Object.getOwnPropertyDescriptor(Image.prototype, 'src');
  const videoSrcDesc = Object.getOwnPropertyDescriptor(HTMLVideoElement.prototype, 'src') ||
    Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');

  if (imgSrcDesc?.set) {
    const nativeSet = imgSrcDesc.set;
    Object.defineProperty(HTMLImageElement.prototype, 'src', {
      get: imgSrcDesc.get,
      set: function (v) {
        this.removeAttribute('crossorigin');
        const proxyUrl = getProxyUrl(v);
        if (proxyUrl.startsWith('data:')) {
          nativeSet.call(this, v);
          return;
        }
        const id = 'p' + Math.random().toString(36).slice(2);
        pending.set(id, this);
        nativeSet.call(this, PLACEHOLDER);
        document.dispatchEvent(new CustomEvent('__proxyFetch', { detail: { id, url: proxyUrl } }));
      },
      configurable: true,
      enumerable: true
    });
  }

  if (videoSrcDesc?.set) {
    const nativeSet = videoSrcDesc.set;
    Object.defineProperty(HTMLVideoElement.prototype, 'src', {
      get: videoSrcDesc.get,
      set: function (v) {
        this.removeAttribute('crossorigin');
        const proxyUrl = getProxyUrl(v);
        if (proxyUrl.startsWith('data:')) {
          nativeSet.call(this, v);
          return;
        }
        const id = 'p' + Math.random().toString(36).slice(2);
        pending.set(id, this);
        nativeSet.call(this, PLACEHOLDER);
        document.dispatchEvent(new CustomEvent('__proxyFetch', { detail: { id, url: proxyUrl } }));
      },
      configurable: true,
      enumerable: true
    });
  }

  Object.defineProperty(HTMLSourceElement.prototype, 'src', {
    get: function () {
      return this.getAttribute('src') || '';
    },
    set: function (v) {
      const proxyUrl = getProxyUrl(v);
      if (proxyUrl.startsWith('data:')) {
        this.setAttribute('src', v);
        return;
      }
      const id = 'p' + Math.random().toString(36).slice(2);
      pending.set(id, this);
      this.setAttribute('src', PLACEHOLDER);
      document.dispatchEvent(new CustomEvent('__proxyFetch', { detail: { id, url: proxyUrl } }));
    },
    configurable: true,
    enumerable: true
  });

  const videoPosterDesc = Object.getOwnPropertyDescriptor(HTMLVideoElement.prototype, 'poster');
  if (videoPosterDesc?.set) {
    const nativeSet = videoPosterDesc.set;
    Object.defineProperty(HTMLVideoElement.prototype, 'poster', {
      get: videoPosterDesc.get,
      set: function (v) {
        const proxyUrl = getProxyUrl(v);
        if (proxyUrl.startsWith('data:')) {
          nativeSet.call(this, v);
          return;
        }
        const id = 'p' + Math.random().toString(36).slice(2);
        pending.set(id, this);
        nativeSet.call(this, PLACEHOLDER);
        document.dispatchEvent(new CustomEvent('__proxyFetch', { detail: { id, url: proxyUrl, attr: 'poster' } }));
      },
      configurable: true,
      enumerable: true
    });
  }

  const nativeSetAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (name, value) {
    if (this.tagName?.toLowerCase() === 'video' && name === 'poster') {
      const proxyUrl = getProxyUrl(value);
      if (!proxyUrl.startsWith('data:')) {
        const id = 'p' + Math.random().toString(36).slice(2);
        pending.set(id, this);
        nativeSetAttribute.call(this, name, PLACEHOLDER);
        document.dispatchEvent(new CustomEvent('__proxyFetch', { detail: { id, url: proxyUrl, attr: 'poster' } }));
        return;
      }
    }
    if (MEDIA_TYPES.includes(this.tagName?.toLowerCase())) {
      if (name === 'crossorigin') return;
      if (name === 'src') {
        const proxyUrl = getProxyUrl(value);
        if (!proxyUrl.startsWith('data:')) {
          const id = 'p' + Math.random().toString(36).slice(2);
          pending.set(id, this);
          nativeSetAttribute.call(this, name, PLACEHOLDER);
          document.dispatchEvent(new CustomEvent('__proxyFetch', { detail: { id, url: proxyUrl } }));
          return;
        }
      }
      if (name === 'srcset') {
        const first = value.split(',')[0]?.trim().split(/\s+/)[0];
        if (first && !first.startsWith('data:')) {
          const proxyUrl = getProxyUrl(first);
          const id = 'p' + Math.random().toString(36).slice(2);
          pending.set(id, this);
          this.removeAttribute('srcset');
          nativeSetAttribute.call(this, 'src', PLACEHOLDER);
          document.dispatchEvent(new CustomEvent('__proxyFetch', { detail: { id, url: proxyUrl } }));
          return;
        }
      }
    }
    return nativeSetAttribute.call(this, name, value);
  };

  processExisting();

  const observer = new MutationObserver((mutations) => {
    mutations.forEach((m) => {
      m.addedNodes.forEach((node) => {
        if (node.nodeType === 1) {
          if (MEDIA_TYPES.includes(node.tagName?.toLowerCase())) {
            proxyMediaElement(node);
          }
          node.querySelectorAll?.('img, video, source').forEach(proxyMediaElement);
        }
      });
    });
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
