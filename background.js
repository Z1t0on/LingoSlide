/**
 * LingoSlide - Background Service Worker (Manifest V3)
 * Rôle : Orchestrateur central, Gestionnaire API Gemini, Router de messages.
 * Fonctionnalités ajoutées : Keep-alive pour offscreen (dictée vocale).
 */

// --- CONFIGURATION & CONSTANTES ---

const API_MODELS = [
  'gemini-3.1-flash-lite', // Priorité 1 : Rapide et léger
  'gemini-3.5-flash-lite', // Priorité 2 : Équilibré
  'gemma-4-26b'            // Priorité 3 : Fallback puissant
];

const API_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

// Variables pour le keep-alive du service worker pendant la dictée
let keepAliveInterval = null;
let isOffscreenActive = false;

// --- GESTIONNAIRE D'INSTALLATION (ONBOARDING) ---

chrome.runtime.onInstalled.addListener((details) => {
  console.log('[LingoSlide] Extension installée/mise à jour.', details.reason);

  // Vérification immédiate de la présence de la clé API
  chrome.storage.local.get(['apiKey'], (result) => {
    if (!result.apiKey || result.apiKey.trim() === '') {
      console.warn('[LingoSlide] Clé API manquante. Ouverture de l\'onboarding.');
      
      // Ouverture de la popup dans un nouvel onglet pour forcer la configuration
      chrome.tabs.create({
        url: chrome.runtime.getURL('popup/popup.html?onboarding=true'),
        active: true
      });
    } else {
      console.log('[LingoSlide] Clé API détectée. Prêt à traduire.');
    }
  });
});

// --- MOTEUR DE TRADUCTION (API GEMINI) ---

/**
 * Traduit un texte en utilisant la stratégie de fallback stricte.
 * @param {string} text - Le texte à traduire.
 * @param {string} targetLang - La langue cible (ex: 'fr', 'en').
 * @param {string} apiKey - La clé API utilisateur.
 * @returns {Promise<{success: boolean, text?: string, error?: string, modelUsed?: string}>}
 */
async function translateWithFallback(text, targetLang, apiKey) {
  let lastError = null;

  for (const model of API_MODELS) {
    try {
      console.log(`[LingoSlide] Tentative avec le modèle : ${model}`);
      
      const response = await fetch(`${API_BASE_URL}/${model}:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: `Translate the following text to ${targetLang}. Output ONLY the translation, no explanations, no quotes:\n\n${text}`
            }]
          }],
          generationConfig: {
            temperature: 0.1, // Faible température pour la précision
            topK: 1,
            topP: 1,
            maxOutputTokens: 2048,
          }
        })
      });

      // Gestion des codes HTTP
      if (response.status === 200) {
        const data = await response.json();
        const translatedText = data.candidates?.[0]?.content?.parts?.[0]?.text;
        
        if (translatedText) {
          return {
            success: true,
            text: translatedText.trim(),
            modelUsed: model
          };
        } else {
          throw new Error('Réponse API vide ou mal formée');
        }
      }

      // Gestion des erreurs spécifiques pour décider du fallback
      if (response.status === 429) {
        lastError = { code: 429, message: 'Quota dépassé pour ce modèle.' };
        console.warn(`[LingoSlide] Quota dépassé pour ${model}. Passage au suivant...`);
        continue; // On passe au modèle suivant dans la boucle
      } 
      
      if (response.status === 403 || response.status === 400) {
        // 403: Clé invalide ou modèle non autorisé pour cette clé.
        // 400: Nom de modèle incorrect.
        const errorData = await response.json().catch(() => ({}));
        if (errorData.error?.message?.includes('API_KEY_INVALID')) {
           return { success: false, error: 'Clé API invalide. Veuillez la vérifier dans les paramètres.', code: 403 };
        }
        lastError = { code: response.status, message: `Erreur ${response.status} sur ${model}.` };
        continue; // On tente le prochain modèle
      }

      // Erreurs serveur (500+) ou autres
      lastError = { code: response.status, message: `Erreur serveur (${response.status}) sur ${model}.` };
      console.warn(`[LingoSlide] Erreur sur ${model}:`, lastError.message);
      // On continue pour essayer le prochain modèle si c'est une erreur temporaire serveur

    } catch (networkError) {
      console.error(`[LingoSlide] Erreur réseau sur ${model}:`, networkError);
      lastError = { code: 0, message: 'Erreur de connexion réseau.' };
      // On continue la boucle de fallback
    }
  }

  // Si on arrive ici, tous les modèles ont échoué
  return {
    success: false,
    error: lastError?.message || 'Échec de traduction sur tous les modèles disponibles.',
    code: lastError?.code
  };
}

// --- MÉCANISME DE KEEP-ALIVE (OFFSCREEN) ---

/**
 * Démarre le pulse de keep-alive pour maintenir le service worker éveillé.
 * Envoie un message ping toutes les 20 secondes à la page offscreen.
 */
function startKeepAlive() {
  if (keepAliveInterval) {
    clearInterval(keepAliveInterval);
  }
  
  console.log('[LingoSlide] Keep-alive démarré (pulse 20s).');
  
  keepAliveInterval = setInterval(() => {
    if (isOffscreenActive) {
      // Envoie un ping à la page offscreen pour maintenir la connexion
      chrome.runtime.sendMessage({ action: 'keepAlivePing' }).catch(() => {
        // Ignorer les erreurs (page offscreen peut être fermée)
      });
    }
  }, 20000); // 20 secondes
}

/**
 * Arrête le pulse de keep-alive.
 */
function stopKeepAlive() {
  if (keepAliveInterval) {
    clearInterval(keepAliveInterval);
    keepAliveInterval = null;
    console.log('[LingoSlide] Keep-alive arrêté.');
  }
}

// --- ROUTEUR DE MESSAGERIE (chrome.runtime.onMessage) ---

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('[LingoSlide] Message reçu:', request.action, 'de:', sender.id);

  // 1. Demande de traduction (Depuis Content Script ou Side Panel)
  if (request.action === 'translateRequest') {
    (async () => {
      const { text, targetLang } = request.payload;
      
      // Récupération de la clé API
      const storage = await chrome.storage.local.get(['apiKey']);
      
      if (!storage.apiKey) {
        sendResponse({ success: false, error: 'Clé API manquante. Veuillez configurer l\'extension.' });
        return;
      }

      // Appel au moteur de traduction
      const result = await translateWithFallback(text, targetLang, storage.apiKey);
      sendResponse(result);
    })();
    
    return true; // Indique qu'on répondra de manière asynchrone
  }

  // 2. Demande d'état (Depuis Popup ou Side Panel)
  if (request.action === 'getStatus') {
    chrome.storage.local.get(['apiKey', 'targetLang', 'autoSend', 'selectedModel'], (data) => {
      sendResponse({
        configured: !!data.apiKey,
        settings: data
      });
    });
    return true;
  }

  // 3. Mise à jour des paramètres (Depuis Popup)
  if (request.action === 'updateSettings') {
    chrome.storage.local.set(request.payload, () => {
      sendResponse({ success: true });
      
      // Notifier le side panel et le content script que les settings ont changé
      chrome.runtime.sendMessage({ action: 'settingsUpdated', payload: request.payload }).catch(() => {});
    });
    return true;
  }

  // 4. Ouverture forcée du Side Panel (Depuis Popup ou Shortcut)
  if (request.action === 'openSidePanel') {
    const tabId = request.payload?.tabId || sender.tab?.id;
    if (tabId) {
      chrome.sidePanel.open({ tabId });
      sendResponse({ success: true });
    } else {
      sendResponse({ success: false, error: 'Aucun onglet actif trouvé.' });
    }
    return true;
  }

  // 5. Activation du mode offscreen (dictée vocale)
  if (request.action === 'offscreenActivated') {
    isOffscreenActive = true;
    startKeepAlive();
    sendResponse({ success: true });
    return true;
  }

  // 6. Désactivation du mode offscreen
  if (request.action === 'offscreenDeactivated') {
    isOffscreenActive = false;
    stopKeepAlive();
    sendResponse({ success: true });
    return true;
  }

  // 7. Réponse au ping de keep-alive (depuis offscreen)
  if (request.action === 'keepAliveAck') {
    // Acquitter le ping reçu de la page offscreen
    sendResponse({ status: 'ok' });
    return true;
  }
});

// Nettoyage à l'arrêt du service worker
self.addEventListener('unload', () => {
  stopKeepAlive();
  console.log('[LingoSlide] Service Worker arrêté.');
});

console.log('[LingoSlide] Service Worker démarré.');
