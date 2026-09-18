# 🧠 AGENT.md — Ancrage Mémoire & Carnet de Bord : LingoSlide (v1.0.0)

> **Projet** : Extension Web Chromium — **LingoSlide**  
> **Version** : 1.1.0 (Architecture Side Panel First & Traduction Hybride)  
> **Standard** : Manifest V3 (Google Chrome, Thorium Browser, Brave, Microsoft Edge)  
> **Statut** : Verrouillé — Développement 100 % Web Natif, zéro framework, zéro bundler, zéro dépendance externe.

---

## 1. 📜 Directives Absolues & Règles d'Or

1. **Règle d'or** :
   - Développement **100 % Web Natif** : **JavaScript ES6+ pur**, **HTML5 sémantique** et **CSS3 moderne**.
   - Standard Chromium **Manifest V3** exclusif.

2. **Interdictions formelles** :
   - **Aucun framework UI** : Interdiction totale de React, Next.js, Angular, Vue.js, Svelte, etc. pour le code de l'extension.
   - **Aucun sur-langage** : Interdiction absolue de TypeScript (`.ts`, `.tsx`) ou CoffeeScript.
   - **Aucun bundler ou serveur de build** : Aucun recours à Vite, Bun, Webpack, Rollup ou serveurs Express.

3. **Environnement de test & Validation** :
   - **Analyse statique et syntaxique** des scripts via `node -c`.
   - Micro-serveur statique **Node.js 100 % natif** (`dev-server.js`) utilisant uniquement l'API `node:http` (port 3000) pour l'hébergement dans la sandbox Cloud Run.

4. **Absence totale de dépendances externes** :
   - Zéro paquet `npm` tiers.
   - Utilisation exclusive des API Web et Chromium natives (`chrome.storage.local`, `chrome.runtime`, `chrome.sidePanel`, `chrome.commands`, `chrome.offscreen`, `window.SpeechRecognition`, `fetch`, DOM & Events standards).

---

## 2. 🎯 Vision Globale & Séparation Fonctionnelle (v1.0.0)

LingoSlide v1.0.0 adopte une architecture hybride optimisée pour les tchats en direct (notamment **Xbox Cloud Gaming** sur `https://www.xbox.com/play/*`, Discord Web, etc.) :

### A. Répartition des Interfaces (UI)
* **POPUP DE LA BARRE D'OUTILS (`popup/`) — Réglages & Configuration Exclusive** :
  - **Onboarding prioritaire** : À la première installation (`chrome.runtime.onInstalled`), l'extension redirige immédiatement l'utilisateur vers le Popup/Options pour saisir sa clé API Gemini. Tant que la clé est absente, l'injection reste inactive avec un avertissement visuel.
  - **Stockage centralisé** (`chrome.storage.local`) :
    1. Clé API Google Gemini (AI Studio).
    2. Sélection du modèle (`gemini-3.5-flash-lite` / `gemini-3.1-flash-lite`).
    3. Langue cible de traduction sortante.
    4. **Interrupteur Auto-Envoi (`autoSend`)** : Activer/désactiver l'envoi automatique avec la touche `Enter` après injection.
    5. **Configuration du raccourci clavier** : Champ de saisie dynamique pour personnaliser la combinaison d'activation.

* **SIDE PANEL (`sidepanel/`) — Fil de Conversation & Dictée Épurés** :
  - **Interface 100 % dédiée au flux de tchat** : Aucun bouton de configuration, aucune clé API ni paramètre n'apparaît dans le Side Panel.
  - **Capture structurée des interlocuteurs** : Affiche les messages du fil sous forme d'objets structurés : ` { author: "Pseudo", text: "Message traduit", timestamp: "12:34", id: "unique_id" }`.
  - **Command Center d'écriture** : Zone de prévisualisation de la dictée vocale / saisie texte rapide avec boutons *Traduire & Injecter* et *Copier*.

---

### B. Stratégie de Traduction Hybride & Zéro Quota Entrant
1. **Traduction Entrante (Lecture du Tchat)** :
   - **Déléguée 100 % au navigateur** : L'extension s'appuie sur le moteur de traduction native Chromium (Chrome/Edge Translate) pour traduire la page web d'origine.
   - **Consommation API Gemini : STRICTEMENT 0 REQUÊTE** pour la lecture. Les 500 requêtes/jour du quota gratuit sont préservées à 100 % pour vos envois.
   - Le script `content.js` capture les blocs du tchat traduits par le navigateur et transmet la structure (auteur + texte) au Side Panel.

2. **Traduction Sortante (Écriture & Dictée Vocale)** :
   - Gérée par **LingoSlide + API REST Gemini** (`gemini-3.1-flash-lite`).
   - Saisie texte ou dictée vocale locale (`Web Speech API` via `offscreen`) $\rightarrow$ Traduction via Gemini $\rightarrow$ Injection dans la zone active de la page web hôte.

---

## 3. ⚡ Contraintes Architecturales Strictes pour React & SPA (Xbox Cloud Gaming, Discord)

Le tchat Xbox Cloud Gaming s'exécute directement dans le DOM principal (`#root`, sans `iframe` ni Shadow DOM), mais repose sur l'architecture React. L'injection de texte doit respecter des règles strictes pour synchroniser le Virtual DOM :

1. **Ciblage dynamique à la volée (`document.activeElement`)** :
   - Résolution de l'élément actif au moment exact de l'injection via `getDeepActiveElement`.
   - **Aucune référence DOM conservée en variable globale** pour éviter les références obsolètes (*stale nodes*) dues aux re-rendus React.

2. **Gestion des zones `contenteditable="true"` et `[role="textbox"]`** :
   - Injection directe dans la structure textuelle de l'élément cible.
   - **Émission impérative des événements synthétiques** :
     ```javascript
     el.dispatchEvent(new Event('input', { bubbles: true, cancelable: true, composed: true }));
     el.dispatchEvent(new Event('change', { bubbles: true, cancelable: true, composed: true }));
     ```

3. **Validation et Envoi Automatique (`autoSend`)** :
   - Si l'option `autoSend` est active dans `chrome.storage.local`, l'injection est immédiatement suivie de l'émission des événements clavier pour la touche **Entrée** :
     ```javascript
     el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
     el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
     ```

4. **Sélecteurs de repli d'accessibilité (Fallback)** :
   - Si `document.activeElement` n'est pas un champ de saisie validé, recherche prioritaire sur :
     - `[contenteditable="true"][role="textbox"]`
     - `[aria-label*="Envoyer" i]`, `[aria-label*="message" i]`, `[placeholder*="message" i]`
     - `textarea`, `input[type="text"]`

5. **Exclusion Stricte** :
   - `docs.google.com` est formellement exclu du périmètre d'injection.

---

## 4. 🏛️ Architecture Modulaire & Flux de Données

```
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
│  │  - Injection dans document.activeElement (<div contenteditable="true">, Xbox #root)    │  │
│  │  - Émission des événements React (input, change)                                      │  │
│  │  - Envoi automatique si autoSend === true (Simulation Touche Enter)                   │  │
│  │                                                                                       │  │
│  │  [CAPTURE ENTRANTE (LECTURE DU CHAT)]                                                 │  │
│  │  - Capture du texte traduit par le navigateur + détection du pseudo auteur              │  │
│  │  - Transmission de l'objet { author, text, timestamp, id } au Side Panel              │  │
│  └───────────────────────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 5. 📂 Arborescence du Projet

```
LingoSlide/
├── AGENT.md                    # Carnet de bord & spécifications architecturales (v1.0.0)
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
```

---

## 6. 🛡️ Modèle de Données `chrome.storage.local`

Les paramètres enregistrés et partagés entre le Popup, le Side Panel, le Background et le Content Script respectent la structure JSON suivante :

```json
{
  "apiKey": "AIzaSy...",
  "selectedModel": "gemini-3.1-flash-lite",
  "targetLang": "en",
  "autoSend": true,
  "customShortcut": "Ctrl+Shift+Y"
}
```

---

## 7. 🛡️ Configuration API Gemini (Stratégie Optimale)

### Modèles Disponibles & Rôle

| Modèle | TPM | RPM | RPD | Rôle dans LingoSlide|
|--------|-----|-----|-----|----------------------|
| **Gemini 3.1 Flash Lite** | **250K** | 15 | 500 | **MODÈLE PRINCIPAL** |
| **Gemini 3.5 Flash Lite** | **250K** | 15 | 500 | **FALLBACK DIRECT** |
| **Gemma 4 26B** | 16K | 30 | 14.4K | **Premium (cas complexes)** |

### Pourquoi cette hiérarchie ?

**Priorité Flash Lite :**
- **250K tokens/min** = 15.6x plus rapide que Gemma
- Idéal pour le chat en temps réel (latence <1s)
- 500 req/jour = 15-20K messages/mois suffisent pour usage intensif

**Gemma 4 26B en second :**
- **16K tokens/min** = throughput limité
- Usage : messages >100 tokens, nuances culturelles
- Basculer seulement quand qualité > vitesse nécessaire

**Exemple concret :**
- Message court ("Hello ! Comment ça va ?") → Flash Lite (rapide)
- Phrase complexe ("La nuance politique du discours de Macron sur..." ) → Gemma (qualité

---

## 8. 🛡️ Journal des Modifications (Changelog)

### [1.1.0] - Refonte UI Side Panel First & Traduction Hybride
- **Séparation UI stricte** :
  - Le Popup est désormais le centre de configuration unique (Clé API, langue, modèle, auto-envoi `autoSend`, raccourci personnalisé).
  - Le Side Panel est 100 % dédié à l'affichage du fil de tchat et au panneau de dictée.
- **Zéro Quota en Lecture** :
  - Traduction des messages entrants déléguée à la traduction native du navigateur Chromium.
  - Capture structurée des pseudos d'auteurs et transmission au Side Panel sous forme d'objets `{ author, text, timestamp, id }`.
- **Injection React & Auto-Envoi** :
  - Injection dans les zones `contenteditable="true"` (Xbox Cloud Gaming `#root`) avec déclenchement obligatoire des événements `input` et `change`.
  - Prise en charge de l'option `autoSend` déclenchant la simulation de la touche `Enter`.

---

## 9. 🔴 Gestion des Erreurs & Fallbacks

| Code HTTP | Message UI (Toast) | Action |
|-----------|-------------------|--------|
| 429 | "Quota quotidien épuisé" | Bascule vers le modèle suivant disponible |
| 403 | "Clé API invalide" | Redirige vers la Popup + désactive l'injection |
| 400 | "Message trop long (>2000 chars)" | Tronque automatiquement + avertissement |
| 500+ | "Service temporairement indisponible" | Timeout 10s → Retry 3 fois → Fallback "envoyer brut" |

- **Compteur de requêtes** : Stocke le nombre de requêtes/jour dans `chrome.storage.local` avec reset à minuit UTC.
- **Alerte à 80%** : Toast "400/500 requêtes utilisées aujourd'hui".
- **Logs locaux** : Dernière erreur stockée pour débogage (`lastError` key).

---

## 10. 🎮 Spécificités Techniques : Xbox Cloud Gaming

### Architecture DOM
- **Conteneur principal** : `#root` ou `#gamepass-dialog-root` (React)
- **Isolation** : Aucune iframe, aucun Shadow DOM. Accès direct via content script.
- **Zone de chat** : Injectée directement dans le DOM parent.

### Injection de Message (Critique)
- **Élément cible** : `<div contenteditable="true" role="textbox">`
- **Méthode** : `element.textContent = "..."` (NE PAS utiliser .value)
- **Événements requis** :
  1. `input` (bubbles: true)
  2. `change` (bubbles: true)
  3. `keydown` + `keyup` (Key: "Enter") pour l'envoi

### Sélecteurs Stables (Anti-Fragilité)
- **Input** : `[contenteditable="true"][role="textbox"]`
- **Bouton Envoi** : `[aria-label*="Envoyer"]` ou `[data-testid="chat-send"]`
- **Conteneur Chat** : `[data-testid="chat-messages"]` (si disponible)

### Exclusion
- Ne jamais cibler les classes générées dynamiquement (ex: `xgp-*`).
