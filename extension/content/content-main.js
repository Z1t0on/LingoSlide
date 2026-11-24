/**
 * LingoSlide V2.1 Native Edition — Point d'entrée Content Script
 * Charge dynamiquement les modules ES6+ en résolvant le préfixe racine du manifest.
 */

(async function bootstrapLingoSlideContent() {
  if (globalThis.__LINGOSLIDE_CONTENT_LOADED__) return;
  globalThis.__LINGOSLIDE_CONTENT_LOADED__ = true;

  const host = (globalThis.location?.hostname || '').toLowerCase();
  if (host === 'docs.google.com' || host.endsWith('.docs.google.com')) {
    return;
  }

  let basePrefix = 'extension/';
  try {
    const manifest = chrome.runtime.getManifest();
    const scriptPath = manifest?.content_scripts?.[0]?.js?.[0] || '';
    basePrefix = scriptPath.startsWith('extension/') ? 'extension/' : '';
  } catch {
    basePrefix = 'extension/';
  }

  const [
    { MSG_TYPES },
    { resolveProviderFromUrl },
    { injectTextIntoPage },
    { createFeedObserver }
  ] = await Promise.all([
    import(chrome.runtime.getURL(`${basePrefix}shared/constants.js`)),
    import(chrome.runtime.getURL(`${basePrefix}shared/providers.config.js`)),
    import(chrome.runtime.getURL(`${basePrefix}content/dom-adapter.js`)),
    import(chrome.runtime.getURL(`${basePrefix}content/feed-observer.js`))
  ]);

  if (resolveProviderFromUrl(globalThis.location?.href || '')) {
    await import(chrome.runtime.getURL(`${basePrefix}content/relay-stt-agent.js`));
  }

  function safeSendMessage(payload) {
    try {
      const maybePromise = chrome.runtime.sendMessage(payload);
      if (maybePromise && typeof maybePromise.catch === 'function') {
        maybePromise.catch(() => {});
      }
    } catch {
      // Contexte d'extension rechargé
    }
  }

  const observer = createFeedObserver({
    root: document,
    onReset(info) {
      safeSendMessage({
        type: MSG_TYPES.RESET_FEED,
        reason: info?.reason || 'SPA_NAVIGATION',
        url: info?.url || globalThis.location?.href || ''
      });
    },
    onBatch(messages) {
      safeSendMessage({
        type: MSG_TYPES.FEED_BATCH,
        messages,
        url: globalThis.location?.href || ''
      });
    }
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message !== 'object') return false;

    if (message.type === MSG_TYPES.PING) {
      observer.forceScan();
      sendResponse({ ok: true });
      return false;
    }

    if (message.type === MSG_TYPES.INJECT_TEXT) {
      injectTextIntoPage(message.text, {
        autoEnter: Boolean(message.autoEnter)
      })
        .then((result) => sendResponse(result))
        .catch((err) =>
          sendResponse({ ok: false, reason: err?.message || 'INJECTION_FAILED' })
        );
      return true;
    }

    return false;
  });

  globalThis.addEventListener('beforeunload', () => {
    safeSendMessage({
      type: MSG_TYPES.RESET_FEED,
      reason: 'PAGE_UNLOAD'
    });
    observer.disconnect();
  });
})();
