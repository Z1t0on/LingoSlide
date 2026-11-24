/**
 * LingoSlide V2.1 Native Edition — Constantes partagées et empreinte stricte
 * Pure ES6+ (aucune dépendance externe, aucun parsing complexe de dates)
 */

export const MAX_FEED_MESSAGES = 5;
export const AUTO_ENTER_DELAY_MS = 50;

export const EXCLUDED_HOSTS = ['docs.google.com'];

export const MSG_TYPES = Object.freeze({
  FEED_MESSAGE: 'LINGOSLIDE_FEED_MESSAGE',
  FEED_BATCH: 'LINGOSLIDE_FEED_BATCH',
  RESET_FEED: 'LINGOSLIDE_RESET_FEED',
  INJECT_TEXT: 'LINGOSLIDE_INJECT_TEXT',
  INJECT_RESULT: 'LINGOSLIDE_INJECT_RESULT',
  GET_STATE: 'LINGOSLIDE_GET_STATE',
  OPEN_OPTIONS: 'LINGOSLIDE_OPEN_OPTIONS',
  PREFS_UPDATED: 'LINGOSLIDE_PREFS_UPDATED',
  PING: 'LINGOSLIDE_PING',
  STT_START: 'LINGOSLIDE_STT_START',
  STT_STOP: 'LINGOSLIDE_STT_STOP',
  STT_STATE: 'LINGOSLIDE_STT_STATE',
  STT_TRANSCRIPT: 'LINGOSLIDE_STT_TRANSCRIPT',
  STT_ERROR: 'LINGOSLIDE_STT_ERROR',
  STT_OPEN_LOGIN: 'LINGOSLIDE_STT_OPEN_LOGIN',
  STT_TEST_SESSION: 'LINGOSLIDE_STT_TEST_SESSION',
  OFFSCREEN_AUDIO_START: 'LINGOSLIDE_OFFSCREEN_AUDIO_START',
  OFFSCREEN_AUDIO_STOP: 'LINGOSLIDE_OFFSCREEN_AUDIO_STOP',
  OFFSCREEN_AUDIO_BLOB: 'LINGOSLIDE_OFFSCREEN_AUDIO_BLOB',
  RELAY_PING: 'LINGOSLIDE_RELAY_PING',
  RELAY_SESSION_CHECK: 'LINGOSLIDE_RELAY_SESSION_CHECK',
  RELAY_START_DICTATION: 'LINGOSLIDE_RELAY_START_DICTATION',
  RELAY_STOP_DICTATION: 'LINGOSLIDE_RELAY_STOP_DICTATION'
});

/**
 * Langues explicites supportées (pas de mode 'auto' : l'utilisateur choisit source et cible)
 */
export const SUPPORTED_LANGUAGES = Object.freeze([
  { code: 'fr', label: 'Français', sttLocale: 'fr-FR' },
  { code: 'en', label: 'English', sttLocale: 'en-US' },
  { code: 'es', label: 'Español', sttLocale: 'es-ES' },
  { code: 'de', label: 'Deutsch', sttLocale: 'de-DE' },
  { code: 'it', label: 'Italiano', sttLocale: 'it-IT' },
  { code: 'pt', label: 'Português', sttLocale: 'pt-PT' },
  { code: 'nl', label: 'Nederlands', sttLocale: 'nl-NL' },
  { code: 'ja', label: '日本語', sttLocale: 'ja-JP' },
  { code: 'ko', label: '한국어', sttLocale: 'ko-KR' },
  { code: 'zh', label: '中文', sttLocale: 'zh-CN' },
  { code: 'ar', label: 'العربية', sttLocale: 'ar-SA' },
  { code: 'ru', label: 'Русский', sttLocale: 'ru-RU' }
]);

export const THEME_MODES = ['auto', 'dark', 'light'];

/**
 * Calcule une empreinte unique déterministe pour le dédoublonnage strict
 * du Fil Miroir (combinaison normalisée de auteur + texte brut + étiquette horaire).
 */
export function computeMessageFingerprint(message) {
  if (!message || typeof message !== 'object') return '';
  const author = String(message.author || 'Message')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  const rawText = String(message.rawText || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  const timeLabel = String(message.timeLabel || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  return `${author}::${rawText}::${timeLabel}`;
}
