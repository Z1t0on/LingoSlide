/**
 * LingoSlide V2.1 Native Edition — Observateur DOM structurel pur du Fil Miroir
 *
 * Capture les éléments de message dans leur ordre naturel d'apparition dans le DOM
 * (du haut vers le bas), filtre les nœuds imbriqués, applique le dédoublonnage strict
 * par empreinte et conserve UNIQUEMENT les 5 DERNIERS éléments du bas de la page.
 * Aucun parsing d'horodatage ni tri par date.
 */

import { MAX_FEED_MESSAGES, computeMessageFingerprint } from '../shared/constants.js';

const HOST_CONTAINER_SELECTORS = [
  // Discord
  'ol[data-list-id="chat-messages"]',
  '[data-list-id="chat-messages"]',
  // WhatsApp Web
  '[data-testid="conversation-panel-messages"]',
  '#main [role="application"]',
  // Slack / Teams / Messageries génériques
  '[role="log"]',
  '[aria-live="polite"]',
  '[data-testid="message-list"]',
  '.chat-messages',
  '.messages-container'
];

const MESSAGE_NODE_SELECTORS = [
  // Discord
  'li[id^="chat-messages-"]',
  '[id^="message-content-"]',
  // WhatsApp Web
  'div[data-id][role="row"]',
  '[data-testid="msg-container"]',
  // Messageries / Banc de test / Générique
  '[data-lingoslide-msg]',
  '[data-message-id]',
  '[role="listitem"]',
  'article',
  '.chat-message',
  '.message-item',
  '.message'
];

/**
 * Trouve le conteneur principal des messages du site hôte.
 */
export function resolveFeedContainer(root = document) {
  for (const selector of HOST_CONTAINER_SELECTORS) {
    const el = root.querySelector(selector);
    if (el) return el;
  }
  return root.querySelector('main') || root.body || root;
}

/**
 * Filtre les nœuds enfants imbriqués lorsqu'un ancêtre est déjà sélectionné.
 */
export function filterOutNestedNodes(nodes) {
  const uniqueNodes = [];
  const seen = new Set();

  for (const node of nodes) {
    if (!node || seen.has(node)) continue;
    seen.add(node);
    uniqueNodes.push(node);
  }

  return uniqueNodes.filter(
    (node) => !uniqueNodes.some((other) => other !== node && other.contains(node))
  );
}

function extractMessageFields(node) {
  // Sélecteurs prioritaires de texte principal (Discord / WhatsApp / Générique)
  const textEl =
    node.querySelector('[data-lingoslide-text]') ||
    node.querySelector('[id^="message-content-"]') ||
    node.querySelector('[data-testid="msg-text"]') ||
    node.querySelector('.selectable-text') ||
    node.querySelector('.message-text, .msg-body, .content');

  const authorEl =
    node.querySelector('[data-lingoslide-author]') ||
    node.querySelector('[id^="message-username-"]') ||
    node.querySelector('[data-testid="msg-author"]') ||
    node.querySelector('.username, .author, .sender');

  const timeEl =
    node.querySelector('[data-lingoslide-time]') ||
    node.querySelector('time') ||
    node.querySelector('[data-testid="msg-meta"], .timestamp, .time');

  const rawText = (textEl ? textEl.textContent : node.textContent || '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!rawText || rawText.length < 1) {
    return null;
  }

  const author = (authorEl?.textContent || node.getAttribute?.('data-author') || 'Message')
    .replace(/\s+/g, ' ')
    .trim();

  const timeLabel = (timeEl?.textContent || '')
    .replace(/\s+/g, ' ')
    .trim();

  const directionAttr = node.getAttribute?.('data-direction') || '';
  const isOutgoing =
    directionAttr === 'outgoing' ||
    node.classList?.contains('outgoing') ||
    Boolean(node.querySelector?.('.message-out'));

  const payload = {
    author: author || 'Message',
    rawText,
    timeLabel,
    direction: isOutgoing ? 'outgoing' : 'incoming'
  };

  const fingerprint = computeMessageFingerprint(payload);
  return {
    id: node.getAttribute?.('data-message-id') || node.id || fingerprint,
    fingerprint,
    ...payload
  };
}

/**
 * Extrait les 5 derniers messages du conteneur principal dans leur ordre naturel DOM (haut -> bas).
 */
export function extractLastMessagesFromDom(root = document, limit = MAX_FEED_MESSAGES) {
  const container = resolveFeedContainer(root);
  if (!container || typeof container.querySelectorAll !== 'function') {
    return [];
  }

  const combinedSelector = MESSAGE_NODE_SELECTORS.join(', ');
  const rawNodes = Array.from(container.querySelectorAll(combinedSelector));
  const cleanNodes = filterOutNestedNodes(rawNodes);

  const deduped = [];
  const seenFingerprints = new Set();

  for (const node of cleanNodes) {
    const item = extractMessageFields(node);
    if (!item || !item.rawText) continue;
    if (seenFingerprints.has(item.fingerprint)) continue;
    seenFingerprints.add(item.fingerprint);
    deduped.push(item);
  }

  return deduped.slice(-limit);
}

/**
 * Démarre l'observation DOM et la détection de navigation SPA sur l'hôte.
 */
export function createFeedObserver({ root = document, onBatch, onReset } = {}) {
  let lastBatchKey = '';
  let lastUrl = globalThis.location?.href || '';
  let scheduled = false;
  let stopped = false;

  const scan = () => {
    scheduled = false;
    if (stopped) return;

    const currentUrl = globalThis.location?.href || '';
    if (currentUrl && currentUrl !== lastUrl) {
      lastUrl = currentUrl;
      lastBatchKey = '';
      if (typeof onReset === 'function') {
        onReset({ reason: 'SPA_NAVIGATION', url: currentUrl });
      }
    }

    const messages = extractLastMessagesFromDom(root, MAX_FEED_MESSAGES);
    const batchKey = messages.map((m) => m.fingerprint).join('|');
    if (batchKey === lastBatchKey) {
      return;
    }

    lastBatchKey = batchKey;
    if (typeof onBatch === 'function') {
      onBatch(messages);
    }
  };

  const scheduleScan = () => {
    if (stopped || scheduled) return;
    scheduled = true;
    globalThis.requestAnimationFrame
      ? globalThis.requestAnimationFrame(scan)
      : setTimeout(scan, 16);
  };

  const targetNode = root.body || root.documentElement || root;
  const observer = new MutationObserver(() => {
    scheduleScan();
  });

  if (targetNode) {
    observer.observe(targetNode, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }

  const handleNavigation = () => {
    const currentUrl = globalThis.location?.href || '';
    if (currentUrl !== lastUrl) {
      lastUrl = currentUrl;
      lastBatchKey = '';
      if (typeof onReset === 'function') {
        onReset({ reason: 'SPA_NAVIGATION', url: currentUrl });
      }
    }
    scheduleScan();
  };

  globalThis.addEventListener?.('popstate', handleNavigation);
  globalThis.addEventListener?.('hashchange', handleNavigation);

  // Scan initial synchrone des 5 derniers nœuds déjà présents
  scan();

  return {
    forceScan() {
      lastBatchKey = '';
      scan();
    },
    reset() {
      lastBatchKey = '';
      if (typeof onReset === 'function') {
        onReset({ reason: 'MANUAL_RESET', url: globalThis.location?.href || '' });
      }
      scan();
    },
    disconnect() {
      stopped = true;
      observer.disconnect();
      globalThis.removeEventListener?.('popstate', handleNavigation);
      globalThis.removeEventListener?.('hashchange', handleNavigation);
    }
  };
}
