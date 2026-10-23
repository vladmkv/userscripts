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

function scan(pageUrl, itemUrl, seen, offscreen = false) {
    const location = new URL(pageUrl);
    const id = location.hostname === 'zenmarket.jp'
        ? new URL(itemUrl).searchParams.get('itemCode')
        : new URL(itemUrl).pathname.split('/').filter(Boolean).at(-1);
    const storage = { buyee_item_registry: seen ? { [id]: 'hide' } : {} };
    const card = {
        tagName: location.hostname === 'zenmarket.jp' ? 'A' : 'DIV',
        href: itemUrl,
        style: {},
        getBoundingClientRect: () => ({ top: offscreen ? -200 : 100, bottom: offscreen ? -10 : 300 })
    };
    const link = { href: itemUrl, closest: () => card };
    card.querySelector = () => link;
    let tick;
    const context = {
        URL, location, console: { info() {}, log() {}, warn() {}, error(error) { throw error; } },
        GM_getValue: (key, fallback) => storage[key] ?? fallback,
        GM_setValue: (key, value) => { storage[key] = value; },
        document: {
            documentElement: { scrollHeight: 5000 },
            querySelectorAll: query => {
                if (query.startsWith('a[href*=')) return [link];
                if (query.includes('product-item') || query === '.product-card.auction') return [card];
                return [];
            }
        },
        window: { innerHeight: 900, scrollY: 0, addEventListener() {}, dispatchEvent() {} },
        CustomEvent: class {},
        setTimeout() {},
        setInterval: callback => { tick = callback; }
    };
    vm.runInNewContext(highlighter, context);
    tick();
    return { card, storage, id };
}

for (const marketplace of ['yahoo', 'mercari', 'yahooFleaMarket']) {
    for (const slash of ['', '/']) {
        test(`Neokyo ${marketplace}${slash}: paint stored IDs and save off-screen IDs`, () => {
            const url = `https://neokyo.com/en/search/${marketplace}${slash}?page=2`;
            const item = `https://neokyo.com/en/product/${marketplace}/m42470092884?search_phrase=test`;
            const existing = scan(url, item, true);
            assert.equal(existing.card.style.backgroundColor, '#fdf2f2');
            const unseen = scan(url, item, false);
            assert.equal(unseen.card.style.backgroundColor, undefined);
            const scrolled = scan(url, item, false, true);
            assert.equal(scrolled.storage.buyee_item_registry[scrolled.id], 'hide');
            assert.equal(scrolled.card.style.backgroundColor, '#fdf2f2');
        });
    }
}

for (const route of ['product', 'auction']) {
    test(`ZenMarket ${route} result cards use the shared registry`, () => {
        const result = scan('https://zenmarket.jp/en/search.aspx?ucid=6585', `https://zenmarket.jp/${route}.aspx?itemCode=x1248934501`, true);
        assert.equal(result.card.style.backgroundColor, '#fdf2f2');
    });
}