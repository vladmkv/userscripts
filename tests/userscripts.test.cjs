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

function scan(pageUrl, itemUrl, seen, offscreen = false, existingStorage, atBottom = false) {
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
    let tick;
    const context = {
        URL, location, console: { info() {}, log() {}, warn() {}, error(error) { throw error; } },
        GM_getValue: (key, fallback) => structuredClone(storage[key] ?? fallback),
        GM_setValue: (key, value) => { storage[key] = structuredClone(value); },
        document: {
            title: 'Item results',
            body: { innerText: 'Product information', style: {} },
            documentElement: { scrollHeight: atBottom ? 900 : 5000 },
            querySelectorAll: query => {
                if (query.startsWith('a[href*=')) return [link];
                if (query.includes('product-item') || query === '.product-card.auction'
                    || query.startsWith('#content_inner')) return [card];
                return [];
            }
        },
        window: { innerHeight: 900, scrollY: 0, pageYOffset: 0, addEventListener() {}, dispatchEvent() {} },
        CustomEvent: class {},
        setTimeout() {},
        setInterval: callback => { tick = callback; }
    };
    vm.runInNewContext(highlighter, context);
    tick();
    return { card, wrapper, storage, id, tick, document: context.document };
}

for (const marketplace of ['yahoo', 'mercari', 'yahooFleaMarket']) {
    for (const slash of ['', '/']) {
        test(`Neokyo ${marketplace}${slash}: hide stored IDs and frame new IDs until reload`, () => {
            const url = `https://neokyo.com/en/search/${marketplace}${slash}?page=2`;
            const item = `https://neokyo.com/en/product/${marketplace}/m42470092884?search_phrase=test`;
            const existing = scan(url, item, true);
            assert.equal(existing.wrapper.style.display, 'none');
            assert.equal(existing.card.style.border, undefined);
            const unseen = scan(url, item, false);
            assert.equal(unseen.card.style.backgroundColor, undefined);
            const scrolled = scan(url, item, false, true);
            assert.equal(scrolled.storage.buyee_item_registry[scrolled.id], 'hide');
            assert.equal(scrolled.card.style.backgroundColor, '#fdf2f2');
            scrolled.tick();
            assert.equal(scrolled.wrapper.style.display, undefined);
            const reloaded = scan(url, item, false, false, scrolled.storage);
            assert.equal(reloaded.wrapper.style.display, 'none');
            assert.equal(reloaded.card.style.border, undefined);
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

test('late shared-storage updates do not hide or frame cards in this visit', () => {
    const result = scan('https://neokyo.com/en/search/mercari', 'https://neokyo.com/en/product/mercari/m42470092884', false);
    result.storage.buyee_item_registry[result.id] = 'hide';
    result.tick();
    assert.equal(result.wrapper.style.display, undefined);
    assert.equal(result.card.style.border, undefined);
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

test('platform panel metadata includes update URLs and does not request storage or network grants', () => {
    new vm.Script(itemLinksSource);
    assert.ok(itemLinksSource.includes('// @grant        none'));
    assert.ok(itemLinksSource.includes('// @icon         https://buyee.jp/favicon.ico'));
    assert.ok(itemLinksSource.includes('https://raw.githubusercontent.com/vladmkv/userscripts/main/Cross-Platform-Item-Links.user.js'));
    assert.equal(/\b(?:fetch|GM_xmlhttpRequest|GM_setValue|GM_getValue)\s*\(/.test(itemLinksSource), false);
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