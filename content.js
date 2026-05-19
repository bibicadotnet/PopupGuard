"use strict";

const loadLists = async () => {
    const staticList = await fetch(chrome.runtime.getURL("allowlist.json"))
        .then(r => r.json()).catch(() => []);
    const data = await chrome.storage.sync.get(["popupAllow", "popupBlock", "navBlock"]);
    return {
        pal: [...new Set([...staticList, ...(data.popupAllow || [])])],
        pbl: data.popupBlock || [],
        nbl: data.navBlock || []
    };
};

const syncData = async () => {
    const { pal, pbl, nbl } = await loadLists();
    document.documentElement.setAttribute("data-pg-pal", JSON.stringify(pal));
    document.documentElement.setAttribute("data-pg-pbl", JSON.stringify(pbl));
    document.documentElement.setAttribute("data-pg-nbl", JSON.stringify(nbl));
};

syncData();
chrome.storage.onChanged.addListener(syncData);

const showPopup = (url, source, name = "_blank", specs = "", isNav = false) => {
    const destHost = getHost(url);
    if (window !== window.top) {
        window.top.postMessage({ action: "PG_IFRAME", url, source, name, specs, isNav }, "*");
        return;
    }
    if (document.getElementById("pg-container")) return;

    const container = document.createElement("div");
    container.id = "pg-container";
    container.style.cssText = "position:fixed !important;top:0 !important;left:0 !important;z-index:2147483647 !important;width:0 !important;height:0 !important;display:block !important;";
    document.body.appendChild(container);

    const shadow = container.attachShadow({ mode: "open" });
    const iconUrl = chrome.runtime.getURL("app_icon_128.png");

    shadow.innerHTML = `
        <style>
            * { box-sizing: border-box; }
            .ov { position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.55);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; }
            .cd { background:#fff;width:420px;padding:24px 24px 20px;border-radius:14px;box-shadow:0 16px 48px rgba(0,0,0,0.35);animation:popIn 0.18s cubic-bezier(0.16,1,0.3,1); }
            .hd { display:flex;align-items:center;gap:10px;margin-bottom:6px; }
            .hd img { width:22px;height:22px;flex-shrink:0; }
            .hd h3 { margin:0;font-size:15px;font-weight:700;color:#111; }
            .src { font-size:13px;color:#475569;margin-bottom:12px;line-height:1.5; }
            .src b { color:#0f172a; }
            .dst-label { font-size:11px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px; }
            .dst { background:#f1f5f9;padding:9px 11px;border-radius:7px;font-size:12px;color:#475569;word-break:break-all;line-height:1.45;margin-bottom:18px; }
            .ch-grp { display:flex;flex-direction:column;gap:8px;margin-bottom:20px; }
            .ch { display:flex;align-items:center;gap:9px;font-size:13px;color:#334155;cursor:pointer;user-select:none; }
            .ch input { width:15px;height:15px;accent-color:#1e293b;cursor:pointer;flex-shrink:0; }
            .btns { display:flex;gap:10px;justify-content:flex-end; }
            .btn { border:none;padding:9px 20px;border-radius:7px;cursor:pointer;font-weight:600;font-size:13px;transition:all .15s; }
            .btn-allow { background:#16a34a;color:#fff; }
            .btn-allow:hover { background:#15803d; }
            .btn-block { background:#dc2626;color:#fff; }
            .btn-block:hover { background:#b91c1c; }
            @keyframes popIn { from{transform:scale(0.94);opacity:0}to{transform:scale(1);opacity:1} }
        </style>
        <div class="ov">
            <div class="cd">
                <div class="hd">
                    <img src="${iconUrl}">
                    <h3>PopupGuard</h3>
                </div>
                <p class="src">
                    <b>${source}</b> is trying to automatically open a ${isNav ? 'new page' : 'new tab'}:
                </p>
                <div class="dst-label">Destination URL</div>
                <div class="dst">${url.length > 150 ? url.substring(0, 150) + '...' : url}</div>
                <div class="ch-grp">
                    <label class="ch">
                        <input type="checkbox" id="cb-allow">
                        Always allow <b>${source}</b> to open new tabs
                    </label>
                    <label class="ch">
                        <input type="checkbox" id="cb-block">
                        Always block <b>${source}</b> from opening new tabs
                    </label>
                    <label class="ch" id="cb-dest-row" style="display:none">
                        <input type="checkbox" id="cb-dest">
                        Block all network requests to <b id="dest-host-label"></b>
                    </label>
                </div>
                <div class="btns">
                    <button class="btn btn-allow" id="btn-open">Allow this time</button>
                    <button class="btn btn-block" id="btn-block">Block this time</button>
                </div>
            </div>
        </div>`;

    const cbAllow = shadow.getElementById("cb-allow");
    const cbBlock = shadow.getElementById("cb-block");
    const cbDest = shadow.getElementById("cb-dest");
    shadow.getElementById("dest-host-label").textContent = destHost;
    if (destHost && destHost !== source) {
        const pal = JSON.parse(document.documentElement.getAttribute('data-pg-pal') || '[]');
        const nbl = JSON.parse(document.documentElement.getAttribute('data-pg-nbl') || '[]');
        if (!checkMatch(destHost, pal) && !checkMatch(destHost, nbl)) {
            shadow.getElementById("cb-dest-row").style.display = "";
        }
    }

    const btnOpen = shadow.getElementById("btn-open");
    const btnBlock = shadow.getElementById("btn-block");

    const updateButtons = () => {
        const blocking = cbBlock.checked;
        const allowing = cbAllow.checked;
        btnOpen.disabled = blocking;
        btnOpen.style.opacity = blocking ? '0.4' : '1';
        btnOpen.style.cursor = blocking ? 'not-allowed' : 'pointer';
        btnBlock.disabled = allowing;
        btnBlock.style.opacity = allowing ? '0.4' : '1';
        btnBlock.style.cursor = allowing ? 'not-allowed' : 'pointer';
    };

    cbAllow.onchange = () => {
        if (cbAllow.checked) cbBlock.checked = false;
        updateButtons();
    };
    cbBlock.onchange = () => {
        if (cbBlock.checked) cbAllow.checked = false;
        updateButtons();
    };
    cbDest.onchange = updateButtons;

    const closeDialog = () => {
        container.remove();
        window.postMessage({ action: 'PG_DIALOG_CLOSED' }, '*');
    };

    const saveChecked = () => {
        if (cbAllow.checked) saveSource(source, 'allow');
        if (cbBlock.checked) saveSource(source, 'block');
        if (cbDest.checked) saveDestBlock(destHost);
    };

    btnOpen.onclick = () => {
        if (btnOpen.disabled) return;
        saveChecked();
        closeDialog();
        if (isNav) {
            const token = document.documentElement.getAttribute('data-pg-nav-token');
            window.postMessage({ action: 'PG_DO_NAV', url, token }, '*');
        } else {
            window.open(url, name, specs);
        }
    };

    btnBlock.onclick = () => {
        if (btnBlock.disabled) return;
        saveChecked();
        closeDialog();
        if (cbDest.checked) setTimeout(() => location.reload(), 300);
    };
};

const updateAttr = (key, fn) => {
    const list = JSON.parse(document.documentElement.getAttribute(key) || '[]');
    const updated = fn(list);
    if (updated) document.documentElement.setAttribute(key, JSON.stringify(updated));
};

const saveSource = (source, action) => {
    if (action === 'allow') {
        updateAttr('data-pg-pal', list => {
            if (list.includes(source)) return null;
            list.push(source); return list;
        });
        updateAttr('data-pg-pbl', list => list.filter(x => x !== source));
        chrome.storage.sync.get(["popupAllow", "popupBlock"], data => {
            const pal = data.popupAllow || [];
            const pbl = (data.popupBlock || []).filter(x => x !== source);
            if (!pal.includes(source)) pal.push(source);
            chrome.storage.sync.set({ popupAllow: pal, popupBlock: pbl });
        });
    } else {
        updateAttr('data-pg-pbl', list => {
            if (list.includes(source)) return null;
            list.push(source); return list;
        });
        updateAttr('data-pg-pal', list => list.filter(x => x !== source));
        chrome.storage.sync.get(["popupAllow", "popupBlock"], data => {
            const pbl = data.popupBlock || [];
            const pal = (data.popupAllow || []).filter(x => x !== source);
            if (!pbl.includes(source)) pbl.push(source);
            chrome.storage.sync.set({ popupBlock: pbl, popupAllow: pal });
        });
    }
};

const saveDestBlock = (host) => {
    updateAttr('data-pg-nbl', list => {
        if (list.includes(host)) return null;
        list.push(host); return list;
    });
    chrome.storage.sync.get(['navBlock'], data => {
        const nbl = data.navBlock || [];
        if (!nbl.includes(host)) {
            nbl.push(host);
            chrome.storage.sync.set({ navBlock: nbl });
        }
    });
};

const getHost = url => {
    try { return new URL(url.startsWith('http') ? url : 'http://' + url).hostname.toLowerCase(); }
    catch (e) { return 'unknown'; }
};

const checkMatch = (host, list) => {
    if (!host || !list) return false;
    return list.some(x => x.startsWith('*.')
        ? (host === x.slice(2) || host.endsWith('.' + x.slice(2)))
        : host === x);
};

window.addEventListener("message", e => {
    if (e.data?.action === 'PG_ASK' || e.data?.action === 'PG_IFRAME') {
        const source = e.data.source || getHost(e.data.url);
        if (source === 'unknown') return;
        showPopup(e.data.url, source, e.data.name, e.data.specs, e.data.isNav || false);
    }
});