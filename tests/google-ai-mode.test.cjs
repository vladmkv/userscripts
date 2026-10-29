const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const filename = 'Google-AI-Mode-Lightweight.user.js';
const source = fs.readFileSync(path.join(__dirname, '..', filename), 'utf8');

function setup(count, start = true) {
    const menus = new Map();
    const timers = [];
    const logs = [];
    const marks = new Set();
    const measures = [];
    const observation = { active: false };
    let clock = 0;
    let mutation;
    const answers = Array.from({ length: count }, () => {
        const classes = new Set();
        return {
            classes,
            classList: { add: value => classes.add(value), remove: value => classes.delete(value) },
            parentElement: { closest: () => null },
            querySelector: () => ({}),
            contains: element => element === 'focused',
            isConnected: true,
            nodeType: 1,
            matches: () => true,
            closest() { return this; }
        };
    });
    const document = { querySelectorAll: () => answers, activeElement: null, documentElement: {} };
    vm.runInNewContext(source, {
        document,
        console: { info: (...args) => logs.push(args) },
        performance: {
            now: () => clock++,
            mark: name => marks.add(name),
            measure: (name, begin, end) => {
                assert.ok(marks.has(begin));
                assert.ok(marks.has(end));
                measures.push(name);
            },
            clearMarks: name => marks.delete(name),
            clearMeasures() {}
        },
        GM_addStyle: style => assert.match(style, /display: none !important/),
        GM_registerMenuCommand: (label, callback) => menus.set(label, callback),
        MutationObserver: class {
            constructor(callback) { mutation = callback; }
            observe() { observation.active = true; }
            disconnect() { observation.active = false; }
        },
        setTimeout: callback => timers.push(callback),
        alert() {}
    });
    if (start) menus.get('Keep latest 3 answers (resume)')();
    return { answers, document, menus, timers, mutation, logs, marks, measures, observation,
        hidden: () => answers.filter(answer => answer.classes.size).length,
        restore: () => menus.get('Restore all answers (pause hiding)')(),
        resume: () => menus.get('Keep latest 3 answers (resume)')(),
        flush: () => { while (timers.length) timers.shift()(); }
    };
}

test('AI Mode script preserves prototype identity and publishes update URLs', () => {
    new vm.Script(source);
    assert.ok(source.includes('// @namespace    local.ai-mode-lightweight'));
    for (const key of ['updateURL', 'downloadURL']) {
        assert.match(source, new RegExp(`// @${key} +https://raw\\.githubusercontent\\.com/vladmkv/userscripts/main/${filename.replaceAll('.', '\\.')}`));
    }
});

test('hides only older answers, keeping the newest three', () => {
    const state = setup(8);
    assert.equal(state.hidden(), 5);
    assert.ok(state.answers.slice(-3).every(answer => !answer.classes.size));
});

test('short chats remain unchanged', () => {
    for (const count of [0, 1, 2, 3]) assert.equal(setup(count).hidden(), 0);
});

test('restore pauses hiding, including an already queued update', () => {
    const state = setup(8);
    state.mutation([{ target: { nodeType: 1, closest: () => null }, addedNodes: [state.answers[0]], removedNodes: [] }]);
    state.restore();
    state.flush();
    assert.equal(state.hidden(), 0);
    state.resume();
    assert.equal(state.hidden(), 5);
});

test('new answer containers trigger one coalesced update', () => {
    const state = setup(4);
    const record = { target: { nodeType: 1, closest: () => null }, addedNodes: [state.answers[0]], removedNodes: [] };
    state.answers.push(...setup(2).answers);
    state.mutation([record]);
    state.mutation([record]);
    assert.equal(state.timers.length, 1);
    state.flush();
    assert.equal(state.hidden(), 3);
});

test('streaming changes inside an answer do not schedule scans', () => {
    const state = setup(4);
    state.mutation([{ target: state.answers[3], addedNodes: [state.answers[0]], removedNodes: [] }]);
    assert.equal(state.timers.length, 0);
});

test('focused input inside an older answer is not hidden', () => {
    const state = setup(4);
    state.document.activeElement = 'focused';
    state.resume();
    assert.equal(state.hidden(), 0);
});

test('non-answer and nested containers are excluded', () => {
    const state = setup(5);
    state.answers[0].querySelector = () => null;
    state.answers[1].parentElement.closest = () => state.answers[2];
    state.resume();
    assert.equal(state.hidden(), 0);
});

test('disconnected answers have their script-owned class restored', () => {
    const state = setup(4);
    const removed = state.answers.shift();
    removed.isConnected = false;
    state.resume();
    assert.equal(removed.classes.size, 0);
    assert.equal(state.hidden(), 0);
});

test('diagnostic release starts paused without scanning or observing', () => {
    const state = setup(8, false);
    assert.equal(state.hidden(), 0);
    assert.equal(state.observation.active, false);
    assert.equal(state.logs[0][2].scans, 0);
    assert.equal(state.measures.length, 0);
});

test('pause disconnects the observer and restores all script-hidden answers', () => {
    const state = setup(8);
    assert.equal(state.observation.active, true);
    state.restore();
    assert.equal(state.observation.active, false);
    assert.equal(state.hidden(), 0);
    assert.ok(state.measures.includes('AIMLH restore all'));
});

test('scan, hiding, and observer measurements leave no accumulated marks', () => {
    const state = setup(8);
    state.mutation([{ target: { nodeType: 1, closest: () => null }, addedNodes: [], removedNodes: [] }]);
    assert.ok(state.measures.includes('AIMLH scan'));
    assert.ok(state.measures.includes('AIMLH apply hiding'));
    assert.ok(state.measures.includes('AIMLH observer'));
    assert.equal(state.marks.size, 0);
});

test('diagnostic snapshots report counts without logging message contents', () => {
    const state = setup(8, false);
    state.answers[0].textContent = 'PRIVATE CHAT TEXT';
    state.menus.get('Show lightweight history status')();
    const snapshot = state.logs.at(-1)[2];
    assert.equal(snapshot.candidates, 8);
    assert.equal(snapshot.answers, 8);
    assert.equal(snapshot.hiddenAnswers, 0);
    assert.equal(snapshot.enabled, false);
    assert.equal(JSON.stringify(state.logs).includes('PRIVATE CHAT TEXT'), false);
    assert.equal(state.observation.active, false);
});

test('repeated updates do not reapply hiding classes or flood the console', () => {
    const state = setup(8);
    state.mutation([{ target: { nodeType: 1, closest: () => null }, addedNodes: [state.answers[0]], removedNodes: [] }]);
    const logCount = state.logs.length;
    state.flush();
    assert.equal(state.logs.length, logCount);
    state.menus.get('Show lightweight history status')();
    assert.equal(state.logs.at(-1)[2].classChanges, 5);
    state.menus.get('Reset diagnostic counters')();
    assert.equal(state.logs.at(-1)[2].scans, 0);
});