// ==UserScript==
// @name         Image Gamma Controller (Seller Filter Production)
// @namespace    http://tampermonkey.net
// @version      1.0
// @description  Locked gamma controller for Buyee that targets main/maximized views, keeps thumbs synced silently, and ignores seller rating icons.
// @updateURL    https://raw.githubusercontent.com/vladmkv/userscripts/main/Image Gamma Controller (Seller Filter Production).user.js
// @downloadURL  https://raw.githubusercontent.com/vladmkv/userscripts/main/Image Gamma Controller (Seller Filter Production).user.js
// @author       Your Name
// @match        *://buyee.jp/item/*
// @match        *://*.buyee.jp/item/*
// @match        *://buyee.jp/mercari/item/*
// @match        *://buyee.jp/paypayfleamarket/item/*
// @grant        GM_addStyle
// @run-at       document-end
// ==/UserScript==


(function() {
    'use strict';

    let globalActiveGammaValue = 0;

    // 1. Inject passive layout-native styles
    GM_addStyle(`
        .g-wrap { position: relative; display: inline-block; }

        /* Unified horizontal control container pinned to top-right */
        .g-container {
            position: absolute;
            top: 10px;
            right: 10px;
            height: 32px;
            background: #1a1a1a;
            border: 1px solid #444;
            border-radius: 16px;
            display: flex;
            align-items: center;
            flex-direction: row-reverse; /* Keeps icon rightmost, builds contents leftward */
            overflow: hidden;
            z-index: 2147483647; /* Sits completely on top of expanded lightbox states */
            transition: width 0.2s ease-in-out, padding 0.2s ease-in-out;
            width: 32px; /* Collapsed state matching button diameter exactly */
            box-sizing: border-box;
            box-shadow: 0 4px 12px rgba(0,0,0,0.4);
        }

        /* Expanded state footprint adjustment */
        .g-container.g-expanded {
            width: 190px;
            padding: 0 10px;
        }

        /* Master Trigger Toggle Button */
        .g-btn {
            width: 30px;
            height: 30px;
            color: #fff;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 16px;
            user-select: none;
            -webkit-user-select: none;
            flex-shrink: 0;
        }
        .g-btn:hover { color: #00bcd4; }

        /* Slid-in controller content container */
        .g-controls-inner {
            display: flex;
            align-items: center;
            gap: 8px;
            width: 140px;
            opacity: 0;
            visibility: hidden;
            transition: opacity 0.15s ease-in-out;
            flex-shrink: 0;
        }
        .g-expanded .g-controls-inner {
            opacity: 1;
            visibility: visible;
        }

        .g-slide { width: 105px; cursor: pointer; accent-color: #00bcd4; }
        .g-val { color: #fff; font-family: monospace; font-size: 11px; min-width: 25px; text-align: right; user-select: none; }

        /* --- THE ACCESSIBILITY HIDE TRICK --- */
        ol.flex-control-thumbs .g-container,
        .flex-control-nav .g-container {
            display: none !important;
        }
    `);

    // Helper rendering filter function to apply attenuated mathematical multiplier
    function renderGammaFilter(img, v) {
        if (v === 100) {
            img.style.filter = 'brightness(0) invert(1)';
        } else {
            const factor = 1 + Math.pow(v / 24, 1.3);
            img.style.filter = `brightness(${factor})`;
        }
    }

    // 2. Safe element implementation setup mapping
    function setup(img) {
        if (img.dataset.gProc || img.naturalWidth < 200 || img.naturalHeight < 200) return;

        // Skip if inside the seller profile rating container elements
        if (img.closest('.itemSeller') || img.closest('.itemSeller__item')) return;

        img.dataset.gProc = "true";
        img.setAttribute('draggable', 'false');

        const anc = img.closest('a') || img;
        const wrap = document.createElement('div');
        wrap.className = 'g-wrap';
        wrap.style.display = window.getComputedStyle(anc).display === 'block' ? 'block' : 'inline-block';

        anc.parentNode.insertBefore(wrap, anc);
        wrap.appendChild(anc);

        // SEAMLESS SYNCHRONIZATION: Pre-load current working value automatically across ALL elements
        let initialTrackValue = globalActiveGammaValue;
        if (initialTrackValue !== 0) {
            renderGammaFilter(img, initialTrackValue);
        }

        // Core integrated layout structure setup
        const container = document.createElement('div');
        container.className = 'g-container';
        container.innerHTML = `
            <div class="g-btn" title="Adjust Gamma">◑</div>
            <div class="g-controls-inner">
                <input type="range" class="g-slide" min="0" max="100" value="${initialTrackValue}" draggable="false">
                <span class="g-val">${initialTrackValue}</span>
            </div>
        `;
        wrap.appendChild(container);

        const btn = container.querySelector('.g-btn');
        const slider = container.querySelector('.g-slide');
        const label = container.querySelector('.g-val');

        // --- PREVENT CLICK-THROUGH VIA ISOLATED POINTER LOGIC ---
        const killChain = (e) => {
            e.preventDefault();
            e.stopPropagation();
        };

        // We handle UI expansion logic strictly on the initial mousedown/touchstart vector
        const toggleMenuAction = (e) => {
            killChain(e);
            container.classList.toggle('g-expanded');
        };

        btn.addEventListener('mousedown', toggleMenuAction);
        btn.addEventListener('touchstart', toggleMenuAction, { passive: false });

        // Neutralize trailing mouseup and click actions locally so they don't bubble out to Buyee
        btn.addEventListener('mouseup', killChain);
        btn.addEventListener('touchend', killChain, { passive: false });
        btn.addEventListener('click', killChain);

        // Isolate container actions locally
        container.addEventListener('click', (e) => e.stopPropagation());
        container.addEventListener('mousedown', (e) => e.stopPropagation());
        container.addEventListener('mouseup', (e) => e.stopPropagation());

        // Capture local input interaction loops before they reach Buyee's document listeners
        const clampEvent = (e) => { e.stopPropagation(); };
        slider.addEventListener('mousedown', clampEvent, { capture: true });
        slider.addEventListener('mousemove', clampEvent, { capture: true });
        slider.addEventListener('mouseup', clampEvent, { capture: true });
        slider.addEventListener('touchstart', clampEvent, { capture: true, passive: true });
        slider.addEventListener('touchmove', clampEvent, { capture: true, passive: true });
        slider.addEventListener('touchend', clampEvent, { capture: true, passive: true });

        // Process adjustments via browser-native form input updates
        slider.addEventListener('input', (e) => {
            const v = parseInt(e.target.value, 10);

            globalActiveGammaValue = v;
            label.textContent = v;
            renderGammaFilter(img, v);

            // Cross-update all other existing controller blocks across the layout workspace
            document.querySelectorAll('.g-slide').forEach(item => {
                if (item !== slider && parseInt(item.value, 10) !== v) {
                    item.value = v;
                    const counterpartLabel = item.parentNode.querySelector('.g-val');
                    if (counterpartLabel) counterpartLabel.textContent = v;
                }
            });

            // Cross-update all visible active image element nodes
            document.querySelectorAll('img[data-g-proc="true"]').forEach(processedImg => {
                if (processedImg !== img) {
                    renderGammaFilter(processedImg, v);
                }
            });
        });

        // Close and collapse menu inline when user clicks away
        document.addEventListener('click', (e) => {
            if (container.classList.contains('g-expanded') && !wrap.contains(e.target)) {
                container.classList.remove('g-expanded');
            }
        });
    }

    // 3. Scan layouts dynamically via MutationObserver loops
    function scan() {
        document.querySelectorAll('img').forEach(i => {
            if (i.complete) setup(i);
            else i.addEventListener('load', () => setup(i), { once: true });
        });
    }

    scan();
    new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
})();

