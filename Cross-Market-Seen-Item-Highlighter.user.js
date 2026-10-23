// ==UserScript==
// @name         Cross-Market Seen Item Highlighter
// @namespace    http://tampermonkey.net
// @version      7.19
// @updateURL    https://raw.githubusercontent.com/vladmkv/userscripts/main/Cross-Market-Seen-Item-Highlighter.user.js
// @downloadURL  https://raw.githubusercontent.com/vladmkv/userscripts/main/Cross-Market-Seen-Item-Highlighter.user.js
// @description  Tracks seen item IDs across Buyee, ZenMarket, and Neokyo search feeds.
// @author       You
// @match        *://*.buyee.jp/item/search*
// @match        *://*.buyee.jp/mercari/search*
// @match        *://*.buyee.jp/item/jdirectitems/auction/*
// @match        *://*.buyee.jp/mercari/item/
// @match        *://*.buyee.jp/paypayfleamarket/item/*
// @match        *://zenmarket.jp/en/search.aspx*
// @match        *://zenmarket.jp/product.aspx*
// @match        *://zenmarket.jp/auction.aspx*
// @match        *://neokyo.com/en/search/yahoo*
// @match        *://neokyo.com/en/search/mercari*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        unsafeWindow
// ==/UserScript==

(function() {
    'use strict';

    // --- PREFIX REGEX CONSTANT ---
    const ORIGINAL_SEARCH_REGEX = /^https?:\/\/[^\/]+\/(?:item(?:\/[^\/]+)*|mercari\/item|paypayfleamarket\/item)\/([a-zA-Z0-9_]+)(?:[\?,]|$)/;
    const MAX_TRACKED_ITEMS = 60000;
    const REGISTRY_KEY = 'buyee_item_registry';
    const MIGRATED_ORIGINS_KEY = 'buyee_item_registry_migrated_origins';

    function isBuyeeSite() {
        return location.hostname === 'buyee.jp' || location.hostname.endsWith('.buyee.jp');
    }

    function isZenMarketSearch() {
        return location.hostname === 'zenmarket.jp' && location.pathname.toLowerCase() === '/en/search.aspx';
    }

    function isNeokyoSearch() {
        const hostname = location.hostname.toLowerCase();
        return (hostname === 'neokyo.com' || hostname.endsWith('.neokyo.com'))
            && /^\/en\/search\/(?:yahoo|mercari|yahoofleamarket)\/?$/.test(location.pathname.toLowerCase());
    }

    function isZenMarketSite() {
        return location.hostname === 'zenmarket.jp';
    }

    function isZenMarketItemPage() {
        return isZenMarketSite() && ['/product.aspx', '/auction.aspx'].includes(location.pathname.toLowerCase());
    }

    function readLegacyBuyeeRegistry() {
        try {
            const stored = JSON.parse(unsafeWindow.localStorage.getItem(REGISTRY_KEY)) || {};
            return stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
        } catch (error) {
            console.warn('Could not read the legacy Buyee registry', error);
            return null;
        }
    }

    function loadRegistry() {
        const storedRegistry = GM_getValue(REGISTRY_KEY, {});
        const registry = storedRegistry && typeof storedRegistry === 'object' && !Array.isArray(storedRegistry)
            ? { ...storedRegistry }
            : {};

        if (isBuyeeSite()) {
            const migratedOriginsValue = GM_getValue(MIGRATED_ORIGINS_KEY, []);
            const migratedOrigins = Array.isArray(migratedOriginsValue) ? migratedOriginsValue : [];
            const currentOrigin = location.origin;

            if (migratedOrigins.includes(currentOrigin)) {
                console.info(`[Cross-Market Seen Item Highlighter] Shared registry ready for ${currentOrigin}; previously migrated with ${Object.keys(registry).length} records.`);
                return registry;
            }

            const legacyRegistry = readLegacyBuyeeRegistry();
            if (!legacyRegistry) return registry;

            let importedCount = 0;
            Object.entries(legacyRegistry).forEach(([id, state]) => {
                if (!(id in registry)) {
                    registry[id] = state;
                    importedCount++;
                }
            });

            GM_setValue(REGISTRY_KEY, registry);
            GM_setValue(MIGRATED_ORIGINS_KEY, [...migratedOrigins, currentOrigin]);
            console.info(`[Cross-Market Seen Item Highlighter] Migration complete for ${currentOrigin}: imported ${importedCount} records; ${Object.keys(registry).length} total in shared storage.`);
        }

        if (isZenMarketSearch()) {
            const migratedOrigins = GM_getValue(MIGRATED_ORIGINS_KEY, []);
            const migrationStatus = Array.isArray(migratedOrigins) && migratedOrigins.length > 0
                ? `Buyee migration complete for ${migratedOrigins.join(', ')}`
                : 'Buyee migration has not run yet; open a matched Buyee page to import its localStorage';
            console.info(`[Cross-Market Seen Item Highlighter] ZenMarket loaded ${Object.keys(registry).length} shared records. ${migrationStatus}.`);
        }

        return registry;
    }

    let itemRegistry = loadRegistry();
    const seenAtPageLoad = new Set(Object.keys(itemRegistry).filter(id => itemRegistry[id] === 'hide'));
    const seenThisVisit = new Set();
    let neokyoCardDiagnosticReported = false;
    let neokyoProcessEntryReported = false;
    const neokyoDiagnosticStartedAt = Date.now();
    let lastScanError = '';

    if (isNeokyoSearch()) {
        console.info(`[Cross-Market Seen Item Highlighter] Neokyo userscript active on ${location.pathname}; shared registry has ${Object.keys(itemRegistry).length} records.`);
    }

    function saveToMemory() {
        let registryKeys = Object.keys(itemRegistry);
        if (registryKeys.length > MAX_TRACKED_ITEMS) {
            let discardableIds = registryKeys.filter(id => itemRegistry[id] === 'hide');
            let overflowCount = registryKeys.length - MAX_TRACKED_ITEMS;
            if (discardableIds.length > 0 && overflowCount > 0) {
                let itemsToRemove = Math.min(overflowCount, discardableIds.length);
                for (let i = 0; i < itemsToRemove; i++) {
                    delete itemRegistry[discardableIds[i]];
                }
            }
        }
        GM_setValue(REGISTRY_KEY, itemRegistry);
    }

    function isAtPageBottom() {
        const currentScroll = window.scrollY || window.pageYOffset;
        const windowHeight = window.innerHeight;
        const totalHeight = document.documentElement.scrollHeight;
        return (currentScroll + windowHeight) >= (totalHeight - 15);
    }

    function getTargetListingCards() {
        if (isNeokyoSearch()) {
            if (/\/(?:mercari|yahoofleamarket)\/?$/i.test(location.pathname)) {
                const marketplace = /\/mercari\/?$/i.test(location.pathname) ? 'mercari' : 'yahooFleaMarket';
                const productLinks = document.querySelectorAll(`a[href*="/en/product/${marketplace}/"]`);
                return Array.from(new Set(Array.from(productLinks, link =>
                    link.closest('.card') || link.closest('.product-card') || link.parentElement
                ).filter(Boolean)));
            }

            return document.querySelectorAll('.product-card.auction');
        }

        if (isZenMarketSearch()) {
            return document.querySelectorAll('a.product-item.product-link[href*="product.aspx"], a.product-item.product-link[href*="auction.aspx"]');
        }

        // First, check if standard top-level list wrappers exist on the current page layout
        let listItems = document.querySelectorAll('#content_inner form > div > ul > li, #content_inner form > ul > li, #top main section ul > li');
        if (listItems && listItems.length > 0) {
            return listItems;
        }
        // Fall back to alternative card grid classes ONLY if the outer list items do not exist
        return document.querySelectorAll('.g-itemCard, .yahooAuctionItemCard, div[class*="itemCard"]');
    }

    function getItemId(href) {
        if (isNeokyoSearch()) {
            try {
                const itemUrl = new URL(href, location.href);
                const match = itemUrl.pathname.match(/^\/en\/product\/(?:yahoo|mercari|yahooFleaMarket)\/([a-zA-Z0-9_-]+)\/?$/i);
                return match ? match[1] : null;
            } catch (error) {
                return null;
            }
        }

        if (isZenMarketSite()) {
            try {
                const itemUrl = new URL(href, location.href);
                const itemCode = itemUrl.searchParams.get('itemCode');
                if (!['/product.aspx', '/auction.aspx'].includes(itemUrl.pathname.toLowerCase()) || !itemCode) return null;

                return itemCode;
            } catch (error) {
                return null;
            }
        }

        const match = href.match(ORIGINAL_SEARCH_REGEX);
        return (match && match[1]) ? match[1] : null;
    }

    function paintSeenItem(card) {
        card.style.border = '4px dashed #e74c3c';
        card.style.backgroundColor = '#fdf2f2';
    }

    function hideSeenItem(card) {
        const wrapper = isZenMarketSearch() ? card.closest('.product')
            : isNeokyoSearch() ? card.closest('.col-lg-3, .col-md-4, .col-xs-6') : null;
        (wrapper || card).style.display = 'none';
    }

    function processZenMarketItemPage() {
        if (!isZenMarketItemPage()) return false;

        const pageText = `${document.title} ${document.body?.innerText || ''}`.toLowerCase();
        if (/just a moment|performing security verification|verify you are human/.test(pageText)) return true;

        const itemId = getItemId(location.href);
        if (!itemId) return true;

        if (itemRegistry[itemId] !== 'hide') {
            itemRegistry[itemId] = 'hide';
            saveToMemory();
            console.info(`[Cross-Market Seen Item Highlighter] Marked ZenMarket item ${itemId} as seen.`);
        }

        return true;
    }

    function processStateEngine() {
        if (isNeokyoSearch() && !neokyoProcessEntryReported) {
            console.info(`[Cross-Market Seen Item Highlighter] Neokyo scan callback entered on ${location.pathname}.`);
            neokyoProcessEntryReported = true;
        }

        const sharedRegistry = GM_getValue(REGISTRY_KEY, itemRegistry);
        if (sharedRegistry && typeof sharedRegistry === 'object' && !Array.isArray(sharedRegistry)) {
            itemRegistry = sharedRegistry;
        }

        if (processZenMarketItemPage()) return;
        if (!isZenMarketSearch() && !isNeokyoSearch()
            && !(isBuyeeSite() && /^\/(?:item|mercari)\/search(?:\/|$)/.test(location.pathname))) return;

        const cards = getTargetListingCards();
        const userReachedBottom = isAtPageBottom();

        if (isNeokyoSearch() && !neokyoCardDiagnosticReported
            && (cards.length > 0 || Date.now() - neokyoDiagnosticStartedAt >= 5000)) {
            const cardLinks = Array.from(document.querySelectorAll('a[href*="/en/product/"]'));
            const sampleLink = cardLinks[0];
            const sampleId = sampleLink ? getItemId(sampleLink.href) : null;
            const previouslySeenCount = cardLinks.filter(link => {
                const id = link ? getItemId(link.href) : null;
                return id && itemRegistry[id] === 'hide';
            }).length;
            console.info(`[Cross-Market Seen Item Highlighter] Neokyo scan: ${cards.length} cards, ${cardLinks.length} Mercari product links, sample ID ${sampleId || 'none'}, ${previouslySeenCount} already in shared registry.`);
            neokyoCardDiagnosticReported = true;
        }

        cards.forEach(card => {
            const linkSelector = isNeokyoSearch() ? 'a[href*="/en/product/"]' : 'a[href*="/item/"]';
            const link = card.tagName === 'A' ? card : card.querySelector(linkSelector);
            if (!link) return;

            const href = link.href || "";
            const isMercari = isBuyeeSite() && href.includes("mercari");
            const itemId = getItemId(href);

            if (!itemId) return;
            if (isBuyeeSite() && ['jdirectitems', 'auction', 'item', 'search', 'mercari'].includes(itemId)) return;

            if (seenAtPageLoad.has(itemId)) {
                hideSeenItem(card);
                return;
            }

            if (seenThisVisit.has(itemId)) {
                paintSeenItem(card);
                return;
            }
            if (itemRegistry[itemId] === 'hide') return;

            const position = card.getBoundingClientRect();
            const hasCompletelyLeftScreen = isMercari ? false : (position.bottom < 0);
            const visibleAtBottomSweep = (userReachedBottom && position.top < window.innerHeight);

            if (hasCompletelyLeftScreen || visibleAtBottomSweep) {
                itemRegistry[itemId] = 'hide';
                seenThisVisit.add(itemId);
                saveToMemory();
                paintSeenItem(card);
                window.dispatchEvent(new CustomEvent('buyeeItemSeen', { detail: { id: itemId } }));
                console.log(itemId + " added as hidden");
            }
        });
    }

    function runStateEngineSafely() {
        try {
            processStateEngine();
            lastScanError = '';
        } catch (error) {
            const errorKey = `${error?.name || 'Error'}: ${error?.message || error}`;
            if (errorKey !== lastScanError) {
                console.error(`[Cross-Market Seen Item Highlighter] Scan failed on ${location.pathname}:`, error);
                lastScanError = errorKey;
            }
        }
    }

    setTimeout(runStateEngineSafely, 300);
    setTimeout(runStateEngineSafely, 800);
    window.addEventListener('scroll', runStateEngineSafely);
    setInterval(runStateEngineSafely, 1500);
})();
