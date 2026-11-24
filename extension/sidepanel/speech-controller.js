/**
 * Contrôleur Web Speech API (STT) pour LingoSlide V2.1 Native.
 * Ouvre et maintient un flux getUserMedia({ audio: true }) sur l'origine du Side Panel
 * pendant toute la dictée afin d'éviter l'extinction immédiate du voyant REC sous Chromium/Thorium.
 */

export function createSpeechController({ onStateChange, onTranscript, onError }) {
  const SpeechCtor = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition || null;

  let recognition = null;
  let activeStream = null;
  let state = SpeechCtor ? 'idle' : 'unavailable';
  let activeLang = 'fr-FR';
  let stopRequested = false;

  const setState = (nextState) => {
    state = nextState;
    if (typeof onStateChange === 'function') {
      onStateChange(state);
    }
  };

  const releaseMediaStream = () => {
    if (!activeStream) return;
    try {
      activeStream.getTracks().forEach((track) => track.stop());
    } catch {
      // Ignorer
    }
    activeStream = null;
  };

  setState(state);

  const stop = () => {
    stopRequested = true;
    if (!recognition) {
      releaseMediaStream();
      if (state === 'listening' || state === 'starting') {
        setState('idle');
      }
      return;
    }
    if (state === 'listening' || state === 'starting') {
      setState('stopping');
      try {
        recognition.stop();
      } catch {
        releaseMediaStream();
        recognition = null;
        setState('idle');
      }
    }
  };

  const openAudioStream = async (deviceId) => {
    if (!navigator.mediaDevices?.getUserMedia) {
      return null;
    }

    if (deviceId) {
      try {
        return await navigator.mediaDevices.getUserMedia({
          audio: { deviceId: { exact: deviceId } }
        });
      } catch {
        // Fallback sur le micro système par défaut si l'ID mémorisé n'est plus connecté
      }
    }

    return navigator.mediaDevices.getUserMedia({ audio: true });
  };

  const start = async (langBcp47, deviceId = '') => {
    if (!SpeechCtor) {
      setState('unavailable');
      onError?.({
        code: 'SPEECH_UNAVAILABLE',
        message: 'Dictée vocale non supportée par ce navigateur.',
        needsPermissionTab: false
      });
      return;
    }

    if (langBcp47) {
      activeLang = langBcp47;
    }

    if (state === 'listening' || state === 'starting') {
      stop();
      return;
    }

    stopRequested = false;
    setState('starting');

    try {
      releaseMediaStream();
      activeStream = await openAudioStream(deviceId);

      if (stopRequested) {
        releaseMediaStream();
        setState('idle');
        return;
      }
    } catch (err) {
      releaseMediaStream();
      setState('idle');
      const name = err?.name || '';
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        onError?.({
          code: 'MIC_PERMISSION_DENIED',
          message: 'Permission micro requise — autorisez le micro dans les Options.',
          needsPermissionTab: true
        });
      } else {
        onError?.({
          code: 'NO_MICROPHONE',
          message: 'Impossible d’ouvrir le flux microphone audio.',
          needsPermissionTab: true
        });
      }
      return;
    }

    try {
      recognition = new SpeechCtor();
      recognition.lang = activeLang;
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;

      recognition.onstart = () => {
        if (stopRequested) {
          stop();
          return;
        }
        setState('listening');
      };

      recognition.onresult = (event) => {
        let finalChunk = '';
        let interimChunk = '';

        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          const result = event.results[i];
          const text = result[0]?.transcript || '';
          if (result.isFinal) {
            finalChunk += text;
          } else {
            interimChunk += text;
          }
        }

        if (finalChunk || interimChunk) {
          onTranscript?.({ finalText: finalChunk, interimText: interimChunk });
        }
      };

      recognition.onerror = (event) => {
        const errCode = event?.error || 'unknown';
        releaseMediaStream();
        recognition = null;

        if (errCode === 'aborted' && (state === 'stopping' || stopRequested)) {
          setState('idle');
          return;
        }
        setState('idle');

        if (errCode === 'not-allowed' || errCode === 'service-not-allowed') {
          onError?.({
            code: 'MIC_PERMISSION_DENIED',
            message: 'Permission micro requise — autorisez le micro dans Réglages.',
            needsPermissionTab: true
          });
          return;
        }

        if (errCode === 'no-speech') {
          onError?.({
            code: 'NO_SPEECH',
            message: 'Aucune voix détectée.',
            needsPermissionTab: false
          });
          return;
        }

        if (errCode === 'audio-capture') {
          onError?.({
            code: 'NO_MICROPHONE',
            message: 'Aucun microphone Windows actif détecté.',
            needsPermissionTab: true
          });
          return;
        }

        onError?.({
          code: 'SPEECH_ERROR',
          message: `Dictée interrompue (${errCode}).`,
          needsPermissionTab: false
        });
      };

      recognition.onend = () => {
        recognition = null;
        releaseMediaStream();
        if (state !== 'unavailable') {
          setState('idle');
        }
      };

      recognition.start();
    } catch {
      recognition = null;
      releaseMediaStream();
      setState('idle');
      onError?.({
        code: 'SPEECH_START_FAILED',
        message: 'Impossible de démarrer la dictée vocale.',
        needsPermissionTab: true
      });
    }
  };

  return {
    getState: () => state,
    hasActiveStream: () => Boolean(activeStream),
    setLanguage: (langBcp47) => {
      if (langBcp47) activeLang = langBcp47;
    },
    toggle: (langBcp47, deviceId = '') => {
      if (state === 'listening' || state === 'starting') {
        stop();
      } else {
        void start(langBcp47, deviceId);
      }
    },
    stop
  };
}
