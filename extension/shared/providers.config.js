/**
 * LingoSlide V2.1 Native Edition — Configuration déclarative des fournisseurs STT Web
 * Centralise les URL cibles et sélecteurs CSS pour ChatGPT Web, Gemini et Mistral Le Chat.
 * Ajouter ou ajuster un fournisseur ici ne nécessite aucune modification du code cœur.
 */

export const DEFAULT_STT_PROVIDER = 'chatgpt';

export const STT_PROVIDERS = Object.freeze({
  chatgpt: Object.freeze({
    id: 'chatgpt',
    label: 'ChatGPT Web',
    domainLabel: 'chatgpt.com',
    targetUrl: 'https://chatgpt.com/',
    matchPatterns: ['https://chatgpt.com/*', 'https://chat.openai.com/*'],
    selectors: Object.freeze({
      micButton: [
        'button[aria-label*="Dictate"]',
        'button[aria-label*="Dicter"]',
        'button[aria-label*="dictate"]',
        'button[aria-label*="Microphone"]',
        'button[data-testid="composer-speech-button"]'
      ],
      stopButton: [
        'button[aria-label*="Stop dictating"]',
        'button[aria-label*="Arrêter la dictée"]',
        'button[aria-label*="Submit dictation"]',
        'button[aria-label*="Valider"]',
        'button[data-testid="composer-speech-stop-button"]',
        'button[data-testid="stop-button"]'
      ],
      inputArea: [
        '#prompt-textarea',
        'div.ProseMirror[contenteditable="true"]',
        'textarea[name="prompt-textarea"]',
        '[role="textbox"][contenteditable="true"]'
      ],
      fileInput: ['input[type="file"]'],
      loggedOutIndicators: [
        'button[data-testid="login-button"]',
        'button[data-testid="signup-button"]',
        'a[href*="/auth/login"]',
        'form[action*="login"]'
      ]
    }),
    timeouts: Object.freeze({
      tabLoadMs: 15000,
      micReadyMs: 4000,
      transcriptIdleMs: 1200
    })
  }),

  gemini: Object.freeze({
    id: 'gemini',
    label: 'Gemini',
    domainLabel: 'gemini.google.com',
    targetUrl: 'https://gemini.google.com/app',
    matchPatterns: ['https://gemini.google.com/*'],
    selectors: Object.freeze({
      micButton: [
        'button[aria-label*="Microphone"]',
        'button[aria-label*="Utiliser le micro"]',
        'button[aria-label*="Use microphone"]',
        'button[mattooltip*="Micro"]'
      ],
      stopButton: [
        'button[aria-label*="Stop listening"]',
        'button[aria-label*="Arrêter l’écoute"]',
        'button[aria-label*="Arrêter le micro"]',
        'button[aria-label*="Microphone"].active'
      ],
      inputArea: [
        'div.ql-editor[contenteditable="true"]',
        'rich-textarea [contenteditable="true"]',
        '[role="textbox"][contenteditable="true"]',
        'textarea'
      ],
      fileInput: ['input[type="file"]'],
      loggedOutIndicators: [
        'a[href*="accounts.google.com/ServiceLogin"]',
        'a[aria-label*="Sign in"]',
        'a[aria-label*="Se connecter"]',
        'button[aria-label*="Sign in"]'
      ]
    }),
    timeouts: Object.freeze({
      tabLoadMs: 15000,
      micReadyMs: 4000,
      transcriptIdleMs: 1200
    })
  }),

  mistral: Object.freeze({
    id: 'mistral',
    label: 'Mistral Le Chat',
    domainLabel: 'chat.mistral.ai',
    targetUrl: 'https://chat.mistral.ai/chat',
    matchPatterns: ['https://chat.mistral.ai/*'],
    selectors: Object.freeze({
      micButton: [
        'button[aria-label*="Voice"]',
        'button[aria-label*="Microphone"]',
        'button[aria-label*="Dictée"]',
        'button[aria-label*="vocal"]',
        'button[data-testid*="voice"]'
      ],
      stopButton: [
        'button[aria-label*="Stop"]',
        'button[aria-label*="Arrêter"]',
        'button[data-testid*="voice-stop"]'
      ],
      inputArea: [
        'textarea[placeholder]',
        'div.ProseMirror[contenteditable="true"]',
        '[role="textbox"][contenteditable="true"]',
        'textarea'
      ],
      fileInput: ['input[type="file"]'],
      loggedOutIndicators: [
        'a[href*="/login"]',
        'a[href*="auth.mistral.ai"]',
        'button[type="submit"][name*="login"]',
        'form[action*="login"]'
      ]
    }),
    timeouts: Object.freeze({
      tabLoadMs: 15000,
      micReadyMs: 4000,
      transcriptIdleMs: 1200
    })
  })
});

export function getAllProviderIds() {
  return Object.keys(STT_PROVIDERS);
}

export function getProviderConfig(providerId) {
  if (providerId && Object.prototype.hasOwnProperty.call(STT_PROVIDERS, providerId)) {
    return STT_PROVIDERS[providerId];
  }
  return STT_PROVIDERS[DEFAULT_STT_PROVIDER];
}

export function resolveProviderFromUrl(url) {
  if (!url || typeof url !== 'string') return null;
  let hostname = '';
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }

  if (hostname === 'chatgpt.com' || hostname === 'chat.openai.com') {
    return STT_PROVIDERS.chatgpt;
  }
  if (hostname === 'gemini.google.com') {
    return STT_PROVIDERS.gemini;
  }
  if (hostname === 'chat.mistral.ai') {
    return STT_PROVIDERS.mistral;
  }
  return null;
}

export function resolveSelector(selectors, root = document, { requireVisible = true } = {}) {
  if (!Array.isArray(selectors) || !root?.querySelectorAll) return null;

  for (const selector of selectors) {
    let matches = [];
    try {
      matches = Array.from(root.querySelectorAll(selector));
    } catch {
      continue;
    }

    for (const el of matches) {
      if (!requireVisible) return el;
      const style = globalThis.getComputedStyle?.(el);
      if (style && (style.display === 'none' || style.visibility === 'hidden')) {
        continue;
      }
      const rect = el.getBoundingClientRect?.();
      if (!rect || (rect.width > 0 && rect.height > 0)) {
        return el;
      }
    }
  }

  return null;
}
