"use strict";

let _staticList = null;
let _pal = [];
let _pbl = [];

const getHost = url => {
    try { return new URL(url.startsWith('http') ? url : 'http://' + url).hostname.toLowerCase(); }
    catch (_) { return 'unknown'; }
};

const checkMatch = (host, list) => {
    if (!host || !list?.length) return false;
    return list.some(x => x.startsWith('*.')
        ? (host === x.slice(2) || host.endsWith('.' + x.slice(2)))
        : host === x);
};

const getTopHost = () => {
    if (window === window.top) {
        try { return location.hostname.toLowerCase(); } catch (_) {}
    } else {
        try { return window.top.location.hostname.toLowerCase(); } catch (_) {
            if (location.ancestorOrigins?.length > 0) {
                try { return new URL(location.ancestorOrigins[location.ancestorOrigins.length - 1]).hostname.toLowerCase(); } catch (_) {}
            }
        }
    }
    return '';
};

const computeAction = host => {
    if (!host) return 'ASK';
    if (checkMatch(host, _pal)) return 'ALLOW';
    if (checkMatch(host, _pbl)) return 'BLOCK';
    return 'ASK';
};

const syncData = async () => {
    if (!_staticList) {
        _staticList = await fetch(chrome.runtime.getURL('allowlist.json'))
            .then(r => r.json()).catch(() => []);
    }
    // Phase 1: static list first (fast) so inject.js gets correct action ASAP
    _pal = [..._staticList];
    _pbl = [];
    const topHost = getTopHost();
    document.documentElement.setAttribute('data-pg-popup-action', computeAction(topHost));

    // Phase 2: merge user overrides
    const data = await chrome.storage.sync.get(['popupAllow', 'popupBlock', 'navBlock']);
    _pal = [...new Set([..._staticList, ...(data.popupAllow || [])])];
    _pbl = data.popupBlock || [];
    document.documentElement.setAttribute('data-pg-popup-action', computeAction(topHost));
    document.documentElement.setAttribute('data-pg-nbl', JSON.stringify(data.navBlock || []));
};

const _syncPromise = syncData();
chrome.storage.onChanged.addListener((_, area) => { if (area === 'sync') syncData(); });

// ── Dialog ────────────────────────────────────────────────────────────────────

const showDialog = (url, source, name, specs, isNav, token) => {
    const destHost = getHost(url);
    if (window !== window.top) {
        window.top.postMessage({ action: 'PG_IFRAME', url, source, name, specs, isNav }, '*');
        return;
    }
    if (document.getElementById('pg-container')) return;

    const container = document.createElement('div');
    container.id = 'pg-container';
    container.style.cssText = 'position:fixed!important;top:0!important;left:0!important;z-index:2147483647!important;width:0!important;height:0!important;display:block!important;';
    (document.body || document.documentElement).appendChild(container);

    const shadow = container.attachShadow({ mode: 'open' });
    let iconUrl = '';
    try { iconUrl = chrome.runtime.getURL('app_icon_128.png'); } catch (_) {}

    const isSourceBlocked = checkMatch(source, _pbl);
    const actionText = isSourceBlocked
        ? `<b>${source}</b> is a blocked site. You clicked an external link to:`
        : `<b>${source}</b> is trying to automatically open a ${isNav ? 'new page' : 'new tab'}:`;

    shadow.innerHTML = `<style>
        *{box-sizing:border-box}
        .ov{position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,.55);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;z-index:2147483647}
        .cd{background:#fff;width:420px;padding:24px 24px 20px;border-radius:14px;box-shadow:0 16px 48px rgba(0,0,0,.35);animation:pi .18s cubic-bezier(.16,1,.3,1)}
        .hd{display:flex;align-items:center;gap:10px;margin-bottom:6px}
        .hd img{width:22px;height:22px;flex-shrink:0}
        .hd h3{margin:0;font-size:15px;font-weight:700;color:#111}
        .src{font-size:13px;color:#475569;margin-bottom:12px;line-height:1.5}
        .src b{color:#0f172a}
        .lbl{font-size:11px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px}
        .dst{background:#f1f5f9;padding:9px 11px;border-radius:7px;font-size:12px;color:#475569;word-break:break-all;line-height:1.45;margin-bottom:18px}
        .chk{display:flex;flex-direction:column;gap:8px;margin-bottom:20px}
        .ch{display:flex;align-items:center;gap:9px;font-size:13px;color:#334155;cursor:pointer;user-select:none}
        .ch input{width:15px;height:15px;accent-color:#1e293b;cursor:pointer;flex-shrink:0}
        .btns{display:flex;gap:10px;justify-content:flex-end}
        .btn{border:none;padding:9px 20px;border-radius:7px;cursor:pointer;font-weight:600;font-size:13px;transition:all .15s}
        .al{background:#16a34a;color:#fff}.al:hover{background:#15803d}
        .bl{background:#dc2626;color:#fff}.bl:hover{background:#b91c1c}
        @keyframes pi{from{transform:scale(.94);opacity:0}to{transform:scale(1);opacity:1}}
    </style>
    <div class="ov"><div class="cd">
        <div class="hd"><img src="${iconUrl}"><h3>PopupGuard</h3></div>
        <p class="src">${actionText}</p>
        <div class="lbl">Destination URL</div>
        <div class="dst">${url.length > 150 ? url.slice(0, 150) + '…' : url}</div>
        <div class="chk">
            <label class="ch" id="r-al" ${isSourceBlocked ? 'style="display:none"' : ''}>
                <input type="checkbox" id="cb-al"> Always allow <b>${source}</b> to open new tabs
            </label>
            <label class="ch" id="r-bl" ${isSourceBlocked ? 'style="display:none"' : ''}>
                <input type="checkbox" id="cb-bl"> Always block <b>${source}</b> from opening new tabs
            </label>
            <label class="ch" id="r-dst" style="display:none">
                <input type="checkbox" id="cb-dst"> Block all network requests to <b id="dest-lbl"></b>
            </label>
        </div>
        <div class="btns">
            <button class="btn al" id="btn-ok">${isSourceBlocked ? 'Open Link' : 'Allow this time'}</button>
            <button class="btn bl" id="btn-no">${isSourceBlocked ? 'Cancel' : 'Block this time'}</button>
        </div>
    </div></div>`;

    const cbAl = shadow.getElementById('cb-al');
    const cbBl = shadow.getElementById('cb-bl');
    const cbDst = shadow.getElementById('cb-dst');
    shadow.getElementById('dest-lbl').textContent = destHost;

    if (destHost && destHost !== source) {
        const nbl = JSON.parse(document.documentElement.getAttribute('data-pg-nbl') || '[]');
        if (!checkMatch(destHost, _pal) && !checkMatch(destHost, nbl))
            shadow.getElementById('r-dst').style.display = '';
    }

    const btnOk = shadow.getElementById('btn-ok');
    const btnNo = shadow.getElementById('btn-no');

    const updateBtns = () => {
        btnOk.disabled = cbBl.checked;
        btnOk.style.opacity = cbBl.checked ? '0.4' : '1';
        btnOk.style.cursor = cbBl.checked ? 'not-allowed' : 'pointer';
        btnNo.disabled = cbAl.checked;
        btnNo.style.opacity = cbAl.checked ? '0.4' : '1';
        btnNo.style.cursor = cbAl.checked ? 'not-allowed' : 'pointer';
    };

    cbAl.onchange = () => { if (cbAl.checked) cbBl.checked = false; updateBtns(); };
    cbBl.onchange = () => { if (cbBl.checked) cbAl.checked = false; updateBtns(); };

    const close = () => {
        container.remove();
        window.postMessage({ action: 'PG_DIALOG_CLOSED' }, '*');
    };

    const saveChecks = () => {
        if (cbAl.checked) saveSource(source, 'allow');
        if (cbBl.checked) saveSource(source, 'block');
        if (cbDst.checked) saveDestBlock(destHost);
    };

    btnOk.onclick = () => {
        if (btnOk.disabled) return;
        saveChecks(); close();
        if (isNav) {
            const topToken = document.documentElement?.getAttribute('data-pg-nav-token') || token;
            window.postMessage({ action: 'PG_DO_NAV', url, token: topToken }, '*');
        } else {
            window.postMessage({ action: 'PG_DO_OPEN', url, name, specs }, '*');
        }
    };

    btnNo.onclick = () => {
        if (btnNo.disabled) return;
        saveChecks(); close();
        if (cbDst.checked) setTimeout(() => location.reload(), 300);
    };
};

// ── Storage helpers ───────────────────────────────────────────────────────────

const saveSource = (source, action) => {
    if (action === 'allow') {
        _pal = [...new Set([..._pal, source])];
        _pbl = _pbl.filter(x => x !== source);
        chrome.storage.sync.get(['popupAllow', 'popupBlock'], data => {
            const pal = [...new Set([...(data.popupAllow || []), source])];
            chrome.storage.sync.set({ popupAllow: pal, popupBlock: (data.popupBlock || []).filter(x => x !== source) });
        });
    } else {
        _pbl = [...new Set([..._pbl, source])];
        _pal = _pal.filter(x => x !== source);
        chrome.storage.sync.get(['popupAllow', 'popupBlock'], data => {
            const pbl = [...new Set([...(data.popupBlock || []), source])];
            chrome.storage.sync.set({ popupBlock: pbl, popupAllow: (data.popupAllow || []).filter(x => x !== source) });
        });
    }
    document.documentElement.setAttribute('data-pg-popup-action', computeAction(getTopHost()));
};

const saveDestBlock = host => {
    const nbl = JSON.parse(document.documentElement.getAttribute('data-pg-nbl') || '[]');
    if (nbl.includes(host)) return;
    nbl.push(host);
    document.documentElement.setAttribute('data-pg-nbl', JSON.stringify(nbl));
    chrome.storage.sync.get('navBlock', data => {
        const stored = data.navBlock || [];
        if (!stored.includes(host)) chrome.storage.sync.set({ navBlock: [...stored, host] });
    });
};

// ── Message bridge ────────────────────────────────────────────────────────────

window.addEventListener('message', async e => {
    if (!e.data || typeof e.data !== 'object') return;
    const { action, url, source, name, specs, isNav, token } = e.data;
    if (action !== 'PG_ASK' && action !== 'PG_IFRAME') return;
    if (action === 'PG_ASK' && e.source !== window) return;

    await _syncPromise;

    const topHost = getTopHost();
    const src = (topHost && topHost !== 'unknown') ? topHost : (source || getHost(url));
    if (!src || src === 'unknown') return;

    if (checkMatch(src, _pal)) {
        window.postMessage({ action: 'PG_DIALOG_CLOSED' }, '*');
        if (isNav) {
            const topToken = document.documentElement?.getAttribute('data-pg-nav-token') || token;
            window.postMessage({ action: 'PG_DO_NAV', url, token: topToken }, '*');
        } else {
            window.postMessage({ action: 'PG_DO_OPEN', url, name, specs }, '*');
        }
        return;
    }
    showDialog(url, src, name, specs, isNav || false, token);
});

// ── Overlay remover (BLOCK sites only) ───────────────────────────────────────

const isBlockSite = () => document.documentElement.getAttribute('data-pg-popup-action') === 'BLOCK';

const looksLikeOverlay = el => {
    try {
        if (!el || el.nodeType !== 1) return false;
        const tag = el.tagName;
        if (tag === 'BODY' || tag === 'HTML' || tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') return false;
        if (el.id === 'pg-container' || el.closest?.('#pg-container')) return false;
        const s = window.getComputedStyle(el);
        if (s.display === 'none' || s.opacity === '0') return false;
        if (s.position !== 'fixed' && s.position !== 'absolute') return false;
        if (s.pointerEvents === 'none') return false;
        const z = parseInt(s.zIndex, 10);
        if (isNaN(z) || z < 100) return false;
        const vw = window.innerWidth, vh = window.innerHeight;
        if (!vw || !vh) return false;
        const r = el.getBoundingClientRect();
        if (r.width < vw * 0.45 || r.height < vh * 0.45) return false;
        if (r.bottom < 0 || r.right < 0 || r.top > vh || r.left > vw) return false;
        if (el.querySelector('input,button,textarea,select,canvas,video,audio')) return false;
        return true;
    } catch (_) { return false; }
};

const scanAndRemove = () => {
    if (window !== window.top || !isBlockSite()) return;
    document.querySelectorAll('div,section,aside,span,ins,article')
        .forEach(el => { if (looksLikeOverlay(el)) el.remove(); });
};

const unlockScroll = () => {
    if (window !== window.top || !isBlockSite()) return;
    try {
        const s = window.getComputedStyle(document.body);
        if (s.overflow === 'hidden' || s.overflowY === 'hidden') {
            document.body.style.setProperty('overflow', 'auto', 'important');
            document.body.style.setProperty('overflow-y', 'auto', 'important');
        }
    } catch (_) {}
};

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scanAndRemove);
else scanAndRemove();

window.addEventListener('load', () => {
    scanAndRemove(); unlockScroll();
    setTimeout(scanAndRemove, 500);
    setTimeout(scanAndRemove, 1500);
    setTimeout(scanAndRemove, 3000);
});

const overlayObs = new MutationObserver(mutations => {
    if (!isBlockSite()) return;
    for (const m of mutations) {
        for (const node of m.addedNodes) {
            if (node.nodeType !== 1) continue;
            if (looksLikeOverlay(node)) { node.remove(); continue; }
            node.querySelectorAll?.('div,section,aside')
                .forEach(c => { if (looksLikeOverlay(c)) c.remove(); });
        }
    }
});

const startOverlayObs = () => {
    if (window !== window.top) return;
    const root = document.body || document.documentElement;
    if (root) overlayObs.observe(root, { childList: true, subtree: true });
};

if (document.body) startOverlayObs();
else document.addEventListener('DOMContentLoaded', startOverlayObs);
