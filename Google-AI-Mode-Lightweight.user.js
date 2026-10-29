// ==UserScript==
// @name         Google AI Mode - Lightweight History
// @namespace    local.ai-mode-lightweight
// @version      0.1.2
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
    const metrics = { scans: 0, scanMs: 0, candidates: 0, answers: 0,
        mutationCallbacks: 0, mutationRecords: 0, scheduledUpdates: 0, classChanges: 0 };
    let enabled = false;
    let pending = false;
    let lastReport = 0;

    GM_addStyle(`.${hiddenClass} { display: none !important; }`);

    function measure(name, operation) {
        const label = `AIMLH ${name}`;
        performance.mark(`${label} start`);
        try {
            return operation();
        } finally {
            performance.mark(`${label} end`);
            performance.measure(label, `${label} start`, `${label} end`);
            performance.clearMarks(`${label} start`);
            performance.clearMarks(`${label} end`);
            performance.clearMeasures(label);
        }
    }

    function report(reason) {
        console.info('[AI Mode Lightweight]', reason, {
            version: '0.1.2', enabled, pending, hiddenAnswers: hiddenAnswers.size, ...metrics
        });
        lastReport = performance.now();
    }

    function findAnswers() {
        return measure('scan', () => {
            const started = performance.now();
            const candidates = [...document.querySelectorAll(answerSelector)];
            const answers = candidates.filter(answer =>
                !answer.parentElement?.closest(answerSelector) &&
                answer.querySelector('.n6owBd[data-sfc-cp]')
            );
            metrics.scans++;
            metrics.scanMs += performance.now() - started;
            metrics.candidates = candidates.length;
            metrics.answers = answers.length;
            return answers;
        });
    }

    function restoreAll() {
        for (const answer of hiddenAnswers) {
            answer.classList.remove(hiddenClass);
            metrics.classChanges++;
        }
        hiddenAnswers.clear();
    }

    function update() {
        pending = false;
        if (!enabled) return;

        const answers = findAnswers();
        const olderAnswers = new Set(answers.slice(0, Math.max(0, answers.length - keepAnswers)));

        measure('apply hiding', () => {
            for (const answer of hiddenAnswers) {
                if (!answer.isConnected || !olderAnswers.has(answer) || answer.contains(document.activeElement)) {
                    answer.classList.remove(hiddenClass);
                    hiddenAnswers.delete(answer);
                    metrics.classChanges++;
                }
            }

            for (const answer of olderAnswers) {
                if (hiddenAnswers.has(answer) || answer.contains(document.activeElement)) continue;
                answer.classList.add(hiddenClass);
                hiddenAnswers.add(answer);
                metrics.classChanges++;
            }
        });
        if (performance.now() - lastReport >= 5000) report('Update summary; cumulative milliseconds');
    }

    function scheduleUpdate() {
        if (!enabled || pending) return;
        pending = true;
        metrics.scheduledUpdates++;
        setTimeout(update, 250);
    }

    const observer = new MutationObserver(records => {
        metrics.mutationCallbacks++;
        metrics.mutationRecords += records.length;
        if (!enabled || pending) return;
        measure('observer', () => {
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
    });

    GM_registerMenuCommand('Restore all answers (pause hiding)', () => {
        enabled = false;
        observer.disconnect();
        measure('restore all', restoreAll);
        report('PAUSED; observer disconnected, all script-hidden answers restored');
    });
    GM_registerMenuCommand('Keep latest 3 answers (resume)', () => {
        enabled = true;
        observer.observe(document.documentElement, { childList: true, subtree: true });
        update();
        report('HIDING ENABLED');
    });
    GM_registerMenuCommand('Show lightweight history status', () => {
        findAnswers();
        report('Diagnostic snapshot; cumulative milliseconds');
        alert(`Version: 0.1.2\nLightweight history: ${enabled ? 'enabled' : 'paused'}\nMatched containers: ${metrics.candidates}\nRecognized answers: ${metrics.answers}\nHidden answers: ${hiddenAnswers.size}\nDiagnostic details are in the console.`);
    });
    GM_registerMenuCommand('Reset diagnostic counters', () => {
        for (const key of Object.keys(metrics)) metrics[key] = 0;
        report('Counters reset');
    });

    report('Loaded PAUSED; no scan, observer, or hiding until a menu command is selected');
})();