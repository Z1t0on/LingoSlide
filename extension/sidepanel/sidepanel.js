/**
 * LingoSlide V2.1 Native Edition — Contrôleur du Side Panel
 * - Fil Miroir (targetLang -> sourceLang), texte traduit uniquement, ordre naturel DOM (max 5).
 * - Purge immédiate des verrous et de la file d'attente sur resetFeed (SPA / F5 / onglet).
 * - Command Center (sourceLang -> targetLang) sans traduction à la frappe.
 */

import {
  MAX_FEED_MESSAGES,
  MSG_TYPES,
  THEME_MODES,
  computeMessageFingerprint
} from '../shared/constants.js';
import { loadPrefs, savePrefs } from '../shared/storage-schema.js';
import {
  abortAndFlushTranslations,
  getTranslationEpoch,
  translateNative
} from '../shared/native-translator.js';
import { createSpeechController } from './speech-controller.js';

const chatFeedEl = document.getElementById('chat-feed');
const emptyStateEl = document.getElementById('feed-empty-state');
const langPairLabelEl = document.getElementById('lang-pair-label');
const themeToggleBtn = document.getElementById('theme-toggle-btn');
const openOptionsBtn = document.getElementById('open-options-btn');
const draftInputEl = document.getElementById('draft-input');
const injectTranslateBtn = document.getElementById('inject-translate-btn');
const injectRawBtn = document.getElementById('inject-raw-btn');
const micBtn = document.getElementById('mic-btn');
const micBtnLabel = document.getElementById('mic-btn-label');
const autoEnterToggle = document.getElementById('auto-enter-toggle');
const fallbackBannerEl = document.getElementById('fallback-banner');
const fallbackBannerTextEl = document.getElementById('fallback-banner-text');
const fallbackLoginBtn = document.getElementById('fallback-login-btn');
const fallbackCopyBtn = document.getElementById('fallback-copy-btn');

let prefs = null;
let feedMessages = [];
let lastFailedText = '';
let lastFailedProviderId = '';
let lastErrorNeedsPermissionTab = false;
let isInjecting = false;
let speechBaseText = '';
let speechCommittedText = '';
let speechState = 'idle';

function hasExtensionRuntime() {
  return typeof chrome !== 'undefined' && Boolean(chrome.runtime?.sendMessage);
}

function applySpeechState(nextState) {
  speechState = nextState || 'idle';
  const active = speechState === 'listening';
  micBtn.classList.toggle('listening', active);
  micBtn.setAttribute('aria-pressed', active ? 'true' : 'false');
  if (speechState === 'starting') {
    micBtnLabel.textContent = 'Micro…';
  } else if (active) {
    micBtnLabel.textContent = 'REC';
  } else {
    micBtnLabel.textContent = '🎙️ Micro';
    speechBaseText = '';
    speechCommittedText = '';
  }
  micBtn.disabled = speechState === 'unavailable';
}

function applySpeechTranscript({ finalText, interimText }) {
  if (finalText) {
    speechCommittedText = `${speechCommittedText}${finalText}`;
  }
  const combinedSpeech = `${speechCommittedText}${interimText || ''}`.trim();
  const prefix = speechBaseText ? `${speechBaseText} ` : '';
  draftInputEl.value = `${prefix}${combinedSpeech}`.trimStart();
}

function applySpeechError(err) {
  applySpeechState('idle');
  lastFailedProviderId = err?.providerId || prefs?.sttProvider || 'chatgpt';
  lastErrorNeedsPermissionTab = Boolean(err?.needsPermissionTab);
  const needsAction = Boolean(err?.needsLogin || err?.needsPermissionTab);
  fallbackLoginBtn.textContent = err?.needsPermissionTab
    ? 'Autoriser micro'
    : 'Ouvrir la connexion';
  fallbackLoginBtn.style.display = needsAction ? 'inline-flex' : 'none';
  fallbackLoginBtn.classList.toggle('hidden', !needsAction);
  showFallbackBanner(err?.message || 'Erreur relais STT.');
}

const fallbackSpeechController = createSpeechController({
  onStateChange: applySpeechState,
  onTranscript: applySpeechTranscript,
  onError: applySpeechError
});

// Cache local par empreinte + paire pour éviter de retraduire un message inchangé
const translatedTextCache = new Map();

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme || 'auto');
  const icons = { auto: '🌗', dark: '🌙', light: '☀️' };
  themeToggleBtn.textContent = icons[theme] || '🌗';
}

function updateHeaderPair() {
  if (!prefs) return;
  langPairLabelEl.textContent = `${prefs.sourceLang.toUpperCase()} ⇄ ${prefs.targetLang.toUpperCase()}`;
  autoEnterToggle.checked = Boolean(prefs.autoEnter);
}

function showFallbackBanner(message, textToCopy = '') {
  lastFailedText = textToCopy;
  fallbackBannerTextEl.textContent = message;
  fallbackCopyBtn.style.display = textToCopy ? 'inline-flex' : 'none';
  fallbackBannerEl.classList.remove('hidden');
}

function hideFallbackBanner() {
  lastFailedText = '';
  lastErrorNeedsPermissionTab = false;
  fallbackLoginBtn.style.display = 'none';
  fallbackLoginBtn.classList.add('hidden');
  fallbackBannerEl.classList.add('hidden');
}

function isDuplicateInBuffer(buffer, message) {
  const fp = message.fingerprint || computeMessageFingerprint(message);
  return buffer.some(
    (item) => item.fingerprint === fp || (message.id && item.id === message.id)
  );
}

/**
 * Libère immédiatement les verrous du traducteur natif et purge la file locale.
 */
function flushTranslationState() {
  abortAndFlushTranslations();
  isInjecting = false;
  injectTranslateBtn.disabled = false;
  injectRawBtn.disabled = false;
}

function renderFeed() {
  chatFeedEl.innerHTML = '';

  if (!feedMessages.length) {
    chatFeedEl.appendChild(emptyStateEl);
    return;
  }

  for (const msg of feedMessages) {
    const card = document.createElement('article');
    card.className = `sp-msg ${msg.direction === 'outgoing' ? 'outgoing' : 'incoming'}`;

    const meta = document.createElement('div');
    meta.className = 'sp-msg-meta';

    const author = document.createElement('span');
    author.className = 'sp-msg-author';
    author.textContent = msg.author || 'Message';
    meta.appendChild(author);

    if (msg.timeLabel) {
      const time = document.createElement('span');
      time.className = 'sp-msg-time';
      time.textContent = msg.timeLabel;
      meta.appendChild(time);
    }

    const body = document.createElement('div');
    body.className = 'sp-msg-body';

    if (msg.translating) {
      body.classList.add('pending');
      body.textContent = 'Traduction…';
    } else {
      // Rendu compact : texte traduit uniquement (ou brut si identique/indisponible)
      body.textContent = msg.translatedText || msg.rawText || '';
    }

    card.appendChild(meta);
    card.appendChild(body);
    chatFeedEl.appendChild(card);
  }

  chatFeedEl.scrollTop = chatFeedEl.scrollHeight;
}

async function translateFeedItem(item, epochSnapshot) {
  if (!prefs || !item || !item.rawText) return;

  // Direction inversée pour le Fil Miroir : targetLang -> sourceLang
  const mirrorSource = prefs.targetLang;
  const mirrorTarget = prefs.sourceLang;
  const cacheKey = `${mirrorSource}::${mirrorTarget}::${item.fingerprint}`;

  if (translatedTextCache.has(cacheKey)) {
    item.translatedText = translatedTextCache.get(cacheKey);
    item.translating = false;
    renderFeed();
    return;
  }

  if (mirrorSource === mirrorTarget) {
    item.translatedText = item.rawText;
    item.translating = false;
    renderFeed();
    return;
  }

  item.translating = true;
  renderFeed();

  const res = await translateNative(item.rawText, mirrorSource, mirrorTarget, {
    epoch: epochSnapshot
  });

  if (res.cancelled || epochSnapshot !== getTranslationEpoch()) {
    return;
  }

  item.translating = false;
  item.translatedText = res.ok ? res.text : item.rawText;
  if (res.ok) {
    translatedTextCache.set(cacheKey, item.translatedText);
  }
  renderFeed();
}

function applyFeedBatch(rawBatch) {
  const epochSnapshot = getTranslationEpoch();
  const next = [];

  for (const raw of Array.isArray(rawBatch) ? rawBatch : []) {
    if (!raw || !raw.rawText) continue;
    const fp = raw.fingerprint || computeMessageFingerprint(raw);
    const candidate = { ...raw, fingerprint: fp };
    if (isDuplicateInBuffer(next, candidate)) continue;

    // Réutiliser l'état déjà traduit si le même message était présent
    const existing = feedMessages.find((m) => m.fingerprint === fp);
    if (existing && existing.translatedText && !existing.translating) {
      candidate.translatedText = existing.translatedText;
      candidate.translating = false;
    }
    next.push(candidate);
  }

  // Conserver uniquement les 5 derniers nœuds dans l'ordre naturel du DOM
  feedMessages = next.slice(-MAX_FEED_MESSAGES);
  renderFeed();

  for (const msg of feedMessages) {
    if (!msg.translatedText && !msg.translating) {
      void translateFeedItem(msg, epochSnapshot);
    }
  }
}

function resetFeed(nextMessages = []) {
  flushTranslationState();
  feedMessages = [];
  if (Array.isArray(nextMessages) && nextMessages.length > 0) {
    applyFeedBatch(nextMessages);
  } else {
    renderFeed();
  }
}

async function sendToRuntime(payload) {
  if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
    return chrome.runtime.sendMessage(payload);
  }
  return null;
}

async function handleInject({ translate }) {
  if (isInjecting) return;
  const rawDraft = draftInputEl.value.trim();
  if (!rawDraft) return;

  hideFallbackBanner();
  isInjecting = true;
  injectTranslateBtn.disabled = true;
  injectRawBtn.disabled = true;

  const epochSnapshot = getTranslationEpoch();
  let textToInject = rawDraft;

  try {
    if (translate && prefs && prefs.sourceLang !== prefs.targetLang) {
      const res = await translateNative(rawDraft, prefs.sourceLang, prefs.targetLang, {
        epoch: epochSnapshot
      });
      if (res.cancelled) {
        return;
      }
      if (!res.ok) {
        showFallbackBanner(
          res.error || 'Traduction native indisponible. Vous pouvez copier le brouillon.',
          rawDraft
        );
        return;
      }
      textToInject = res.text;
    }

    const injectRes = await sendToRuntime({
      type: MSG_TYPES.INJECT_TEXT,
      text: textToInject,
      autoEnter: Boolean(prefs?.autoEnter)
    });

    if (injectRes?.ok) {
      draftInputEl.value = '';
      hideFallbackBanner();
    } else {
      showFallbackBanner(
        'Injection impossible sur cet onglet. Copiez le texte traduit :',
        textToInject
      );
    }
  } finally {
    isInjecting = false;
    injectTranslateBtn.disabled = false;
    injectRawBtn.disabled = false;
  }
}

async function toggleMicrophone() {
  hideFallbackBanner();

  if (!hasExtensionRuntime()) {
    if (fallbackSpeechController.getState() === 'idle') {
      speechBaseText = draftInputEl.value.trim();
      speechCommittedText = '';
    }
    fallbackSpeechController.toggle(prefs?.sttLocale || 'fr-FR', prefs?.micDeviceId || '');
    return;
  }

  if (speechState === 'listening' || speechState === 'starting') {
    await sendToRuntime({ type: MSG_TYPES.STT_STOP });
    return;
  }

  speechBaseText = draftInputEl.value.trim();
  speechCommittedText = '';
  applySpeechState('starting');

  try {
    const res = await sendToRuntime({
      type: MSG_TYPES.STT_START,
      providerId: prefs?.sttProvider || 'chatgpt',
      lang: prefs?.sttLocale || 'fr-FR',
      deviceId: prefs?.micDeviceId || ''
    });
    if (res && res.ok === false) {
      applySpeechError({
        message: res.error || 'Impossible de démarrer le relais STT.',
        providerId: prefs?.sttProvider || 'chatgpt',
        needsLogin: true
      });
    }
  } catch (err) {
    applySpeechError({ message: err?.message || 'Erreur démarrage relais STT.' });
  }
}

async function initSidePanel() {
  prefs = await loadPrefs();
  applyTheme(prefs.theme);
  updateHeaderPair();

  if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((message) => {
      if (!message || typeof message !== 'object') return;

      const isSttSource =
        message.source === 'relay' ||
        message.source === 'offscreen' ||
        message.source === 'background';

      if (message.type === MSG_TYPES.FEED_BATCH) {
        applyFeedBatch(message.messages);
      } else if (message.type === MSG_TYPES.RESET_FEED) {
        resetFeed(message.messages || []);
      } else if (message.type === MSG_TYPES.STT_STATE && isSttSource) {
        applySpeechState(message.state);
      } else if (message.type === MSG_TYPES.STT_TRANSCRIPT && isSttSource) {
        applySpeechTranscript({
          finalText: message.finalText || '',
          interimText: message.interimText || ''
        });
      } else if (message.type === MSG_TYPES.STT_ERROR && isSttSource) {
        applySpeechError(message.error);
      } else if (message.type === MSG_TYPES.PREFS_UPDATED && message.prefs) {
        const pairChanged =
          prefs?.sourceLang !== message.prefs.sourceLang ||
          prefs?.targetLang !== message.prefs.targetLang;
        prefs = message.prefs;
        applyTheme(prefs.theme);
        updateHeaderPair();
        if (pairChanged) {
          translatedTextCache.clear();
          flushTranslationState();
          const currentRaw = feedMessages.map(({ author, rawText, timeLabel, direction, id, fingerprint }) => ({
            author,
            rawText,
            timeLabel,
            direction,
            id,
            fingerprint
          }));
          feedMessages = [];
          applyFeedBatch(currentRaw);
        }
      }
    });
  }

  try {
    const state = await sendToRuntime({ type: MSG_TYPES.GET_STATE });
    if (state?.prefs) {
      prefs = state.prefs;
      applyTheme(prefs.theme);
      updateHeaderPair();
    }
    if (Array.isArray(state?.messages)) {
      applyFeedBatch(state.messages);
    }
  } catch {
    renderFeed();
  }
}

themeToggleBtn.addEventListener('click', async () => {
  const idx = THEME_MODES.indexOf(prefs?.theme || 'auto');
  const nextTheme = THEME_MODES[(idx + 1) % THEME_MODES.length];
  prefs = await savePrefs({ theme: nextTheme });
  applyTheme(nextTheme);
  await sendToRuntime({ type: MSG_TYPES.PREFS_UPDATED, prefs });
});

openOptionsBtn.addEventListener('click', async () => {
  await sendToRuntime({ type: MSG_TYPES.OPEN_OPTIONS });
});

autoEnterToggle.addEventListener('change', async () => {
  prefs = await savePrefs({ autoEnter: autoEnterToggle.checked });
  await sendToRuntime({ type: MSG_TYPES.PREFS_UPDATED, prefs });
});

injectTranslateBtn.addEventListener('click', () => void handleInject({ translate: true }));
injectRawBtn.addEventListener('click', () => void handleInject({ translate: false }));
micBtn.addEventListener('click', () => void toggleMicrophone());

fallbackLoginBtn.addEventListener('click', async () => {
  if (lastErrorNeedsPermissionTab) {
    await sendToRuntime({ type: MSG_TYPES.OPEN_OPTIONS });
  } else {
    await sendToRuntime({
      type: MSG_TYPES.STT_OPEN_LOGIN,
      providerId: lastFailedProviderId || prefs?.sttProvider || 'chatgpt'
    });
  }
  hideFallbackBanner();
});

fallbackCopyBtn.addEventListener('click', async () => {
  if (!lastFailedText) return;
  try {
    await navigator.clipboard.writeText(lastFailedText);
    fallbackCopyBtn.textContent = '✓ Copié';
    setTimeout(() => {
      fallbackCopyBtn.textContent = '📋 Copier';
    }, 1400);
  } catch {
    // Ignorer
  }
});

draftInputEl.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault();
    void handleInject({ translate: true });
  }
});

globalThis.addEventListener('beforeunload', () => {
  if (hasExtensionRuntime()) {
    sendToRuntime({ type: MSG_TYPES.STT_STOP }).catch(() => {});
  } else {
    fallbackSpeechController.stop();
  }
});

void initSidePanel();
