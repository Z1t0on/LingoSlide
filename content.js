/**
 * LingoSlide - Content Script (Manifest V3)
 * Rôle : Capture du tchat entrant (MutationObserver) et injection du texte sortant (React).
 * Contraintes : 100% Web Natif, Zero Framework, Exclusion docs.google.com
 */

(function() {
  'use strict';

  // ==========================================
  // 1. GARDE-FOU & EXCLUSIONS STRICTES
  // ==========================================

  // Interruption immédiate si Google Docs
  if (window.location.hostname.includes('docs.google.com')) {
    console.log('[LingoSlide] Exclusion : Google Docs détecté. Aucun script injecté.');
    return;
  }

  console.log('[LingoSlide] Content Script démarré sur :', window.location.hostname);

  // ==========================================
  // 2. CONFIGURATION & ÉTAT LOCAL
  // ==========================================

  // Cache des messages déjà traités pour éviter les doublons (Max 100 entrées)
  // Structure : Set contenant des empreintes textuelles (string)
  const messageCache = new Set();
  const MAX_CACHE_SIZE = 100;

  // Sélecteurs cibles pour Xbox Cloud Gaming et autres plateformes
  // Note: On ne stocke PAS de références DOM globales (anti-obsolète)
  const CHAT_CONTAINERS_SELECTORS = [
    '#root', // Xbox Cloud Gaming
    '[class*="chat"]',
    '[class*="message-list"]',
    'main'
  ];

  // ==========================================
  // 3. FLUX ENTRANT : CAPTURE DU TCHAT (MutationObserver)
  // ==========================================

  /**
   * Calcule une empreinte déterministe unique basée uniquement sur l'auteur et le texte.
   * Exclut toute valeur temporelle ou aléatoire.
   * @param {string} author - Le pseudo de l'auteur.
   * @param {string} text - Le contenu du message.
   * @returns {string} - L'empreinte unique.
   */
  function generateFingerprint(author, text) {
    const normalizedAuthor = (author || '').trim().toLowerCase();
    const normalizedText = (text || '').trim().toLowerCase();
    return `msg:${normalizedAuthor}:${normalizedText}`;
  }

  /**
   * Purge le cache en supprimant les éléments les plus anciens si la limite est atteinte.
   * Utilise les itérateurs natifs du Set.
   */
  function purgeCache() {
    if (messageCache.size <= MAX_CACHE_SIZE) return;

    const iterator = messageCache.values();
    const toRemove = [];
    
    // On récupère les X premières entrées pour les supprimer (les plus anciennes)
    for (let i = 0; i < (messageCache.size - MAX_CACHE_SIZE); i++) {
      const result = iterator.next();
      if (!result.done) {
        toRemove.push(result.value);
      }
    }

    toRemove.forEach(key => messageCache.delete(key));
  }

  /**
   * Extrait le pseudo et le texte d'un nœud de message.
   * Sépare strictement l'auteur du contenu du message.
   * @param {HTMLElement} node - Le nœud DOM contenant le message.
   * @returns {{author: string, text: string}|null} - Les données extraites ou null.
   */
  function extractMessageData(node) {
    // Sélecteurs typiques pour les pseudos (à adapter selon la plateforme cible)
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

    const author = authorElement ? authorElement.textContent.trim() : 'Inconnu';

    // Extraction du texte du message UNIQUEMENT (sans le pseudo)
    // On clone le nœud pour retirer temporairement l'élément auteur avant de lire le texte
    const clone = node.cloneNode(true);
    const cloneAuthor = clone.querySelector(authorSelectors.join(', '));
    if (cloneAuthor) {
      cloneAuthor.remove();
    }
    
    // Nettoyage du texte : suppression des espaces multiples et sauts de ligne inutiles
    let text = clone.textContent.trim().replace(/\s+/g, ' ');

    // Filtrage : on ignore les messages vides ou trop courts (bruits)
    if (!text || text.length < 1) return null;

    return { author, text };
  }

  /**
   * Callback du MutationObserver : traite les nouveaux nœuds ajoutés.
   * @param {MutationRecord[]} mutations - La liste des mutations observées.
   */
  function handleMutations(mutations) {
    mutations.forEach(mutation => {
      // On ne traite que les ajouts d'enfants (childList), pas les modifications de texte (characterData)
      // pour optimiser la performance lors du streaming.
      if (mutation.type !== 'childList') return;

      mutation.addedNodes.forEach(node => {
        // Ignorer les nœuds non-éléments (commentaires, textes bruts)
        if (node.nodeType !== Node.ELEMENT_NODE) return;

        const data = extractMessageData(node);
        if (!data) return;

        const fingerprint = generateFingerprint(data.author, data.text);

        // Vérification de dédoublonnage
        if (messageCache.has(fingerprint)) {
          return; // Message déjà traité, on ignore
        }

        // Ajout au cache et purge si nécessaire
        messageCache.add(fingerprint);
        purgeCache();

        // Construction de l'objet message structuré
        const messageObj = {
          id: fingerprint, // Utilisation de l'empreinte comme ID unique
          author: data.author,
          text: data.text,
          timestamp: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
        };

        console.log('[LingoSlide] Nouveau message capturé:', messageObj);

        // Envoi au Background Script (qui relaye au Side Panel)
        chrome.runtime.sendMessage({
          action: 'newIncomingMessage',
          payload: messageObj
        }).catch(err => {
          // Silencieux en cas d'erreur (ex: context invalidé)
          console.warn('[LingoSlide] Échec envoi message:', err);
        });
      });
    });
  }

  /**
   * Initialise le MutationObserver sur le conteneur de tchat.
   */
  function initChatObserver() {
    // Recherche du conteneur principal (essai successif des sélecteurs)
    let chatContainer = null;
    for (const selector of CHAT_CONTAINERS_SELECTORS) {
      chatContainer = document.querySelector(selector);
      if (chatContainer) break;
    }

    if (!chatContainer) {
      console.warn('[LingoSlide] Conteneur de tchat non trouvé. Réessai dans 2s...');
      setTimeout(initChatObserver, 2000);
      return;
    }

    console.log('[LingoSlide] Observation du conteneur:', chatContainer.id || chatContainer.className);

    const observer = new MutationObserver(handleMutations);
    
    // Configuration stricte : uniquement les ajouts d'enfants directs et sous-arbres
    // characterData: false pour éviter la surcharge lors des mises à jour de texte en temps réel
    observer.observe(chatContainer, {
      childList: true,
      subtree: true,
      characterData: false 
    });
  }

  // Démarrage de l'observateur après chargement du DOM
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initChatObserver);
  } else {
    initChatObserver();
  }

  // ==========================================
  // 4. FLUX SORTANT : INJECTION & SYNCHRONISATION REACT
  // ==========================================

  /**
   * Résout dynamiquement l'élément cible pour l'injection du texte.
   * Gère la perte de focus (clic dans le Side Panel) via des sélecteurs de secours.
   * @returns {HTMLElement|null} - L'élément éditable cible.
   */
  function resolveEditableTarget() {
    // 1. Priorité à l'élément actuellement actif (focus)
    const active = document.activeElement;
    
    // Vérification que l'élément actif est bien éditable
    if (active && active !== document.body) {
      const isEditable = 
        active.isContentEditable || 
        active.tagName === 'TEXTAREA' || 
        (active.tagName === 'INPUT' && active.type === 'text');
      
      if (isEditable) {
        return active;
      }
    }

    // 2. Fallback : Sélecteurs de secours si le focus est perdu (sur body)
    const fallbackSelectors = [
      '[contenteditable="true"][role="textbox"]',
      '[contenteditable="true"]',
      'textarea[placeholder*="message" i]',
      'input[type="text"][placeholder*="message" i]',
      'textarea',
      'input[type="text"]'
    ];

    for (const selector of fallbackSelectors) {
      const el = document.querySelector(selector);
      if (el) return el;
    }

    return null;
  }

  /**
   * Injecte un texte traduit dans une zone éditable et gère l'envoi auto.
   * Respecte la séquence React : Input -> Change -> Pause 50ms -> Enter.
   * @param {string} translatedText - Le texte traduit à injecter.
   * @param {boolean} autoSend - Si vrai, déclenche l'envoi automatique.
   */
  async function injectTranslatedText(translatedText, autoSend) {
    const target = resolveEditableTarget();

    if (!target) {
      console.error('[LingoSlide] Aucune zone éditable trouvée pour injection.');
      chrome.runtime.sendMessage({ action: 'injectionError', payload: 'Zone de saisie introuvable.' });
      return;
    }

    console.log('[LingoSlide] Injection du texte dans:', target.tagName, target.className);

    // 1. Injection du texte (textContent pour contenteditable, value pour input/textarea)
    if (target.isContentEditable) {
      target.textContent = translatedText;
    } else {
      target.value = translatedText;
    }

    // 2. Émission des événements synthétiques pour notifier React/Frameworks
    const eventOptions = { bubbles: true, cancelable: true, composed: true };
    
    target.dispatchEvent(new Event('input', eventOptions));
    target.dispatchEvent(new Event('change', eventOptions));

    // 3. MICRO-PAUSE ASYNCHRONE DE 50ms (CRITIQUE POUR REACT)
    // Laisse le temps au Virtual DOM de synchroniser son état interne (state)
    await new Promise(resolve => setTimeout(resolve, 50));

    // 4. Envoi automatique si activé
    if (autoSend) {
      console.log('[LingoSlide] AutoSend activé : simulation de la touche Entrée.');
      
      const keyOptions = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
      
      target.dispatchEvent(new KeyboardEvent('keydown', keyOptions));
      target.dispatchEvent(new KeyboardEvent('keyup', keyOptions));
    }

    chrome.runtime.sendMessage({ action: 'injectionSuccess', payload: 'Texte injecté avec succès.' });
  }

  // ==========================================
  // 5. ÉCOUTEUR DE MESSAGES (Depuis Popup / Side Panel)
  // ==========================================

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('[LingoSlide] Message reçu (Content):', request.action);

    // Demande d'injection de texte traduit
    if (request.action === 'injectText') {
      const { text, autoSend } = request.payload;
      injectTranslatedText(text, autoSend).then(() => {
        sendResponse({ success: true });
      }).catch(err => {
        sendResponse({ success: false, error: err.message });
      });
      return true; // Réponse asynchrone
    }

    // Demande de test de connectivité (Heartbeat)
    if (request.action === 'ping') {
      sendResponse({ status: 'ok', url: window.location.href });
      return true;
    }
  });

})();
