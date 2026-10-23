// ==UserScript==
// @name         Cross-Platform Item Links
// @namespace    http://tampermonkey.net
// @version      1.6
// @description  Open the same auction, Mercari or Flea Market item on another proxy platform.
// @icon         https://buyee.jp/favicon.ico
// @updateURL    https://raw.githubusercontent.com/vladmkv/userscripts/main/Cross-Platform-Item-Links.user.js
// @downloadURL  https://raw.githubusercontent.com/vladmkv/userscripts/main/Cross-Platform-Item-Links.user.js
// @match        https://*.buyee.jp/item/jdirectitems/auction/*
// @match        https://*.buyee.jp/mercari/item/*
// @match        https://*.buyee.jp/paypayfleamarket/item/*
// @match        https://zenmarket.jp/auction.aspx*
// @match        https://zenmarket.jp/product.aspx*
// @match        https://neokyo.com/en/product/yahoo/*
// @match        https://neokyo.com/en/product/mercari/*
// @match        https://neokyo.com/en/product/yahooFleaMarket/*
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==

(function() {
    'use strict';

    const PANEL_ID = 'cross-platform-item-links';
    const PANEL_SIDE_KEY = 'item_links_panel_side';
    const MARKETS = { yahoo: 'JDirectItems Auction', mercari: 'Mercari', flea: 'JDirectItems Flea Market' };
    const FAVICONS = {
        Buyee: 'https://buyee.jp/favicon.ico',
        ZenMarket: 'https://zenmarket.jp/favicon.ico',
        Neokyo: 'https://neokyo.com/favicon.ico'
    };

    function appendSiteLabel(control, site) {
        const iconSource = FAVICONS[site];
        const icon = document.createElement(iconSource ? 'img' : 'span');
        icon.className = 'favicon';
        if (iconSource) {
            icon.src = iconSource;
            icon.alt = '';
            icon.width = 18;
            icon.height = 18;
        } else {
            icon.textContent = site[0];
            icon.title = `${site} favicon unavailable`;
        }
        icon.setAttribute('aria-hidden', 'true');
        const label = document.createElement('span');
        label.textContent = site;
        control.append(icon, label);
    }

    function identifyItem(href) {
        let url;
        try {
            url = new URL(href);
        } catch {
            return null;
        }
        if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
        let site;
        let marketplace;
        let id;
        if (url.hostname === 'buyee.jp' || url.hostname.endsWith('.buyee.jp')) {
            const match = url.pathname.match(/^\/(item\/jdirectitems\/auction|mercari\/item|paypayfleamarket\/item)\/([a-zA-Z0-9_-]+)\/?$/);
            if (!match) return null;
            site = 'Buyee';
            marketplace = { 'item/jdirectitems/auction': 'yahoo', 'mercari/item': 'mercari', 'paypayfleamarket/item': 'flea' }[match[1]];
            id = match[2];
        } else if (url.hostname === 'zenmarket.jp') {
            site = 'ZenMarket';
            const pathname = url.pathname.toLowerCase();
            if (pathname === '/auction.aspx') {
                marketplace = 'yahoo';
            } else if (pathname === '/product.aspx') {
                const shop = (url.searchParams.get('shop') || '').toLowerCase();
                if (shop === 'mercari') marketplace = 'mercari';
                else if (shop === 'yahoofleamarket') marketplace = 'flea';
                else return null;
            } else return null;
            id = url.searchParams.get('itemCode');
        } else if (url.hostname === 'neokyo.com') {
            const match = url.pathname.match(/^\/en\/product\/(yahoo|mercari|yahooFleaMarket)\/([a-zA-Z0-9_-]+)\/?$/i);
            if (!match) return null;
            site = 'Neokyo';
            marketplace = { yahoo: 'yahoo', mercari: 'mercari', yahoofleamarket: 'flea' }[match[1].toLowerCase()];
            id = match[2];
        } else return null;
        if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) return null;
        return { site, marketplace, id };
    }

    function destinationLinks(item) {
        const id = encodeURIComponent(item.id);
        const buyeePath = { yahoo: 'item/jdirectitems/auction', mercari: 'mercari/item', flea: 'paypayfleamarket/item' }[item.marketplace];
        const neokyoPath = { yahoo: 'yahoo', mercari: 'mercari', flea: 'yahooFleaMarket' }[item.marketplace];
        const zenmarket = item.marketplace === 'yahoo' ? `https://zenmarket.jp/auction.aspx?itemCode=${id}`
            : item.marketplace === 'mercari' ? `https://zenmarket.jp/product.aspx?shop=mercari&itemCode=${id}`
                : `https://zenmarket.jp/product.aspx?shop=yahooFleaMarket&itemCode=${id}`;
        return [
            { site: 'Buyee', href: `https://buyee.jp/${buyeePath}/${id}` },
            { site: 'ZenMarket', href: zenmarket },
            { site: 'Neokyo', href: `https://neokyo.com/en/product/${neokyoPath}/${id}` }
        ];
    }

    function applyPanelSide(host, move) {
        const side = GM_getValue(PANEL_SIDE_KEY, 'left') === 'right' ? 'right' : 'left';
        host.style.left = side === 'left' ? '12px' : '';
        host.style.right = side === 'right' ? '12px' : '';
        move.textContent = side === 'left' ? 'Move panel right' : 'Move panel left';
    }

    function renderPanel(href = location.href) {
        const item = identifyItem(href);
        if (!item || document.getElementById(PANEL_ID)) return;
        const host = document.createElement('div');
        host.id = PANEL_ID;
        host.style.cssText = 'position:fixed;bottom:12px;z-index:2147483646;max-width:calc(100vw - 24px);';
        const root = host.attachShadow({ mode: 'open' });
        const style = document.createElement('style');
        style.textContent = `
            :host { color-scheme: light; }
            nav { box-sizing: border-box; max-width: 320px; padding: 10px; border: 1px solid #777; border-radius: 4px; background: #fff; color: #202020; box-shadow: 0 2px 8px #0003; font: 13px/1.4 Verdana, sans-serif; letter-spacing: 0; }
            p { margin: 0 0 8px; overflow-wrap: anywhere; }
            .links { display: flex; flex-direction: column; gap: 6px; }
            a, button { display: flex; align-items: center; gap: 8px; box-sizing: border-box; width: 100%; min-height: 34px; padding: 6px 9px; border: 1px solid #777; border-radius: 3px; background: #f5f5f5; color: #202020; font: inherit; text-align: left; text-decoration: none; }
            .favicon { display: inline-flex; align-items: center; justify-content: center; flex: 0 0 18px; width: 18px; height: 18px; object-fit: contain; font-weight: bold; }
            a:hover { background: #e5f3e8; }
            a:focus-visible, button:focus-visible { outline: 2px solid #14652c; outline-offset: 2px; }
            a[aria-current] { border-color: #14652c; }
            button:disabled { color: #666; background: #eee; cursor: not-allowed; }
            .move { justify-content: center; margin-top: 6px; cursor: pointer; }
            .move:hover { background: #e5f3e8; }
        `;
        const nav = document.createElement('nav');
        nav.setAttribute('aria-label', 'Open item on another platform');
        const label = document.createElement('p');
        label.textContent = `${MARKETS[item.marketplace]}: ${item.id}`;
        const links = document.createElement('div');
        links.className = 'links';
        for (const destination of destinationLinks(item)) {
            if (!destination.href) {
                const disabled = document.createElement('button');
                disabled.type = 'button';
                appendSiteLabel(disabled, destination.site);
                disabled.disabled = true;
                disabled.title = 'ZenMarket Flea Market URL is not yet confirmed';
                links.append(disabled);
                continue;
            }
            const anchor = document.createElement('a');
            appendSiteLabel(anchor, destination.site);
            anchor.href = destination.href;
            anchor.target = '_blank';
            anchor.rel = 'noopener noreferrer';
            anchor.title = `Open this item on ${destination.site} in a new tab`;
            if (destination.site === item.site) anchor.setAttribute('aria-current', 'page');
            links.append(anchor);
        }
        const move = document.createElement('button');
        move.type = 'button';
        move.className = 'move';
        move.setAttribute('data-action', 'move-panel');
        move.addEventListener('click', () => {
            GM_setValue(PANEL_SIDE_KEY, GM_getValue(PANEL_SIDE_KEY, 'left') === 'right' ? 'left' : 'right');
            applyPanelSide(host, move);
        });
        applyPanelSide(host, move);
        nav.append(label, links, move);
        root.append(style, nav);
        document.body.append(host);
    }

    renderPanel();
})();