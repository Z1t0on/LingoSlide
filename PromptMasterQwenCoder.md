# 🎯 PROMPT MASTER — QWEN CODER : PROJET LINGOSLIDE (v1.0.0)

Agis comme un expert en développement d'extensions Chrome Manifest V3. Je crée de zéro une nouvelle extension nommée "LingoSlide" (version v1.0.0). Le dossier de destination est entièrement vide : tu dois générer TOUS les fichiers du projet, dans leur intégralité.

## CONTEXTE DU PROJET :
- Nom : LingoSlide.
- Version : 1.0.0.
- Type : Extension Web Chromium (Chrome, Edge, Brave, Thorium).
- Architecture : Side Panel First (Manifest V3).
- Stack : 100% Web Natif (JS ES6+, HTML5, CSS3). Zéro framework (React, Vue, etc.), Zéro bundler (Webpack, Vite), Zéro dépendance npm.
- Objectif : Traduction vocale/texte en temps réel pour les chats en ligne (Xbox Cloud Gaming sur `https://www.xbox.com/play/*`, Discord Web, etc.).

## FONCTIONNALITÉS CLÉS :

### 1. SIDE PANEL (Interface Principale) :
- Un volet latéral (`chrome.sidePanel`) qui s'ouvre avec un raccourci clavier personnalisé (ex: `Ctrl+Shift+Y`).
- CONTENU :
  a. "Fil Miroir" : Liste déroulante des messages reçus (avec pseudo de l'auteur, horodatage et texte traduit par le navigateur).
  b. "Command Center" : Zone de saisie rapide / prévisualisation dictée vocale + Bouton "Traduire & Injecter" + Bouton "Copier" (fallback sécurité).
- Zéro configuration dans le Side Panel.

### 2. POPUP (Configuration Exclusive) :
- Une fenêtre dédiée (`chrome.action`) pour configurer : Clé API Gemini, Langue cible, Modèle (`gemini-3.1-flash-lite` par défaut), Interrupteur `autoSend`, Raccourci clavier.
- Onboarding : Si la clé API est absente, redirige automatiquement vers cette popup à l'installation (`chrome.runtime.onInstalled`).

### 3. STRATÉGIE DE TRADUCTION HYBRIDE & IDENTIFIANTS API REST STRICTS :
- ENTRANT (Lecture) : **0 requête API Gemini**. Le navigateur traduit la page hôte nativement. Le content script observe le DOM du chat (`MutationObserver`), capture les messages (`{ author, text, timestamp, id }`) et les transmet au Fil Miroir du Side Panel.
- SORTANT (Écriture) : Utilise l'API REST Google Gemini appelée depuis le Service Worker (`background.js`).
- IDENTIFIANTS TECHNIQUES STRICTS POUR LES ENDPOINTS REST :
  - Principal : `gemini-3.1-flash-lite` (500 req/jour, 250K TPM)
  - Fallback 1 : `gemini-3.5-flash-lite` (500 req/jour, 250K TPM)
  - Fallback 2 / Premium : `gemma-4-26b` (14.4K req/jour, 16K TPM)
  - URL POST : `https://generativelanguage.googleapis.com/v1beta/models/{modelName}:generateContent?key={apiKey}`

### 4. INJECTION DE TEXTE & SYNCHRONISATION VIRTUAL DOM (REACT / XBOX CLOUD GAMING) :

Tu dois impérativement respecter cette séquence d'injection pour `xbox.com/play` (#root React) et les SPA modernes :

A. Nature du Champ de Saisie :
- L'élément cible est généralement un : `<div contenteditable="true" role="textbox">`.
- N'utilise JAMAIS `.value = "..."`.
- Utilise `el.textContent = "..."` ou manipule `Selection`/`Range`.

B. Gestion de la Perte de Focus :
- Lorsque l'utilisateur clique sur "Traduire & Injecter" dans le Side Panel, `document.activeElement` peut temporairement être `<body>`.
- Si `document.activeElement` n'est pas un champ de saisie valide, utilise immédiatement les sélecteurs de secours sémantiques stables :
  1. `document.querySelector('[contenteditable="true"][role="textbox"]')`
  2. `document.querySelector('[aria-label*="Envoyer" i]')` ou `[aria-label*="message" i]`

C. Ordre d'Événements & Micro-Pause (Obligatoire pour React State) :
1. Injection du texte dans l'élément.
2. Émission des événements synthétiques :
   ```javascript
   el.dispatchEvent(new Event('input', { bubbles: true, cancelable: true, composed: true }));
   el.dispatchEvent(new Event('change', { bubbles: true, cancelable: true, composed: true }));
   ```
3. **MICRO-PAUSE ASYNCHRONE DE 50ms** (`await new Promise(r => setTimeout(r, 50))`) pour laisser React mettre à jour son état interne.
4. Si `autoSend` est actif, émission des événements clavier pour `Enter` :
   ```javascript
   el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
   el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
   ```

D. Exclusion Stricte :
- `docs.google.com` est formellement exclu (aucune injection, aucune capture).

## RÈGLES STRICTES (ANTI-HALLUCINATION) :
- Ne jamais utiliser de frameworks UI ou de bundlers.
- Utiliser exclusivement les identifiants REST stricts : `gemini-3.1-flash-lite`, `gemini-3.5-flash-lite`, `gemma-4-26b`.
- Gérer les erreurs API (429, 403, 500) avec des fallbacks clairs et des notifications utilisateur non bloquantes (toasts).
- Code intégralement commenté en français.
- Chaque fichier généré doit être COMPLET et IMMÉDIATEMENT UTILISABLE — aucun placeholder `// à compléter`.

## TA MISSION :
Génère l'arborescence complète du projet et le code source intégral de chaque fichier nécessaire pour la version v1.0.0 fonctionnelle :

1. L'arborescence des fichiers.
2. `manifest.json` (avec sidePanel, permissions, commands, storage).
3. `background.js` (service worker : requêtes REST Gemini, fallback quotas, onboarding, relais inter-scripts).
4. `content.js` (capture MutationObserver + injection DOM avec micro-pause React).
5. `offscreen/offscreen.html` et `offscreen/offscreen.js` (Web Speech API locale pour la dictée vocale sans réseau).
6. `sidepanel/sidepanel.html`, `sidepanel.js`, `sidepanel.css` (Fil Miroir + Command Center).
7. `popup/popup.html`, `popup.js`, `popup.css` (Configuration & Onboarding).
8. `dev-server.js` et `package.json` (micro-serveur Node.js natif pour test + validation syntaxique `node -c`).

Assure-toi que le code soit prêt à être chargé dans `chrome://extensions` en mode développeur, sans aucune étape de build.