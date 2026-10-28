// ==UserScript==
// @name         Cross-Market Seen Item Highlighter
// @namespace    http://tampermonkey.net
// @version      7.29
// @updateURL    https://raw.githubusercontent.com/vladmkv/userscripts/main/Cross-Market-Seen-Item-Highlighter.user.js
// @downloadURL  https://raw.githubusercontent.com/vladmkv/userscripts/main/Cross-Market-Seen-Item-Highlighter.user.js
// @description  Tracks seen item IDs across Buyee, ZenMarket, and Neokyo search feeds.
// @author       You
// @match        *://*.buyee.jp/item/search*
// @match        *://*.buyee.jp/mercari/search*
// @match        *://*.buyee.jp/item/jdirectitems/auction/*
// @match        *://*.buyee.jp/mercari/item/*
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
    const LEGACY_CLEANUP_ORIGINS_KEY = 'buyee_item_registry_legacy_cleanup_origins';
    const PANEL_SIDE_KEY = 'seen_item_panel_side';
    const BACKUP_FORMAT = 'cross-market-seen-items-backup';
    const MAX_BACKUP_BYTES = 20 * 1024 * 1024;
    const RELOAD_MIN_MS = 5 * 60000;
    const RELOAD_MAX_MS = 10 * 60000;
    const RELOAD_POSTPONE_MS = 60000;
    const RECENT_SCROLL_MS = 30000;
    const BLINK_MIN_MS = 300;
    const BLINK_MAX_MS = 1000;
    const ALARM_EMOJIS = ['\u{1F534}', '\u{1F535}'];

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

    function isBuyeeItemPage() {
        if (!isBuyeeSite()) return false;
        return /^\/(?:item\/jdirectitems\/auction|mercari\/item|paypayfleamarket\/item)\/[a-zA-Z0-9_-]+(?:\/|$)/.test(location.pathname);
    }

    function isSearchPage() {
        return isZenMarketSearch() || isNeokyoSearch()
            || (isBuyeeSite() && /^\/(?:item|mercari)\/search(?:\/|$)/.test(location.pathname));
    }

    function randomBetween(min, max) {
        return min + Math.random() * (max - min);
    }

    function loadRegistry() {
        const storedRegistry = GM_getValue(REGISTRY_KEY, {});
        const registry = storedRegistry && typeof storedRegistry === 'object' && !Array.isArray(storedRegistry)
            ? { ...storedRegistry }
            : {};

        if (isBuyeeSite()) {
            const migratedOriginsValue = GM_getValue(MIGRATED_ORIGINS_KEY, []);
            const migratedOrigins = Array.isArray(migratedOriginsValue) ? migratedOriginsValue : [];
            const cleanupOriginsValue = GM_getValue(LEGACY_CLEANUP_ORIGINS_KEY, []);
            const cleanupOrigins = Array.isArray(cleanupOriginsValue) ? cleanupOriginsValue : [];
            const currentOrigin = location.origin;

            if (migratedOrigins.includes(currentOrigin)) {
                if (!cleanupOrigins.includes(currentOrigin)) {
                    try {
                        unsafeWindow.localStorage.removeItem(REGISTRY_KEY);
                        GM_setValue(LEGACY_CLEANUP_ORIGINS_KEY, [...cleanupOrigins, currentOrigin]);
                        console.info(`[Cross-Market Seen Item Highlighter] Removed legacy localStorage registry for ${currentOrigin}; shared Tampermonkey data is preserved.`);
                    } catch (error) {
                        console.warn(`[Cross-Market Seen Item Highlighter] Could not remove legacy localStorage registry for ${currentOrigin}.`, error);
                    }
                }
                console.info(`[Cross-Market Seen Item Highlighter] Shared registry ready for ${currentOrigin}; previously migrated with ${Object.keys(registry).length} records.`);
                return registry;
            }

            console.warn(`[Cross-Market Seen Item Highlighter] No migration marker for ${currentOrigin}; legacy localStorage was left untouched.`);
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
    // Load-time snapshot: search pages hide these; fixed so cards do not vanish mid-visit.
    const seenAtPageLoad = new Set(Object.keys(itemRegistry).filter(id => itemRegistry[id] === 'hide'));
    // Marked by this tab: shown framed, never hidden, until reload.
    const seenThisVisit = new Set();
    const pendingWrites = new Set();
    const hiddenElements = new Set();
    let showHidden = false;
    let panelElements = null;
    let writeRetryAt = 0;
    let writeRetryDelay = 5000;
    let lastWriteError = '';
    let neokyoCardDiagnosticReported = false;
    let neokyoProcessEntryReported = false;
    const neokyoDiagnosticStartedAt = Date.now();
    let lastScanError = '';
    let lastScrollAt = 0;
    let reloadDueAt = 0;
    let reloadTimeoutHandle = null;
    let reloadCountdownInterval = null;

    function formatReloadCountdown(msRemaining) {
        const totalSeconds = Math.max(0, Math.ceil(msRemaining / 1000));
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }

    function updateReloadCountdown() {
        if (!panelElements || !panelElements.countdown) return;
        if (!reloadDueAt) {
            panelElements.countdown.textContent = 'Next reload: --:--';
            return;
        }
        const remaining = Math.max(0, reloadDueAt - Date.now());
        panelElements.countdown.textContent = `Next reload: ${formatReloadCountdown(remaining)}`;
    }

    // Tab-title alarm; callers only report how many unseen cards remain on the page.
    const newItemAlarm = (() => {
        let active = false;
        let phase = 0;
        let count = 0;
        let baseTitle = '';
        let blinkTimer = null;

        function render() {
            document.title = `${ALARM_EMOJIS[phase]} (${count}) ${baseTitle}`;
        }

        function blink() {
            render();
            phase = (phase + 1) % ALARM_EMOJIS.length;
            blinkTimer = setTimeout(blink, randomBetween(BLINK_MIN_MS, BLINK_MAX_MS));
        }

        function start() {
            active = true;
            baseTitle = document.title;
            phase = 0;
            blink();
        }

        function stop() {
            active = false;
            clearTimeout(blinkTimer);
            blinkTimer = null;
            document.title = baseTitle;
        }

        return {
            update(unseenCount) {
                count = unseenCount;
                if (count > 0 && !active) start();
                else if (count === 0 && active) stop();
            }
        };
    })();

    function scheduleAutoReload(delay) {
        if (reloadTimeoutHandle) {
            clearTimeout(reloadTimeoutHandle);
        }
        if (reloadCountdownInterval) {
            clearInterval(reloadCountdownInterval);
        }
        reloadDueAt = Date.now() + delay;
        reloadCountdownInterval = setInterval(updateReloadCountdown, 1000);
        updateReloadCountdown();
        reloadTimeoutHandle = setTimeout(tryAutoReload, delay);
    }

    // Waits while the user is scrolling or seen items are not yet saved, so no marks are lost.
    function tryAutoReload() {
        flushPendingWrites();
        if (pendingWrites.size > 0 || Date.now() - lastScrollAt < RECENT_SCROLL_MS) {
            scheduleAutoReload(RELOAD_POSTPONE_MS);
            return;
        }
        if (reloadCountdownInterval) {
            clearInterval(reloadCountdownInterval);
            reloadCountdownInterval = null;
        }
        if (reloadTimeoutHandle) {
            clearTimeout(reloadTimeoutHandle);
            reloadTimeoutHandle = null;
        }
        reloadDueAt = 0;
        location.reload();
    }

    if (isNeokyoSearch()) {
        console.info(`[Cross-Market Seen Item Highlighter] Neokyo userscript active on ${location.pathname}; shared registry has ${Object.keys(itemRegistry).length} records.`);
    }

    function readStoredRegistry() {
        const stored = GM_getValue(REGISTRY_KEY, {});
        return stored && typeof stored === 'object' && !Array.isArray(stored) ? { ...stored } : {};
    }

    // REVIEW(pruning): behavior at the cap is untested; recheck both callers, the registry refresh in processStateEngine and the detail-page paint check.
    function pruneRegistry(registry) {
        const registryKeys = Object.keys(registry);
        const overflowCount = registryKeys.length - MAX_TRACKED_ITEMS;
        if (overflowCount <= 0) return;
        const discardableIds = registryKeys.filter(id => registry[id] === 'hide');
        const itemsToRemove = Math.min(overflowCount, discardableIds.length);
        for (let i = 0; i < itemsToRemove; i++) {
            delete registry[discardableIds[i]];
        }
    }

    function markSeen(itemId) {
        itemRegistry[itemId] = 'hide';
        pendingWrites.add(itemId);
    }

    // GM_setValue returns nothing, so success is confirmed by reading the value back.
    function saveVerified(registry) {
        GM_setValue(REGISTRY_KEY, registry);
        const saved = readStoredRegistry();
        const ids = Object.keys(registry);
        const missing = ids.filter(id => saved[id] !== registry[id]);
        if (missing.length > 0) {
            throw new Error(`${missing.length} of ${ids.length} items were missing after saving`);
        }
        return saved;
    }

    // Merges with the latest stored copy so writes from other tabs are not overwritten.
    function flushPendingWrites() {
        if (pendingWrites.size === 0 || Date.now() < writeRetryAt) return;
        const ids = [...pendingWrites];
        try {
            const latest = readStoredRegistry();
            ids.forEach(id => { latest[id] = 'hide'; });
            pruneRegistry(latest);
            const saved = saveVerified(latest);
            ids.forEach(id => pendingWrites.delete(id));
            itemRegistry = saved;
            writeRetryAt = 0;
            writeRetryDelay = 5000;
            lastWriteError = '';
        } catch (error) {
            writeRetryAt = Date.now() + writeRetryDelay;
            writeRetryDelay = Math.min(writeRetryDelay * 2, 60000);
            const errorKey = `${error?.name || 'Error'}: ${error?.message || error}`;
            if (errorKey !== lastWriteError) {
                console.error(`[Cross-Market Seen Item Highlighter] Saving ${ids.length} seen items failed; will retry.`, error);
                lastWriteError = errorKey;
            }
        }
    }

    function downloadBackup() {
        const registry = readStoredRegistry();
        pendingWrites.forEach(id => { registry[id] = 'hide'; });
        const backup = {
            format: BACKUP_FORMAT,
            version: 1,
            exportedAt: new Date().toISOString(),
            itemCount: Object.keys(registry).length,
            migratedOrigins: GM_getValue(MIGRATED_ORIGINS_KEY, []),
            registry
        };
        const url = URL.createObjectURL(new Blob([JSON.stringify(backup)], { type: 'application/json' }));
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `seen-items-backup-${backup.exportedAt.replace(/[:.]/g, '-')}.json`;
        document.body.append(anchor);
        anchor.click();
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function isValidRegistry(registry) {
        return registry && typeof registry === 'object' && !Array.isArray(registry)
            && Object.entries(registry).every(([id, value]) => /^[a-zA-Z0-9_-]+$/.test(id) && typeof value === 'string');
    }

    function applyBackup(text) {
        let backup = null;
        try {
            backup = JSON.parse(text);
        } catch {
            backup = null;
        }
        if (backup?.format !== BACKUP_FORMAT || !isValidRegistry(backup.registry)) {
            window.alert('Restore failed: this is not a seen-items backup file.');
            return;
        }
        const current = readStoredRegistry();
        const currentCount = Object.keys(current).length;
        const backupCount = Object.keys(backup.registry).length;
        let restored;
        if (window.confirm(`Merge ${backupCount} backed-up items into the ${currentCount} stored items?\n\nOK = merge. Cancel = choose replace instead.`)) {
            restored = { ...current, ...backup.registry };
        } else if (window.confirm(`Replace all ${currentCount} stored items with the ${backupCount} backed-up items?\n\nItems not in the backup will be forgotten.`)) {
            restored = { ...backup.registry };
        } else {
            return;
        }
        pendingWrites.forEach(id => { restored[id] = 'hide'; });
        pruneRegistry(restored);
        try {
            itemRegistry = saveVerified(restored);
            pendingWrites.clear();
            window.alert(`Restore complete: ${Object.keys(itemRegistry).length} items stored. Reload to hide restored items on this page.`);
        } catch (error) {
            console.error('[Cross-Market Seen Item Highlighter] Restore failed.', error);
            window.alert('Restore failed: the data could not be saved completely. Try restoring the backup again.');
        }
        updatePanel();
    }

    function chooseBackupFile() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'application/json,.json';
        input.addEventListener('change', async () => {
            const file = input.files?.[0];
            if (!file) return;
            if (file.size > MAX_BACKUP_BYTES) {
                window.alert('Restore failed: the file is too large to be a seen-items backup.');
                return;
            }
            applyBackup(await file.text());
        });
        input.click();
    }

    function applyPanelSide() {
        const side = GM_getValue(PANEL_SIDE_KEY, 'left') === 'right' ? 'right' : 'left';
        panelElements.host.style.left = side === 'left' ? '12px' : '';
        panelElements.host.style.right = side === 'right' ? '12px' : '';
        panelElements.move.textContent = side === 'left' ? 'Move panel right' : 'Move panel left';
    }

    function movePanel() {
        GM_setValue(PANEL_SIDE_KEY, GM_getValue(PANEL_SIDE_KEY, 'left') === 'right' ? 'left' : 'right');
        applyPanelSide();
    }

    function toggleHiddenItems() {
        showHidden = !showHidden;
        hiddenElements.forEach(element => { element.style.display = showHidden ? '' : 'none'; });
        updatePanel();
    }

    function createButton(text, action, onClick) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = text;
        button.setAttribute('data-action', action);
        button.addEventListener('click', onClick);
        return button;
    }

    function ensurePanel() {
        if (panelElements || !document.body) return;
        const host = document.createElement('div');
        host.id = 'cross-market-seen-panel';
        host.style.cssText = 'position:fixed;bottom:12px;z-index:2147483646;';
        const root = host.attachShadow({ mode: 'open' });
        const style = document.createElement('style');
        style.textContent = `
            section { box-sizing: border-box; display: flex; flex-direction: column; gap: 6px; width: 210px; padding: 10px; border: 1px solid #777; border-radius: 4px; background: #fff; color: #202020; box-shadow: 0 2px 8px #0003; font: 13px/1.4 Verdana, sans-serif; }
            p { margin: 0; }
            .pending { color: #b00020; }
            button { min-height: 32px; padding: 5px 8px; border: 1px solid #777; border-radius: 3px; background: #f5f5f5; color: #202020; font: inherit; cursor: pointer; }
            button:hover { background: #e5f3e8; }
            button:focus-visible { outline: 2px solid #14652c; outline-offset: 2px; }
        `;
        const panel = document.createElement('section');
        panel.setAttribute('aria-label', 'Seen item registry');
        const total = document.createElement('p');
        const hidden = document.createElement('p');
        const pending = document.createElement('p');
        pending.className = 'pending';
        const countdown = document.createElement('p');
        const toggle = createButton('Show hidden items', 'toggle-hidden', toggleHiddenItems);
        const backup = createButton('Back up data', 'backup', downloadBackup);
        const restore = createButton('Restore data', 'restore', chooseBackupFile);
        const move = createButton('Move panel right', 'move-panel', movePanel);
        panel.append(total, hidden, pending, countdown, toggle, backup, restore, move);
        root.append(style, panel);
        document.body.append(host);
        panelElements = { host, total, hidden, pending, countdown, toggle, move };
        applyPanelSide();
        updateReloadCountdown();
    }

    function updatePanel() {
        if (!panelElements) return;
        panelElements.total.textContent = `Stored items: ${Object.keys(itemRegistry).length}`;
        panelElements.hidden.textContent = `Hidden on this page: ${hiddenElements.size}`;
        panelElements.pending.hidden = pendingWrites.size === 0;
        panelElements.pending.textContent = `Not yet saved: ${pendingWrites.size}`;
        panelElements.toggle.textContent = showHidden ? 'Hide seen items' : 'Show hidden items';
        panelElements.toggle.setAttribute('aria-pressed', String(showHidden));
        updateReloadCountdown();
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
        const target = wrapper || card;
        paintSeenItem(card);
        hiddenElements.add(target);
        target.style.display = showHidden ? '' : 'none';
    }

    function processZenMarketItemPage() {
        if (!isZenMarketItemPage()) return false;

        const pageText = `${document.title} ${document.body?.innerText || ''}`.toLowerCase();
        if (/just a moment|performing security verification|verify you are human/.test(pageText)) return true;

        const itemId = getItemId(location.href);
        if (!itemId) return true;

        if (itemRegistry[itemId] !== 'hide') {
            markSeen(itemId);
            console.info(`[Cross-Market Seen Item Highlighter] Marked ZenMarket item ${itemId} as seen.`);
        }
        flushPendingWrites();

        return true;
    }

    function getBuyeeRecommendationItemId(card) {
        const links = card.querySelectorAll('a[href]');
        for (const link of links) {
            const rawHref = typeof link.getAttribute === 'function' ? link.getAttribute('href') : link.href;
            if (!rawHref) continue;
            try {
                const absoluteHref = new URL(rawHref, location.href).href;
                const itemId = getItemId(absoluteHref);
                if (itemId) return itemId;
            } catch (error) {
                continue;
            }
        }
        return null;
    }

    function processBuyeeItemRecommendations() {
        if (!isBuyeeItemPage()) return false;

        const userReachedBottom = isAtPageBottom();
        const currentItemId = getItemId(location.href);
        const cards = document.querySelectorAll('.recommendItem__list .recommendItem__items');
        cards.forEach(card => {
            const itemId = getBuyeeRecommendationItemId(card);
            if (!itemId) return;
            // REVIEW(pruning): the sets and the registry diverge only if IDs are pruned or replaced mid-visit.
            if (seenAtPageLoad.has(itemId) || seenThisVisit.has(itemId) || itemRegistry[itemId] === 'hide') {
                paintSeenItem(card);
                return;
            }

            if (itemId === currentItemId) return;

            const position = card.getBoundingClientRect();
            const hasCompletelyLeftScreen = position.bottom < 0;
            const visibleAtBottomSweep = userReachedBottom && position.top < window.innerHeight;

            if (hasCompletelyLeftScreen || visibleAtBottomSweep) {
                markSeen(itemId);
                seenThisVisit.add(itemId);
                paintSeenItem(card);
            }
        });

        flushPendingWrites();

        return true;
    }

    function processStateEngine() {
        if (isNeokyoSearch() && !neokyoProcessEntryReported) {
            console.info(`[Cross-Market Seen Item Highlighter] Neokyo scan callback entered on ${location.pathname}.`);
            neokyoProcessEntryReported = true;
        }

        const sharedRegistry = GM_getValue(REGISTRY_KEY, itemRegistry);
        if (sharedRegistry && typeof sharedRegistry === 'object' && !Array.isArray(sharedRegistry)) {
            // REVIEW(pruning): pruned IDs vanish from the live registry here but stay in seenAtPageLoad.
            itemRegistry = sharedRegistry;
            pendingWrites.forEach(id => { itemRegistry[id] = 'hide'; });
        }

        if (processZenMarketItemPage()) return;
        if (processBuyeeItemRecommendations()) return;
        if (!isSearchPage()) return;

        ensurePanel();
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

        let unseenCount = 0;
        cards.forEach(card => {
            const linkSelector = isNeokyoSearch() ? 'a[href*="/en/product/"]' : 'a[href*="/item/"]';
            const link = card.tagName === 'A' ? card : card.querySelector(linkSelector);
            if (!link) return;

            const href = link.href || "";
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
            const hasCompletelyLeftScreen = (position.bottom < 0);
            const visibleAtBottomSweep = (userReachedBottom && position.top < window.innerHeight);

            if (hasCompletelyLeftScreen || visibleAtBottomSweep) {
                markSeen(itemId);
                seenThisVisit.add(itemId);
                paintSeenItem(card);
                window.dispatchEvent(new CustomEvent('buyeeItemSeen', { detail: { id: itemId } }));
                console.log(itemId + " added as hidden");
            } else {
                unseenCount++;
            }
        });

        newItemAlarm.update(unseenCount);
        flushPendingWrites();
        updatePanel();
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
    window.addEventListener('scroll', () => { lastScrollAt = Date.now(); });
    window.addEventListener('scroll', runStateEngineSafely);
    setInterval(runStateEngineSafely, 1500);
    if (isSearchPage()) scheduleAutoReload(randomBetween(RELOAD_MIN_MS, RELOAD_MAX_MS));
})();
