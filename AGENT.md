🧠 AGENT.md — Ancrage Mémoire & Carnet de Bord : LingoSlide (v1.0.0)

1. 🛡️ Règles & Engagements de l'Agent de Développement (v1.0.0)
Développement 100 % Web Natif : JavaScript ES6+ pur, HTML5 sémantique et CSS3 moderne. Standard Chromium Manifest V3 exclusif.

Interdictions formelles :

Aucun framework UI : Interdiction totale de React, Next.js, Angular, Vue.js, Svelte, etc. pour le code de l'extension.

Aucun sur-langage : Interdiction absolue de TypeScript (.ts, .tsx) ou CoffeeScript.

Aucun bundler ou serveur de build : Aucun recours à Vite, Bun, Webpack, Rollup ou serveurs Express.

Absence totale de dépendances externes : Zéro paquet npm tiers.

Utilisation exclusive des API Web et Chromium natives (chrome.storage.local, chrome.runtime, chrome.sidePanel, chrome.commands, chrome.offscreen, window.SpeechRecognition, fetch, DOM & Events standards).

Obligation de Livraison Physique sur Disque :

Toute création, modification ou refonte de fichier doit impérativement passer par une écriture physique dans le système de fichiers du projet (ex: /workspace).

L'affichage de blocs de code dans la fenêtre de tchat ne constitue en aucun cas une livraison. Un fichier n'est considéré comme produit que s'il est physiquement présent dans le dépôt.

Vérification d'existence préalable : L'agent doit contrôler la présence effective et l'intégrité des fichiers sur le disque avant de déclarer une tâche terminée.

Procédure d'Auto-Révision, Auto-Audit & Inspection du Diff (Code Review) :

Poste de contrôle d'auto-audit : Après toute modification physique sur le disque, l'agent doit exécuter une passe de relecture critique (« Relis ces modifications et relève les risques ») pour identifier les fuites mémoire, les stale nodes et les ruptures d'API.

Inspection du Diff : L'agent analyse systématiquement le git diff ou le différentiel textuel avant de solliciter une validation.

Cohérence d'architecture : Vérification des contrats d'interface entre background.js, content.js, sidepanel.js et popup.js.

Environnement de test & Validation Syntaxique :

Analyse statique et syntaxique obligatoire des scripts via node -c <fichier.js> avant toute validation.

Micro-serveur statique Node.js 100 % natif (dev-server.js) utilisant uniquement l'API node:http (port 3000) pour l'hébergement de développement.

2. 🎯 Vision Globale & Séparation Fonctionnelle (v1.0.0)
LingoSlide v1.0.0 adopte une architecture hybride optimisée pour les tchats en direct (notamment Xbox Cloud Gaming sur https://www.xbox.com/play/*, Discord Web, etc.).

A. Répartition des Interfaces (UI)

POPUP DE LA BARRE D'OUTILS (popup/) — Réglages & Configuration Exclusive :

Onboarding prioritaire : À la première installation (chrome.runtime.onInstalled), l'extension redirige immédiatement l'utilisateur vers le Popup/Options pour saisir sa clé API Gemini. Tant que la clé est absente, l'injection reste inactive avec un avertissement visuel.

Stockage centralisé (chrome.storage.local) :

Clé API Google Gemini (AI Studio).

Sélection du modèle (gemini-3.1-flash-lite par défaut, gemini-3.5-flash-lite, gemma-4-26b).

Langue cible de traduction sortante.

Interrupteur Auto-Envoi (autoSend) : Activer/désactiver l'envoi automatique avec la touche Enter après injection.

Configuration du raccourci clavier : Champ de saisie dynamique pour personnaliser la combinaison d'activation.

SIDE PANEL (sidepanel/) — Fil de Conversation & Dictée Épurés :

Interface 100 % dédiée au flux de tchat : Aucun bouton de configuration, aucune clé API ni paramètre n'apparaît dans le Side Panel.

Capture structurée des interlocuteurs : Affiche les messages du fil sous forme d'objets structurés : { author: "Pseudo", text: "Message traduit", timestamp: "12:34", id: "unique_id" }.

Command Center d'écriture : Zone de prévisualisation de la dictée vocale / saisie texte rapide avec boutons Traduire & Injecter et Copier.

B. Stratégie de Traduction Hybride & Zéro Quota Entrant

Traduction Entrante (Lecture du Tchat) :

Déléguée 100 % au navigateur : L'extension s'appuie sur le moteur de traduction native Chromium (Chrome/Edge Translate) pour traduire la page web d'origine.

Consommation API Gemini : STRICTEMENT 0 REQUÊTE pour la lecture. Les 500 requêtes/jour du quota gratuit sont préservées à 100 % pour vos envois.

Le script content.js capture les blocs du tchat traduits par le navigateur et transmet la structure (auteur + texte) au Side Panel.

Traduction Sortante (Écriture & Dictée Vocale) :

Gérée par LingoSlide + API REST Gemini (gemini-3.1-flash-lite).

Saisie texte ou dictée vocale locale (Web Speech API via offscreen) → Traduction via Gemini → Injection dans la zone active de la page web hôte.

3. ⚡ Contraintes Architecturales Strictes pour React & SPA (Xbox Cloud Gaming, Discord)
Le tchat Xbox Cloud Gaming s'exécute directement dans le DOM principal (#root, sans iframe ni Shadow DOM), mais repose sur l'architecture React. L'injection de texte doit respecter des règles strictes pour synchroniser le Virtual DOM :

Ciblage dynamique & Perte de focus (document.activeElement) :

Résolution de l'élément actif au moment exact de l'injection.

Gestion de perte de focus : Lorsqu'un clic survient dans le Side Panel, l'élément actif sur la page web peut devenir <body>. Le script doit alors chercher en priorité les sélecteurs sémantiques stables :

[contenteditable="true"][role="textbox"]

[aria-label="Envoyer" i], [aria-label="message" i], [placeholder*="message" i]

textarea, input[type="text"]

Aucune référence DOM conservée en variable globale pour éviter les références obsolètes (stale nodes) dues aux re-rendus React.

Gestion des zones contenteditable="true" et [role="textbox"] :

Injection directe dans la structure textuelle de l'élément cible via textContent ou manipulation propre de Selection/Range.

Émission impérative des événements synthétiques :

javascript
el.dispatchEvent(new Event('input', { bubbles: true, cancelable: true, composed: true }));
el.dispatchEvent(new Event('change', { bubbles: true, cancelable: true, composed: true }));
Micro-pause Asynchrone de 50ms & Synchronisation React State :

Attente explicite de 50ms avant déclenchement de la touche Enter :

javascript
await new Promise(resolve => setTimeout(resolve, 50));
el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
Exclusion Stricte : docs.google.com est formellement exclu du périmètre d'injection.

4. 🏛️ Architecture Modulaire & Flux de Données
text
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                                   NAVIGATEUR CHROMIUM (MV3)                                 │
│                                                                                             │
│  [POPUP BARRE D'OUTILS : REGLAGES]         [SIDE PANEL : CHAT & DICTÉE]                     │
│  /popup/popup.html + popup.js               /sidepanel/sidepanel.html + sidepanel.js        │
│  - Config Clé API Gemini (Obligatoire)      - Fil de conversation épuré (0 réglage)        │
│  - Sélection Langue & Modèle                - Affichage Pseudos + Messages traduits         │
│  - Interrupteur Auto-Envoi (autoSend)       - Prévisualisation dictée vocale                │
│  - Enregistrement Raccourci Clavier         - Bouton Traductions & Injection                │
│              │                                           │                                  │
│              └─────────────────┬─────────────────────────┘                                  │
│                                │ Synchronisation storage                                    │
│                                ▼                                                            │
│  ┌───────────────────────────────────────────────────────────────────────────────────────┐  │
│  │                    SERVICE WORKER ÉPHÉMÈRE (background.js)                            │  │
│  │  - Redirection vers Popup si Clé API manquante à l'installation                       │  │
│  │  - Exécute les requêtes de traduction sortante via l'API REST Gemini                   │  │
│  │  - Gère les commandes clavier globales (chrome.commands)                              │  │
│  │  - Relais bidirectionnel entre Side Panel et Content Script                            │  │
│  └──────────────────────────────────────────┬────────────────────────────────────────────┘  │
│                                             │                                               │
│                                             │ chrome.tabs.sendMessage                       │
│                                             ▼                                               │
│  ┌───────────────────────────────────────────────────────────────────────────────────────┐  │
│  │                     ONGLET WEB ACTIF (content.js — Moteur Unique)                     │  │
│  │                                                                                       │  │
│  │  [TRANSDUCTION SORTANTE (INJECTION)]                                                  │  │
│  │  - Injection dans document.activeElement ou sélecteur de secours (Xbox #root)           │  │
│  │  - Émission des événements React (input, change) + micro-pause (50ms)                 │  │
│  │  - Envoi automatique si autoSend === true (Simulation Touche Enter)                   │  │
│  │                                                                                       │  │
│  │  [CAPTURE ENTRANTE (LECTURE DU CHAT)]                                                 │  │
│  │  - Capture du texte traduit par le navigateur + détection du pseudo auteur              │  │
│  │  - Transmission de l'objet { author, text, timestamp, id } au Side Panel              │  │
│  └───────────────────────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
5. 📂 Arborescence du Projet
text
LingoSlide/
├── AGENT.md                    # Carnet de bord & spécifications architecturales (v1.0.0)
├── PromptMasterQwenCoder.md    # Directive d'amorçage, System Instructions & Auto-Audit
├── manifest.json               # Manifest V3 (declarations sidePanel, commands, storage, activeTab)
├── background.js               # Service Worker d'arrière-plan (Gemini API, routing, onboarding)
├── content.js                  # Script d'injection DOM & capture des messages du tchat
├── offscreen/                  # Captation vocale locale Web Speech API (0 réseau)
│   ├── offscreen.html
│   └── offscreen.js
├── popup/                      # Interface de Configuration & Réglages
│   ├── popup.html              # Vue Clé API, Langue, Modèle, Auto-Envoi, Raccourci
│   ├── popup.js                # Logic de sauvegarde chrome.storage.local
│   └── popup.css               # Styles du panneau d'options
├── sidepanel/                  # Fil de Conversation & Command Center Épuré
│   ├── sidepanel.html          # Chat épuré + zone de dictée rapide
│   ├── sidepanel.js            # Affichage des messages structurés (Pseudo + Texte)
│   └── sidepanel.css           # Feuille de styles du fil de discussion
├── icons/                      # Icônes de l'extension (16, 48, 128 px)
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
├── dev-server.js               # Micro-serveur statique Node.js natif pour sandbox Cloud Run (port 3000)
└── package.json                # Validation statique (node -c, zéro dépendance npm)
6. 🛡️ Modèle de Données chrome.storage.local
json
{
  "apiKey": "AIzaSy...",
  "selectedModel": "gemini-3.1-flash-lite",
  "targetLang": "en",
  "autoSend": true,
  "customShortcut": "Ctrl+Shift+Y"
}
7. 🛡️ Configuration API Gemini (Identifiants REST Stricts)
Libellé Interface	Identifiant API REST Strict	TPM	RPM	RPD	Rôle dans LingoSlide
Gemini 3.1 Flash Lite	gemini-3.1-flash-lite	250K	15	500	MODÈLE PRINCIPAL
Gemini 3.5 Flash Lite	gemini-3.5-flash-lite	250K	15	500	FALLBACK DIRECT
Gemma 4 26B	gemma-4-26b	16K	30	14.4K	PREMIUM (Cas complexes)
8. 🔴 Gestion des Erreurs & Fallbacks
Code HTTP	Message UI (Toast)	Action
429	"Quota quotidien épuisé"	Bascule vers le modèle suivant disponible (gemini-3.5-flash-lite puis gemma-4-26b)
403	"Clé API invalide"	Redirige vers le Popup + désactive l'injection
400	"Message trop long (>2000 chars)"	Tronque automatiquement + avertissement
500+	"Service temporairement indisponible"	Timeout 10s → Retry 3 fois → Fallback "copier dans le presse-papier"
9. 🎮 Spécificités Techniques : Xbox Cloud Gaming
Conteneur principal : #root ou #gamepass-dialog-root (React).

Isolation : Aucune iframe, aucun Shadow DOM. Accès direct via content script.

Élément cible : <div contenteditable="true" role="textbox">.

Séquence d'injection : textContent → événements synthétiques input/change → micro-pause 50ms → simulation keydown/keyup Enter.
