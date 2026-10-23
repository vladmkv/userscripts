// ==UserScript==
// @name         Cross-Platform Item Links
// @namespace    http://tampermonkey.net
// @version      1.3
// @description  Open the same auction, Mercari or Flea Market item on another proxy platform.
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
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    const PANEL_ID = 'cross-platform-item-links';
    const MARKETS = { yahoo: 'JDirectItems Auction', mercari: 'Mercari', flea: 'JDirectItems Flea Market' };
    const FAVICONS = {
        ZenMarket: 'data:image/png;base64,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',
        Neokyo: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAGiSURBVDhPjZNLq89RFIaP+0mSgYlOJCU9TMgHMNCZkGtJGcgAoaQUxcgXMDGRoTq5vQMhIikpl+Q2cCmX0iMUUsJACu1avxP//qesWoO99lrvXu+71h4YGMOIg8SZ5VN678c04jziPuJF4kPiA+I54h7i7N787qVxxPHEDcRnxF/E3z3eYo+IKyu/+WADWEHcStxP/NSnsNffEfcSdxGHuw6WEDcSDxFHiNeId4vCfeLNonSs6K0hLhrVhriFuJq4lDinQKcRZxCnE6cSJxHnVk6jsbYrbpeXiR+JL4g7Kr6ceIR4uBVV7ADxJfE98XQDbcFZxKfES8RtRErMltTxbkXDxMXE7cTjxFutww7gMfEn8TNxPfEU8RvxBPFOgRwtql+IP4i3O4BG4UolfSduJp4kvikR39ZdE3ddPdTOZ4gTOx0OVvB1cb/RZ3xnicuIX+u88+9lmk98XuNrm3ivD8DVGveH2s6hUYAC2US8UGBP+gA00RYQrxNX/VNcAG3OC6uDV30Amh5DtUATeutHrUTd3fOZzteIJ/fmj2n/+53/AC8axVQF26UPAAAAAElFTkSuQmCC'
    };

    function appendSiteLabel(control, site) {
        const iconSource = site === 'Buyee' ? 'https://buyee.jp/favicon.ico' : FAVICONS[site];
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

    function renderPanel(href = location.href) {
        const item = identifyItem(href);
        if (!item || document.getElementById(PANEL_ID)) return;
        const host = document.createElement('div');
        host.id = PANEL_ID;
        host.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:2147483646;max-width:calc(100vw - 24px);';
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
        nav.append(label, links);
        root.append(style, nav);
        document.body.append(host);
    }

    renderPanel();
})();