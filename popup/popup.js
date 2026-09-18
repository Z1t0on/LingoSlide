/**
 * LingoSlide - Popup Logic (popup.js)
 * Rôle : Gestion du formulaire de configuration, Onboarding, Persistance.
 */

document.addEventListener('DOMContentLoaded', () => {
  // --- RÉFÉRECES DOM ---
  const apiKeyInput = document.getElementById('apiKey');
  const toggleApiKeyBtn = document.getElementById('toggleApiKey');
  const targetLangSelect = document.getElementById('targetLang');
  const selectedModelSelect = document.getElementById('selectedModel');
  const autoSendCheckbox = document.getElementById('autoSend');
  const configForm = document.getElementById('config-form');
  const onboardingBlock = document.getElementById('onboarding-block');
  const saveMessage = document.getElementById('save-message');
  const errorMessage = document.getElementById('error-message');
  const saveBtn = document.getElementById('save-btn');

  // --- ÉTAT LOCAL ---
  let isOnboardingMode = false;

  // --- FONCTIONS UTILITAIRES ---

  /**
   * Affiche un message temporaire (succès ou erreur).
   * @param {HTMLElement} element - L'élément à afficher.
   * @param {number} duration - Durée d'affichage en ms.
   */
  function showTemporaryMessage(element, duration = 3000) {
    element.classList.remove('hidden');
    setTimeout(() => {
      element.classList.add('hidden');
    }, duration);
  }

  /**
   * Charge les paramètres depuis chrome.storage.local et remplit le formulaire.
   */
  async function loadSettings() {
    try {
      const result = await chrome.storage.local.get(['apiKey', 'targetLang', 'selectedModel', 'autoSend']);
      
      // Gestion du mode Onboarding
      if (!result.apiKey || result.apiKey.trim() === '') {
        isOnboardingMode = true;
        onboardingBlock.classList.remove('hidden');
        apiKeyInput.value = '';
        apiKeyInput.focus;
      } else {
        isOnboardingMode = false;
        onboardingBlock.classList.add('hidden');
        apiKeyInput.value = result.apiKey;
      }

      // Remplissage des autres champs avec valeurs par défaut si absentes
      targetLangSelect.value = result.targetLang || 'fr';
      selectedModelSelect.value = result.selectedModel || 'gemini-3.1-flash-lite';
      autoSendCheckbox.checked = result.autoSend || false;

      console.log('[Popup] Paramètres chargés:', result);
    } catch (err) {
      console.error('[Popup] Erreur lors du chargement des paramètres:', err);
      errorMessage.classList.remove('hidden');
    }
  }

  /**
   * Sauvegarde les paramètres du formulaire dans chrome.storage.local.
   */
  async function saveSettings() {
    const apiKey = apiKeyInput.value.trim();
    const targetLang = targetLangSelect.value;
    const selectedModel = selectedModelSelect.value;
    const autoSend = autoSendCheckbox.checked;

    // Validation basique
    if (!apiKey && !isOnboardingMode) {
      // Si on n'est pas en mode onboarding mais que la clé est vide, on bloque
      // (Normalement géré par l'attribut 'required' du HTML, mais sécurité supplémentaire)
      errorMessage.textContent = '❌ La clé API est obligatoire.';
      errorMessage.classList.remove('hidden');
      return;
    }

    // Désactivation temporaire du bouton
    saveBtn.disabled = true;
    saveBtn.textContent = 'Enregistrement...';

    try {
      const settings = {
        apiKey: apiKey,
        targetLang: targetLang,
        selectedModel: selectedModel,
        autoSend: autoSend
      };

      await chrome.storage.local.set(settings);

      // Notification visuelle de succès
      saveMessage.classList.remove('hidden');
      errorMessage.classList.add('hidden');
      
      // Envoi d'un message au background pour notifier le changement
      await chrome.runtime.sendMessage({ 
        action: 'updateSettings', 
        payload: settings 
      });

      console.log('[Popup] Paramètres enregistrés.');
      
      showTemporaryMessage(saveMessage);
    } catch (err) {
      console.error('[Popup] Erreur lors de la sauvegarde:', err);
      errorMessage.textContent = '❌ Échec de la sauvegarde. Vérifiez la console.';
      errorMessage.classList.remove('hidden');
      showTemporaryMessage(errorMessage);
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = '💾 Enregistrer les paramètres';
    }
  }

  // --- GESTIONNAIRES D'ÉVÉNEMENTS ---

  // Bascule affichage/masquage de la clé API
  toggleApiKeyBtn.addEventListener('click', () => {
    const type = apiKeyInput.getAttribute('type') === 'password' ? 'text' : 'password';
    apiKeyInput.setAttribute('type', type);
    toggleApiKeyBtn.textContent = type === 'password' ? '👁️' : '🙈';
  });

  // Soumission du formulaire
  configForm.addEventListener('submit', (e) => {
    e.preventDefault();
    saveSettings();
  });

  // Détection de saisie dans la clé API pour masquer le bloc onboarding
  apiKeyInput.addEventListener('input', () => {
    if (isOnboardingMode && apiKeyInput.value.trim().length > 0) {
      onboardingBlock.classList.add('hidden');
    } else if (isOnboardingMode && apiKeyInput.value.trim().length === 0) {
      onboardingBlock.classList.remove('hidden');
    }
  });

  // --- INITIALISATION ---
  loadSettings();
});
