/**
 * LingoSlide V2.1 Native Edition — Offscreen Document Audio Capture (Blob)
 * Ouvre et maintient le flux getUserMedia({ audio }) + MediaRecorder sur l'origine
 * de l'extension et émet un Blob audio (Base64) lorsque le relais web en a besoin.
 */

import { MSG_TYPES } from '../shared/constants.js';

let activeStream = null;
let mediaRecorder = null;
let recordedChunks = [];
let activeMimeType = 'audio/webm';

function sendToExtension(payload) {
  try {
    const maybePromise = chrome.runtime.sendMessage({
      ...payload,
      source: 'offscreen'
    });
    if (maybePromise && typeof maybePromise.catch === 'function') {
      maybePromise.catch(() => {});
    }
  } catch {
    // Contexte fermé
  }
}

function releaseAudioResources() {
  if (activeStream) {
    try {
      activeStream.getTracks().forEach((track) => track.stop());
    } catch {
      // Ignorer
    }
    activeStream = null;
  }
  mediaRecorder = null;
  recordedChunks = [];
}

function pickSupportedMimeType(preferred) {
  if (typeof MediaRecorder === 'undefined') return '';
  const candidates = [
    preferred,
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus'
  ].filter(Boolean);

  for (const mime of candidates) {
    if (MediaRecorder.isTypeSupported?.(mime)) {
      return mime;
    }
  }
  return '';
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const commaIdx = result.indexOf(',');
      resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
    };
    reader.onerror = () => reject(reader.error || new Error('Conversion Blob échouée'));
    reader.readAsDataURL(blob);
  });
}

async function openAudioStream(deviceId) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('getUserMedia indisponible dans le document Offscreen.');
  }

  if (deviceId) {
    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: { exact: deviceId } }
      });
    } catch {
      // Fallback sur le micro système par défaut
    }
  }

  return navigator.mediaDevices.getUserMedia({ audio: true });
}

export async function startBlobCapture(deviceId = '', preferredMimeType = 'audio/webm;codecs=opus') {
  releaseAudioResources();

  activeStream = await openAudioStream(deviceId);
  recordedChunks = [];

  if (typeof MediaRecorder !== 'undefined') {
    const chosenMime = pickSupportedMimeType(preferredMimeType);
    activeMimeType = chosenMime || 'audio/webm';
    mediaRecorder = chosenMime
      ? new MediaRecorder(activeStream, { mimeType: chosenMime })
      : new MediaRecorder(activeStream);

    mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        recordedChunks.push(event.data);
      }
    };

    mediaRecorder.start(250);
  }

  return { ok: true, mimeType: activeMimeType };
}

export async function stopBlobCapture(emitBlob = false) {
  const recorder = mediaRecorder;
  const chunks = recordedChunks;
  const mimeType = activeMimeType;

  if (!recorder || recorder.state === 'inactive') {
    releaseAudioResources();
    return { ok: true, emitted: false };
  }

  return new Promise((resolve) => {
    recorder.onstop = async () => {
      try {
        if (emitBlob && chunks.length > 0) {
          const blob = new Blob(chunks, { type: mimeType });
          const base64Data = await blobToBase64(blob);
          sendToExtension({
            type: MSG_TYPES.OFFSCREEN_AUDIO_BLOB,
            base64Data,
            mimeType
          });
          releaseAudioResources();
          resolve({ ok: true, emitted: true, base64Data, mimeType });
          return;
        }
      } catch {
        // Ignorer erreur de conversion à la fermeture
      }

      releaseAudioResources();
      resolve({ ok: true, emitted: false });
    };

    try {
      recorder.stop();
    } catch {
      releaseAudioResources();
      resolve({ ok: true, emitted: false });
    }
  });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== 'object' || message.target !== 'offscreen') {
    return false;
  }

  if (message.type === MSG_TYPES.OFFSCREEN_AUDIO_START || message.type === MSG_TYPES.STT_START) {
    startBlobCapture(message.deviceId || '', message.mimeType)
      .then((res) => sendResponse(res))
      .catch((err) => {
        const name = err?.name || '';
        const denied = name === 'NotAllowedError' || name === 'PermissionDeniedError';
        sendResponse({
          ok: false,
          code: denied ? 'MIC_PERMISSION_DENIED' : 'NO_MICROPHONE',
          needsPermissionTab: true,
          error: denied
            ? 'Permission micro requise — autorisez le microphone dans les Options.'
            : err?.message || 'Impossible d’ouvrir le flux audio.'
        });
      });
    return true;
  }

  if (message.type === MSG_TYPES.OFFSCREEN_AUDIO_STOP || message.type === MSG_TYPES.STT_STOP) {
    stopBlobCapture(Boolean(message.emitBlob))
      .then((res) => sendResponse(res))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  return false;
});
