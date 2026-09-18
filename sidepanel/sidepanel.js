/**
 * LingoSlide - Side Panel Logic (sidepanel.js)
 * Rôle : Affichage du Fil Miroir, Command Center, Traduction & Injection.
 */

document.addEventListener('DOMContentLoaded', () => {
  // --- RÉFÉRECES DOM ---
  const chatFeed = document.getElementById('chat-feed');
  const welcomeMsg = document.getElementById('welcome-msg');
  const draftInput = document.getElementById('draft-input');
  const translateInjectBtn = document.getElementById('translate-inject-btn');
  const copyBtn = document.getElementById('copy-btn');
  const dictateBtn = document.getElementById('dictate-btn');
  const statusBar = document.getElementById('status-bar');
  const statusText = document.getElementById('status-text');

  // --- ÉTAT LOCAL ---
  let currentTranslation = ''; // Stocke la dernière traduction pour le bouton Copier
  let settings = {
    apiKey: null,
    targetLang: 'fr',
    autoSend: false
  };

  // --- FONCTIONS UTILITAIRES ---

  /**
   * Affiche un message dans la barre de statut.
   * @param {string} text - Le texte à afficher.
   * @param {string} type - 'info', 'success', ou 'error'.
   * @param {number} duration - Durée en ms (0 pour permanent).
   */
  function showStatus(text, type = 'info', duration = 3000) {
    statusText.textContent = text;
    statusBar.className = 'status-bar ' + type;
    statusBar.classList.remove('hidden');

    if (duration > 0) {
      setTimeout(() => {
        statusBar.classList.add('hidden');
      }, duration);
    }
  }

  /**
   * Crée et injecte une carte de message dans le Fil Miroir.
   * @param {Object} msgObj - { author, text, timestamp, id, type: 'incoming'|'outgoing' }
   */
  function appendMessage(msgObj) {
    // Masquer le message de bienvenue au premier message réel
    if (welcomeMsg && !welcomeMsg.classList.contains('hidden')) {
      welcomeMsg.classList.add('hidden');
    }

    const messageEl = document.createElement('div');
    messageEl.className = `message ${msgObj.type}`;
    messageEl.dataset.id = msgObj.id;

    const contentEl = document.createElement('div');
    contentEl.className = 'message-content';

    // Badge auteur (seulement pour incoming)
    if (msgObj.type === 'incoming' && msgObj.author) {
      const badgeEl = document.createElement('div');
      badgeEl.className = 'author-badge';
      badgeEl.textContent = msgObj.author;
      contentEl.appendChild(badgeEl);
      
      const textEl = document.createElement('div');
      textEl.textContent = msgObj.text;
      contentEl.appendChild(textEl);
    } else {
      // Pour outgoing ou system
      const textEl = document.createElement('div');
      textEl.textContent = msgObj.text;
      contentEl.appendChild(textEl);
    }

    // Métadonnées (timestamp)
    if (msgObj.timestamp) {
      const metaEl = document.createElement('div');
      metaEl.className = 'message-meta';
      metaEl.textContent = msgObj.timestamp;
      contentEl.appendChild(metaEl);
    }

    messageEl.appendChild(contentEl);
    chatFeed.appendChild(messageEl);

    // Scroll automatique vers le bas
    chatFeed.scrollTop = chatFeed.scrollHeight;
  }

  /**
   * Charge les paramètres depuis le storage.
   */
  async function loadSettings() {
    try {
      const result = await chrome.storage.local.get(['apiKey', 'targetLang', 'autoSend']);
      settings.apiKey = result.apiKey;
      settings.targetLang = result.targetLang || 'fr';
      settings.autoSend = result.autoSend || false;

      if (!settings.apiKey) {
        showStatus('⚠️ Clé API manquante. Configurez l\'extension.', 'error', 0);
        translateInjectBtn.disabled = true;
      }
    } catch (err) {
      console.error('[SidePanel] Erreur chargement settings:', err);
    }
  }

  /**
   * Demande la traduction au Background Script.
   * @param {string} text - Texte à traduire.
   * @returns {Promise<{success: boolean, text?: string, error?: string}>}
   */
  async function requestTranslation(text) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { 
          action: 'translateRequest', 
          payload: { text, targetLang: settings.targetLang } 
        },
        (response) => {
          if (chrome.runtime.lastError) {
            resolve({ success: false, error: 'Erreur de communication avec le background.' });
          } else {
            resolve(response);
          }
        }
      );
    });
  }

  /**
   * Envoie le texte traduit au Content Script pour injection.
   * @param {string} text - Texte à injecter.
   */
  async function injectTextToPage(text) {
    return new Promise((resolve) => {
      // Récupérer l'onglet actif
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs || tabs.length === 0) {
          resolve({ success: false, error: 'Aucun onglet actif trouvé.' });
          return;
        }

        chrome.tabs.sendMessage(
          tabs[0].id,
          { 
            action: 'injectText', 
            payload: { text, autoSend: settings.autoSend } 
          },
          (response) => {
            if (chrome.runtime.lastError) {
              resolve({ success: false, error: 'Content Script non disponible. Rechargez la page.' });
            } else {
              resolve(response);
            }
          }
        );
      });
    });
  }

  /**
   * Copie un texte dans le presse-papier.
   * @param {string} text - Texte à copier.
   */
  async function copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return { success: true };
    } catch (err) {
      return { success: false, error: 'Échec de la copie.' };
    }
  }

  // --- GESTIONNAIRES D'ÉVÉNEMENTS ---

  // Bouton "Traduire & Injecter"
  translateInjectBtn.addEventListener('click', async () => {
    const originalText = draftInput.value.trim();

    if (!originalText) {
      showStatus('⚠️ Veuillez saisir un message.', 'info', 2000);
      return;
    }

    if (!settings.apiKey) {
      showStatus('❌ Clé API manquante.', 'error', 0);
      return;
    }

    // État de chargement
    translateInjectBtn.disabled = true;
    translateInjectBtn.innerHTML = '<span class="loading-spinner"></span> Traduction...';
    showStatus('Traduction en cours...', 'info', 0);

    try {
      // 1. Demande de traduction
      const translationResult = await requestTranslation(originalText);

      if (!translationResult.success) {
        throw new Error(translationResult.error || 'Échec de la traduction.');
      }

      currentTranslation = translationResult.text;
      showStatus(`✅ Traduit avec ${translationResult.modelUsed || 'Gemini'}`, 'success', 2000);

      // 2. Injection dans la page
      const injectResult = await injectTextToPage(currentTranslation);

      if (!injectResult.success) {
        throw new Error(injectResult.error || 'Échec de l\'injection.');
      }

      // 3. Ajout au Fil Miroir (message sortant)
      appendMessage({
        type: 'outgoing',
        author: 'Moi',
        text: currentTranslation,
        timestamp: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
        id: 'out_' + Date.now()
      });

      // 4. Reset du brouillon si injection réussie
      draftInput.value = '';
      currentTranslation = '';

    } catch (err) {
      console.error('[SidePanel] Erreur:', err);
      showStatus('❌ ' + err.message, 'error', 5000);
    } finally {
      translateInjectBtn.disabled = false;
      translateInjectBtn.textContent = '🌐 Traduire & Injecter';
    }
  });

  // Bouton "Copier"
  copyBtn.addEventListener('click', async () => {
    if (!currentTranslation) {
      showStatus('⚠️ Aucune traduction à copier.', 'info', 2000);
      return;
    }

    const result = await copyToClipboard(currentTranslation);
    if (result.success) {
      showStatus('📋 Traduction copiée !', 'success', 2000);
    } else {
      showStatus('❌ Échec de la copie.', 'error', 2000);
    }
  });

  // Bouton "Dictée" (Réservé)
  dictateBtn.addEventListener('click', () => {
    showStatus('🎤 Dictée vocale : Fonctionnalité à venir.', 'info', 3000);
  });

  // Écoute des messages entrants depuis le Background (nouveaux messages du tchat)
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'newIncomingMessage') {
      const msgObj = request.payload;
      
      // Ajout au Fil Miroir
      appendMessage({
        type: 'incoming',
        author: msgObj.author,
        text: msgObj.text,
        timestamp: msgObj.timestamp,
        id: msgObj.id
      });

      sendResponse({ success: true });
    }

    // Mise à jour des paramètres (depuis Popup)
    if (request.action === 'settingsUpdated') {
      settings = { ...settings, ...request.payload };
      console.log('[SidePanel] Settings mis à jour:', settings);
      
      if (!settings.apiKey) {
        translateInjectBtn.disabled = true;
        showStatus('⚠️ Clé API retirée.', 'error', 0);
      } else {
        translateInjectBtn.disabled = false;
      }
      sendResponse({ success: true });
    }
  });

  // --- INITIALISATION ---
  loadSettings();
  
  // Focus automatique sur la zone de saisie
  draftInput.focus();
});
