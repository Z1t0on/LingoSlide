# 🌐 LingoSlide v1.0.0
> **Parle le monde entier, sans quitter ton jeu.**

Une extension de navigateur **Chromium** (Chrome, Edge, Brave, Thorium) conçue pour briser les barrières linguistiques dans les chats en temps réel.

---

## 🚀 Ce que fait LingoSlide

Imagine que tu joues sur **Xbox Cloud Gaming** ou discutes sur **Discord** avec des joueurs anglophones, mais que tu ne parles pas leur langue. LingoSlide résout le problème en deux étapes simples :

1.  **👀 Lecture Immédiate (Fil Miroir)**
    *   Il ouvre un **panneau latéral élégant** à côté de ton écran.
    *   Il y affiche tous les messages reçus, **déjà traduits** grâce à la traduction native de ton navigateur.
    *   Tu vois qui parle (pseudo + avatar) et ce qu'ils disent, sans jamais quitter ton jeu.

2.  **✍️ Écriture Fluide (Command Center)**
    *   Tu tapes ton message en français dans le panneau.
    *   LingoSlide le traduit instantanément en anglais (ou autre) via l'IA.
    *   Il **injecte automatiquement** le texte traduit dans la zone de chat du jeu, comme si tu l'avais tapé toi-même.
    *   *Option "Auto-Envoi"* : Le message part tout seul dès que tu as fini.

---

## 🛡️ Pourquoi LingoSlide est différent

| Fonctionnalité | LingoSlide | Autres extensions |
|----------------|------------|-------------------|
| **Architecture** | **Side Panel First** (Zéro conflit avec le jeu) | Overlays intrusifs qui cachent l'écran |
| **Traduction Entrante** | **Gratuite & Illimitée** (Utilise le navigateur) | Coûteux en crédits API |
| **Traduction Sortante** | **Intelligente** (Choisit le meilleur modèle IA) | Souvent un seul modèle rigide |
| **Injection** | **Respectueuse** (Simule un humain) | Souvent bloquée par les anti-cheats |
| **Confidentialité** | **Clé API personnelle** (Tu gardes le contrôle) | Données envoyées à des serveurs tiers obscurs |

---

## 🎯 Cas d'Usage Parfaits

*   🎮 **Xbox Cloud Gaming** : Jouer avec des communautés internationales sans comprendre un mot.
*   💬 **Discord Web** : Participer à des serveurs étrangers sans changer de langue.
*   🌍 **Slack / Teams** : Collaborer avec des équipes multilingues.
*   🗣️ **Dictée Vocale** : Parler ton message, LingoSlide le traduit et l'écrit pour toi.

---

## ⚙️ Configuration Requise

*   **Navigateur** : Chrome, Edge, Brave, Thorium (basés sur Chromium, Manifest V3).
*   **Compte Google** : Nécessaire pour obtenir une clé API gratuite sur [Google AI Studio](https://aistudio.google.com/).
*   **Modèles utilisés** : Gemini 3.1/3.5 Flash Lite (Rapide & Économique) et Gemma 4 26B (Qualité supérieure).

---

## 📥 Installation Rapide

1.  **Télécharge** le dossier du projet.
2.  Ouvre `chrome://extensions` dans ton navigateur.
3.  Active le **Mode Développeur** (en haut à droite).
4.  Clique sur **"Charger l'extension non emballée"** et sélectionne le dossier `LingoSlide`.
5.  Clique sur l'icône de l'extension → Saisis ta clé API Gemini.
6.  Ouvre Xbox ou Discord → Appuie sur `Ctrl+Shift+Y` pour ouvrir le panneau !

---

## 🧠 Architecture Technique (Pour les curieux)

*   **100% Web Natif** : Aucun framework (React/Vue), aucun bundler. Juste du JavaScript pur, rapide et léger.
*   **Side Panel API** : Utilise l'API native `chrome.sidePanel` pour une intégration parfaite.
*   **Hybridation Intelligente** :
    *   Lecture = Traduction navigateur (0 coût).
    *   Écriture = API Gemini (optimisée par quota).
*   **Anti-Fragilité** : Utilise des sélecteurs sémantiques (`[role="textbox"]`) au lieu des classes CSS changeantes pour rester stable malgré les mises à jour des sites.

---

## 🤝 Contribuer & Feedback

Ce projet est né d'un besoin personnel de jouer sans barrière. Si tu rencontres un bug ou as une idée d'amélioration, n'hésite pas à ouvrir une issue !

*Développé avec ❤️ par Zit0on.*