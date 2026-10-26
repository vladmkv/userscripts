const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const highlighterName = 'Cross-Market-Seen-Item-Highlighter.user.js';
const selectorName = 'Neokyo-Category-Selector.user.js';
const highlighter = fs.readFileSync(path.join(root, highlighterName), 'utf8');
const selector = fs.readFileSync(path.join(root, selectorName), 'utf8');

test('both scripts retain identity, parse, and publish stable auto-update URLs', () => {
    for (const [filename, source] of [[highlighterName, highlighter], [selectorName, selector]]) {
        new vm.Script(source);
        for (const key of ['updateURL', 'downloadURL']) {
            assert.ok(source.includes(`// @${key}  `) || source.includes(`// @${key}    `));
            assert.ok(source.includes(`https://raw.githubusercontent.com/vladmkv/userscripts/main/${filename}`));
        }
        assert.ok(source.includes('// @namespace    http://tampermonkey.net'));
    }
    assert.ok(highlighter.includes('// @name         Cross-Market Seen Item Highlighter'));
    assert.ok(highlighter.includes('// @match        *://*.buyee.jp/mercari/item/*'));
});

test('category URLs preserve filters, clear descendants and control pagination', () => {
    const context = { URL, location: new URL('https://neokyo.com/en/search/yahoo') };
    vm.createContext(context);
    vm.runInContext(selector.replace('    start();', '    globalThis.api = { categoryUrl, categoriesMatch, readPath, isYahooSearch };'), context);
    const api = context.api;
    const categories = ['0', '23632', '23764', '23848', '44762'];
    const original = 'https://neokyo.com/en/search/yahoo?page=7&keyword=sony+walkman&max_price=5000&order-tag=end&condition=all&category[level_7]=999';
    const result = api.categoryUrl(original, categories, true);
    for (const [key, value] of [['keyword', 'sony walkman'], ['max_price', '5000'], ['order-tag', 'end'], ['condition', 'all'], ['page', '1']]) {
        assert.equal(result.searchParams.get(key), value);
    }
    assert.equal(result.searchParams.has('category[level_7]'), false);
    assert.equal(api.categoriesMatch(result, categories), true);
    assert.equal(api.categoryUrl(original, categories).searchParams.get('page'), '7');
    assert.deepEqual(Array.from(api.readPath(result)), categories);
    assert.equal(api.categoriesMatch(api.categoryUrl(result.href, []), []), true);
    assert.equal(api.isYahooSearch(new URL('https://neokyo.com/en/search/yahooFleaMarket')), false);
    assert.equal(api.isYahooSearch(new URL('https://other.example/en/search/yahoo')), false);
});

function createCategoryApi(store, fetchImpl) {
    const context = {
        URL,
        Date,
        location: new URL('https://neokyo.com/en/search/yahoo'),
        GM_getValue: (key, fallback) => store[key] ?? fallback,
        GM_setValue: (key, value) => { store[key] = value; },
        fetch: fetchImpl
    };
    vm.createContext(context);
    vm.runInContext(selector.replace('    start();', '    globalThis.api = { getChildren };'), context);
    return context.api;
}

test('category API responses persist across page sessions', async () => {
    const store = {};
    let requests = 0;
    const rows = [{ provider_category_ref: '23632', translation: 'Home appliances', has_children: 1 }];
    const fetchImpl = async () => {
        requests++;
        return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ level_2: rows }) };
    };
    const firstPageApi = createCategoryApi(store, fetchImpl);
    assert.equal(JSON.stringify(await firstPageApi.getChildren(2, 1)), JSON.stringify(rows));
    const nextPageApi = createCategoryApi(store, fetchImpl);
    assert.equal(JSON.stringify(await nextPageApi.getChildren(2, 1)), JSON.stringify(rows));
    assert.equal(requests, 1);
});

test('category API 429 honors Retry-After and does not retry during cooldown', async () => {
    const store = {};
    let requests = 0;
    const api = createCategoryApi(store, async () => {
        requests++;
        return { ok: false, status: 429, headers: { get: name => name === 'Retry-After' ? '120' : null } };
    });
    await assert.rejects(api.getChildren(2, 1), /rate-limited \(HTTP 429\)/);
    assert.ok(store.neokyo_yahoo_category_retry_after >= Date.now() + 119000);
    const cooledApi = createCategoryApi(store, async () => {
        requests++;
        throw new Error('Should not make another request during the cooldown');
    });
    await assert.rejects(cooledApi.getChildren(2, 1), /Try again in about 2 min/);
    assert.equal(requests, 1);
});

test('stale category cache remains usable during a 429 cooldown', async () => {
    const rows = [{ provider_category_ref: '23632', translation: 'Home appliances', has_children: 1 }];
    const store = {
        neokyo_yahoo_category_cache_v1: { '2:1': { savedAt: 1, rows } },
        neokyo_yahoo_category_retry_after: Date.now() + 60000
    };
    const api = createCategoryApi(store, async () => {
        throw new Error('Cached data should avoid the request');
    });
    assert.equal(JSON.stringify(await api.getChildren(2, 1)), JSON.stringify(rows));
});

function fakeElement(tag) {
    const element = {
        tag, style: {}, attributes: {}, children: [], listeners: {}, textContent: '', clicked: 0,
        setAttribute(name, value) { this.attributes[name] = value; },
        addEventListener(type, listener) { this.listeners[type] = listener; },
        append(...nodes) { this.children.push(...nodes); },
        remove() {},
        click() { this.clicked++; },
        attachShadow() { this.shadowRoot = fakeElement('#shadow'); return this.shadowRoot; }
    };
    return element;
}

function findByAction(root, action) {
    if (!root) return undefined;
    if (root.attributes?.['data-action'] === action) return root;
    for (const child of [...(root.children || []), root.shadowRoot].filter(Boolean)) {
        const found = findByAction(child, action);
        if (found) return found;
    }
    return undefined;
}

function panelText(body) {
    const section = body.children[0].shadowRoot.children.find(node => node.tag === 'section');
    return section.children.filter(node => node.tag === 'p' && !node.hidden).map(node => node.textContent);
}

function scan(pageUrl, itemUrl, seen, offscreen = false, existingStorage, atBottom = false, options = {}) {
    const location = new URL(pageUrl);
    const id = location.hostname === 'zenmarket.jp'
        ? new URL(itemUrl).searchParams.get('itemCode')
        : new URL(itemUrl).pathname.split('/').filter(Boolean).at(-1);
    const storage = existingStorage || {
        buyee_item_registry: seen ? { [id]: 'hide' } : {},
        buyee_item_registry_migrated_origins: [location.origin]
    };
    const wrapper = { style: {} };
    const card = {
        tagName: location.hostname === 'zenmarket.jp' ? 'A' : 'DIV',
        href: itemUrl,
        style: {},
        closest: () => wrapper,
        getBoundingClientRect: () => ({ top: offscreen ? -200 : 100, bottom: offscreen ? -10 : 300 })
    };
    const link = { href: itemUrl, closest: () => card };
    card.querySelector = () => link;
    const legacyLocalStorage = {
        buyee_item_registry: 'legacy-copy',
        removeItem(key) { delete this[key]; }
    };
    let tick;
    const timers = [];
    const windowListeners = {};
    const events = [];
    let reloads = 0;
    location.reload = () => { reloads++; };
    const writes = [];
    const errors = [];
    const blobs = [];
    const body = fakeElement('body');
    body.innerText = 'Product information';
    const created = [];
    const TestURL = class extends URL {
        static createObjectURL(blob) { blobs.push(blob); return 'blob:test'; }
        static revokeObjectURL() {}
    };
    const context = {
        URL: TestURL, Blob, location,
        console: { info() {}, log() {}, warn() {}, error(...args) { if (!options.allowErrors) throw args.at(-1); errors.push(args); } },
        GM_getValue: (key, fallback) => structuredClone(storage[key] ?? fallback),
        GM_setValue: (key, value) => {
            writes.push(key);
            if (options.setValue) return options.setValue(key, value, storage);
            storage[key] = structuredClone(value);
        },
        unsafeWindow: { localStorage: legacyLocalStorage },
        document: {
            title: 'Item results',
            body,
            createElement: tag => { const element = fakeElement(tag); created.push(element); return element; },
            documentElement: { scrollHeight: atBottom ? 900 : 5000 },
            querySelectorAll: query => {
                if (query.startsWith('a[href*=')) return [link];
                if (query.includes('product-item') || query === '.product-card.auction'
                    || query.startsWith('#content_inner')) return [card];
                return [];
            }
        },
        window: {
            innerHeight: 900, scrollY: 0, pageYOffset: 0,
            addEventListener(type, listener) { (windowListeners[type] ||= []).push(listener); },
            dispatchEvent(event) { events.push(event); }, confirm: options.confirm, alert: options.alert
        },
        CustomEvent: class {},
        setTimeout: (callback, ms) => timers.push({ callback, ms }),
        clearTimeout: id => { if (id) timers[id - 1] = null; },
        setInterval: callback => { tick = callback; }
    };
    if (options.now) context.Date = class extends Date { static now() { return options.now(); } };
    vm.runInNewContext(highlighter, context);
    tick();
    const restore = async text => {
        findByAction(body, 'restore').listeners.click();
        const input = created.findLast(element => element.tag === 'input');
        assert.equal(input.clicked, 1);
        input.files = [{ size: text.length, text: async () => text }];
        await input.listeners.change();
    };
    return {
        card, wrapper, storage, legacyLocalStorage, id, tick, document: context.document, body, writes, errors, events, blobs, restore,
        timers, windowListeners, reloads: () => reloads
    };
}

function createRecommendationCard(pageUrl, hrefEntries) {
    const anchors = hrefEntries.map(entry => {
        const hasHref = !(entry && typeof entry === 'object' && entry.hasHref === false) && entry !== null && entry !== undefined;
        const rawHref = entry && typeof entry === 'object' ? entry.href : entry;
        return {
            href: hasHref && rawHref ? new URL(rawHref, pageUrl).href : '',
            getAttribute(name) {
                if (name !== 'href' || !hasHref) return null;
                return rawHref ?? '';
            }
        };
    });

    return {
        style: {},
        querySelectorAll(query) {
            if (query !== 'a[href]') return [];
            return anchors.filter(anchor => anchor.getAttribute('href') !== null);
        }
    };
}

function scanBuyeeDetailRecommendations(pageUrl, cards, existingStorage) {
    const location = new URL(pageUrl);
    const storage = existingStorage || {
        buyee_item_registry: {},
        buyee_item_registry_migrated_origins: [location.origin],
        buyee_item_registry_legacy_cleanup_origins: [location.origin]
    };
    const body = fakeElement('body');
    body.innerText = 'Product information';
    const writes = [];
    const timers = [];
    const events = [];
    const windowListeners = {};
    let tick;

    const context = {
        URL,
        Blob,
        location,
        console: { info() {}, log() {}, warn() {}, error(error) { throw error; } },
        GM_getValue: (key, fallback) => structuredClone(storage[key] ?? fallback),
        GM_setValue: (key, value) => {
            writes.push(key);
            storage[key] = structuredClone(value);
        },
        unsafeWindow: {
            localStorage: {
                removeItem() {}
            }
        },
        document: {
            title: 'Item results',
            body,
            createElement: fakeElement,
            documentElement: { scrollHeight: 5000 },
            querySelectorAll: query => query === '.recommendItem__list .recommendItem__items' ? cards : []
        },
        window: {
            innerHeight: 900,
            scrollY: 0,
            pageYOffset: 0,
            addEventListener(type, listener) { (windowListeners[type] ||= []).push(listener); },
            dispatchEvent(event) { events.push(event); }
        },
        CustomEvent: class {
            constructor(type, init = {}) {
                this.type = type;
                this.detail = init.detail;
            }
        },
        setTimeout: (callback, ms) => timers.push({ callback, ms }),
        clearTimeout: id => { if (id) timers[id - 1] = null; },
        setInterval: callback => { tick = callback; }
    };

    vm.runInNewContext(highlighter, context);
    tick();

    return {
        cards,
        storage,
        writes,
        events,
        timers,
        body,
        document: context.document,
        windowListeners,
        tick
    };
}

for (const marketplace of ['yahoo', 'mercari', 'yahooFleaMarket']) {
    for (const slash of ['', '/']) {
        test(`Neokyo ${marketplace}${slash}: hide stored IDs and frame new IDs until reload`, () => {
            const url = `https://neokyo.com/en/search/${marketplace}${slash}?page=2`;
            const item = `https://neokyo.com/en/product/${marketplace}/m42470092884?search_phrase=test`;
            const existing = scan(url, item, true);
            assert.equal(existing.wrapper.style.display, 'none');
            assert.equal(existing.card.style.border, '4px dashed #e74c3c');
            const unseen = scan(url, item, false);
            assert.equal(unseen.card.style.backgroundColor, undefined);
            const scrolled = scan(url, item, false, true);
            assert.equal(scrolled.storage.buyee_item_registry[scrolled.id], 'hide');
            assert.equal(scrolled.card.style.backgroundColor, '#fdf2f2');
            scrolled.tick();
            assert.equal(scrolled.wrapper.style.display, undefined);
            const reloaded = scan(url, item, false, false, scrolled.storage);
            assert.equal(reloaded.wrapper.style.display, 'none');
            assert.equal(reloaded.card.style.border, '4px dashed #e74c3c');
        });
    }
}

for (const route of ['product', 'auction']) {
    test(`ZenMarket ${route} results hide old IDs and frame new IDs until reload`, () => {
        const url = 'https://zenmarket.jp/en/search.aspx?ucid=6585';
        const item = `https://zenmarket.jp/${route}.aspx?itemCode=x1248934501`;
        const result = scan(url, item, true);
        assert.equal(result.wrapper.style.display, 'none');
        const scrolled = scan(url, item, false, true);
        assert.equal(scrolled.card.style.border, '4px dashed #e74c3c');
        scrolled.tick();
        assert.equal(scrolled.wrapper.style.display, undefined);
        assert.equal(scan(url, item, false, false, scrolled.storage).wrapper.style.display, 'none');
    });

    test(`ZenMarket ${route} detail remains visible and records its ID`, () => {
        const item = `https://zenmarket.jp/${route}.aspx?itemCode=x1248934501`;
        const result = scan(item, item, false);
        assert.equal(result.storage.buyee_item_registry[result.id], 'hide');
        assert.equal(result.document.body.style.display, undefined);
        assert.equal(result.card.style.border, undefined);
        assert.equal(result.wrapper.style.display, undefined);
    });
}

for (const marketplace of ['item', 'mercari']) {
    test(`Buyee ${marketplace} results hide old IDs and frame newly seen IDs until reload`, () => {
        const url = `https://buyee.jp/${marketplace}/search`;
        const item = marketplace === 'mercari' ? 'https://buyee.jp/mercari/item/m42470092884'
            : 'https://buyee.jp/item/jdirectitems/auction/x1248934501';
        assert.equal(scan(url, item, true).card.style.display, 'none');
        const result = scan(url, item, false, true, undefined, marketplace === 'mercari');
        assert.equal(result.storage.buyee_item_registry[result.id], 'hide');
        assert.equal(result.card.style.border, '4px dashed #e74c3c');
        result.tick();
        assert.equal(result.card.style.display, undefined);
        assert.equal(scan(url, item, false, false, result.storage).card.style.display, 'none');
    });
}

test('Buyee Mercari still requires a bottom sweep to mark unseen cards', () => {
    const result = scan('https://buyee.jp/mercari/search', 'https://buyee.jp/mercari/item/m42470092884', false, true);
    assert.equal(result.storage.buyee_item_registry[result.id], undefined);
});

test('Buyee detail pages do not hide cards or paint frames', () => {
    const url = 'https://buyee.jp/item/jdirectitems/auction/x1248934501';
    const result = scan(url, url, true);
    assert.equal(result.card.style.display, undefined);
    assert.equal(result.card.style.border, undefined);
});

for (const pageUrl of [
    'https://buyee.jp/item/jdirectitems/auction/x1248934501',
    'https://buyee.jp/mercari/item/m42470092884',
    'https://buyee.jp/paypayfleamarket/item/z708672664'
]) {
    test(`Buyee detail recommendations frame only already-seen cards: ${pageUrl}`, () => {
        const cards = [
            createRecommendationCard(pageUrl, [null, { href: '', hasHref: true }, '/mercari/item/2JYT9KEfHQbS7hkiqhqnLD?conversionType=Mercari_DirectSearch']),
            createRecommendationCard(pageUrl, ['/paypayfleamarket/item/z708672664?conversionType=jdirectitems_auction_DirectSearch']),
            createRecommendationCard(pageUrl, ['https://buyee.jp/item/jdirectitems/auction/1248800526?conversionType=mypage_watch_list']),
            createRecommendationCard(pageUrl, ['https://buyee.jp/item/jdirectitems/auction/x1248934501']),
            createRecommendationCard(pageUrl, ['/mercari/item/mUnseenItem', '/mercari/item/mUnseenItem']),
            createRecommendationCard(pageUrl, [null, { href: '', hasHref: true }, '/watch/list', '/help'])
        ];
        const storage = {
            buyee_item_registry: {
                '2JYT9KEfHQbS7hkiqhqnLD': 'hide',
                z708672664: 'hide',
                '1248800526': 'hide',
                x1248934501: 'hide'
            },
            buyee_item_registry_migrated_origins: ['https://buyee.jp'],
            buyee_item_registry_legacy_cleanup_origins: ['https://buyee.jp']
        };

        const result = scanBuyeeDetailRecommendations(pageUrl, cards, storage);

        for (const card of cards.slice(0, 4)) {
            assert.equal(card.style.border, '4px dashed #e74c3c');
            assert.equal(card.style.backgroundColor, '#fdf2f2');
            assert.equal(card.style.display, undefined);
        }
        for (const card of cards.slice(4)) {
            assert.equal(card.style.border, undefined);
            assert.equal(card.style.backgroundColor, undefined);
            assert.equal(card.style.display, undefined);
        }

        assert.deepEqual(result.writes, []);
        assert.equal(result.events.length, 0);
        assert.equal(result.body.children.length, 0);
        assert.equal(result.document.title, 'Item results');
        assert.equal(pendingTimers(result, 'tryAutoReload').length, 0);
    });
}

test('Buyee detail recommendations do not react to late shared-storage updates until reload', () => {
    const pageUrl = 'https://buyee.jp/item/jdirectitems/auction/x1248934501';
    const cards = [createRecommendationCard(pageUrl, ['/mercari/item/mLateJoin'])];
    const storage = {
        buyee_item_registry: {},
        buyee_item_registry_migrated_origins: ['https://buyee.jp'],
        buyee_item_registry_legacy_cleanup_origins: ['https://buyee.jp']
    };

    const firstVisit = scanBuyeeDetailRecommendations(pageUrl, cards, storage);
    assert.equal(cards[0].style.border, undefined);

    storage.buyee_item_registry.mLateJoin = 'hide';
    firstVisit.tick();
    assert.equal(cards[0].style.border, undefined);

    const afterReloadCards = [createRecommendationCard(pageUrl, ['/mercari/item/mLateJoin'])];
    const afterReload = scanBuyeeDetailRecommendations(pageUrl, afterReloadCards, storage);
    assert.equal(afterReloadCards[0].style.border, '4px dashed #e74c3c');
    assert.equal(afterReload.writes.length, 0);
    assert.equal(afterReload.events.length, 0);
});

test('Buyee detail recommendations pick up delayed cards on repeated scans without marking seen items', () => {
    const pageUrl = 'https://buyee.jp/item/jdirectitems/auction/x1248934501';
    const cards = [];
    const storage = {
        buyee_item_registry: { delayedSeen: 'hide' },
        buyee_item_registry_migrated_origins: ['https://buyee.jp'],
        buyee_item_registry_legacy_cleanup_origins: ['https://buyee.jp']
    };

    const result = scanBuyeeDetailRecommendations(pageUrl, cards, storage);
    cards.push(createRecommendationCard(pageUrl, ['/mercari/item/delayedSeen']));
    cards.push(createRecommendationCard(pageUrl, ['/mercari/item/delayedUnseen']));

    result.tick();
    assert.equal(cards[0].style.border, '4px dashed #e74c3c');
    assert.equal(cards[1].style.border, undefined);

    result.windowListeners.scroll.forEach(listener => listener());
    assert.equal(cards[0].style.border, '4px dashed #e74c3c');
    assert.equal(cards[1].style.border, undefined);
    assert.deepEqual(result.writes, []);
    assert.equal(result.events.length, 0);
});

test('legacy Buyee localStorage is removed only after migration and shared data is kept', () => {
    const url = 'https://buyee.jp/item/search';
    const item = 'https://buyee.jp/item/jdirectitems/auction/x1248934501';
    const migrated = scan(url, item, true);
    assert.equal(migrated.legacyLocalStorage.buyee_item_registry, undefined);
    assert.equal(migrated.storage.buyee_item_registry.x1248934501, 'hide');
    assert.deepEqual(migrated.storage.buyee_item_registry_legacy_cleanup_origins, ['https://buyee.jp']);

    const unmarkedStorage = { buyee_item_registry: {}, buyee_item_registry_migrated_origins: [] };
    const unmarked = scan(url, item, false, false, unmarkedStorage);
    assert.equal(unmarked.legacyLocalStorage.buyee_item_registry, 'legacy-copy');
    assert.equal(unmarked.storage.buyee_item_registry_legacy_cleanup_origins, undefined);
});

test('search panel shows counts, temporarily reveals hidden items and backs up storage', async () => {
    const url = 'https://neokyo.com/en/search/mercari';
    const item = 'https://neokyo.com/en/product/mercari/m42470092884';
    const result = scan(url, item, true);
    result.storage.buyee_item_registry.other = 'hide';
    result.tick();
    assert.deepEqual(panelText(result.body), ['Stored items: 2', 'Hidden on this page: 1']);

    const toggle = findByAction(result.body, 'toggle-hidden');
    toggle.listeners.click();
    assert.equal(result.wrapper.style.display, '');
    assert.equal(result.card.style.border, '4px dashed #e74c3c');
    assert.equal(toggle.attributes['aria-pressed'], 'true');
    result.tick();
    assert.equal(result.wrapper.style.display, '');
    toggle.listeners.click();
    assert.equal(result.wrapper.style.display, 'none');
    assert.deepEqual(Object.keys(result.storage.buyee_item_registry).sort(), ['m42470092884', 'other']);

    findByAction(result.body, 'backup').listeners.click();
    assert.equal(result.blobs.length, 1);
    const backup = JSON.parse(await result.blobs[0].text());
    assert.equal(backup.format, 'cross-market-seen-items-backup');
    assert.equal(backup.itemCount, 2);
    assert.deepEqual(backup.registry, { m42470092884: 'hide', other: 'hide' });
    assert.deepEqual(backup.migratedOrigins, ['https://neokyo.com']);
});

test('detail pages do not show the panel', () => {
    const item = 'https://zenmarket.jp/product.aspx?itemCode=x1248934501';
    assert.equal(scan(item, item, false).body.children.length, 0);
});

test('newly seen items are saved once per scan and merged with other tabs', () => {
    const url = 'https://neokyo.com/en/search/mercari';
    const item = 'https://neokyo.com/en/product/mercari/m42470092884';
    const result = scan(url, item, false, true, undefined, false, {
        setValue(key, value, storage) {
            storage[key] = { ...structuredClone(value), fromOtherTab: 'hide' };
        }
    });
    assert.deepEqual(result.writes, ['buyee_item_registry']);
    result.tick();
    assert.deepEqual(result.writes, ['buyee_item_registry']);
    assert.equal(result.storage.buyee_item_registry.fromOtherTab, 'hide');
});

test('failed read-back keeps items pending and retries after backoff', () => {
    let now = 1000;
    let failing = true;
    const url = 'https://neokyo.com/en/search/mercari';
    const item = 'https://neokyo.com/en/product/mercari/m42470092884';
    const result = scan(url, item, false, true, undefined, false, {
        allowErrors: true,
        now: () => now,
        setValue(key, value, storage) { if (!failing) storage[key] = structuredClone(value); }
    });
    assert.equal(result.storage.buyee_item_registry[result.id], undefined);
    assert.equal(result.errors.length, 1);
    assert.ok(panelText(result.body).includes('Not yet saved: 1'));

    result.tick();
    assert.equal(result.writes.length, 1);
    failing = false;
    now += 5000;
    result.tick();
    assert.equal(result.writes.length, 2);
    assert.equal(result.storage.buyee_item_registry[result.id], 'hide');
    assert.equal(result.errors.length, 1);
    assert.equal(panelText(result.body).some(text => text.startsWith('Not yet saved')), false);
});

test('highlighter panel starts lower-left and remembers a move to the right', () => {
    const url = 'https://neokyo.com/en/search/mercari';
    const item = 'https://neokyo.com/en/product/mercari/m42470092884';
    const result = scan(url, item, true);
    const host = result.body.children[0];
    assert.equal(host.style.left, '12px');
    findByAction(result.body, 'move-panel').listeners.click();
    assert.equal(host.style.right, '12px');
    assert.equal(host.style.left, '');
    assert.equal(result.storage.seen_item_panel_side, 'right');
    assert.equal(scan(url, item, true, false, result.storage).body.children[0].style.right, '12px');
});

function restoreFrom(backupRegistry, answers, options = {}) {
    const url = 'https://neokyo.com/en/search/mercari';
    const item = 'https://neokyo.com/en/product/mercari/m42470092884';
    const storage = { buyee_item_registry: { current: 'hide' }, buyee_item_registry_migrated_origins: ['https://neokyo.com'] };
    const alerts = [];
    const confirms = [...answers];
    const result = scan(url, item, false, false, storage, false, {
        ...options,
        confirm: () => confirms.shift(),
        alert: message => alerts.push(message)
    });
    const text = typeof backupRegistry === 'string' ? backupRegistry
        : JSON.stringify({ format: 'cross-market-seen-items-backup', registry: backupRegistry });
    return { result, alerts, text };
}

for (const [answers, expected] of [
    [[true], { current: 'hide', restored: 'hide' }],
    [[false, true], { restored: 'hide' }],
    [[false, false], { current: 'hide' }]
]) {
    test(`restore with answers ${JSON.stringify(answers)} saves the expected registry`, async () => {
        const { result, alerts, text } = restoreFrom({ restored: 'hide' }, answers);
        await result.restore(text);
        assert.deepEqual(result.storage.buyee_item_registry, expected);
        assert.equal(alerts.length, answers.at(-1) ? 1 : 0);
        if (answers.at(-1)) assert.match(alerts[0], /^Restore complete/);
    });
}

test('restore rejects files that are not seen-item backups', async () => {
    for (const text of ['not json', JSON.stringify({ registry: { a: 'hide' } }),
        JSON.stringify({ format: 'cross-market-seen-items-backup', registry: { '<script>': 'hide' } })]) {
        const restore = restoreFrom(text, [true]);
        await restore.result.restore(restore.text);
        assert.deepEqual(restore.result.storage.buyee_item_registry, { current: 'hide' });
        assert.match(restore.alerts[0], /not a seen-items backup/);
    }
});

test('restore reports a failed read-back', async () => {
    const { result, alerts, text } = restoreFrom({ restored: 'hide' }, [true], { allowErrors: true, setValue() {} });
    await result.restore(text);
    assert.match(alerts[0], /^Restore failed: the data could not be saved/);
});

test('late shared-storage updates do not hide or frame cards in this visit', () => {
    const result = scan('https://neokyo.com/en/search/mercari', 'https://neokyo.com/en/product/mercari/m42470092884', false);
    result.storage.buyee_item_registry[result.id] = 'hide';
    result.tick();
    assert.equal(result.wrapper.style.display, undefined);
    assert.equal(result.card.style.border, undefined);
});

function pendingTimers(result, name) {
    return result.timers.filter(timer => timer?.callback.name === name);
}

function fireTimer(result, name) {
    const [timer] = pendingTimers(result, name);
    result.timers[result.timers.indexOf(timer)] = null;
    timer.callback();
}

test('unseen items cycle a two-color alarm emoji in the tab title until all are seen', () => {
    const result = scan('https://neokyo.com/en/search/mercari', 'https://neokyo.com/en/product/mercari/m42470092884', false);
    assert.equal(result.document.title, '\u{1F534} (1) Item results');
    const [blink] = pendingTimers(result, 'blink');
    assert.ok(blink.ms >= 300 && blink.ms <= 1000);
    fireTimer(result, 'blink');
    assert.equal(result.document.title, '\u{1F535} (1) Item results');
    fireTimer(result, 'blink');
    assert.equal(result.document.title, '\u{1F534} (1) Item results');
    assert.equal(pendingTimers(result, 'blink').length, 1);
    result.tick();
    assert.equal(pendingTimers(result, 'blink').length, 1);

    result.card.getBoundingClientRect = () => ({ top: -200, bottom: -10 });
    result.tick();
    assert.equal(result.document.title, 'Item results');
    assert.equal(pendingTimers(result, 'blink').length, 0);
});

test('seen items and detail pages do not blink the tab title', () => {
    assert.equal(scan('https://neokyo.com/en/search/mercari', 'https://neokyo.com/en/product/mercari/m42470092884', true).document.title, 'Item results');
    const item = 'https://zenmarket.jp/product.aspx?itemCode=x1248934501';
    assert.equal(scan(item, item, false).document.title, 'Item results');
});

test('search pages reload after 5-10 min and postpone one minute after a recent scroll', () => {
    let now = 1000000;
    const result = scan('https://neokyo.com/en/search/mercari', 'https://neokyo.com/en/product/mercari/m42470092884', true, false, undefined, false, { now: () => now });
    const [first] = pendingTimers(result, 'tryAutoReload');
    assert.ok(first.ms >= 300000 && first.ms <= 600000);

    result.windowListeners.scroll.forEach(listener => listener());
    now += 10000;
    fireTimer(result, 'tryAutoReload');
    assert.equal(result.reloads(), 0);
    assert.equal(pendingTimers(result, 'tryAutoReload')[0].ms, 60000);

    now += 60000;
    fireTimer(result, 'tryAutoReload');
    assert.equal(result.reloads(), 1);
});

test('auto-reload waits while seen items are not saved', () => {
    const result = scan('https://neokyo.com/en/search/mercari', 'https://neokyo.com/en/product/mercari/m42470092884', false, true, undefined, false, {
        allowErrors: true,
        setValue() {}
    });
    fireTimer(result, 'tryAutoReload');
    assert.equal(result.reloads(), 0);
    assert.equal(pendingTimers(result, 'tryAutoReload')[0].ms, 60000);
});

test('detail pages do not schedule auto-reload', () => {
    const item = 'https://zenmarket.jp/product.aspx?itemCode=x1248934501';
    assert.equal(pendingTimers(scan(item, item, false), 'tryAutoReload').length, 0);
});

const itemLinksSource = fs.readFileSync(path.join(root, 'Cross-Platform-Item-Links.user.js'), 'utf8');
const itemLinksContext = { URL };
vm.createContext(itemLinksContext);
vm.runInContext(itemLinksSource.replace('    renderPanel();', '    globalThis.api = { identifyItem, destinationLinks };'), itemLinksContext);
const itemLinksApi = itemLinksContext.api;

const itemExamples = [
    ['https://buyee.jp/item/jdirectitems/auction/1248800526?conversionType=mypage_watch_list', 'yahoo', '1248800526'],
    ['https://buyee.jp/mercari/item/2JYT9KEfHQbS7hkiqhqnLD?conversionType=Mercari_DirectSearch', 'mercari', '2JYT9KEfHQbS7hkiqhqnLD'],
    ['https://buyee.jp/paypayfleamarket/item/z708672664?conversionType=jdirectitems_auction_DirectSearch', 'flea', 'z708672664'],
    ['https://zenmarket.jp/auction.aspx?itemCode=x1248934501&cs=4', 'yahoo', 'x1248934501'],
    ['https://zenmarket.jp/product.aspx?shop=mercari&itemCode=m42470092884', 'mercari', 'm42470092884'],
    ['https://zenmarket.jp/product.aspx?shop=yahooFleaMarket&itemCode=z708672664', 'flea', 'z708672664'],
    ['https://neokyo.com/en/product/yahoo/m1248475288', 'yahoo', 'm1248475288'],
    ['https://neokyo.com/en/product/mercari/m42470092884', 'mercari', 'm42470092884'],
    ['https://neokyo.com/en/product/yahooFleaMarket/b1249471224', 'flea', 'b1249471224']
];

for (const [href, marketplace, id] of itemExamples) {
    test(`platform links preserve marketplace and exact ID: ${href}`, () => {
        const item = itemLinksApi.identifyItem(href);
        assert.equal(item.marketplace, marketplace);
        assert.equal(item.id, id);
        const links = itemLinksApi.destinationLinks(item);
        assert.equal(links.length, 3);
        for (const link of links) {
            assert.ok(link.href);
            const destination = itemLinksApi.identifyItem(link.href);
            assert.equal(destination.id, id);
            assert.equal(destination.marketplace, marketplace);
            assert.equal(destination.site, link.site);
            assert.equal(new URL(link.href).searchParams.has('conversionType'), false);
        }
    });
}

test('platform links reject unrelated shops, invalid URLs and deceptive hosts', () => {
    for (const href of [
        'https://zenmarket.jp/product.aspx?shop=yshopping&itemCode=suntop-store_6202-25800',
        'https://zenmarket.jp/product.aspx?itemCode=m42470092884',
        'https://zenmarket.jp/auction.aspx?itemCode=',
        'https://buyee.jp.example.com/mercari/item/m42470092884',
        'https://neokyo.com/en/search/mercari',
        'https://neokyo.com/en/product/rakuma/m42470092884',
        'https://neokyo.com/en/product/mercari/m42470092884/extra',
        'https://zenmarket.jp/auction.aspx?itemCode=%3Cscript%3E',
        'not a URL'
    ]) assert.equal(itemLinksApi.identifyItem(href), null, href);
    assert.equal(itemLinksApi.identifyItem('https://neokyo.com/en/product/yahoo/m42470092884').marketplace, 'yahoo');
});

test('platform panel metadata includes update URLs and does not request network grants', () => {
    new vm.Script(itemLinksSource);
    const grants = [...itemLinksSource.matchAll(/^\/\/ @grant\s+(\S+)/gm)].map(match => match[1]);
    assert.deepEqual(grants, ['GM_getValue', 'GM_setValue']);
    assert.ok(itemLinksSource.includes('// @icon         https://buyee.jp/favicon.ico'));
    assert.ok(itemLinksSource.includes('https://raw.githubusercontent.com/vladmkv/userscripts/main/Cross-Platform-Item-Links.user.js'));
    assert.equal(/\b(?:fetch|GM_xmlhttpRequest)\s*\(/.test(itemLinksSource), false);
    assert.deepEqual([...itemLinksSource.matchAll(/GM_(?:get|set)Value\((\w+)/g)].map(match => match[1]).filter(key => key !== 'PANEL_SIDE_KEY'), []);
});

test('platform panel starts lower-left and remembers a move to the right', () => {
    const store = {};
    const render = () => {
        const body = fakeElement('body');
        const context = {
            URL,
            location: new URL('https://neokyo.com/en/product/mercari/m42470092884'),
            GM_getValue: (key, fallback) => store[key] ?? fallback,
            GM_setValue: (key, value) => { store[key] = value; },
            document: { body, createElement: fakeElement, getElementById: () => null }
        };
        vm.runInNewContext(itemLinksSource, context);
        return body.children[0];
    };
    const host = render();
    assert.equal(host.style.left, '12px');
    const move = findByAction(host, 'move-panel');
    assert.equal(move.textContent, 'Move panel right');
    move.listeners.click();
    assert.equal(host.style.left, '');
    assert.equal(host.style.right, '12px');
    assert.equal(move.textContent, 'Move panel left');
    assert.equal(render().style.right, '12px');
});

test('platform button icons precede labels and use the matching site favicon URL', () => {
    const context = {
        URL,
        document: {
            createElement: tag => ({ tag, attributes: {}, setAttribute(name, value) { this.attributes[name] = value; } })
        }
    };
    vm.createContext(context);
    vm.runInContext(itemLinksSource.replace('    renderPanel();', '    globalThis.appendSiteLabel = appendSiteLabel;'), context);
    const expectedFavicons = {
        Buyee: 'https://buyee.jp/favicon.ico',
        ZenMarket: 'https://zenmarket.jp/favicon.ico',
        Neokyo: 'https://neokyo.com/favicon.ico'
    };
    for (const site of Object.keys(expectedFavicons)) {
        const control = { append(...children) { this.children = children; } };
        context.appendSiteLabel(control, site);
        const [icon, label] = control.children;
        assert.equal(label.textContent, site);
        assert.equal(icon.className, 'favicon');
        assert.equal(icon.attributes['aria-hidden'], 'true');
        assert.equal(icon.tag, 'img');
        assert.equal(icon.src, expectedFavicons[site]);
        assert.equal(icon.width, 18);
    }
    assert.match(itemLinksSource, /\.links \{[^}]*flex-direction: column/);
});