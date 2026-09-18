# 🎯 PROMPT MASTER — QWEN CODER : PROJET LINGOSLIDE

Agis comme un expert en développement d'extensions Chrome Manifest V3. Je crée de zéro une nouvelle extension nommée "LingoSlide". Le dossier de destination est entièrement vide : tu dois générer TOUS les fichiers du projet, dans leur intégralité.

## CONTEXTE DU PROJET :
- Nom : LingoSlide.
- Type : Extension Web Chromium (Chrome, Edge, Brave, Thorium).
- Architecture : Side Panel First (Manifest V3).
- Stack : 100% Web Natif (JS ES6+, HTML5, CSS3). Zéro framework (React, Vue, etc.), Zéro bundler (Webpack, Vite), Zéro dépendance npm.
- Objectif : Traduction vocale/texte en temps réel pour les chats en ligne (Xbox Cloud Gaming, Discord, etc.).

## FONCTIONNALITÉS CLÉS :

### 1. SIDE PANEL (Interface Principale) :
- Un volet latéral (chrome.sidePanel) qui s'ouvre avec un raccourci (ex: Ctrl+Shift+Y).
- CONTENU :
  a. "Fil Miroir" : Liste déroulante des messages reçus (avec pseudo de l'auteur et texte traduit par le navigateur).
  b. "Command Center" : Zone de saisie rapide + Bouton "Traduire & Injecter" + Bouton "Copier" (fallback sécurité).
- Zéro configuration dans le Side Panel.

### 2. POPUP (Configuration) :
- Une petite fenêtre (chrome.action) pour configurer : Clé API Gemini, Langue cible, Modèle (3.1 Flash Lite par défaut), Raccourci clavier.
- Onboarding : Si pas de clé API, redirige vers cette popup à l'installation (chrome.runtime.onInstalled).

### 3. STRATÉGIE DE TRADUCTION HYBRIDE :
- ENTRANT (Lecture) : 0 requête API. Le navigateur traduit la page hôte nativement. Le content script observe le DOM du chat (MutationObserver), capture les messages (auteur + texte) et les affiche dans le Fil Miroir du Side Panel.
- SORTANT (Écriture) : Utilise l'API Google Gemini (REST), appelée depuis le service worker.
  - Priorité : Gemini 3.1 Flash Lite (500 req/jour, 250K TPM).
  - Fallback : Gemini 3.5 Flash Lite (500 req/jour).
  - Premium : Gemma 4 26B (14.4K req/jour, 16K TPM) pour messages complexes (>100 tokens).

### 4. INJECTION DE TEXTE (côté page hôte) :
- Le texte traduit est injecté dans le champ actif de la page hôte (Xbox, Discord).
- Méthode : Ciblage dynamique de document.activeElement.
- Événements requis : input, change, keydown/keyup (Enter) pour les sites React/SPA.
- Exclusion stricte : docs.google.com.

### 5. SPÉCIFICITÉS TECHNIQUES CRITIQUES : XBOX CLOUD GAMING (DOM)

Tu dois impérativement respecter ces contraintes techniques pour l'injection sur xbox.com/play, basées sur une analyse réelle du DOM :

A. Architecture du DOM :
- Le chat est injecté DIRECTEMENT dans le DOM principal (React #root).
- IL N'Y A PAS d'iframe, IL N'Y A PAS de Shadow DOM, IL N'Y A PAS d'isolation cross-origin.
- Conséquence : Un content script standard peut accéder au chat sans permissions spéciales.

B. Nature du Champ de Saisie :
- L'élément cible est un : <div contenteditable="true" role="textbox">
- Ce n'est PAS un <textarea> ni un <input>.
- ERREUR À ÉVITER : Ne jamais utiliser .value = "..." (ça ne marche pas).
- MÉTHODE CORRECTE : Utiliser el.textContent = "..." ou manipuler la Selection/Range.

C. Événements React Obligatoires (Virtual DOM Sync) :
Pour que React détecte le changement et active le bouton d'envoi, tu DOIS déclencher ces événements dans cet ordre strict :
1. new Event('input', { bubbles: true, cancelable: true })
2. new Event('change', { bubbles: true, cancelable: true })
3. new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
4. new KeyboardEvent('keyup', { key: 'Enter', bubbles: true })

D. Sélecteurs Stables (Anti-Fragilité) :
- INTERDIT : Utiliser les classes CSS dynamiques (ex: .xgp-reset-style, .css-xyz123). Elles changent à chaque update.
- OBLIGATOIRE : Utiliser les attributs sémantiques stables :
  - Pour l'input : document.querySelector('[contenteditable="true"][role="textbox"]')
  - Pour le bouton : document.querySelector('[aria-label*="Envoyer" i]')
  - Fallback : [aria-label*="message" i], [data-testid="chat-input"]

E. Logique d'Injection Spécifique :
- Si document.activeElement est le div contenteditable : Injection directe + événements ci-dessus.
- Si activeElement n'est pas valide : Cherche le div avec le sélecteur stable ci-dessus avant de tenter l'injection.
- Ne jamais forcer le focus si l'utilisateur est déjà en train de taper ailleurs.

F. Exclusion :
- docs.google.com est strictement exclu (pas d'injection, pas de capture).

## RÈGLES STRICTES (ANTI-HALLUCINATION) :
- Ne jamais utiliser de frameworks UI.
- Ne jamais inventer de noms de modèles API (utilise uniquement : gemini-3.1-flash-lite, gemini-3.5-flash-lite, gemma-4-26b).
- Gérer les erreurs API (429, 403) avec des fallbacks clairs et des notifications utilisateur non bloquantes (toasts).
- Code commenté en français.
- Chaque fichier généré doit être COMPLET et IMMÉDIATEMENT UTILISABLE — jamais de placeholder "// à compléter".

## TA MISSION :
Génère l'arborescence complète du projet et le code source intégral de chaque fichier nécessaire pour une version v1.0.0 fonctionnelle, sachant que rien n'existe encore.

Commence par :
1. L'arborescence des fichiers.
2. Le manifest.json (avec sidePanel, permissions, commands).
3. Le background.js (service worker : appels API Gemini, gestion des quotas, relais de messages entre Side Panel et Content Script, onboarding).
4. Le content.js (capture des messages entrants via MutationObserver + fonction d'injection du texte traduit déclenchée par message du background).
5. Le sidepanel.html / sidepanel.js / sidepanel.css (Interface Fil Miroir + Command Center).
6. Le popup.html / popup.js / popup.css (Interface Configuration).

Assure-toi que le code soit prêt à être chargé dans chrome://extensions en mode développeur, sans aucune étape de build.