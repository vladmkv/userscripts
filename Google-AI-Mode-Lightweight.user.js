// ==UserScript==
// @name         Google AI Mode - Lightweight History
// @namespace    local.ai-mode-lightweight
// @version      0.2.0
// @description  Remove a measured slow AI Mode CSS selector; optional hiding of older answers.
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
    const version = '0.2.0';
    // 65% of selector time in a recorded trace, with zero matches.
    const slowSelector = ':has(.WTfRgd,.zlmqU):has(.B5aSS) :is(.Y3BBE,.n6owBd)';
    const cssPatches = [];
    const metrics = { scans: 0, scanMs: 0, candidates: 0, answers: 0,
        mutationCallbacks: 0, mutationRecords: 0, scheduledUpdates: 0, classChanges: 0,
        cssRulesPatched: 0, cssRulesDeleted: 0, unreadableSheets: 0 };
    let enabled = false;
    let cssFixEnabled = true;
    let pending = false;
    let lastReport = 0;
    let lastSheetCount = -1;

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
            version, cssFixEnabled, cssPatches: cssPatches.length, enabled, pending, hiddenAnswers: hiddenAnswers.size, ...metrics
        });
        lastReport = performance.now();
    }

    const normalize = selector => selector.replace(/\s*,\s*/g, ',').replace(/\(\s+/g, '(')
        .replace(/\s+\)/g, ')').replace(/\s+/g, ' ').trim();

    function splitSelectorList(text) {
        const parts = [];
        let depth = 0, start = 0, quote = '';
        for (let i = 0; i < text.length; i++) {
            const c = text[i];
            if (quote) { if (c === '\\') i++; else if (c === quote) quote = ''; continue; }
            if (c === '"' || c === "'") quote = c;
            else if (c === '(' || c === '[') depth++;
            else if (c === ')' || c === ']') depth--;
            else if (c === ',' && depth === 0) { parts.push(text.slice(start, i).trim()); start = i + 1; }
        }
        parts.push(text.slice(start).trim());
        return parts;
    }

    function patchRules(container) {
        let rules;
        try {
            rules = container.cssRules;
        } catch {
            metrics.unreadableSheets++;
            return;
        }
        if (!rules) return;
        const target = normalize(slowSelector);
        for (let i = rules.length - 1; i >= 0; i--) {
            const rule = rules[i];
            if (rule.cssRules?.length) patchRules(rule);
            if (typeof rule.selectorText !== 'string' || !rule.selectorText.includes(':has(')) continue;
            const parts = splitSelectorList(rule.selectorText);
            const kept = parts.filter(part => normalize(part) !== target);
            if (kept.length === parts.length) continue;
            if (kept.length) {
                cssPatches.push({ rule, selectorText: rule.selectorText });
                rule.selectorText = kept.join(', ');
                metrics.cssRulesPatched++;
            } else {
                cssPatches.push({ container, cssText: rule.cssText, index: i });
                container.deleteRule(i);
                metrics.cssRulesDeleted++;
            }
        }
    }

    function applyCssFix() {
        if (!cssFixEnabled) return;
        const sheets = document.styleSheets;
        if (sheets.length === lastSheetCount) return;
        lastSheetCount = sheets.length;
        measure('css fix', () => { for (const sheet of sheets) patchRules(sheet); });
    }

    function revertCssFix() {
        for (const patch of cssPatches.reverse()) {
            try {
                if (patch.rule) patch.rule.selectorText = patch.selectorText;
                else patch.container.insertRule(patch.cssText, Math.min(patch.index, patch.container.cssRules.length));
            } catch (error) {
                console.warn('[AI Mode Lightweight] Could not restore a CSS rule', error);
            }
        }
        cssPatches.length = 0;
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
        alert(`Version: ${version}\nCSS fix: ${cssFixEnabled ? 'on' : 'off'} (${cssPatches.length} rules changed)\nLightweight history: ${enabled ? 'enabled' : 'paused'}\nMatched containers: ${metrics.candidates}\nRecognized answers: ${metrics.answers}\nHidden answers: ${hiddenAnswers.size}\nDiagnostic details are in the console.`);
    });
    GM_registerMenuCommand('Reset diagnostic counters', () => {
        for (const key of Object.keys(metrics)) metrics[key] = 0;
        report('Counters reset');
    });

    GM_registerMenuCommand('Turn CSS fix off (restore Google rule)', () => {
        cssFixEnabled = false;
        measure('css revert', revertCssFix);
        report('CSS fix OFF; original rule restored');
    });
    GM_registerMenuCommand('Turn CSS fix on', () => {
        cssFixEnabled = true;
        lastSheetCount = -1;
        applyCssFix();
        report('CSS fix ON');
    });

    applyCssFix();
    setInterval(applyCssFix, 3000);
    report('Loaded; CSS fix ON, answer hiding PAUSED');
})();