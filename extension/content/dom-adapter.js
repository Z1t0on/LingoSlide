/**
 * LingoSlide V2.1 Native Edition — Adaptateur DOM dynamique
 * Résout dynamiquement le champ de saisie cible au moment exact de l'injection.
 * Pour Discord / Slate.js : focus explicite + InputEvent('beforeinput') natif,
 * sans modification DOM directe ni execCommand.
 */

import { AUTO_ENTER_DELAY_MS } from '../shared/constants.js';

function isElementVisible(el) {
  if (!el || !(el instanceof Element)) return false;
  const style = globalThis.getComputedStyle?.(el);
  if (!style || style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
    return false;
  }
  const rect = el.getBoundingClientRect();
  return rect.width > 12 && rect.height > 12;
}

function isEditableElement(el) {
  if (!el || !(el instanceof HTMLElement)) return false;
  if (el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true') {
    return false;
  }
  if (el instanceof HTMLTextAreaElement) {
    return !el.readOnly;
  }
  if (el instanceof HTMLInputElement) {
    const allowedTypes = new Set(['text', 'search', 'url', 'email', 'tel', '']);
    return allowedTypes.has((el.type || '').toLowerCase()) && !el.readOnly;
  }
  if (
    el.isContentEditable ||
    el.getAttribute('contenteditable') === 'true' ||
    el.getAttribute('role') === 'textbox' ||
    el.hasAttribute('data-slate-editor')
  ) {
    return true;
  }
  return false;
}

function isSlateEditor(el) {
  if (!el || !(el instanceof Element)) return false;
  return Boolean(
    el.hasAttribute('data-slate-editor') ||
      el.querySelector('[data-slate-node]') ||
      el.closest('[data-slate-editor="true"]')
  );
}

function hasSlatePlaceholder(el) {
  return Boolean(el?.querySelector?.('[data-slate-placeholder="true"]'));
}

function scoreCandidate(el) {
  const rect = el.getBoundingClientRect();
  let score = 0;

  if (el === document.activeElement) score += 25;
  if (el.hasAttribute('data-slate-editor')) score += 45;
  if (el.getAttribute('role') === 'textbox') score += 30;
  if (el.isContentEditable) score += 20;
  if (el instanceof HTMLTextAreaElement) score += 20;

  const hint = [
    el.getAttribute('aria-label') || '',
    el.getAttribute('placeholder') || '',
    el.getAttribute('data-testid') || '',
    el.getAttribute('name') || '',
    el.id || ''
  ]
    .join(' ')
    .toLowerCase();

  if (/(message|chat|reply|répondre|envoyer|composer|comment|ecrire|écrire|textbox)/.test(hint)) {
    score += 45;
  }
  if (/(search|recherch|filter|filtre)/.test(hint)) {
    score -= 35;
  }

  if (rect.top > globalThis.innerHeight * 0.45) {
    score += 15;
  }

  score += Math.min(20, Math.round(rect.width / 40));
  return score;
}

/**
 * Résout dynamiquement le meilleur champ texte éditable de la page courante.
 */
export function resolveTargetEditable(root = document) {
  const active = document.activeElement;
  if (active instanceof HTMLElement && isEditableElement(active) && isElementVisible(active)) {
    const hint = (active.getAttribute('aria-label') || active.getAttribute('placeholder') || '').toLowerCase();
    if (!/(search|recherch)/.test(hint)) {
      return active;
    }
  }

  const selector = [
    '[data-slate-editor="true"][contenteditable="true"]',
    '[role="textbox"][contenteditable="true"]',
    '[contenteditable="true"]',
    'textarea',
    'input[type="text"]',
    'input:not([type])',
    '[role="textbox"]'
  ].join(', ');

  const candidates = Array.from(root.querySelectorAll(selector)).filter(
    (el) => isEditableElement(el) && isElementVisible(el)
  );

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((a, b) => scoreCandidate(b) - scoreCandidate(a));
  return candidates[0];
}

function setNativeValue(el, value) {
  const proto =
    el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
  if (descriptor && typeof descriptor.set === 'function') {
    descriptor.set.call(el, value);
  } else {
    el.value = value;
  }
}

function dispatchInputEvents(el, text) {
  try {
    el.dispatchEvent(
      new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertText',
        data: text
      })
    );
  } catch {
    // Fallback si InputEvent restreint
  }

  try {
    el.dispatchEvent(
      new InputEvent('input', {
        bubbles: true,
        inputType: 'insertText',
        data: text
      })
    );
  } catch {
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  el.dispatchEvent(new Event('change', { bubbles: true }));
}

function getNormalizedContentText(el) {
  return (el.innerText || el.textContent || '')
    .replace(/\u200B|\uFEFF/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function positionSelectionForBeforeInput(el, slateMode) {
  el.focus({ preventScroll: false });

  const selection = globalThis.getSelection?.();
  if (!selection) return;

  const range = document.createRange();
  if (slateMode) {
    const editableLeaf = el.querySelector('[data-slate-node="element"]') || el;
    if (!hasSlatePlaceholder(el) && getNormalizedContentText(el).length > 0) {
      range.selectNodeContents(editableLeaf);
    } else {
      const caretAnchor =
        el.querySelector('[data-slate-zero-width]') ||
        el.querySelector('[data-slate-string="true"]') ||
        editableLeaf;
      range.selectNodeContents(caretAnchor);
      range.collapse(false);
    }
  } else {
    range.selectNodeContents(el);
  }

  selection.removeAllRanges();
  selection.addRange(range);
}

/**
 * Injecte dans un champ contenteditable via InputEvent('beforeinput') natif.
 * Sur Discord / Slate.js : aucune modification DOM directe ni execCommand.
 */
async function injectIntoContentEditable(el, text) {
  const slateMode = isSlateEditor(el);
  const expected = text.replace(/\s+/g, ' ').trim();

  positionSelectionForBeforeInput(el, slateMode);

  const beforeInputEvent = new InputEvent('beforeinput', {
    inputType: 'insertText',
    data: text,
    bubbles: true,
    cancelable: true
  });

  const notCanceled = el.dispatchEvent(beforeInputEvent);

  // Laisser une micro-trame au state React / Slate pour traiter beforeinput
  await new Promise((resolve) => setTimeout(resolve, 16));

  // Fallback uniquement pour les champs contenteditable simples (non-Slate)
  // lorsque aucun gestionnaire beforeinput n'a intercepté et appliqué le texte.
  if (!slateMode && notCanceled && !getNormalizedContentText(el).includes(expected)) {
    el.textContent = text;
    const selection = globalThis.getSelection?.();
    if (selection) {
      const endRange = document.createRange();
      endRange.selectNodeContents(el);
      endRange.collapse(false);
      selection.removeAllRanges();
      selection.addRange(endRange);
    }
    try {
      el.dispatchEvent(
        new InputEvent('input', {
          inputType: 'insertText',
          data: text,
          bubbles: true
        })
      );
    } catch {
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  return {
    placeholderCleared: !hasSlatePlaceholder(el),
    slateMode
  };
}

function dispatchEnterSequence(fallbackTarget) {
  const activeTarget =
    document.activeElement instanceof HTMLElement &&
    isEditableElement(document.activeElement)
      ? document.activeElement
      : fallbackTarget;

  if (!activeTarget) return;

  activeTarget.focus({ preventScroll: false });

  const eventInit = {
    key: 'Enter',
    code: 'Enter',
    keyCode: 13,
    which: 13,
    bubbles: true,
    cancelable: true
  };

  activeTarget.dispatchEvent(new KeyboardEvent('keydown', eventInit));
  activeTarget.dispatchEvent(new KeyboardEvent('keypress', eventInit));
  activeTarget.dispatchEvent(new KeyboardEvent('keyup', eventInit));

  // Fallback formulaire classique si présent
  const form = activeTarget.closest?.('form');
  if (form) {
    const submitBtn = form.querySelector('button[type="submit"], input[type="submit"]');
    if (submitBtn instanceof HTMLElement) {
      submitBtn.click();
    } else if (typeof form.requestSubmit === 'function') {
      form.requestSubmit();
    }
  }
}

/**
 * Injecte le texte dans le champ résolu dynamiquement.
 * Si autoEnter est actif, attend 50ms après l'injection avant d'envoyer Enter.
 */
export async function injectTextIntoPage(text, { autoEnter = false, root = document } = {}) {
  const cleanText = typeof text === 'string' ? text : '';
  if (!cleanText.trim()) {
    return { ok: false, reason: 'EMPTY_TEXT' };
  }

  const target = resolveTargetEditable(root);
  if (!target) {
    return { ok: false, reason: 'NO_TARGET_INPUT' };
  }

  try {
    target.focus({ preventScroll: false });

    let placeholderCleared = true;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      setNativeValue(target, cleanText);
      dispatchInputEvents(target, cleanText);
    } else {
      const res = await injectIntoContentEditable(target, cleanText);
      placeholderCleared = res.placeholderCleared;
    }

    if (autoEnter) {
      await new Promise((resolve) => setTimeout(resolve, AUTO_ENTER_DELAY_MS));
      dispatchEnterSequence(target);
    }

    return {
      ok: true,
      autoSent: Boolean(autoEnter),
      placeholderCleared,
      targetTag: target.tagName.toLowerCase()
    };
  } catch (err) {
    return {
      ok: false,
      reason: err?.message || 'INJECTION_ERROR'
    };
  }
}
