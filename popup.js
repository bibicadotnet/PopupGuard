"use strict";

var staticAllowlist = [];
var staticLoaded = false;
var currentFilter = 'all';
var searchQuery = '';
var toastTimer = 0;

function showToast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2000);
}

function loadStaticAllowlist() {
    if (staticLoaded) return Promise.resolve(staticAllowlist);
    return fetch(chrome.runtime.getURL("allowlist.json"))
        .then(r => r.json())
        .then(list => { staticAllowlist = list; staticLoaded = true; return list; })
        .catch(() => { staticLoaded = true; return []; });
}

function getHostname(t) {
    try {
        if (!t) return null;
        t = t.trim();
        if (t.startsWith('*.')) {
            const base = new URL('http://' + t.slice(2)).hostname;
            return '*.' + base;
        }
        return new URL(t.includes("http") ? t : "http://" + t).hostname;
    } catch (e) { return null; }
}

function isDomainInList(domain, list) {
    return list.some(x => {
        if (x.startsWith('*.')) {
            const base = x.slice(2);
            return domain === x || domain === base || domain.endsWith('.' + base);
        }
        return domain === x;
    });
}

const TAG_CONFIG = {
    popupBlock: { cls: 'tag-block', label: 'Blocked' },
    popupAllow: { cls: 'tag-allow', label: 'Allowed' },
    navBlock: { cls: 'tag-nav', label: 'Network' },
    builtin: { cls: 'tag-builtin', label: 'Default' }
};

const FILTER_TO_TYPE = {
    all: 'popupBlock',
    popupBlock: 'popupBlock',
    popupAllow: 'popupAllow',
    navBlock: 'navBlock'
};

function syncAddSection() {
    const addSection = document.getElementById('add-section');
    const typeSelect = document.getElementById('new-type');

    if (currentFilter === 'builtin') {
        addSection.classList.add('hidden');
    } else {
        addSection.classList.remove('hidden');
        if (currentFilter === 'all') {
            typeSelect.style.display = '';
            typeSelect.value = 'popupBlock';
        } else {
            typeSelect.style.display = 'none';
            typeSelect.value = FILTER_TO_TYPE[currentFilter];
        }
    }
}

function renderAll() {
    loadStaticAllowlist().then(builtinList => {
        chrome.storage.sync.get(['popupBlock', 'popupAllow', 'navBlock'], data => {
            const pbl = data.popupBlock || [];
            const pal = data.popupAllow || [];
            const nbl = data.navBlock || [];


            const items = [];
            pbl.forEach(d => items.push({ domain: d, type: 'popupBlock' }));
            pal.forEach(d => items.push({ domain: d, type: 'popupAllow' }));
            nbl.forEach(d => items.push({ domain: d, type: 'navBlock' }));
            builtinList.forEach(d => items.push({ domain: d, type: 'builtin' }));


            document.getElementById('count-all').textContent = pbl.length + pal.length + nbl.length + builtinList.length;
            document.getElementById('count-block').textContent = pbl.length;
            document.getElementById('count-allow').textContent = pal.length;
            document.getElementById('count-nav').textContent = nbl.length;
            document.getElementById('count-builtin').textContent = builtinList.length;


            let filtered = items;
            if (currentFilter !== 'all') {
                filtered = items.filter(i => i.type === currentFilter);
            }
            if (searchQuery) {
                const q = searchQuery.toLowerCase();
                filtered = filtered.filter(i => i.domain.toLowerCase().includes(q));
            }


            const container = document.getElementById('domain-list');
            const emptyMsg = document.getElementById('empty-msg');
            container.innerHTML = '';

            if (filtered.length === 0) {
                emptyMsg.style.display = 'block';
                return;
            }
            emptyMsg.style.display = 'none';

            filtered.forEach(item => {
                const row = document.createElement('div');
                row.className = 'domain-row';

                const name = document.createElement('span');
                name.className = 'domain-name';
                name.textContent = item.domain;

                const cfg = TAG_CONFIG[item.type];
                const tag = document.createElement('span');
                tag.className = 'domain-tag ' + cfg.cls;
                tag.textContent = cfg.label;

                row.appendChild(name);
                row.appendChild(tag);

                if (item.type !== 'builtin') {
                    const btn = document.createElement('button');
                    btn.className = 'domain-x';
                    btn.textContent = '\u00d7';
                    btn.title = 'Remove';
                    btn.addEventListener('click', () => removeDomain(item.domain, item.type));
                    row.appendChild(btn);
                }

                container.appendChild(row);
            });


            updateStatusCard(pbl, pal, nbl);
        });
    });
}

function removeDomain(domain, storageKey) {
    chrome.storage.sync.get([storageKey], data => {
        const list = (data[storageKey] || []).filter(x => x !== domain);
        chrome.storage.sync.set({ [storageKey]: list }, renderAll);
    });
}

function addDomain(input, targetKey) {
    const host = getHostname(input);
    if (!host) return;
    loadStaticAllowlist().then(staticList => {
        if (isDomainInList(host, staticList)) {
            showToast(host + ' is in default allowlist');
            return;
        }
        const otherKeys = {
            popupBlock: ['popupAllow', 'navBlock'],
            popupAllow: ['popupBlock', 'navBlock'],
            navBlock: ['popupBlock', 'popupAllow']
        }[targetKey];
        const allKeys = [targetKey, ...otherKeys];
        chrome.storage.sync.get(allKeys, data => {
            const target = data[targetKey] || [];
            if (target.includes(host)) { showToast(host + ' already in list'); return; }
            target.push(host);
            const update = { [targetKey]: target };
            otherKeys.forEach(k => {
                update[k] = (data[k] || []).filter(x => x !== host);
            });
            chrome.storage.sync.set(update, () => {
                document.getElementById('new-domain').value = '';
                renderAll();
            });
        });
    });
}



var currentHost = null;

function makeActionBtn(label, onClick) {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.addEventListener('click', onClick);
    return btn;
}

const filterRule = (list, host) => (list || []).filter(x => {
    if (x === host) return false;
    if (x.startsWith('*.')) {
        const base = x.slice(2);
        if (host === base || host.endsWith('.' + base)) return false;
    }
    return true;
});

function clearHostRules() {
    chrome.storage.sync.get(['popupBlock', 'popupAllow', 'navBlock'], data => {
        chrome.storage.sync.set({
            popupBlock: filterRule(data.popupBlock, currentHost),
            popupAllow: filterRule(data.popupAllow, currentHost),
            navBlock: filterRule(data.navBlock, currentHost)
        }, renderAll);
    });
}

function updateStatusCard(pbl, pal, nbl) {
    if (!currentHost) return;
    const badge = document.getElementById('status-badge');
    const actions = document.getElementById('status-actions');

    const isBuiltin = isDomainInList(currentHost, staticAllowlist);
    const isBlocked = isDomainInList(currentHost, pbl);
    const isAllowed = isDomainInList(currentHost, pal);
    const isNavBlock = isDomainInList(currentHost, nbl);

    actions.innerHTML = '';

    if (isBuiltin) {
        badge.className = 'status-badge s-builtin';
        badge.innerHTML = '<span class="dot"></span>Default allowed';
    } else if (isNavBlock) {
        badge.className = 'status-badge s-blocked';
        badge.innerHTML = '<span class="dot"></span>Network blocked';
        actions.appendChild(makeActionBtn('Clear', clearHostRules));
    } else if (isBlocked) {
        badge.className = 'status-badge s-blocked';
        badge.innerHTML = '<span class="dot"></span>Popups blocked';
        actions.appendChild(makeActionBtn('Allow', () => addDomain(currentHost, 'popupAllow')));
        actions.appendChild(makeActionBtn('Clear', clearHostRules));
    } else if (isAllowed) {
        badge.className = 'status-badge s-allowed';
        badge.innerHTML = '<span class="dot"></span>Popups allowed';
        actions.appendChild(makeActionBtn('Block', () => addDomain(currentHost, 'popupBlock')));
        actions.appendChild(makeActionBtn('Clear', clearHostRules));
    } else {
        badge.className = 'status-badge s-norule';
        badge.innerHTML = '<span class="dot"></span>No rule';
        actions.appendChild(makeActionBtn('Block', () => addDomain(currentHost, 'popupBlock')));
        actions.appendChild(makeActionBtn('Allow', () => addDomain(currentHost, 'popupAllow')));
    }
}

function initStatusCard() {
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
        if (!tabs[0]?.url) return;
        const host = getHostname(tabs[0].url);
        if (!host) return;
        currentHost = host;

        document.getElementById('status-host').textContent = host;
        document.getElementById('status-card').classList.remove('status-hidden');
    });
}



document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('ext-version').textContent = 'v' + chrome.runtime.getManifest().version;

    initStatusCard();
    renderAll();


    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            currentFilter = tab.dataset.filter;
            syncAddSection();
            renderAll();
        });
    });


    document.getElementById('search-input').addEventListener('input', e => {
        searchQuery = e.target.value.trim();
        renderAll();
    });


    document.getElementById('add-btn').onclick = () => {
        const domain = document.getElementById('new-domain').value;
        const type = document.getElementById('new-type').value;
        addDomain(domain, type);
    };
    document.getElementById('new-domain').onkeypress = e => {
        if (e.key === 'Enter') {
            const type = document.getElementById('new-type').value;
            addDomain(e.target.value, type);
        }
    };
});
