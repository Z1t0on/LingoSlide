/**
 * LingoSlide V2.1 Native Edition — Service Worker (Orchestration & Routage)
 * - Fil Miroir pure FIFO max 5 messages, dédoublonnage strict, purge sur navigation/F5.
 * - Orchestration STT Relais Vocal par Session Web (ChatGPT / Gemini / Mistral) + Offscreen Blob.
 */

import {
  MAX_FEED_MESSAGES,
  MSG_TYPES,
  computeMessageFingerprint
} from '../shared/constants.js';
import { getProviderConfig } from '../shared/providers.config.js';
import { loadPrefs, savePrefs } from '../shared/storage-schema.js';

const tabFeedBuffers = new Map();
const OFFSCREEN_URL = new URL('../offscreen/offscreen.html', import.meta.url).href;
let creatingOffscreenPromise = null;
let activeRelaySession = null; // { tabId, providerId }

function getManifestBasePrefix() {
  try {
    const manifest = chrome.runtime.getManifest();
    const scriptPath = manifest?.content_scripts?.[0]?.js?.[0] || '';
    return scriptPath.startsWith('extension/') ? 'extension/' : '';
  } catch {
    return 'extension/';
  }
}

async function hasOffscreenDocument() {
  if (typeof chrome.runtime?.getContexts === 'function') {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [OFFSCREEN_URL]
    });
    return contexts.length > 0;
  }
  if (typeof chrome.offscreen?.hasDocument === 'function') {
    return chrome.offscreen.hasDocument();
  }
  return false;
}

async function ensureOffscreenDocument() {
  if (!chrome.offscreen?.createDocument) {
    throw new Error('API chrome.offscreen indisponible dans ce navigateur.');
  }

  if (await hasOffscreenDocument()) {
    return;
  }

  if (creatingOffscreenPromise) {
    await creatingOffscreenPromise;
    return;
  }

  creatingOffscreenPromise = chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: ['USER_MEDIA'],
    justification: 'Capture audio micro (Blob) pour le module STT Relais Vocal LingoSlide.'
  });

  try {
    await creatingOffscreenPromise;
  } finally {
    creatingOffscreenPromise = null;
  }
}

if (chrome.sidePanel?.setPanelBehavior) {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
}

function broadcastToExtensionViews(payload) {
  try {
    const maybePromise = chrome.runtime.sendMessage(payload);
    if (maybePromise && typeof maybePromise.catch === 'function') {
      maybePromise.catch(() => {});
    }
  } catch {
    // Aucun panneau latéral ouvert actuellement
  }
}

function normalizeAndTrimBuffer(messages) {
  const deduped = [];
  const seen = new Set();

  for (const msg of Array.isArray(messages) ? messages : []) {
    if (!msg || !msg.rawText) continue;
    const fp = msg.fingerprint || computeMessageFingerprint(msg);
    if (seen.has(fp)) continue;
    seen.add(fp);
    deduped.push({ ...msg, fingerprint: fp });
  }

  while (deduped.length > MAX_FEED_MESSAGES) {
    deduped.shift();
  }
  return deduped;
}

function pushFeedMessage(tabId, message) {
  if (!tabId || !message || !message.rawText) return [];
  const current = tabFeedBuffers.get(tabId) || [];
  const fp = message.fingerprint || computeMessageFingerprint(message);
  if (current.some((m) => m.fingerprint === fp || (message.id && m.id === message.id))) {
    return current;
  }

  const next = [...current, { ...message, fingerprint: fp }];
  while (next.length > MAX_FEED_MESSAGES) {
    next.shift();
  }
  tabFeedBuffers.set(tabId, next);
  return next;
}

async function getActiveTabId() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return tab?.id ?? null;
  } catch {
    return null;
  }
}

function waitForTabComplete(tabId, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      chrome.tabs.onUpdated.removeListener(onUpdated);
      reject(new Error('Délai de chargement de la page relais dépassé.'));
    }, timeoutMs);

    const onUpdated = (updatedTabId, changeInfo, tab) => {
      if (updatedTabId !== tabId) return;
      if (changeInfo.status === 'complete') {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(onUpdated);
        resolve(tab);
      }
    };

    chrome.tabs.onUpdated.addListener(onUpdated);

    chrome.tabs
      .get(tabId)
      .then((tab) => {
        if (!settled && tab?.status === 'complete') {
          settled = true;
          clearTimeout(timer);
          chrome.tabs.onUpdated.removeListener(onUpdated);
          resolve(tab);
        }
      })
      .catch(() => {});
  });
}

/**
 * Réutilise un onglet ouvert correspondant au fournisseur, sinon en ouvre un discrètement (active: false).
 */
export async function findOrCreateRelayTab(providerConfig) {
  const existingTabs = await chrome.tabs.query({ url: providerConfig.matchPatterns });
  if (existingTabs.length > 0) {
    const tab = existingTabs[0];
    if (tab.status !== 'complete') {
      await waitForTabComplete(tab.id, providerConfig.timeouts?.tabLoadMs || 15000).catch(() => {});
    }
    return tab;
  }

  const created = await chrome.tabs.create({
    url: providerConfig.targetUrl,
    active: false
  });
  await waitForTabComplete(created.id, providerConfig.timeouts?.tabLoadMs || 15000);
  // Laisser une courte pause pour l'hydratation SPA du fournisseur
  await new Promise((resolve) => setTimeout(resolve, 600));
  return created;
}

/**
 * Vérifie que l'agent relais est monté dans l'onglet, sinon l'injecte via chrome.scripting.
 */
export async function ensureRelayContentScript(tabId) {
  try {
    const ping = await chrome.tabs.sendMessage(tabId, { type: MSG_TYPES.RELAY_PING });
    if (ping?.ok) return;
  } catch {
    // Pas encore injecté (onglet déjà ouvert avant rechargement de l'extension)
  }

  if (!chrome.scripting?.executeScript) {
    throw new Error('Permission scripting indisponible pour injecter l’agent relais.');
  }

  const basePrefix = getManifestBasePrefix();
  await chrome.scripting.executeScript({
    target: { tabId },
    files: [`${basePrefix}content/relay-stt-agent.js`]
  });
}

async function stopOffscreenCapture(emitBlob = false) {
  try {
    if (await hasOffscreenDocument()) {
      return await chrome.runtime.sendMessage({
        type: MSG_TYPES.OFFSCREEN_AUDIO_STOP,
        target: 'offscreen',
        emitBlob
      });
    }
  } catch {
    // Ignorer
  }
  return { ok: true, emitted: false };
}

function emitSessionError({ code, message, providerConfig, needsLogin = false, needsPermissionTab = false }) {
  broadcastToExtensionViews({
    type: MSG_TYPES.STT_ERROR,
    source: 'background',
    error: {
      code,
      message,
      providerId: providerConfig.id,
      loginUrl: providerConfig.targetUrl,
      needsLogin,
      needsPermissionTab
    }
  });
  broadcastToExtensionViews({
    type: MSG_TYPES.STT_STATE,
    source: 'background',
    providerId: providerConfig.id,
    state: 'idle'
  });
}

/**
 * Démarre une session de dictée via l'onglet relais du fournisseur + capture audio Offscreen.
 */
export async function startRelaySttSession({ providerId, lang, deviceId } = {}) {
  const prefs = await loadPrefs();
  const providerConfig = getProviderConfig(providerId || prefs.sttProvider);

  broadcastToExtensionViews({
    type: MSG_TYPES.STT_STATE,
    source: 'background',
    providerId: providerConfig.id,
    state: 'starting'
  });

  // 1. Démarrer la capture audio Blob dans le document Offscreen
  try {
    await ensureOffscreenDocument();
    const audioRes = await chrome.runtime.sendMessage({
      type: MSG_TYPES.OFFSCREEN_AUDIO_START,
      target: 'offscreen',
      deviceId: deviceId ?? prefs.micDeviceId ?? ''
    });
    if (audioRes && audioRes.ok === false) {
      emitSessionError({
        code: audioRes.code || 'MIC_PERMISSION_DENIED',
        message: audioRes.error || 'Permission microphone requise dans les Options.',
        providerConfig,
        needsPermissionTab: Boolean(audioRes.needsPermissionTab)
      });
      return { ok: false, error: audioRes.error };
    }
  } catch (err) {
    emitSessionError({
      code: 'OFFSCREEN_AUDIO_FAILED',
      message: err?.message || 'Capture audio Offscreen impossible.',
      providerConfig,
      needsPermissionTab: true
    });
    return { ok: false, error: err?.message };
  }

  // 2. Résoudre ou ouvrir l'onglet relais en arrière-plan (active: false)
  let relayTab;
  try {
    relayTab = await findOrCreateRelayTab(providerConfig);
    await ensureRelayContentScript(relayTab.id);
  } catch (err) {
    await stopOffscreenCapture(false);
    emitSessionError({
      code: 'RELAY_TAB_UNREACHABLE',
      message: `Impossible d'ouvrir ou de joindre ${providerConfig.label} (${err?.message || ''}).`,
      providerConfig,
      needsLogin: true
    });
    return { ok: false, error: err?.message };
  }

  // 3. Vérifier l'état de session sur la page relais
  let sessionCheck;
  try {
    sessionCheck = await chrome.tabs.sendMessage(relayTab.id, {
      type: MSG_TYPES.RELAY_SESSION_CHECK,
      providerId: providerConfig.id
    });
  } catch {
    sessionCheck = { ok: false, reason: 'UI_NOT_READY' };
  }

  if (!sessionCheck?.ok) {
    await stopOffscreenCapture(false);
    const expired = sessionCheck?.reason === 'SESSION_EXPIRED';
    emitSessionError({
      code: sessionCheck?.reason || 'SESSION_EXPIRED',
      message: expired
        ? `Session ${providerConfig.label} expirée ou déconnectée.`
        : `${providerConfig.label} n'est pas prêt (connexion ou captcha requis).`,
      providerConfig,
      needsLogin: true
    });
    return { ok: false, reason: sessionCheck?.reason };
  }

  // 4. Démarrer la dictée sur la page relais
  try {
    const startRes = await chrome.tabs.sendMessage(relayTab.id, {
      type: MSG_TYPES.RELAY_START_DICTATION,
      providerId: providerConfig.id,
      lang: lang || prefs.sttLocale || 'fr-FR'
    });

    if (!startRes?.ok) {
      await stopOffscreenCapture(false);
      emitSessionError({
        code: startRes?.reason || 'MIC_CONTROL_UNAVAILABLE',
        message: `Contrôle vocal indisponible sur ${providerConfig.label}.`,
        providerConfig,
        needsLogin: true
      });
      return { ok: false, reason: startRes?.reason };
    }

    activeRelaySession = {
      tabId: relayTab.id,
      providerId: providerConfig.id
    };
    return { ok: true, tabId: relayTab.id, mode: startRes.mode };
  } catch (err) {
    await stopOffscreenCapture(false);
    emitSessionError({
      code: 'RELAY_START_FAILED',
      message: err?.message || `Échec démarrage dictée sur ${providerConfig.label}.`,
      providerConfig,
      needsLogin: true
    });
    return { ok: false, error: err?.message };
  }
}

/**
 * Arrête la session STT relais, rapatrie le texte final et vide le champ relais.
 */
export async function stopRelaySttSession() {
  const session = activeRelaySession;
  activeRelaySession = null;

  await stopOffscreenCapture(false);

  if (session?.tabId) {
    try {
      await chrome.tabs.sendMessage(session.tabId, {
        type: MSG_TYPES.RELAY_STOP_DICTATION,
        providerId: session.providerId,
        clearAfterRead: true
      });
    } catch {
      // L'onglet relais a pu être fermé entre-temps
    }
  }

  broadcastToExtensionViews({
    type: MSG_TYPES.STT_STATE,
    source: 'background',
    providerId: session?.providerId || null,
    state: 'idle'
  });

  return { ok: true };
}

/**
 * Met au premier plan un onglet existant du fournisseur ou en ouvre un pour connexion.
 */
export async function focusOrOpenProviderLogin(providerId) {
  const prefs = await loadPrefs();
  const providerConfig = getProviderConfig(providerId || prefs.sttProvider);
  const existingTabs = await chrome.tabs.query({ url: providerConfig.matchPatterns });

  if (existingTabs.length > 0) {
    const tab = existingTabs[0];
    await chrome.tabs.update(tab.id, { active: true });
    if (typeof tab.windowId === 'number') {
      await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
    }
    return { ok: true, tabId: tab.id, reused: true };
  }

  const created = await chrome.tabs.create({
    url: providerConfig.targetUrl,
    active: true
  });
  return { ok: true, tabId: created.id, reused: false };
}

async function testRelaySession(providerId) {
  const prefs = await loadPrefs();
  const providerConfig = getProviderConfig(providerId || prefs.sttProvider);
  try {
    const tab = await findOrCreateRelayTab(providerConfig);
    await ensureRelayContentScript(tab.id);
    const check = await chrome.tabs.sendMessage(tab.id, {
      type: MSG_TYPES.RELAY_SESSION_CHECK,
      providerId: providerConfig.id
    });
    return {
      ok: Boolean(check?.ok),
      providerId: providerConfig.id,
      label: providerConfig.label,
      reason: check?.reason || (check?.ok ? 'READY' : 'SESSION_EXPIRED'),
      loginUrl: providerConfig.targetUrl
    };
  } catch (err) {
    return {
      ok: false,
      providerId: providerConfig.id,
      label: providerConfig.label,
      reason: err?.message || 'RELAY_TEST_FAILED',
      loginUrl: providerConfig.targetUrl
    };
  }
}

chrome.tabs.onActivated.addListener(({ tabId }) => {
  const messages = tabFeedBuffers.get(tabId) || [];
  broadcastToExtensionViews({
    type: MSG_TYPES.RESET_FEED,
    tabId,
    reason: 'TAB_SWITCH',
    messages
  });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading' || typeof changeInfo.url === 'string') {
    tabFeedBuffers.set(tabId, []);
    broadcastToExtensionViews({
      type: MSG_TYPES.RESET_FEED,
      tabId,
      reason: 'TAB_RELOAD_OR_NAV',
      messages: []
    });
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  tabFeedBuffers.delete(tabId);
  if (activeRelaySession?.tabId === tabId) {
    activeRelaySession = null;
    void stopOffscreenCapture(false);
    broadcastToExtensionViews({
      type: MSG_TYPES.STT_STATE,
      source: 'background',
      state: 'idle'
    });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== 'object') return false;

  const senderTabId = sender?.tab?.id ?? message.tabId ?? null;

  if (message.type === MSG_TYPES.FEED_BATCH) {
    if (senderTabId !== null) {
      const normalized = normalizeAndTrimBuffer(message.messages);
      tabFeedBuffers.set(senderTabId, normalized);
      broadcastToExtensionViews({
        type: MSG_TYPES.FEED_BATCH,
        tabId: senderTabId,
        messages: normalized
      });
    }
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === MSG_TYPES.FEED_MESSAGE) {
    if (senderTabId !== null) {
      const updated = pushFeedMessage(senderTabId, message.message);
      broadcastToExtensionViews({
        type: MSG_TYPES.FEED_BATCH,
        tabId: senderTabId,
        messages: updated
      });
    }
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === MSG_TYPES.RESET_FEED) {
    if (senderTabId !== null) {
      tabFeedBuffers.set(senderTabId, []);
    }
    broadcastToExtensionViews({
      type: MSG_TYPES.RESET_FEED,
      tabId: senderTabId,
      reason: message.reason || 'RESET',
      messages: []
    });
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === MSG_TYPES.GET_STATE) {
    (async () => {
      const activeTabId = await getActiveTabId();
      const prefs = await loadPrefs();
      const messages = activeTabId !== null ? tabFeedBuffers.get(activeTabId) || [] : [];

      if (activeTabId !== null) {
        try {
          await chrome.tabs.sendMessage(activeTabId, { type: MSG_TYPES.PING });
        } catch {
          // Onglet système ou exclu (ex. docs.google.com)
        }
      }

      sendResponse({ ok: true, tabId: activeTabId, prefs, messages });
    })();
    return true;
  }

  if (message.type === MSG_TYPES.INJECT_TEXT) {
    (async () => {
      const targetTabId = message.tabId ?? (await getActiveTabId());
      if (targetTabId === null) {
        sendResponse({ ok: false, reason: 'NO_ACTIVE_TAB' });
        return;
      }

      try {
        const result = await chrome.tabs.sendMessage(targetTabId, {
          type: MSG_TYPES.INJECT_TEXT,
          text: message.text,
          autoEnter: Boolean(message.autoEnter)
        });
        sendResponse(result || { ok: false, reason: 'NO_RESPONSE' });
      } catch (err) {
        sendResponse({
          ok: false,
          reason: err?.message || 'CONTENT_UNREACHABLE'
        });
      }
    })();
    return true;
  }

  if (message.type === MSG_TYPES.OPEN_OPTIONS) {
    (async () => {
      try {
        if (chrome.runtime.openOptionsPage) {
          await chrome.runtime.openOptionsPage();
        } else {
          const url = new URL('../options/options.html', import.meta.url).href;
          await chrome.tabs.create({ url });
        }
        sendResponse({ ok: true });
      } catch {
        const url = new URL('../options/options.html', import.meta.url).href;
        chrome.tabs?.create?.({ url });
        sendResponse({ ok: true });
      }
    })();
    return true;
  }

  if (message.type === MSG_TYPES.PREFS_UPDATED) {
    (async () => {
      const next = message.prefs ? await savePrefs(message.prefs) : await loadPrefs();
      broadcastToExtensionViews({
        type: MSG_TYPES.PREFS_UPDATED,
        prefs: next
      });
      sendResponse({ ok: true, prefs: next });
    })();
    return true;
  }

  if (message.type === MSG_TYPES.STT_START && message.target !== 'offscreen') {
    startRelaySttSession({
      providerId: message.providerId,
      lang: message.lang,
      deviceId: message.deviceId
    })
      .then((res) => sendResponse(res))
      .catch((err) => sendResponse({ ok: false, error: err?.message || 'STT_START_ERROR' }));
    return true;
  }

  if (message.type === MSG_TYPES.STT_STOP && message.target !== 'offscreen') {
    stopRelaySttSession()
      .then((res) => sendResponse(res))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message.type === MSG_TYPES.STT_OPEN_LOGIN) {
    focusOrOpenProviderLogin(message.providerId)
      .then((res) => sendResponse(res))
      .catch((err) => sendResponse({ ok: false, error: err?.message }));
    return true;
  }

  if (message.type === MSG_TYPES.STT_TEST_SESSION) {
    testRelaySession(message.providerId)
      .then((res) => sendResponse(res))
      .catch((err) => sendResponse({ ok: false, reason: err?.message }));
    return true;
  }

  return false;
});
