# LingoSlide

Extension Chromium **Manifest V3** (*Side Panel First*) **100 % Web Natif** (JavaScript ES6+ pur, HTML5, CSS3) dédiée à la traduction bidirectionnelle en temps réel sans serveur tiers ni clé API cloud.

<p align="center">
  <img src="https://github.com/user-attachments/assets/49c3c917-4600-4bac-bcd7-58c11e536646" alt="Aperçu 1 - Éditeur et Side Panel" width="85%" />
</p>
<p align="center">
  <img src="https://github.com/user-attachments/assets/ec2e7986-e6ac-4a92-97df-f2424488ae01" alt="Aperçu 2 - Traduction des messages Discord dans le Side Panel" width="85%" />
</p>


---

## Fonctionnalités principales

### 1. Traduction bidirectionnelle 100 % locale (WICG Chrome Translator)
LingoSlide s'appuie exclusivement sur l'API native du navigateur (`globalThis.Translator` / `globalThis.translation`) avec un cache LRU bidirectionnel :

- **Fil Miroir (zone supérieure — 80 %)** :
  - Observe le conteneur de messages de l'onglet actif dans l'**ordre naturel du DOM** (du haut vers le bas) et ne conserve que les **5 derniers messages** avec filtrage des nœuds imbriqués et dédoublonnage strict par empreinte.
  - Traduit automatiquement les messages entrants dans la direction inverse (**langue de sortie → langue d'origine**) en n'affichant que le texte traduit pour préserver la compacité.
  - Purge instantanément la file d'attente et les verrous du traducteur lors des navigations SPA, rechargements (`F5`) ou changements d'onglet.
- **Centre de commande (zone inférieure — 20 %)** :
  - Saisie libre sans traduction intempestive pendant la frappe.
  - Traduction et injection déclenchées uniquement sur action explicite (`🌐 Injecter` ou `Ctrl+Entrée` / `Cmd+Entrée`) dans le sens **langue d'origine → langue de sortie**.
  - Bouton `📤 Sans traduire` pour injecter le texte brut.
  - Option `⏎ Auto-Enter` avec pause de synchronisation de `50 ms` avant l'émission de la touche `Enter`.
  - Bannière de secours avec bouton `📋 Copier` si le site hôte bloque l'injection.

### 2. Injection DOM universelle & Compatibilité Slate.js
- Résolution dynamique du champ cible au moment exact de l'injection (`input`, `textarea`, `contenteditable`, `[role="textbox"]`) sans référence DOM figée ni vol de focus pendant la rédaction.
- Prise en charge native des éditeurs React / Slate.js (Discord) via focus explicite et `InputEvent('beforeinput')`, sans altérer directement le DOM de l'éditeur.
- Garde-fou d'exclusion actif pour `docs.google.com`.

### 3. Dictée vocale (STT) par Relais de Session Web
Pour contourner les restrictions de l'API Web Speech dans les panneaux latéraux Chromium sans surcharger le CPU/GPU local, LingoSlide orchestre la dictée via une session web authentifiée de l'utilisateur :

- **Fournisseurs pris en charge** (configurés dans `extension/shared/providers.config.js`) :
  - **ChatGPT Web** (`chatgpt.com`) — *fournisseur par défaut*
  - **Gemini** (`gemini.google.com`)
  - **Mistral Le Chat** (`chat.mistral.ai`)
- **Cycle d'orchestration MV3** :
  - Le Service Worker réutilise un onglet ouvert du fournisseur choisi ou en ouvre un discrètement en arrière-plan (`active: false`).
  - Un **Offscreen Document** (`USER_MEDIA`) capture le flux audio (`MediaRecorder` Blob) pendant l'écoute et libère proprement les pistes microphone à l'arrêt.
  - Un Content Script dédié (`relay-stt-agent.js`) pilote la dictée, rapatrie le texte transcrit vers le Side Panel en temps réel, puis vide le champ texte de la page relais sans soumettre la requête.
  - En cas de session expirée ou déconnectée, une alerte non bloquante apparaît dans le Side Panel avec un bouton **« Ouvrir la connexion »**.

### 4. Page Options dédiée
Accessible via l'icône `⚙️` du Side Panel ou la page d'options de l'extension :
- Sélection explicite de la langue d'origine et de la langue de sortie.
- Diagnostic bidirectionnel en direct des paires de langues WICG Chrome et bouton de préchargement hors-ligne.
- Choix du fournisseur relais STT, test de session relais et ouverture rapide de l'onglet fournisseur.
- Sélection de la locale STT, énumération des microphones (`audioinput`) et test de niveau audio en temps réel.
- Thème (`Auto`, `Sombre`, `Clair`) et comportement `Auto-Enter` par défaut.

---

## Installation dans Chromium / Chrome / Thorium

Le code de l'extension ne nécessite **aucune étape de build** ni dépendance npm pour fonctionner. Deux points d'entrée Manifest V3 équivalents sont fournis :

1. Ouvrir `chrome://extensions` (ou `thorium://extensions`).
2. Activer le **Mode développeur**.
3. Cliquer sur **Charger l'extension non empaquetée** et sélectionner :
   - soit le dossier racine du dépôt (`manifest.json`),
   - soit directement le sous-dossier `extension/` (`extension/manifest.json`).
4. Épingler l'icône **LingoSlide** dans la barre d'outils et cliquer dessus pour ouvrir le Side Panel.

> **Prérequis navigateur :** Chrome / Chromium / Thorium récent supportant l'API native `Translator` (WICG) ainsi que les permissions MV3 `sidePanel` et `offscreen`. Pensez à autoriser le microphone dans les **Options** de l'extension lors de la première utilisation de la dictée vocale.

---

## Banc de test local (Workbench)

Un banc de test interactif (simulateur Discord / WhatsApp / Formulaire Web + aperçu du Side Panel) est inclus pour tester l'observation DOM, le dédoublonnage et l'injection en local :

```bash
npm install
npm run dev
```

Le banc de test est accessible sur `http://localhost:3000`.

### Scripts utiles

```bash
# Build de distribution dans dist/ (copie manifest.json, extension/ et workbench/)
npm run build

# Vérification TypeScript de la configuration Vite
npm run lint

# Vérification syntaxique de tous les scripts ES6+ de l'extension et du banc de test
find extension workbench -name '*.js' -print0 | xargs -0 -n1 node --check
```

---

## Structure du projet

```text
├── manifest.json                         # Manifeste MV3 (chargement depuis la racine)
├── extension/
│   ├── manifest.json                     # Manifeste MV3 autonome (chargement depuis extension/)
│   ├── assets/                           # Icônes officielles (16x16, 48x48, 128x128)
│   ├── background/
│   │   └── service-worker.js             # Routage MV3, buffers FIFO, orchestrateur relais STT
│   ├── content/
│   │   ├── content-main.js               # Bootstrap content script & garde-fou docs.google.com
│   │   ├── dom-adapter.js                # Résolution dynamique de cible & injection beforeinput/Slate.js
│   │   ├── feed-observer.js              # Extraction DOM pure (5 derniers nœuds) & dédoublonnage
│   │   └── relay-stt-agent.js            # Agent relais sur ChatGPT / Gemini / Mistral
│   ├── offscreen/
│   │   ├── offscreen.html
│   │   └── offscreen.js                  # Capture audio getUserMedia + MediaRecorder (Blob)
│   ├── options/
│   │   ├── options.html
│   │   ├── options.css
│   │   └── options.js                    # Langues, diagnostic WICG, micro Windows & relais STT
│   ├── shared/
│   │   ├── constants.js                  # Types de messages, langues supportées & empreinte
│   │   ├── native-translator.js          # Wrapper WICG Translator, cache LRU & purge SPA
│   │   ├── providers.config.js           # Configuration déclarative des fournisseurs STT Web
│   │   └── storage-schema.js             # Persistance chrome.storage.local / localStorage
│   └── sidepanel/
│       ├── sidepanel.html
│       ├── sidepanel.css
│       ├── sidepanel.js                  # Fil Miroir (80%) & Centre de commande (20%)
│       └── speech-controller.js          # Contrôleur STT local (fallback hors contexte MV3)
├── workbench/                            # Banc de test interactif (simulateur hôte + aperçu)
├── index.html
├── package.json
├── tsconfig.json
└── vite.config.ts
```

---

## Ajouter ou mettre à jour un fournisseur STT

Les sélecteurs CSS et URL cibles sont isolés dans `extension/shared/providers.config.js`. Pour ajuster un sélecteur ou ajouter un fournisseur web, il suffit d'éditer `STT_PROVIDERS` (et d'ajouter son domaine dans `host_permissions` des manifestes MV3) sans modifier le code cœur du Service Worker ni du Side Panel.
