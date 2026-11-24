/**
 * LingoSlide V2.1 Native Edition — Agent Content Script Relais STT
 * Pilote les sessions web actives (ChatGPT Web, Gemini, Mistral Le Chat)
 * à partir des sélecteurs déclaratifs de providers.config.js, observe la transcription
 * et nettoie le champ relais après rapatriement dans le Side Panel.
 */

(async function bootstrapRelaySttAgent() {
  if (globalThis.__LINGOSLIDE_RELAY_STT_LOADED__) return;
  globalThis.__LINGOSLIDE_RELAY_STT_LOADED__ = true;

  let basePrefix = 'extension/';
  try {
    const manifest = chrome.runtime.getManifest();
    const scriptPath = manifest?.content_scripts?.[0]?.js?.[0] || '';
    basePrefix = scriptPath.startsWith('extension/') ? 'extension/' : '';
  } catch {
    basePrefix = 'extension/';
  }

  const [{ MSG_TYPES }, { getProviderConfig, resolveProviderFromUrl, resolveSelector }] =
    await Promise.all([
      import(chrome.runtime.getURL(`${basePrefix}shared/constants.js`)),
      import(chrome.runtime.getURL(`${basePrefix}shared/providers.config.js`))
    ]);

  let activeObserver = null;
  let activeInputListener = null;
  let observedInputEl = null;
  let baselineText = '';
  let lastTranscribedSegment = '';
  let activeProviderId = null;

  function emitRuntimeEvent(payload) {
    try {
      const maybePromise = chrome.runtime.sendMessage({
        ...payload,
        source: 'relay'
      });
      if (maybePromise && typeof maybePromise.catch === 'function') {
        maybePromise.catch(() => {});
      }
    } catch {
      // Contexte rechargé
    }
  }

  function readInputText(el) {
    if (!el) return '';
    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
      return (el.value || '').trim();
    }
    return (el.innerText || el.textContent || '')
      .replace(/\u200B|\uFEFF/g, '')
      .trim();
  }

  function clearInputArea(el) {
    if (!el) return;

    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
      const proto =
        el instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
      const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
      if (descriptor && typeof descriptor.set === 'function') {
        descriptor.set.call(el, '');
      } else {
        el.value = '';
      }
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }

    el.focus({ preventScroll: true });
    const selection = globalThis.getSelection?.();
    if (selection) {
      const range = document.createRange();
      range.selectNodeContents(el);
      selection.removeAllRanges();
      selection.addRange(range);
    }

    const notCanceled = el.dispatchEvent(
      new InputEvent('beforeinput', {
        inputType: 'deleteContentBackward',
        bubbles: true,
        cancelable: true
      })
    );

    if (notCanceled && readInputText(el).length > 0) {
      el.textContent = '';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  function detachInputObserver() {
    if (activeObserver) {
      activeObserver.disconnect();
      activeObserver = null;
    }
    if (observedInputEl && activeInputListener) {
      observedInputEl.removeEventListener('input', activeInputListener);
    }
    activeInputListener = null;
    observedInputEl = null;
  }

  function extractDeltaText(fullText) {
    if (!fullText) return '';
    if (baselineText && fullText.startsWith(baselineText)) {
      return fullText.slice(baselineText.length).trim();
    }
    return fullText.trim();
  }

  function attachInputObserver(inputEl, providerId) {
    detachInputObserver();
    observedInputEl = inputEl;
    baselineText = readInputText(inputEl);
    lastTranscribedSegment = '';
    activeProviderId = providerId;

    const handleChange = () => {
      const current = readInputText(inputEl);
      const delta = extractDeltaText(current);
      if (delta === lastTranscribedSegment) return;
      lastTranscribedSegment = delta;

      emitRuntimeEvent({
        type: MSG_TYPES.STT_TRANSCRIPT,
        providerId,
        finalText: '',
        interimText: delta
      });
    };

    activeInputListener = handleChange;
    inputEl.addEventListener('input', handleChange);

    activeObserver = new MutationObserver(handleChange);
    activeObserver.observe(inputEl, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }

  function base64ToFile(base64Data, mimeType, fileName) {
    const binary = atob(base64Data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new File([bytes], fileName, { type: mimeType || 'audio/webm' });
  }

  function checkProviderSession(providerConfig) {
    const currentUrl = (globalThis.location?.href || '').toLowerCase();
    if (/(\/auth\/|\/login|accounts\.google\.com|\/signin)/.test(currentUrl)) {
      return {
        ok: false,
        reason: 'SESSION_EXPIRED',
        loginUrl: providerConfig.targetUrl
      };
    }

    const loggedOutEl = resolveSelector(providerConfig.selectors.loggedOutIndicators, document);
    if (loggedOutEl) {
      return {
        ok: false,
        reason: 'SESSION_EXPIRED',
        loginUrl: providerConfig.targetUrl
      };
    }

    const inputEl = resolveSelector(providerConfig.selectors.inputArea, document);
    if (!inputEl) {
      return {
        ok: false,
        reason: 'UI_NOT_READY',
        loginUrl: providerConfig.targetUrl
      };
    }

    const micBtn = resolveSelector(providerConfig.selectors.micButton, document);
    const fileInput = resolveSelector(providerConfig.selectors.fileInput, document, {
      requireVisible: false
    });

    return {
      ok: true,
      hasMicButton: Boolean(micBtn),
      hasFileInput: Boolean(fileInput)
    };
  }

  async function startDictationOnProvider(providerConfig, { audioBlob } = {}) {
    const session = checkProviderSession(providerConfig);
    if (!session.ok) {
      return session;
    }

    const inputEl = resolveSelector(providerConfig.selectors.inputArea, document);
    const micBtn = resolveSelector(providerConfig.selectors.micButton, document);

    attachInputObserver(inputEl, providerConfig.id);

    if (micBtn) {
      micBtn.click();
      emitRuntimeEvent({
        type: MSG_TYPES.STT_STATE,
        providerId: providerConfig.id,
        state: 'listening'
      });
      return { ok: true, mode: 'web_mic_button' };
    }

    if (audioBlob?.base64Data && session.hasFileInput) {
      const fileInput = resolveSelector(providerConfig.selectors.fileInput, document, {
        requireVisible: false
      });
      if (fileInput) {
        const dt = new DataTransfer();
        dt.items.add(
          base64ToFile(audioBlob.base64Data, audioBlob.mimeType, 'lingoslide-dictation.webm')
        );
        fileInput.files = dt.files;
        fileInput.dispatchEvent(new Event('change', { bubbles: true }));
        emitRuntimeEvent({
          type: MSG_TYPES.STT_STATE,
          providerId: providerConfig.id,
          state: 'listening'
        });
        return { ok: true, mode: 'audio_blob_upload' };
      }
    }

    detachInputObserver();
    return {
      ok: false,
      reason: 'MIC_CONTROL_UNAVAILABLE',
      loginUrl: providerConfig.targetUrl
    };
  }

  async function stopDictationAndClear(providerConfig, clearAfterRead = true) {
    const stopBtn = resolveSelector(providerConfig.selectors.stopButton, document);
    if (stopBtn) {
      stopBtn.click();
    } else {
      const micBtn = resolveSelector(providerConfig.selectors.micButton, document);
      if (micBtn && micBtn.getAttribute('aria-pressed') === 'true') {
        micBtn.click();
      }
    }

    // Attendre brièvement la stabilisation du texte transcrit dans le champ relais
    await new Promise((resolve) => setTimeout(resolve, 260));

    const inputEl =
      observedInputEl || resolveSelector(providerConfig.selectors.inputArea, document);
    const finalText = extractDeltaText(readInputText(inputEl)) || lastTranscribedSegment;

    detachInputObserver();

    if (finalText) {
      emitRuntimeEvent({
        type: MSG_TYPES.STT_TRANSCRIPT,
        providerId: providerConfig.id,
        finalText,
        interimText: ''
      });
    }

    if (clearAfterRead && inputEl) {
      clearInputArea(inputEl);
    }

    emitRuntimeEvent({
      type: MSG_TYPES.STT_STATE,
      providerId: providerConfig.id,
      state: 'idle'
    });

    return { ok: true, finalText };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message !== 'object') return false;

    if (message.type === MSG_TYPES.RELAY_PING) {
      const matched = resolveProviderFromUrl(globalThis.location?.href || '');
      sendResponse({ ok: true, providerId: matched?.id || activeProviderId });
      return false;
    }

    const providerConfig = getProviderConfig(
      message.providerId || resolveProviderFromUrl(globalThis.location?.href || '')?.id
    );

    if (message.type === MSG_TYPES.RELAY_SESSION_CHECK) {
      sendResponse(checkProviderSession(providerConfig));
      return false;
    }

    if (message.type === MSG_TYPES.RELAY_START_DICTATION) {
      startDictationOnProvider(providerConfig, { audioBlob: message.audioBlob })
        .then((res) => sendResponse(res))
        .catch((err) =>
          sendResponse({
            ok: false,
            reason: err?.message || 'RELAY_START_FAILED',
            loginUrl: providerConfig.targetUrl
          })
        );
      return true;
    }

    if (message.type === MSG_TYPES.RELAY_STOP_DICTATION) {
      stopDictationAndClear(providerConfig, message.clearAfterRead !== false)
        .then((res) => sendResponse(res))
        .catch((err) =>
          sendResponse({
            ok: false,
            reason: err?.message || 'RELAY_STOP_FAILED'
          })
        );
      return true;
    }

    return false;
  });
})();
