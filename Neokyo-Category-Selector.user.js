// ==UserScript==
// @name         Neokyo Yahoo Category Selector
// @namespace    http://tampermonkey.net
// @version      1.1
// @updateURL    https://raw.githubusercontent.com/vladmkv/userscripts/main/Neokyo-Category-Selector.user.js
// @downloadURL  https://raw.githubusercontent.com/vladmkv/userscripts/main/Neokyo-Category-Selector.user.js
// @description  Hierarchical Yahoo categories and an optional category lock for Neokyo searches.
// @match        https://neokyo.com/en/search/yahoo*
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==

(function() {
    'use strict';

    const SETTINGS_KEY = 'neokyo_yahoo_category_selector';
    const DEFAULT_PATH = ['0', '23632', '23764', '23848', '44762'];
    const categoryCache = new Map();
    let settings;
    let selectedPath;
    let renderVersion = 0;

    function categoryName(level) {
        return `category[level_${level}]`;
    }

    function readPath(url) {
        const result = [];
        for (let level = 1; level <= 7; level++) {
            const value = url.searchParams.get(categoryName(level));
            if (!value) break;
            result.push(value);
        }
        return result;
    }

    function categoryUrl(href, path, resetPage = false) {
        const url = new URL(href, location.href);
        for (let level = 1; level <= 7; level++) {
            url.searchParams.delete(categoryName(level));
            if (path[level - 1]) url.searchParams.set(categoryName(level), path[level - 1]);
        }
        if (resetPage) url.searchParams.set('page', '1');
        return url;
    }

    function categoriesMatch(url, path) {
        for (let level = 1; level <= 7; level++) {
            const values = url.searchParams.getAll(categoryName(level)).filter(Boolean);
            const expected = path[level - 1];
            if (expected ? values.length !== 1 || values[0] !== expected : values.length !== 0) return false;
        }
        return true;
    }

    function isYahooSearch(url) {
        return url.origin === location.origin && /^\/(?:en\/)?search\/yahoo\/?$/.test(url.pathname);
    }

    function saveSettings() {
        settings.path = [...selectedPath];
        GM_setValue(SETTINGS_KEY, settings);
    }

    function fixForm(form) {
        if (!settings.locked || !isYahooSearch(new URL(form.action, location.href))) return;
        for (let level = 1; level <= 7; level++) {
            const name = categoryName(level);
            const fields = Array.from(form.elements).filter(field => field.name === name);
            for (const field of fields) field.disabled = true;
            if (settings.path[level - 1]) {
                const hidden = document.createElement('input');
                hidden.type = 'hidden';
                hidden.name = name;
                hidden.value = settings.path[level - 1];
                form.append(hidden);
            }
        }
    }

    async function getChildren(level, parentId) {
        const key = `${level}:${parentId}`;
        if (!categoryCache.has(key)) {
            const response = await fetch(`/api/v1/categories/yahoo/children?level=${level}&category_id=${parentId}`);
            if (!response.ok) throw new Error(`Category request failed: HTTP ${response.status}`);
            const data = await response.json();
            const rows = data[`level_${level}`];
            if (!Array.isArray(rows)) throw new Error('Unexpected category response');
            categoryCache.set(key, rows);
        }
        return categoryCache.get(key);
    }

    function labelText(text) {
        const decoder = document.createElement('textarea');
        decoder.innerHTML = text;
        return decoder.value;
    }

    function navigate(path, resetPage) {
        const url = categoryUrl(location.href, path, resetPage);
        if (url.href !== location.href) location.assign(url.href);
    }

    async function renderCategories(container, status, apply) {
        const version = ++renderVersion;
        container.replaceChildren();
        apply.disabled = true;
        status.textContent = 'Loading categories...';
        let parentId = 1;
        try {
            for (let level = 2; level <= 7; level++) {
                const rows = await getChildren(level, parentId);
                if (version !== renderVersion) return;
                if (!rows.length) break;
                const label = document.createElement('label');
                label.textContent = `Level ${level - 1} `;
                const select = document.createElement('select');
                select.setAttribute('aria-label', `Yahoo category level ${level - 1}`);
                select.style.cssText = 'display:block;width:100%;max-width:100%;margin:4px 0 10px;';
                select.add(new Option(level === 2 ? 'All categories' : 'All in parent category', ''));
                for (const row of rows) {
                    select.add(new Option(labelText(row.translation || row.provider_category_name), String(row.provider_category_ref)));
                }
                select.value = selectedPath[level - 1] || '';
                label.append(select);
                container.append(label);
                select.addEventListener('change', () => {
                    selectedPath = level === 2 ? ['0'] : selectedPath.slice(0, level - 1);
                    if (select.value) selectedPath.push(select.value);
                    else if (level === 2) selectedPath = [];
                    renderCategories(container, status, apply);
                });
                const chosen = rows.find(row => String(row.provider_category_ref) === select.value);
                if (!chosen) {
                    selectedPath = level === 2 ? [] : selectedPath.slice(0, level - 1);
                    break;
                }
                if (!chosen.has_children) break;
                parentId = chosen.id;
            }
            if (version !== renderVersion) return;
            status.textContent = '';
            apply.disabled = false;
        } catch (error) {
            if (version === renderVersion) status.textContent = error.message;
        }
    }

    function start() {
        if (!/^\/en\/search\/yahoo\/?$/.test(location.pathname)) return;
        const currentUrl = new URL(location.href);
        const stored = GM_getValue(SETTINGS_KEY, {});
        const storedPath = Array.isArray(stored.path) && stored.path.length <= 7
            && stored.path.every(value => typeof value === 'string' && /^\d+$/.test(value)) ? stored.path : null;
        settings = { locked: stored.locked === true && storedPath !== null, path: storedPath || DEFAULT_PATH };
        if (settings.locked && !categoriesMatch(currentUrl, settings.path)) {
            location.replace(categoryUrl(location.href, settings.path).href);
            return;
        }
        const currentPath = readPath(currentUrl);
        selectedPath = [...(settings.locked ? settings.path : currentPath.length ? currentPath : settings.path)];

        document.addEventListener('submit', event => {
            if (event.target instanceof HTMLFormElement) fixForm(event.target);
        }, true);
        document.addEventListener('formdata', event => {
            if (!settings.locked || !isYahooSearch(new URL(event.target.action, location.href))) return;
            for (let level = 1; level <= 7; level++) {
                const name = categoryName(level);
                event.formData.delete(name);
                if (settings.path[level - 1]) event.formData.set(name, settings.path[level - 1]);
            }
        }, true);
        document.addEventListener('click', event => {
            if (!settings.locked || event.defaultPrevented) return;
            const anchor = event.target.closest?.('a[href]');
            if (!anchor) return;
            const url = new URL(anchor.href, location.href);
            if (isYahooSearch(url)) anchor.href = categoryUrl(url.href, settings.path).href;
        }, true);

        const panel = document.createElement('section');
        panel.id = 'neokyo-category-selector';
        panel.style.cssText = 'padding:12px;margin:12px 0;border:1px solid #999;background:#fff;color:#222;max-width:100%;font-size:14px;';
        const title = document.createElement('h3');
        title.textContent = 'Yahoo category';
        title.style.cssText = 'font-size:18px;margin:0 0 10px;';
        const selects = document.createElement('div');
        const status = document.createElement('div');
        status.setAttribute('role', 'status');
        const lockLabel = document.createElement('label');
        const lock = document.createElement('input');
        lock.type = 'checkbox';
        lock.checked = settings.locked;
        lockLabel.append(lock, ' Lock category');
        const apply = document.createElement('button');
        apply.type = 'button';
        apply.textContent = 'Apply category';
        apply.style.cssText = 'display:block;margin-top:10px;';
        apply.addEventListener('click', () => {
            if (!selectedPath.length) {
                settings.locked = false;
                lock.checked = false;
            }
            saveSettings();
            navigate(selectedPath, true);
        });
        lock.addEventListener('change', () => {
            if (lock.checked && (apply.disabled || !selectedPath.length)) {
                lock.checked = false;
                return;
            }
            settings.locked = lock.checked;
            saveSettings();
            if (settings.locked) navigate(settings.path, true);
        });
        panel.append(title, selects, lockLabel, apply, status);
        const filterForm = document.querySelector('#yahoo-filter-form');
        if (filterForm) filterForm.before(panel);
        else document.body.prepend(panel);
        renderCategories(selects, status, apply);
    }

    start();
})();