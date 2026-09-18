/**
 * LingoSlide - Content Script (Manifest V3)
 * Rôle : Observation du tchat entrant (traduction native) et Injection sortante (React/Virtual DOM).
 * Contraintes : 100% Natif, Zero Framework, Debounce 300ms, Micro-pause 50ms, Fallback DOM en cascade.
 * Version : 1.0.0 - Recadrage Architectural Strict
 */

// --- GARDE-FOU EXCLUSION STRICTE ---
if (window.location.hostname.includes('docs.google.com')) {
  console.log('[LingoSlide] Exclusion Google Docs. Arrêt immédiat du script.');
  // Interruption totale de l'exécution
  (function() { return; })();
}

console.log('[LingoSlide] Content Script initialisé sur :', window.location.hostname);

// --- CONFIGURATION & ÉTAT LOCAL ---
const CONFIG = {
  DEBOUNCE_DELAY: 300, // ms pour stabilisation traduction native Chromium
  REACT_SYNC_PAUSE: 50, // ms pour synchronisation Virtual DOM React
  CACHE_LIMIT: 100,
  // Sélecteurs des conteneurs de tchat prioritaires (Xbox Cloud Gaming, Discord, etc.)
  TARGET_CONTAINERS: [
    '#root',
    '#gamepass-dialog-root',
    '[class*="chat"]',
    '[class*="message-list"]',
    'main'
  ]
};

let state = {
  autoSend: false,
  targetLang: 'fr',
  messageCache: new Map(), // Structure { fingerprint -> { author, text, timestamp } }
  observer: null,
  debounceTimer: null,
  mainChatContainer: null // Référence au conteneur principal pour recherche restreinte
};

// ==========================================
// UTILITAIRES
// ==========================================

/**
 * Génère un identifiant déterministe (fingerprint) basé UNIQUEMENT sur auteur + texte nettoyé.
 * Exclut tout timestamp, ID DOM ou valeur aléatoire pour garantir la stabilité.
 * Deux captures identiques produisent strictement le même ID.
 */
function generateMessageId(author, text) {
  const cleanText = text.trim().toLowerCase().replace(/\s+/g, ' ');
  const cleanAuthor = (author || 'unknown').trim().toLowerCase();
  const rawId = `${cleanAuthor}::${cleanText}`;
  
  // Hash simple pour éviter les IDs trop longs dans le cache
  let hash = 0;
  for (let i = 0; i < rawId.length; i++) {
    const char = rawId.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Conversion en entier 32 bits
  }
  return `msg_${Math.abs(hash).toString(36)}`;
}

/**
 * Purge le cache lorsque la limite est dépassée.
 * Utilise les itérateurs natifs du Map pour supprimer les entrées les plus anciennes.
 */
function pruneCache() {
  if (state.messageCache.size <= CONFIG.CACHE_LIMIT) return;
  
  const iterator = state.messageCache.keys();
  // Supprime les 10 premières entrées (les plus vieilles)
  const toRemoveCount = state.messageCache.size - CONFIG.CACHE_LIMIT;
  for (let i = 0; i < toRemoveCount; i++) {
    const result = iterator.next();
    if (!result.done) {
      state.messageCache.delete(result.value);
    }
  }
}

/**
 * Positionne le curseur de sélection à la fin du contenu éditable.
 * Critique pour forcer la synchronisation de l'état interne de React.
 */
function setCursorToEnd(element) {
  if (!element.isContentEditable) return;
  
  const range = document.createRange();
  const selection = window.getSelection();
  
  range.selectNodeContents(element);
  range.collapse(false); // false = collapse to end
  
  selection.removeAllRanges();
  selection.addRange(range);
}

// ==========================================
// FLUX SORTANT : INJECTION DOM & RÉACTIVITÉ REACT
// ==========================================

/**
 * Résout dynamiquement l'élément cible pour l'injection.
 * Stratégie de fallback en cascade (PRIORITÉ AU CONTENEUR MÉMORISÉ) :
 * 1. Élément actif (si éditable)
 * 2. Conteneur principal mémorisé (mainChatContainer) - PRIORITÉ ABSOLUE
 * 3. Conteneurs de tchat connus (TARGET_CONTAINERS) - seulement si mainChatContainer échoue
 * 4. Fallback ultime sur document entier
 */
function resolveEditableTarget() {
  let targetElement = document.activeElement;
  
  // Vérifie si l'élément actif est éditable
  const isEditable = (el) => 
    el && 
    el !== document.body && 
    (el.isContentEditable || el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && el.type === 'text'));
  
  if (isEditable(targetElement)) {
    return targetElement;
  }
  
  console.log('[LingoSlide] Perte de focus détectée. Recherche de secours...');
  
  // A. PRIORITÉ ABSOLUE : Conteneur principal mémorisé (mainChatContainer)
  if (state.mainChatContainer && document.contains(state.mainChatContainer)) {
    targetElement = state.mainChatContainer.querySelector('[contenteditable="true"], textarea, input[type="text"]');
    if (targetElement) {
      console.log('[LingoSlide] Cible trouvée dans mainChatContainer mémorisé.');
      return targetElement;
    }
  }
  
  // B. Conteneurs de tchat connus (TARGET_CONTAINERS) - seulement si A échoue
  for (const selector of CONFIG.TARGET_CONTAINERS) {
    const container = document.querySelector(selector);
    if (container) {
      targetElement = container.querySelector('[contenteditable="true"], textarea, input[type="text"]');
      if (targetElement) {
        state.mainChatContainer = container; // Mise à jour de la référence
        console.log('[LingoSlide] Cible trouvée via sélecteur connu:', selector);
        return targetElement;
      }
    }
  }
  
  // C. FALLBACK ULTIME : Élargir la recherche à TOUT le document
  // Sélecteurs génériques pour zones éditables uniquement (pas de boutons)
  targetElement = 
    document.querySelector('[contenteditable="true"][role="textbox"]') ||
    document.querySelector('[contenteditable="true"]') ||
    document.querySelector('textarea[placeholder*="message" i], textarea[placeholder*="envoyer" i]') ||
    document.querySelector('input[type="text"][placeholder*="message" i], input[type="text"][placeholder*="envoyer" i]') ||
    document.querySelector('textarea') ||
    document.querySelector('input[type="text"]');
  
  if (targetElement) {
    console.log('[LingoSlide] Cible trouvée via fallback global document.');
  }
  
  return targetElement || null;
}

/**
 * Injecte un texte traduit dans une zone éditable cible.
 * Séquence complète : beforeinput -> textContent/value -> input -> change -> pause 50ms -> Enter (si autoSend).
 */
async function injectTranslatedText(text, autoSend) {
  console.log('[LingoSlide] Tentative d\'injection...', text.substring(0, 50) + '...');
  
  const targetElement = resolveEditableTarget();
  
  if (!targetElement) {
    console.error('[LingoSlide] Aucune zone de saisie trouvée.');
    chrome.runtime.sendMessage({ 
      action: 'notifyError', 
      payload: 'Zone de saisie introuvable. Cliquez manuellement dans le chat.' 
    });
    return Promise.reject(new Error('Zone de saisie introuvable'));
  }
  
  console.log('[LingoSlide] Cible trouvée:', targetElement.tagName, targetElement.className || targetElement.id);
  
  // 1. Événement beforeinput (Critique pour certains frameworks React/Preact)
  const beforeInputEvent = new InputEvent('beforeinput', {
    bubbles: true,
    cancelable: true,
    composed: true,
    inputType: 'insertText',
    data: text
  });
  targetElement.dispatchEvent(beforeInputEvent);
  
  // 2. Injection textuelle directe
  if (targetElement.isContentEditable) {
    targetElement.textContent = text;
    // 3. Positionnement du curseur à la fin (Force Sync React)
    setCursorToEnd(targetElement);
  } else {
    targetElement.value = text;
  }
  
  // 4. Événements input et change avec propagation complète
  targetElement.dispatchEvent(new InputEvent('input', { 
    bubbles: true, 
    cancelable: true, 
    composed: true 
  }));
  targetElement.dispatchEvent(new Event('change', { 
    bubbles: true, 
    cancelable: true, 
    composed: true 
  }));
  
  // 5. MICRO-PAUSE ASYNCHRONE (50ms) - CRITIQUE POUR REACT
  // Laisse le temps au Virtual DOM de synchroniser son état interne (state)
  await new Promise(resolve => setTimeout(resolve, CONFIG.REACT_SYNC_PAUSE));
  
  // 6. Auto-Envoi (Si activé dans les paramètres)
  if (autoSend) {
    console.log('[LingoSlide] Auto-send activé. Simulation touche Entrée...');
    
    const keyDownEvent = new KeyboardEvent('keydown', {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true
    });
    
    const keyUpEvent = new KeyboardEvent('keyup', {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true
    });
    
    targetElement.dispatchEvent(keyDownEvent);
    targetElement.dispatchEvent(keyUpEvent);
  }
  
  chrome.runtime.sendMessage({ 
    action: 'injectionSuccess', 
    payload: 'Texte injecté avec succès.' 
  });
  
  return Promise.resolve({ success: true });
}

// ==========================================
// FLUX ENTRANT : OBSERVATION & CAPTURE (MUTATIONOBSERVER)
// ==========================================

/**
 * Extrait les données d'un nœud de message (auteur + texte).
 * Sépare strictement le pseudo du contenu du message.
 */
function extractMessageData(node) {
  if (node.nodeType !== Node.ELEMENT_NODE) return null;
  
  // Sélecteurs typiques pour les pseudos (adaptables selon plateforme)
  const authorSelectors = [
    '[class*="username"]',
    '[class*="author"]',
    '[data-author]',
    'strong',
    'b'
  ];
  
  let authorElement = null;
  for (const selector of authorSelectors) {
    authorElement = node.querySelector(selector);
    if (authorElement) break;
  }
  
  const author = authorElement 
    ? (authorElement.textContent || authorElement.getAttribute('data-author') || 'Inconnu').trim() 
    : 'Inconnu';
  
  // Extraction STRICTE du texte du message (sans le pseudo)
  // Clone le nœud pour retirer temporairement l'élément auteur avant lecture
  const clone = node.cloneNode(true);
  const cloneAuthor = clone.querySelector(authorSelectors.join(', '));
  if (cloneAuthor) {
    cloneAuthor.remove();
  }
  
  const text = clone.textContent.trim().replace(/\s+/g, ' ');
  
  if (!text || text.length < 1) return null;
  
  return { author, text };
}

/**
 * Traite les nouveaux nœuds ajoutés avec temporisation (debounce) pour stabilisation.
 */
function processNodes(nodes) {
  const newMessages = [];
  
  nodes.forEach(node => {
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    
    const data = extractMessageData(node);
    if (!data) return;
    
    const msgId = generateMessageId(data.author, data.text);
    const timestamp = new Date().toLocaleTimeString('fr-FR', { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
    
    // Gestion Cache & Mise à jour (dédoublonnage intelligent)
    if (state.messageCache.has(msgId)) {
      // Le message existe déjà : mise à jour si le texte a évolué (traduction en cours)
      const cachedMsg = state.messageCache.get(msgId);
      if (cachedMsg.text !== data.text) {
        console.log(`[LingoSlide] Mise à jour du message ${msgId}`);
        cachedMsg.text = data.text;
        cachedMsg.timestamp = timestamp;
        
        // Notification de mise à jour au Side Panel (pas de nouvelle carte)
        chrome.runtime.sendMessage({
          action: 'updateMessage',
          payload: cachedMsg
        }).catch(err => console.warn('[LingoSlide] Échec mise à jour:', err));
      }
    } else {
      // Nouveau message
      const msgData = { 
        id: msgId, 
        author: data.author, 
        text: data.text, 
        timestamp 
      };
      state.messageCache.set(msgId, msgData);
      newMessages.push(msgData);
      
      pruneCache();
      console.log('[LingoSlide] Nouveau message capturé:', msgData);
    }
  });
  
  if (newMessages.length > 0) {
    chrome.runtime.sendMessage({
      action: 'newMessages',
      payload: newMessages
    }).catch(err => console.warn('[LingoSlide] Échec envoi messages:', err));
  }
}

/**
 * Callback du MutationObserver avec Debounce de 300ms.
 * Attend la stabilisation de la traduction native Chromium avant extraction.
 */
const handleMutations = (mutationsList) => {
  if (state.debounceTimer) clearTimeout(state.debounceTimer);
  
  state.debounceTimer = setTimeout(() => {
    const relevantNodes = [];
    
    mutationsList.forEach(mutation => {
      // Surveillance stricte : uniquement childList (ajouts d'enfants)
      // characterData: false pour éviter la surcharge lors du streaming
      if (mutation.type === 'childList') {
        mutation.addedNodes.forEach(node => relevantNodes.push(node));
      }
    });
    
    if (relevantNodes.length > 0) {
      processNodes(relevantNodes);
    }
  }, CONFIG.DEBOUNCE_DELAY);
};

/**
 * Initialise le MutationObserver sur les conteneurs de tchat.
 */
function initObserver() {
  if (state.observer) state.observer.disconnect();
  
  state.observer = new MutationObserver(handleMutations);
  
  // Ciblage prioritaire des conteneurs connus
  const targets = CONFIG.TARGET_CONTAINERS
    .map(sel => document.querySelector(sel))
    .filter(el => el);
  
  if (targets.length > 0) {
    targets.forEach(target => {
      state.mainChatContainer = target; // Stocke la référence du premier conteneur trouvé
      state.observer.observe(target, { 
        childList: true, 
        subtree: true,
        characterData: false // Optimisation performance
      });
    });
    console.log('[LingoSlide] Observateur actif sur les conteneurs de tchat.');
  } else {
    // Fallback : observation du body si aucun conteneur connu n'est trouvé
    state.observer.observe(document.body, { 
      childList: true, 
      subtree: true,
      characterData: false 
    });
    console.log('[LingoSlide] Observateur actif sur document.body (fallback global).');
  }
}

// ==========================================
// INITIALISATION & ÉCOUTEURS
// ==========================================

// Chargement des paramètres au démarrage
chrome.storage.local.get(['autoSend', 'targetLang'], (result) => {
  state.autoSend = result.autoSend || false;
  state.targetLang = result.targetLang || 'fr';
  console.log('[LingoSlide] Paramètres chargés:', state);
});

// Démarrage de l'observateur après chargement du DOM
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initObserver);
} else {
  initObserver();
}

// Écoute des messages du Side Panel / Background
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'injectText') {
    injectTranslatedText(request.payload.text, request.payload.autoSend)
      .then(() => sendResponse({ success: true }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; // Réponse asynchrone
  }
  
  if (request.action === 'settingsUpdated') {
    if (request.payload.autoSend !== undefined) state.autoSend = request.payload.autoSend;
    if (request.payload.targetLang !== undefined) state.targetLang = request.payload.targetLang;
    sendResponse({ success: true });
  }
  
  // Ping de test de connectivité
  if (request.action === 'ping') {
    sendResponse({ status: 'ok', url: window.location.href });
    return true;
  }
  
  // Réinitialisation du cache (débogage)
  if (request.action === 'resetCache') {
    state.messageCache.clear();
    sendResponse({ success: true, message: 'Cache réinitialisé.' });
    return true;
  }
});

console.log('[LingoSlide] Content Script prêt.');
