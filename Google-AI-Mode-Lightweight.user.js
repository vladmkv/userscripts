// ==UserScript==
// @name         Google AI Mode - Lightweight History
// @namespace    local.ai-mode-lightweight
// @version      0.1.1
// @description  Hide older AI Mode answers locally; restore them through the Tampermonkey menu.
// @updateURL    https://raw.githubusercontent.com/vladmkv/userscripts/main/Google-AI-Mode-Lightweight.user.js
// @downloadURL  https://raw.githubusercontent.com/vladmkv/userscripts/main/Google-AI-Mode-Lightweight.user.js
// @match        https://www.google.com/search*
// @run-at       document-idle
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// ==/UserScript==

(() => {
    'use strict';

    const keepAnswers = 3;
    const answerSelector = '[data-container-id="main-col"][data-sfc-root="c"]';
    const hiddenClass = 'tm-ai-mode-history-hidden';
    const hiddenAnswers = new Set();
    let enabled = true;
    let pending = false;

    GM_addStyle(`.${hiddenClass} { display: none !important; }`);

    function restoreAll() {
        for (const answer of hiddenAnswers) {
            answer.classList.remove(hiddenClass);
        }
        hiddenAnswers.clear();
    }

    function update() {
        pending = false;
        if (!enabled) return;

        const answers = [...document.querySelectorAll(answerSelector)].filter(answer =>
            !answer.parentElement?.closest(answerSelector) &&
            answer.querySelector('.n6owBd[data-sfc-cp]')
        );
        const olderAnswers = new Set(answers.slice(0, Math.max(0, answers.length - keepAnswers)));

        for (const answer of hiddenAnswers) {
            if (!answer.isConnected || !olderAnswers.has(answer) || answer.contains(document.activeElement)) {
                answer.classList.remove(hiddenClass);
                hiddenAnswers.delete(answer);
            }
        }

        for (const answer of olderAnswers) {
            if (answer.contains(document.activeElement)) continue;
            answer.classList.add(hiddenClass);
            hiddenAnswers.add(answer);
        }
    }

    function scheduleUpdate() {
        if (!enabled || pending) return;
        pending = true;
        setTimeout(update, 250);
    }

    const observer = new MutationObserver(records => {
        if (!enabled || pending) return;
        for (const record of records) {
            if (record.target.nodeType === 1 && record.target.closest(answerSelector)) continue;
            for (const node of record.addedNodes) {
                if (node.nodeType === 1 &&
                    (node.matches(answerSelector) || node.querySelector(answerSelector))) {
                    scheduleUpdate();
                    return;
                }
            }
            if (record.removedNodes.length) scheduleUpdate();
        }
    });

    GM_registerMenuCommand('Restore all answers (pause hiding)', () => {
        enabled = false;
        restoreAll();
    });
    GM_registerMenuCommand('Keep latest 3 answers (resume)', () => {
        enabled = true;
        update();
    });
    GM_registerMenuCommand('Show lightweight history status', () => {
        alert(`Lightweight history: ${enabled ? 'enabled' : 'paused'}\nHidden answers: ${hiddenAnswers.size}\nLatest ${keepAnswers} answers stay visible.`);
    });

    observer.observe(document.documentElement, { childList: true, subtree: true });
    update();
})();