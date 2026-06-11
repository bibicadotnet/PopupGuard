"use strict";

let staticList = [];
let staticLoaded = false;
let currentFilter = 'all';
let searchQuery = '';
let currentHost = null;
let toastTimer = 0;

const showToast = msg => {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2000);
};

const loadStatic = () => {
    if (staticLoaded) return Promise.resolve(staticList);
    return fetch(chrome.runtime.getURL('allowlist.json'))
        .then(r => r.json())
        .then(list => { staticList = list; staticLoaded = true; return list; })
        .catch(() => { staticLoaded = true; return []; });
};

const getHostname = t => {
    try {
        if (!t) return null;
        t = t.trim();
        if (t.startsWith('*.')) return '*.' + new URL('http://' + t.slice(2)).hostname;
        return new URL(t.includes('http') ? t : 'http://' + t).hostname;
    } catch (_) { return null; }
};

const inList = (domain, list) => list.some(x => {
    if (x.startsWith('*.')) { const b = x.slice(2); return domain === x || domain === b || domain.endsWith('.' + b); }
    return domain === x;
});

const TAG = {
    popupBlock: { cls: 'tag-block', label: 'Blocked' },
    popupAllow: { cls: 'tag-allow', label: 'Allowed' },
    navBlock:   { cls: 'tag-nav',   label: 'Network' },
    builtin:    { cls: 'tag-builtin', label: 'Default' }
};

const FILTER_TYPE = { all: 'popupBlock', popupBlock: 'popupBlock', popupAllow: 'popupAllow', navBlock: 'navBlock' };

const syncAddSection = () => {
    const sec = document.getElementById('add-section');
    const sel = document.getElementById('new-type');
    if (currentFilter === 'builtin') { sec.classList.add('hidden'); return; }
    sec.classList.remove('hidden');
    if (currentFilter === 'all') { sel.style.display = ''; sel.value = 'popupBlock'; }
    else { sel.style.display = 'none'; sel.value = FILTER_TYPE[currentFilter]; }
};

const renderAll = () => {
    loadStatic().then(builtin => {
        chrome.storage.sync.get(['popupBlock', 'popupAllow', 'navBlock'], data => {
            const pbl = data.popupBlock || [];
            const pal = data.popupAllow || [];
            const nbl = data.navBlock || [];

            const items = [
                ...pbl.map(d => ({ domain: d, type: 'popupBlock' })),
                ...pal.map(d => ({ domain: d, type: 'popupAllow' })),
                ...nbl.map(d => ({ domain: d, type: 'navBlock' })),
                ...builtin.map(d => ({ domain: d, type: 'builtin' }))
            ];

            document.getElementById('count-all').textContent = pbl.length + pal.length + nbl.length + builtin.length;
            document.getElementById('count-block').textContent = pbl.length;
            document.getElementById('count-allow').textContent = pal.length;
            document.getElementById('count-nav').textContent = nbl.length;
            document.getElementById('count-builtin').textContent = builtin.length;

            let filtered = currentFilter === 'all' ? items : items.filter(i => i.type === currentFilter);
            if (searchQuery) { const q = searchQuery.toLowerCase(); filtered = filtered.filter(i => i.domain.toLowerCase().includes(q)); }

            const container = document.getElementById('domain-list');
            const empty = document.getElementById('empty-msg');
            container.innerHTML = '';

            if (!filtered.length) { empty.style.display = 'block'; updateStatusCard(pbl, pal, nbl); return; }
            empty.style.display = 'none';

            filtered.forEach(item => {
                const row = document.createElement('div');
                row.className = 'domain-row';

                const name = document.createElement('span');
                name.className = 'domain-name';
                name.textContent = item.domain;

                const tag = document.createElement('span');
                tag.className = 'domain-tag ' + TAG[item.type].cls;
                tag.textContent = TAG[item.type].label;

                row.appendChild(name);
                row.appendChild(tag);

                if (item.type !== 'builtin') {
                    const btn = document.createElement('button');
                    btn.className = 'domain-x';
                    btn.textContent = '×';
                    btn.title = 'Remove';
                    btn.addEventListener('click', () => removeDomain(item.domain, item.type));
                    row.appendChild(btn);
                }
                container.appendChild(row);
            });

            updateStatusCard(pbl, pal, nbl);
        });
    });
};

const removeDomain = (domain, key) => {
    chrome.storage.sync.get([key], data => {
        chrome.storage.sync.set({ [key]: (data[key] || []).filter(x => x !== domain) }, renderAll);
    });
};

const addDomain = (input, targetKey) => {
    const host = getHostname(input);
    if (!host) return;
    loadStatic().then(sl => {
        if (inList(host, sl)) { showToast(host + ' is in default allowlist'); return; }
        const others = { popupBlock: ['popupAllow','navBlock'], popupAllow: ['popupBlock','navBlock'], navBlock: ['popupBlock','popupAllow'] }[targetKey];
        chrome.storage.sync.get([targetKey, ...others], data => {
            const target = data[targetKey] || [];
            if (target.includes(host)) { showToast(host + ' already in list'); return; }
            const update = { [targetKey]: [...target, host] };
            others.forEach(k => { update[k] = (data[k] || []).filter(x => x !== host); });
            chrome.storage.sync.set(update, () => { document.getElementById('new-domain').value = ''; renderAll(); });
        });
    });
};

const exportRules = () => {
    chrome.storage.sync.get(['popupBlock', 'popupAllow', 'navBlock'], data => {
        const payload = { version: chrome.runtime.getManifest().version, exported: new Date().toISOString(), ...data };
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
        a.download = 'popupguard-rules-' + new Date().toISOString().slice(0, 10) + '.json';
        a.click();
        URL.revokeObjectURL(a.href);
        showToast('Rules exported');
    });
};

const importRules = file => {
    const reader = new FileReader();
    reader.onload = e => {
        let data;
        try { data = JSON.parse(e.target.result); } catch { showToast('Invalid JSON file'); return; }
        const pbl = Array.isArray(data.popupBlock) ? data.popupBlock : [];
        const pal = Array.isArray(data.popupAllow) ? data.popupAllow : [];
        const nbl = Array.isArray(data.navBlock)   ? data.navBlock   : [];
        if (!pbl.length && !pal.length && !nbl.length) { showToast('No rules found in file'); return; }
        chrome.storage.sync.get(['popupBlock', 'popupAllow', 'navBlock'], existing => {
            const merged = {
                popupBlock: [...new Set([...(existing.popupBlock || []), ...pbl])],
                popupAllow: [...new Set([...(existing.popupAllow || []), ...pal])],
                navBlock:   [...new Set([...(existing.navBlock   || []), ...nbl])]
            };
            const navSet = new Set(merged.navBlock);
            const palSet = new Set(merged.popupAllow);
            merged.popupBlock = merged.popupBlock.filter(x => !navSet.has(x) && !palSet.has(x));
            merged.popupAllow = merged.popupAllow.filter(x => !navSet.has(x));
            chrome.storage.sync.set(merged, () => {
                showToast('Imported ' + (pbl.length + pal.length + nbl.length) + ' rules');
                renderAll();
            });
        });
    };
    reader.readAsText(file);
};

const filterRule = (list, host) => (list || []).filter(x => {
    if (x === host) return false;
    if (x.startsWith('*.')) { const b = x.slice(2); if (host === b || host.endsWith('.' + b)) return false; }
    return true;
});

const clearHostRules = () => {
    chrome.storage.sync.get(['popupBlock', 'popupAllow', 'navBlock'], data => {
        chrome.storage.sync.set({
            popupBlock: filterRule(data.popupBlock, currentHost),
            popupAllow: filterRule(data.popupAllow, currentHost),
            navBlock:   filterRule(data.navBlock,   currentHost)
        }, renderAll);
    });
};

const makeBtn = (label, onClick) => {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.addEventListener('click', onClick);
    return btn;
};

const updateStatusCard = (pbl, pal, nbl) => {
    if (!currentHost) return;
    const badge = document.getElementById('status-badge');
    const actions = document.getElementById('status-actions');
    actions.innerHTML = '';

    if (inList(currentHost, staticList)) {
        badge.className = 'status-badge s-builtin';
        badge.innerHTML = '<span class="dot"></span>Default allowed';
    } else if (inList(currentHost, nbl)) {
        badge.className = 'status-badge s-blocked';
        badge.innerHTML = '<span class="dot"></span>Network blocked';
        actions.appendChild(makeBtn('Clear', clearHostRules));
    } else if (inList(currentHost, pbl)) {
        badge.className = 'status-badge s-blocked';
        badge.innerHTML = '<span class="dot"></span>Popups blocked';
        actions.appendChild(makeBtn('Allow', () => addDomain(currentHost, 'popupAllow')));
        actions.appendChild(makeBtn('Clear', clearHostRules));
    } else if (inList(currentHost, pal)) {
        badge.className = 'status-badge s-allowed';
        badge.innerHTML = '<span class="dot"></span>Popups allowed';
        actions.appendChild(makeBtn('Block', () => addDomain(currentHost, 'popupBlock')));
        actions.appendChild(makeBtn('Clear', clearHostRules));
    } else {
        badge.className = 'status-badge s-norule';
        badge.innerHTML = '<span class="dot"></span>No rule';
        actions.appendChild(makeBtn('Block', () => addDomain(currentHost, 'popupBlock')));
        actions.appendChild(makeBtn('Allow', () => addDomain(currentHost, 'popupAllow')));
    }
};

const initStatusCard = () => {
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
        const host = getHostname(tabs[0]?.url);
        if (!host) return;
        currentHost = host;
        document.getElementById('status-host').textContent = host;
        document.getElementById('status-card').classList.remove('status-hidden');
    });
};

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('ext-version').textContent = 'v' + chrome.runtime.getManifest().version;
    initStatusCard();
    renderAll();

    document.getElementById('export-btn').addEventListener('click', exportRules);
    document.getElementById('import-btn').addEventListener('click', () => {
        document.getElementById('import-file-input').value = '';
        document.getElementById('import-file-input').click();
    });
    document.getElementById('import-file-input').addEventListener('change', e => { if (e.target.files[0]) importRules(e.target.files[0]); });

    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            currentFilter = tab.dataset.filter;
            syncAddSection();
            renderAll();
        });
    });

    document.getElementById('search-input').addEventListener('input', e => { searchQuery = e.target.value.trim(); renderAll(); });

    document.getElementById('add-btn').onclick = () => addDomain(document.getElementById('new-domain').value, document.getElementById('new-type').value);
    document.getElementById('new-domain').onkeypress = e => { if (e.key === 'Enter') addDomain(e.target.value, document.getElementById('new-type').value); };
});
