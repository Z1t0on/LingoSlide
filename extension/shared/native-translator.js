/**
 * LingoSlide V2.1 Native Edition — Moteur de traduction natif WICG Chrome
 * Supporte globalThis.Translator (Chrome 138+) et globalThis.translation (WICG legacy).
 * Inclut un cache LRU (2 paires bidirectionnelles) et la purge instantanée des verrous SPA.
 */

const MAX_CACHE_ENTRIES = 2;

const instanceCache = new Map();
const pendingCreations = new Map();
let activeEpoch = 0;
let activeAbortController = new AbortController();

export function getTranslationEpoch() {
  return activeEpoch;
}

/**
 * Libère immédiatement tous les verrous du moteur natif lors d'une navigation SPA ou d'un F5.
 * Les traductions en cours sur l'ancienne conversation sont annulées instantanément.
 */
export function abortAndFlushTranslations() {
  activeEpoch += 1;
  try {
    activeAbortController.abort('SPA_RESET');
  } catch {
    // Ignorer
  }
  activeAbortController = new AbortController();
  pendingCreations.clear();
  for (const instance of instanceCache.values()) {
    try {
      if (instance && typeof instance.destroy === 'function') {
        instance.destroy();
      }
    } catch {
      // Ignorer
    }
  }
  instanceCache.clear();
  return activeEpoch;
}

export function detectNativeTranslatorSupport() {
  if (typeof globalThis.Translator === 'function') {
    return { supported: true, api: 'Translator' };
  }
  if (
    globalThis.translation &&
    typeof globalThis.translation.createTranslator === 'function'
  ) {
    return { supported: true, api: 'translation' };
  }
  return { supported: false, api: 'none' };
}

export async function checkPairAvailability(sourceLanguage, targetLanguage) {
  if (!sourceLanguage || !targetLanguage || sourceLanguage === targetLanguage) {
    return { status: 'identical', available: true };
  }

  const support = detectNativeTranslatorSupport();
  if (!support.supported) {
    return { status: 'unsupported', available: false };
  }

  try {
    if (support.api === 'Translator' && typeof globalThis.Translator.availability === 'function') {
      const status = await globalThis.Translator.availability({
        sourceLanguage,
        targetLanguage
      });
      return {
        status: String(status),
        available: status === 'available' || status === 'readily' || status === 'downloadable' || status === 'after-download'
      };
    }

    if (
      support.api === 'translation' &&
      typeof globalThis.translation.canTranslate === 'function'
    ) {
      const status = await globalThis.translation.canTranslate({
        sourceLanguage,
        targetLanguage
      });
      return {
        status: String(status),
        available: status === 'readily' || status === 'after-download' || status === 'available'
      };
    }

    return { status: 'available', available: true };
  } catch (err) {
    return {
      status: 'error',
      available: false,
      error: err?.message || 'Erreur vérification WICG'
    };
  }
}

async function getTranslatorInstance(sourceLanguage, targetLanguage, onProgress, epochSnapshot) {
  const key = `${sourceLanguage}::${targetLanguage}`;

  if (instanceCache.has(key)) {
    const existing = instanceCache.get(key);
    // Rafraîchir l'ordre LRU
    instanceCache.delete(key);
    instanceCache.set(key, existing);
    return existing;
  }

  if (pendingCreations.has(key)) {
    return pendingCreations.get(key);
  }

  const support = detectNativeTranslatorSupport();
  if (!support.supported) {
    throw new Error('API native Translator indisponible dans ce navigateur.');
  }

  const signal = activeAbortController.signal;

  const createPromise = (async () => {
    let translator;
    if (support.api === 'Translator') {
      translator = await globalThis.Translator.create({
        sourceLanguage,
        targetLanguage,
        signal,
        monitor(monitor) {
          monitor?.addEventListener?.('downloadprogress', (event) => {
            if (typeof onProgress === 'function' && event.total > 0) {
              onProgress(Math.round((event.loaded / event.total) * 100));
            }
          });
        }
      });
    } else {
      translator = await globalThis.translation.createTranslator({
        sourceLanguage,
        targetLanguage,
        signal
      });
    }

    if (epochSnapshot !== activeEpoch || signal.aborted) {
      try {
        translator?.destroy?.();
      } catch {
        // Ignorer
      }
      throw new DOMException('Traduction annulée suite à une navigation.', 'AbortError');
    }

    if (instanceCache.size >= MAX_CACHE_ENTRIES) {
      const oldestKey = instanceCache.keys().next().value;
      const oldestInstance = instanceCache.get(oldestKey);
      instanceCache.delete(oldestKey);
      try {
        oldestInstance?.destroy?.();
      } catch {
        // Ignorer
      }
    }

    instanceCache.set(key, translator);
    return translator;
  })();

  pendingCreations.set(key, createPromise);

  try {
    return await createPromise;
  } finally {
    if (pendingCreations.get(key) === createPromise) {
      pendingCreations.delete(key);
    }
  }
}

/**
 * Traduit un texte de sourceLanguage vers targetLanguage via le moteur natif Chrome.
 * Retourne un objet structuré : { ok, text, cancelled, error }
 */
export async function translateNative(text, sourceLanguage, targetLanguage, options = {}) {
  const clean = typeof text === 'string' ? text.trim() : '';
  if (!clean) {
    return { ok: true, text: '', cancelled: false };
  }

  if (!sourceLanguage || !targetLanguage || sourceLanguage === targetLanguage) {
    return { ok: true, text: clean, cancelled: false };
  }

  const epochSnapshot =
    typeof options.epoch === 'number' ? options.epoch : activeEpoch;

  if (epochSnapshot !== activeEpoch) {
    return { ok: false, text: clean, cancelled: true };
  }

  try {
    const translator = await getTranslatorInstance(
      sourceLanguage,
      targetLanguage,
      options.onProgress,
      epochSnapshot
    );

    if (epochSnapshot !== activeEpoch) {
      return { ok: false, text: clean, cancelled: true };
    }

    const translated = await translator.translate(clean, {
      signal: activeAbortController.signal
    });

    if (epochSnapshot !== activeEpoch) {
      return { ok: false, text: clean, cancelled: true };
    }

    return {
      ok: true,
      text: typeof translated === 'string' && translated.trim() ? translated.trim() : clean,
      cancelled: false
    };
  } catch (err) {
    if (err?.name === 'AbortError' || epochSnapshot !== activeEpoch) {
      return { ok: false, text: clean, cancelled: true };
    }
    return {
      ok: false,
      text: clean,
      cancelled: false,
      error: err?.message || 'Échec traduction native'
    };
  }
}
