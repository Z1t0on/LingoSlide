/**
 * LingoSlide V2.1 Native Edition — Contrôleur des Options & Diagnostic
 */

import { MSG_TYPES, SUPPORTED_LANGUAGES } from '../shared/constants.js';
import { STT_PROVIDERS } from '../shared/providers.config.js';
import { loadPrefs, savePrefs } from '../shared/storage-schema.js';
import {
  checkPairAvailability,
  detectNativeTranslatorSupport,
  translateNative
} from '../shared/native-translator.js';

const sourceLangSelect = document.getElementById('source-lang-select');
const targetLangSelect = document.getElementById('target-lang-select');
const themeSelect = document.getElementById('theme-select');
const autoEnterCheckbox = document.getElementById('auto-enter-checkbox');
const sttProviderSelect = document.getElementById('stt-provider-select');
const sttLocaleSelect = document.getElementById('stt-locale-select');
const micDeviceSelect = document.getElementById('mic-device-select');
const testRelayBtn = document.getElementById('test-relay-btn');
const openRelayLoginBtn = document.getElementById('open-relay-login-btn');
const relaySessionStatus = document.getElementById('relay-session-status');
const requestMicBtn = document.getElementById('request-mic-btn');
const testMicBtn = document.getElementById('test-mic-btn');
const micMeterFill = document.getElementById('mic-meter-fill');
const micFeedback = document.getElementById('mic-feedback');
const diagOutPair = document.getElementById('diag-out-pair');
const diagOutStatus = document.getElementById('diag-out-status');
const diagInPair = document.getElementById('diag-in-pair');
const diagInStatus = document.getElementById('diag-in-status');
const recheckWicgBtn = document.getElementById('recheck-wicg-btn');
const warmupWicgBtn = document.getElementById('warmup-wicg-btn');
const saveStatusEl = document.getElementById('save-status');

let prefs = null;
let micTestStream = null;
let micTestCtx = null;
let micTestRaf = null;

function populateLanguageSelects() {
  for (const provider of Object.values(STT_PROVIDERS)) {
    const optProvider = document.createElement('option');
    optProvider.value = provider.id;
    optProvider.textContent = `${provider.label} (${provider.domainLabel})`;
    sttProviderSelect.appendChild(optProvider);
  }

  for (const lang of SUPPORTED_LANGUAGES) {
    const optSource = document.createElement('option');
    optSource.value = lang.code;
    optSource.textContent = `${lang.label} (${lang.code})`;
    sourceLangSelect.appendChild(optSource);

    const optTarget = document.createElement('option');
    optTarget.value = lang.code;
    optTarget.textContent = `${lang.label} (${lang.code})`;
    targetLangSelect.appendChild(optTarget);

    const optStt = document.createElement('option');
    optStt.value = lang.sttLocale;
    optStt.textContent = `${lang.label} — ${lang.sttLocale}`;
    sttLocaleSelect.appendChild(optStt);
  }
}

function showSavedFeedback() {
  saveStatusEl.textContent = 'Enregistré';
  setTimeout(() => {
    saveStatusEl.textContent = '';
  }, 1500);
}

function formatAvailabilityLabel(result) {
  if (!result) return { text: 'Inconnu', cls: 'err' };
  if (result.status === 'unsupported') {
    return { text: 'API WICG absente (Chrome 138+ requis)', cls: 'err' };
  }
  if (result.status === 'available' || result.status === 'readily') {
    return { text: 'Prêt hors-ligne (available)', cls: 'ok' };
  }
  if (result.status === 'downloadable' || result.status === 'after-download') {
    return { text: 'Téléchargeable (downloadable)', cls: 'warn' };
  }
  if (result.status === 'identical') {
    return { text: 'Langues identiques', cls: 'warn' };
  }
  return { text: result.status || 'Indisponible', cls: 'err' };
}

async function refreshDiagnostics() {
  if (!prefs) return;
  diagOutPair.textContent = `${prefs.sourceLang.toUpperCase()} → ${prefs.targetLang.toUpperCase()}`;
  diagInPair.textContent = `${prefs.targetLang.toUpperCase()} → ${prefs.sourceLang.toUpperCase()}`;

  const [outRes, inRes] = await Promise.all([
    checkPairAvailability(prefs.sourceLang, prefs.targetLang),
    checkPairAvailability(prefs.targetLang, prefs.sourceLang)
  ]);

  const outFmt = formatAvailabilityLabel(outRes);
  diagOutStatus.textContent = outFmt.text;
  diagOutStatus.className = `opt-diag-value ${outFmt.cls}`;

  const inFmt = formatAvailabilityLabel(inRes);
  diagInStatus.textContent = inFmt.text;
  diagInStatus.className = `opt-diag-value ${inFmt.cls}`;
}

async function persistAndNotify(partial) {
  prefs = await savePrefs(partial);
  document.documentElement.setAttribute('data-theme', prefs.theme);
  sourceLangSelect.value = prefs.sourceLang;
  targetLangSelect.value = prefs.targetLang;
  themeSelect.value = prefs.theme;
  autoEnterCheckbox.checked = Boolean(prefs.autoEnter);
  sttProviderSelect.value = prefs.sttProvider;
  sttLocaleSelect.value = prefs.sttLocale;

  showSavedFeedback();
  await refreshDiagnostics();

  if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
    chrome.runtime
      .sendMessage({ type: MSG_TYPES.PREFS_UPDATED, prefs })
      .catch(() => {});
  }
}

async function enumerateMicrophones() {
  if (!navigator.mediaDevices?.enumerateDevices) {
    micFeedback.textContent = 'Énumération audio non supportée par ce navigateur.';
    return;
  }

  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const audioInputs = devices.filter((d) => d.kind === 'audioinput');
    micDeviceSelect.innerHTML = '<option value="">Périphérique système par défaut</option>';

    audioInputs.forEach((dev, idx) => {
      const opt = document.createElement('option');
      opt.value = dev.deviceId;
      opt.textContent = dev.label || `Microphone ${idx + 1}`;
      micDeviceSelect.appendChild(opt);
    });

    if (prefs?.micDeviceId) {
      micDeviceSelect.value = prefs.micDeviceId;
    }

    micFeedback.textContent = `${audioInputs.length} entrée(s) audio détectée(s).`;
  } catch (err) {
    micFeedback.textContent = err?.message || 'Impossible de lister les microphones.';
  }
}

function stopMicTest() {
  if (micTestRaf) {
    cancelAnimationFrame(micTestRaf);
    micTestRaf = null;
  }
  if (micTestStream) {
    micTestStream.getTracks().forEach((t) => t.stop());
    micTestStream = null;
  }
  if (micTestCtx) {
    micTestCtx.close().catch(() => {});
    micTestCtx = null;
  }
  micMeterFill.style.width = '0%';
  testMicBtn.textContent = 'Tester le niveau micro';
}

async function toggleMicTest() {
  if (micTestStream) {
    stopMicTest();
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    micFeedback.textContent = 'getUserMedia indisponible.';
    return;
  }

  try {
    const constraints = prefs?.micDeviceId
      ? { audio: { deviceId: { exact: prefs.micDeviceId } } }
      : { audio: true };
    micTestStream = await navigator.mediaDevices.getUserMedia(constraints);
    const AudioCtx = globalThis.AudioContext || globalThis.webkitAudioContext;
    micTestCtx = new AudioCtx();
    const source = micTestCtx.createMediaStreamSource(micTestStream);
    const analyser = micTestCtx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);

    const data = new Uint8Array(analyser.frequencyBinCount);
    testMicBtn.textContent = 'Arrêter le test micro';
    micFeedback.textContent = 'Capture audio active — parlez dans votre microphone.';

    const tick = () => {
      if (!micTestStream) return;
      analyser.getByteTimeDomainData(data);
      let peak = 0;
      for (let i = 0; i < data.length; i += 1) {
        const v = Math.abs(data[i] - 128) / 128;
        if (v > peak) peak = v;
      }
      const pct = Math.min(100, Math.round(peak * 220));
      micMeterFill.style.width = `${pct}%`;
      micTestRaf = requestAnimationFrame(tick);
    };
    tick();
  } catch (err) {
    micFeedback.textContent = `Accès micro refusé ou indisponible : ${err?.message || ''}`;
    stopMicTest();
  }
}

async function initOptions() {
  populateLanguageSelects();
  prefs = await loadPrefs();

  document.documentElement.setAttribute('data-theme', prefs.theme);
  sourceLangSelect.value = prefs.sourceLang;
  targetLangSelect.value = prefs.targetLang;
  themeSelect.value = prefs.theme;
  autoEnterCheckbox.checked = Boolean(prefs.autoEnter);
  sttProviderSelect.value = prefs.sttProvider;
  sttLocaleSelect.value = prefs.sttLocale;

  await Promise.all([refreshDiagnostics(), enumerateMicrophones()]);
}

sourceLangSelect.addEventListener('change', () => {
  const nextSource = sourceLangSelect.value;
  const matched = SUPPORTED_LANGUAGES.find((l) => l.code === nextSource);
  void persistAndNotify({
    sourceLang: nextSource,
    sttLocale: matched?.sttLocale || prefs.sttLocale
  });
});

targetLangSelect.addEventListener('change', () => {
  void persistAndNotify({ targetLang: targetLangSelect.value });
});

themeSelect.addEventListener('change', () => {
  void persistAndNotify({ theme: themeSelect.value });
});

autoEnterCheckbox.addEventListener('change', () => {
  void persistAndNotify({ autoEnter: autoEnterCheckbox.checked });
});

sttProviderSelect.addEventListener('change', () => {
  relaySessionStatus.textContent = '';
  void persistAndNotify({ sttProvider: sttProviderSelect.value });
});

sttLocaleSelect.addEventListener('change', () => {
  void persistAndNotify({ sttLocale: sttLocaleSelect.value });
});

micDeviceSelect.addEventListener('change', () => {
  const selectedOpt = micDeviceSelect.selectedOptions?.[0];
  void persistAndNotify({
    micDeviceId: micDeviceSelect.value,
    micLabel: selectedOpt?.textContent || ''
  });
});

testRelayBtn.addEventListener('click', async () => {
  if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
    relaySessionStatus.textContent = 'Test disponible uniquement en mode extension MV3.';
    return;
  }
  relaySessionStatus.textContent = 'Vérification de la session…';
  try {
    const res = await chrome.runtime.sendMessage({
      type: MSG_TYPES.STT_TEST_SESSION,
      providerId: prefs?.sttProvider || sttProviderSelect.value
    });
    if (res?.ok) {
      relaySessionStatus.textContent = `Session ${res.label} active et prête.`;
    } else {
      relaySessionStatus.textContent = `Session non prête (${res?.reason || 'SESSION_EXPIRED'}).`;
    }
  } catch (err) {
    relaySessionStatus.textContent = err?.message || 'Erreur lors du test de session.';
  }
});

openRelayLoginBtn.addEventListener('click', async () => {
  const providerId = prefs?.sttProvider || sttProviderSelect.value;
  if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
    await chrome.runtime.sendMessage({
      type: MSG_TYPES.STT_OPEN_LOGIN,
      providerId
    });
  } else {
    const cfg = STT_PROVIDERS[providerId];
    if (cfg?.targetUrl) {
      globalThis.location.href = cfg.targetUrl;
    }
  }
});

recheckWicgBtn.addEventListener('click', () => void refreshDiagnostics());

warmupWicgBtn.addEventListener('click', async () => {
  const support = detectNativeTranslatorSupport();
  if (!support.supported) {
    await refreshDiagnostics();
    return;
  }
  diagOutStatus.textContent = 'Préchargement…';
  diagInStatus.textContent = 'Préchargement…';
  await Promise.all([
    translateNative('Bonjour', prefs.sourceLang, prefs.targetLang),
    translateNative('Hello', prefs.targetLang, prefs.sourceLang)
  ]);
  await refreshDiagnostics();
});

requestMicBtn.addEventListener('click', async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    await enumerateMicrophones();
  } catch (err) {
    micFeedback.textContent = `Autorisation micro requise : ${err?.message || ''}`;
  }
});

testMicBtn.addEventListener('click', () => void toggleMicTest());

window.addEventListener('beforeunload', stopMicTest);

void initOptions();
