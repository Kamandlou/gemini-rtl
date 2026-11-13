/**
 * Gemini RTL - Content Script
 * Intelligent, real-time RTL/LTR direction manager for Google Gemini.
 * Supports Persian, Arabic, Hebrew, Urdu, etc. with majority detection,
 * dynamic streaming support, LTR isolation for math & code,
 * per-message toggle button, composer toggle button, and keyboard shortcuts.
 */

(() => {
  'use strict';

  // ---------------------------------------------------------------------------
  // 1. Unicode Directional Matchers
  // ---------------------------------------------------------------------------
  const RTL_CHAR_REGEX = /[\u0590-\u05FF\uFB1D-\uFB4F\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF\u0700-\u074F\u0780-\u07BF]/g;
  const LTR_CHAR_REGEX = /[a-zA-Z\u00C0-\u024F\u0400-\u04FF\u0370-\u03FF]/g;

  // Extension Settings (synced with chrome.storage)
  let settings = {
    autoDetectResponse: true,
    autoDetectInput: true,
    forceCodeMathLTR: true,
    defaultInputDirection: 'auto'
  };

  // State
  let manualInputOverride = false;
  let currentInputDirection = 'ltr';
  let isProcessingBatch = false;

  // Load initial settings
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
    chrome.storage.sync.get(settings, (loaded) => {
      if (chrome.runtime.lastError) {
        console.warn('Gemini RTL: Could not load sync storage, using defaults');
        return;
      }
      settings = { ...settings, ...loaded };
      applyCurrentSettings();
    });

    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'sync') {
        for (const [key, { newValue }] of Object.entries(changes)) {
          settings[key] = newValue;
        }
        applyCurrentSettings();
      }
    });
  }

  function applyCurrentSettings() {
    document.documentElement.classList.toggle('gemini-code-math-enabled', settings.forceCodeMathLTR);
    if (!settings.autoDetectResponse) clearMessageFormatting();
    if (!settings.forceCodeMathLTR) clearCodeMathFormatting();
    processAllMessages();
    handleInputChange();
    updateComposerButton();
  }

  // ---------------------------------------------------------------------------
  // 2. Intelligent Direction Calculation
  // ---------------------------------------------------------------------------
  function determineDirection(text) {
    if (!text || typeof text !== 'string') return null;
    const trimmed = text.trim();
    if (!trimmed) return null;

    const rtlMatches = trimmed.match(RTL_CHAR_REGEX);
    const rtlCount = rtlMatches ? rtlMatches.length : 0;

    const ltrMatches = trimmed.match(LTR_CHAR_REGEX);
    const ltrCount = ltrMatches ? ltrMatches.length : 0;

    const total = rtlCount + ltrCount;
    if (total === 0) return null;

    if (rtlCount > ltrCount) return 'rtl';
    if (ltrCount > rtlCount) return 'ltr';

    const firstRtl = trimmed.search(RTL_CHAR_REGEX);
    const firstLtr = trimmed.search(LTR_CHAR_REGEX);

    if (firstRtl !== -1 && (firstLtr === -1 || firstRtl < firstLtr)) {
      return 'rtl';
    }
    return 'ltr';
  }

  // ---------------------------------------------------------------------------
  // 3. Math & Code Guard
  // ---------------------------------------------------------------------------
  const CODE_MATH_SELECTOR = 'pre, code-block, .code-block, .formatted-code-block-internal-container, .code-container, .cm-editor, .katex, .MathJax, math, .math-inline, .math-block, [class*="math-"]';

  function isInsideCodeOrMath(el) {
    if (!el || !el.closest) return false;
    return !!el.closest(CODE_MATH_SELECTOR);
  }

  function clearCodeMathFormatting() {
    document.querySelectorAll('.gemini-code-math-ltr').forEach((el) => {
      el.classList.remove('gemini-code-math-ltr');
      if (el.dataset.geminiOriginalDir === '__none__') el.removeAttribute('dir');
      else if (el.dataset.geminiOriginalDir) el.setAttribute('dir', el.dataset.geminiOriginalDir);
      delete el.dataset.geminiOriginalDir;
    });
  }

  function markCodeMath(el) {
    if (!el.classList.contains('gemini-code-math-ltr')) {
      el.dataset.geminiOriginalDir = el.getAttribute('dir') ?? '__none__';
    }
    el.setAttribute('dir', 'ltr');
    el.classList.add('gemini-code-math-ltr');
  }

  function applyMathAndCodeIsolation(container) {
    if (!settings.forceCodeMathLTR) return;

    const mathElements = container.querySelectorAll('.katex, .katex-display, .katex-html, .MathJax, math, .math-inline, .math-block, [class*="math-"]');
    mathElements.forEach((el) => {
      markCodeMath(el);
    });

    const codeBlocks = container.querySelectorAll('pre, code-block, .code-block, .formatted-code-block-internal-container, .code-container, .cm-editor');
    codeBlocks.forEach((el) => {
      markCodeMath(el);
      el.classList.remove('gemini-rtl', 'gemini-block-rtl');
    });
  }

  function getNonCodeText(el) {
    if (!el.querySelector(CODE_MATH_SELECTOR)) {
      return el.textContent || '';
    }
    try {
      const clone = el.cloneNode(true);
      clone.querySelectorAll(CODE_MATH_SELECTOR).forEach((c) => c.remove());
      return clone.textContent || '';
    } catch {
      return el.textContent || '';
    }
  }

  function determineBlockDirection(block) {
    if (!block) return null;

    let text = block.textContent || '';
    if (block.querySelector(CODE_MATH_SELECTOR)) {
      try {
        const clone = block.cloneNode(true);
        clone.querySelectorAll(CODE_MATH_SELECTOR).forEach((el) => el.remove());
        text = clone.textContent || '';
      } catch {
        text = block.textContent || '';
      }
    }

    const dir = determineDirection(text);
    if (dir === 'rtl') return 'rtl';

    if (block.querySelector('code')) {
      try {
        const clone = block.cloneNode(true);
        clone.querySelectorAll(`${CODE_MATH_SELECTOR}, code`).forEach((el) => el.remove());
        const proseText = clone.textContent || '';
        const proseDir = determineDirection(proseText);
        if (proseDir === 'rtl') {
          return 'rtl';
        }
      } catch {}
    }

    return dir;
  }

  // ---------------------------------------------------------------------------
  // 4. Message Turn Processing (Gemini Responses & User Queries)
  // ---------------------------------------------------------------------------
  function processMessageElement(messageEl) {
    if (!settings.autoDetectResponse || messageEl.dataset.geminiManualDirection || messageEl.querySelector('[data-gemini-manual-direction]')) return;
    if (messageEl.closest('rich-textarea, .ql-editor, [contenteditable="true"]') || isInsideCodeOrMath(messageEl)) return;
    if (messageEl.closest('table') && messageEl.tagName !== 'TABLE') return;

    applyMathAndCodeIsolation(messageEl);

    const blocks = messageEl.querySelectorAll(
      'p, li, h1, h2, h3, h4, h5, h6, blockquote, .query-text, .query-text-line'
    );

    blocks.forEach((block) => {
      if (isInsideCodeOrMath(block) || block.closest('table')) return;

      const dir = determineBlockDirection(block);
      if (dir === 'rtl') {
        if (block.getAttribute('dir') !== 'rtl') setMessageDirection(block, 'rtl', true);
        block.classList.add('gemini-block-rtl');
        block.classList.remove('gemini-block-ltr');

        const parentLi = block.tagName === 'LI' ? block : block.closest('li');
        if (parentLi) {
          setMessageDirection(parentLi, 'rtl', true);
          parentLi.classList.add('gemini-block-rtl');
          parentLi.classList.remove('gemini-block-ltr');

          const parentList = parentLi.closest('ol, ul');
          if (parentList && !isInsideCodeOrMath(parentList)) {
            setMessageDirection(parentList, 'rtl', false);
            parentList.classList.add('gemini-rtl');
            parentList.classList.remove('gemini-ltr');
          }
        }
      } else if (dir === 'ltr') {
        if (block.getAttribute('dir') !== 'ltr') setMessageDirection(block, 'ltr', true);
        block.classList.add('gemini-block-ltr');
        block.classList.remove('gemini-block-rtl');
      }
    });

    // Tables
    const tables = messageEl.tagName === 'TABLE' ? [messageEl] : messageEl.querySelectorAll('table');
    tables.forEach((table) => {
      if (isInsideCodeOrMath(table)) return;
      const tableDir = determineDirection(getNonCodeText(table));
      if (tableDir === 'rtl') {
        setMessageDirection(table, 'rtl', false);
        table.classList.add('gemini-rtl');
        table.classList.remove('gemini-ltr');
        table.querySelectorAll('th, td').forEach((cell) => {
          if (!isInsideCodeOrMath(cell)) {
            setMessageDirection(cell, 'rtl', true);
            cell.style.setProperty('text-align', 'right', 'important');
          }
        });
      } else if (tableDir === 'ltr') {
        setMessageDirection(table, 'ltr', false);
        table.classList.add('gemini-ltr');
        table.classList.remove('gemini-rtl');
        table.querySelectorAll('th, td').forEach((cell) => {
          if (!isInsideCodeOrMath(cell)) {
            setMessageDirection(cell, 'ltr', true);
            cell.style.setProperty('text-align', 'left', 'important');
          }
        });
      }
    });

    // Lists
    messageEl.querySelectorAll('ol, ul').forEach((list) => {
      if (isInsideCodeOrMath(list)) return;
      if (list.querySelector(':scope > li[dir="rtl"], :scope > li.gemini-block-rtl')) {
        setMessageDirection(list, 'rtl', false);
        list.classList.add('gemini-rtl');
        list.classList.remove('gemini-ltr');
      } else if (list.querySelector(':scope > li[dir="ltr"], :scope > li.gemini-block-ltr')) {
        setMessageDirection(list, 'ltr', false);
        list.classList.add('gemini-ltr');
        list.classList.remove('gemini-rtl');
      }
    });

    // Overall direction
    const overallDir = determineDirection(getNonCodeText(messageEl));
    if (overallDir === 'rtl') {
      setMessageDirection(messageEl, 'rtl', false);
      messageEl.classList.add('gemini-rtl');
      messageEl.classList.remove('gemini-ltr');
    } else if (overallDir === 'ltr') {
      setMessageDirection(messageEl, 'ltr', false);
      messageEl.classList.add('gemini-ltr');
      messageEl.classList.remove('gemini-rtl');
    }
  }

  function clearMessageFormatting() {
    document.querySelectorAll('[data-gemini-original-dir]').forEach((el) => {
      if (el.dataset.geminiManualDirection || el.classList.contains('gemini-code-math-ltr')) return;
      const old = el.dataset.geminiOriginalDir;
      if (old === '__none__') el.removeAttribute('dir');
      else el.setAttribute('dir', old);
      delete el.dataset.geminiOriginalDir;
      el.classList.remove('gemini-rtl', 'gemini-ltr', 'gemini-block-rtl', 'gemini-block-ltr');
      el.style.removeProperty('text-align');
    });
  }

  function setMessageDirection(el, dir, block = false) {
    if (!('geminiOriginalDir' in el.dataset)) el.dataset.geminiOriginalDir = el.getAttribute('dir') ?? '__none__';
    el.setAttribute('dir', dir);
    el.classList.toggle(block ? 'gemini-block-rtl' : 'gemini-rtl', dir === 'rtl');
    el.classList.toggle(block ? 'gemini-block-ltr' : 'gemini-ltr', dir === 'ltr');
  }

  function processAllMessages() {
    const messages = document.querySelectorAll(
      'message-content, ' +
      '.markdown, ' +
      'model-response .response-container-content, ' +
      'user-query, ' +
      'user-query-content, ' +
      '.user-query-container, ' +
      'table'
    );
    messages.forEach((msg) => processMessageElement(msg));
  }

  // ---------------------------------------------------------------------------
  // 5. Message Turn Manual Toggle Button
  // ---------------------------------------------------------------------------
  const TURN_BUTTON_SVG = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M4 6h16M4 12h10M4 18h16" />
    </svg>
  `;

  function createTurnToggleButton(targetEl) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'gemini-rtl-turn-btn';
    btn.setAttribute('aria-label', 'Toggle RTL/LTR direction');
    btn.innerHTML = TURN_BUTTON_SVG;

    const syncBtnState = () => {
      const isRtl = targetEl.getAttribute('dir') === 'rtl' || targetEl.classList.contains('gemini-rtl');
      btn.classList.toggle('is-rtl', isRtl);
      btn.setAttribute('title', isRtl ? 'Text Direction: RTL (Click to toggle to LTR)' : 'Text Direction: LTR (Click to toggle to RTL)');
    };

    syncBtnState();

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();

      const currentDir = targetEl.getAttribute('dir') === 'rtl' || targetEl.classList.contains('gemini-rtl') ? 'rtl' : 'ltr';
      const newDir = currentDir === 'rtl' ? 'ltr' : 'rtl';
      const isRtl = newDir === 'rtl';

      targetEl.dataset.geminiManualDirection = newDir;
      setMessageDirection(targetEl, newDir);
      targetEl.classList.toggle('gemini-rtl', isRtl);
      targetEl.classList.toggle('gemini-ltr', !isRtl);

      targetEl.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6, blockquote').forEach((el) => {
        if (!isInsideCodeOrMath(el) && !el.closest('table')) {
          setMessageDirection(el, newDir, true);
          el.classList.toggle('gemini-block-rtl', isRtl);
          el.classList.toggle('gemini-block-ltr', !isRtl);
        }
      });

      targetEl.querySelectorAll('ol, ul').forEach((list) => {
        if (!isInsideCodeOrMath(list)) {
          setMessageDirection(list, newDir);
          list.classList.toggle('gemini-rtl', isRtl);
          list.classList.toggle('gemini-ltr', !isRtl);
        }
      });

      targetEl.querySelectorAll('table').forEach((table) => {
        if (!isInsideCodeOrMath(table)) {
          setMessageDirection(table, newDir);
          table.classList.toggle('gemini-rtl', isRtl);
          table.classList.toggle('gemini-ltr', !isRtl);
          table.querySelectorAll('th, td').forEach((cell) => {
            if (!isInsideCodeOrMath(cell)) {
              setMessageDirection(cell, newDir, true);
              cell.style.setProperty('text-align', isRtl ? 'right' : 'left', 'important');
            }
          });
        }
      });

      applyMathAndCodeIsolation(targetEl);
      syncBtnState();
    });

    return btn;
  }

  function attachAllTurnActionButtons() {
    // Gemini response action bars (copy, thumbs up/down, share, more)
    const actionBars = document.querySelectorAll(
      'message-actions .buttons-container-v2, ' +
      'message-actions > div, ' +
      '.response-footer .buttons-container, ' +
      'model-response .actions-container-v2'
    );

    actionBars.forEach((actionBar) => {
      if (actionBar.querySelector('.gemini-rtl-turn-btn')) return;

      const responseContainer = actionBar.closest('model-response, .response-container, .conversation-container');
      if (!responseContainer) return;

      const messageEl = responseContainer.querySelector('message-content, .markdown');
      if (!messageEl) return;

      const toggleBtn = createTurnToggleButton(messageEl);
      actionBar.appendChild(toggleBtn);
    });
  }

  // ---------------------------------------------------------------------------
  // 6. Composer Input Direction (Gemini Prompt Input Box)
  // ---------------------------------------------------------------------------
  const COMPOSER_RTL_SVG = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M4 6h16M10 12h10M4 18h16" />
      <path d="M7 9l-3 3 3 3" />
    </svg>
  `;

  function getPromptInput() {
    return document.querySelector('rich-textarea .ql-editor[contenteditable="true"]') ||
           document.querySelector('.ql-editor[contenteditable="true"]') ||
           document.querySelector('div[role="textbox"][contenteditable="true"]');
  }

  function setInputDirection(dir, isManual = false) {
    currentInputDirection = dir;
    if (isManual) {
      manualInputOverride = true;
    }

    const input = getPromptInput();
    if (!input) return;

    const richTextarea = input.closest('rich-textarea');
    const isRtl = dir === 'rtl';

    input.setAttribute('dir', dir);
    input.classList.toggle('gemini-rtl', isRtl);
    input.classList.toggle('gemini-ltr', !isRtl);
    input.querySelectorAll('p').forEach((p) => p.setAttribute('dir', dir));

    if (richTextarea) {
      richTextarea.setAttribute('dir', dir);
      richTextarea.classList.toggle('gemini-rtl', isRtl);
      richTextarea.classList.toggle('gemini-ltr', !isRtl);
    }

    updateComposerBtnState(isRtl);
  }

  function handleInputChange() {
    const input = getPromptInput();
    if (!input) return;

    const text = input.innerText || input.textContent || '';

    if (text.trim() === '') {
      manualInputOverride = false;
      setInputDirection(settings.defaultInputDirection !== 'auto' ? settings.defaultInputDirection : 'ltr', false);
      return;
    }

    if (manualInputOverride || !settings.autoDetectInput) return;

    const dir = determineDirection(text);
    if (dir) {
      setInputDirection(dir, false);
    }
  }

  function updateComposerBtnState(isRtl) {
    const btn = document.getElementById('gemini-rtl-composer-toggle');
    if (!btn) return;
    btn.classList.toggle('is-rtl', isRtl);
    btn.classList.toggle('active', isRtl);
    btn.setAttribute('title', isRtl ? 'Text Direction: RTL (Click to toggle)' : 'Text Direction: LTR (Click to toggle)');
  }

  function updateComposerButton() {
    const existing = document.getElementById('gemini-rtl-composer-toggle');
    const input = getPromptInput();
    if (!input) return;

    const inputArea = input.closest('.input-area, .text-input-field, .input-box-wrapper, form') || input.parentElement?.parentElement;
    if (!inputArea) return;
    if (existing && inputArea.contains(existing)) return;
    existing?.remove();

    // Look for Gemini's composer action buttons row (mic / send / tools)
    const composerActions = inputArea.querySelector('.trailing-actions-wrapper, .input-buttons-wrapper-bottom, .send-button-container')?.parentElement ||
                            inputArea.querySelector('.trailing-actions-wrapper, .input-buttons-wrapper-bottom');

    if (!composerActions) return;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'gemini-rtl-composer-toggle';
    btn.className = 'gemini-rtl-composer-btn';
    btn.setAttribute('aria-label', 'Toggle input direction');
    btn.setAttribute('title', 'Toggle input direction (Ctrl+Right/Left Shift)');
    btn.innerHTML = COMPOSER_RTL_SVG;

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const newDir = currentInputDirection === 'rtl' ? 'ltr' : 'rtl';
      setInputDirection(newDir, true);
    });

    if (composerActions.firstChild) {
      composerActions.insertBefore(btn, composerActions.firstChild);
    } else {
      composerActions.appendChild(btn);
    }

    updateComposerBtnState(currentInputDirection === 'rtl');
  }

  // ---------------------------------------------------------------------------
  // 7. Keyboard Shortcuts
  // ---------------------------------------------------------------------------
  document.addEventListener('keydown', (e) => {
    try {
      const input = getPromptInput();
      const isInputActive = input && (document.activeElement === input || input.contains(document.activeElement));

      if ((e.ctrlKey || e.metaKey) && isInputActive) {
        if (e.code === 'ShiftRight') {
          setInputDirection('rtl', true);
        } else if (e.code === 'ShiftLeft') {
          setInputDirection('ltr', true);
        }
      }

      if (e.key === 'Enter' && !e.shiftKey && isInputActive) {
        setTimeout(() => {
          manualInputOverride = false;
        }, 150);
      }
    } catch (err) {
      console.error('Gemini RTL: Keydown handler error:', err);
    }
  });

  document.addEventListener('input', (e) => {
    const input = getPromptInput();
    if (input && (e.target === input || input.contains(e.target))) {
      handleInputChange();
    }
  });

  // ---------------------------------------------------------------------------
  // 8. MutationObserver (Streaming + SPA Navigation)
  // ---------------------------------------------------------------------------
  function scheduleBatchProcessing() {
    if (isProcessingBatch) return;
    isProcessingBatch = true;

    requestAnimationFrame(() => {
      try {
        processAllMessages();
        updateComposerButton();
        attachAllTurnActionButtons();
      } catch (err) {
        console.error('Gemini RTL: Error during batch processing:', err);
      } finally {
        isProcessingBatch = false;
      }
    });
  }

  const observer = new MutationObserver((mutations) => {
    for (let i = 0; i < mutations.length; i++) {
      const mut = mutations[i];
      if ((mut.type === 'childList' && (mut.addedNodes.length > 0 || mut.removedNodes.length > 0)) ||
          mut.type === 'characterData') {
        scheduleBatchProcessing();
        break;
      }
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true
  });

  document.documentElement.classList.toggle('gemini-code-math-enabled', settings.forceCodeMathLTR);
  scheduleBatchProcessing();
  console.info('Gemini RTL v1.0 initialized successfully.');
})();
