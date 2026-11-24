/**
 * LingoSlide V2.1 Native Edition — Schéma de stockage chrome.storage.local
 * Réservé exclusivement aux préférences UI, paramètres audio et fournisseur relais STT.
 */

import { SUPPORTED_LANGUAGES, THEME_MODES } from './constants.js';
import { DEFAULT_STT_PROVIDER, getAllProviderIds } from './providers.config.js';

export const STORAGE_KEY = 'lingoslide_prefs_v2';

export const DEFAULT_PREFS = Object.freeze({
  sourceLang: 'fr',
  targetLang: 'en',
  autoEnter: false,
  theme: 'auto',
  sttLocale: 'fr-FR',
  sttProvider: DEFAULT_STT_PROVIDER,
  micDeviceId: '',
  micLabel: ''
});

const VALID_LANG_CODES = new Set(SUPPORTED_LANGUAGES.map((item) => item.code));

export function normalizePrefs(raw) {
  const input = raw && typeof raw === 'object' ? raw : {};
  const validProviders = new Set(getAllProviderIds());

  let sourceLang = VALID_LANG_CODES.has(input.sourceLang)
    ? input.sourceLang
    : DEFAULT_PREFS.sourceLang;

  let targetLang = VALID_LANG_CODES.has(input.targetLang)
    ? input.targetLang
    : DEFAULT_PREFS.targetLang;

  if (sourceLang === targetLang) {
    targetLang = sourceLang === 'en' ? 'fr' : 'en';
  }

  const theme = THEME_MODES.includes(input.theme)
    ? input.theme
    : DEFAULT_PREFS.theme;

  const matchedLang = SUPPORTED_LANGUAGES.find((l) => l.code === sourceLang);
  const sttLocale =
    typeof input.sttLocale === 'string' && input.sttLocale.trim()
      ? input.sttLocale.trim()
      : matchedLang?.sttLocale || DEFAULT_PREFS.sttLocale;

  const sttProvider = validProviders.has(input.sttProvider)
    ? input.sttProvider
    : DEFAULT_PREFS.sttProvider;

  return {
    sourceLang,
    targetLang,
    autoEnter: Boolean(input.autoEnter),
    theme,
    sttLocale,
    sttProvider,
    micDeviceId: typeof input.micDeviceId === 'string' ? input.micDeviceId : '',
    micLabel: typeof input.micLabel === 'string' ? input.micLabel : ''
  };
}

function getStorageArea() {
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    return {
      async get() {
        const res = await chrome.storage.local.get(STORAGE_KEY);
        return res[STORAGE_KEY];
      },
      async set(value) {
        await chrome.storage.local.set({ [STORAGE_KEY]: value });
      }
    };
  }

  return {
    async get() {
      try {
        const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : null;
      } catch {
        return null;
      }
    },
    async set(value) {
      try {
        globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(value));
      } catch {
        // Ignorer en environnement restreint
      }
    }
  };
}

export async function loadPrefs() {
  const area = getStorageArea();
  const stored = await area.get();
  return normalizePrefs(stored);
}

export async function savePrefs(partial) {
  const area = getStorageArea();
  const current = await loadPrefs();
  const next = normalizePrefs({ ...current, ...partial });
  await area.set(next);
  return next;
}
