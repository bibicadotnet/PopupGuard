(function () {
    'use strict';

    // ── PG Logger ─────────────────────────────────────────────────────────────
    const PG = (...a) => console.log('[PG]', ...a);

    // ── State ─────────────────────────────────────────────────────────────────

    const checkMatch = (host, list) => {
        if (!host || !list?.length) return false;
        return list.some(x => x.startsWith('*.')
            ? (host === x.slice(2) || host.endsWith('.' + x.slice(2)))
            : host === x);
    };

    let cachedAction = 'ASK';
    let cachedNbl = '[]';
    let _ready = false;

    const updateCache = () => {
        const d = document.documentElement;
        if (!d) return;
        if (d.hasAttribute('data-pg-popup-action')) {
            const prev = cachedAction;
            cachedAction = d.getAttribute('data-pg-popup-action');
            if (!_ready) { _ready = true; PG('STATE ready, action=', cachedAction); }
            else if (prev !== cachedAction) PG('STATE action changed:', prev, '->', cachedAction);
        }
        if (d.hasAttribute('data-pg-nbl')) {
            const prev = cachedNbl;
            cachedNbl = d.getAttribute('data-pg-nbl');
            if (prev !== cachedNbl) PG('STATE navBlock updated:', cachedNbl);
        }
    };

    const getAction = () => { updateCache(); return cachedAction; };
    const isReady = () => { updateCache(); return _ready; };
    const isSiteBlocked = () => getAction() === 'BLOCK';

    const _pendingOpens = [];
    const _pendingFns = [];

    const _readyObs = new MutationObserver(() => {
        if (!isReady()) return;
        _readyObs.disconnect();
        PG('_readyObs fired: flushing', _pendingOpens.length, 'opens,', _pendingFns.length, 'fns');
        for (const item of _pendingOpens.splice(0)) item.resolve(interceptedOpen(item.url, item.name, item.specs));
        for (const fn of _pendingFns.splice(0)) fn();
    });
    if (document.documentElement) {
        _readyObs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-pg-popup-action'] });
    }

    const waitReady = fn => {
        if (isReady()) { fn(); return false; }
        PG('waitReady: NOT ready yet, deferring fn');
        _pendingFns.push(fn);
        return true;
    };

    const getTopOrigin = () => {
        if (window === window.top) { try { return location.origin; } catch (_) { } }
        else {
            try { return window.top.location.origin; } catch (_) {
                if (location.ancestorOrigins?.length > 0) return location.ancestorOrigins[location.ancestorOrigins.length - 1] || '';
            }
        }
        return '';
    };

    const getNavAction = url => {
        try {
            const dest = new URL(url, location.href);
            updateCache();
            if (checkMatch(dest.hostname.toLowerCase(), JSON.parse(cachedNbl))) return 'BLOCK';
        } catch (_) { }
        return 'ALLOW';
    };

    // ── Click tracking ────────────────────────────────────────────────────────

    let popupPending = false;
    let pendingNav = null;
    let lastPos = null;
    let isReplaying = false;
    let popupBlocked = false;
    let popupOpened = false;
    let trustedClick = false;
    let trustedUrl = null;
    let trustedTarget = '_self';
    let trustedUrlForNav = null;
    let trustedIframeOrigin = null;
    let trustedTimer = null;
    const origPlay = HTMLMediaElement.prototype.play;

    document.addEventListener('mousedown', e => {
        if (!e.isTrusted || isReplaying) return;
        lastPos = { x: e.clientX, y: e.clientY };
        popupBlocked = false;
        popupOpened = false;

        const path = e.composedPath ? e.composedPath() : [];
        const a = path.find(el => el.tagName === 'A') || e.target?.closest?.('a');
        const iframe = path.find(el => el.tagName === 'IFRAME' || el.tagName === 'FRAME');
        trustedClick = !!(a?.href || iframe);
        trustedUrl = null;
        trustedUrlForNav = null;
        clearTimeout(trustedTimer);

        if (a?.href) {
            trustedUrl = trustedUrlForNav = (() => { try { return new URL(a.href, location.href).href; } catch (_) { return a.href; } })();
            trustedTarget = a.getAttribute('target') || '_self';
            trustedIframeOrigin = null;
            trustedTimer = setTimeout(() => { trustedClick = false; trustedUrl = null; trustedUrlForNav = null; }, 1000);
            PG('mousedown: <a> href=', trustedUrl, 'target=', trustedTarget);
        } else if (iframe) {
            trustedTarget = '_self';
            try { trustedIframeOrigin = new URL(iframe.src).origin; } catch (_) { trustedIframeOrigin = null; }
            trustedTimer = setTimeout(() => { trustedClick = false; trustedIframeOrigin = null; }, 1000);
            PG('mousedown: <iframe> origin=', trustedIframeOrigin);
        } else {
            trustedIframeOrigin = null;
            PG('mousedown: non-link element, tag=', e.target?.tagName);
        }
    }, true);

    let clickCleanup = null;
    let replayTimer = null;

    document.addEventListener('click', e => {
        if (!e.isTrusted || isReplaying) return;
        PG('click: trusted=', e.isTrusted, 'popupBlocked=', popupBlocked, 'popupOpened=', popupOpened,
           'trustedClick=', trustedClick, 'trustedUrl=', trustedUrl, 'trustedUrlForNav=', trustedUrlForNav);
        if (!popupBlocked) clearTimeout(replayTimer);
        clearTimeout(clickCleanup);
        clickCleanup = setTimeout(() => { popupOpened = false; popupBlocked = false; }, 500);
        if (trustedClick) {
            clearTimeout(trustedTimer);
            setTimeout(() => {
                PG('click setTimeout(0): clearing trustedClick/trustedUrl');
                trustedClick = false; trustedUrl = null; trustedTarget = '_self';
            }, 0);
        }
    }, true);

    window.addEventListener('click', e => {
        if (popupPending && e.isTrusted) {
            if (e.composedPath().some(el => el.id === 'pg-container')) return;
            PG('bubble click: popupPending=true, stopping event');
            origPD.call(e);
            origSP.call(e);
            origSIP.call(e);
        }
    }, false);

    // ── Page freeze/unfreeze ──────────────────────────────────────────────────

    let dialogGuard = null;
    let savedContainer = null;
    let origPushState = null;
    let origReplaceState = null;

    const freeze = () => {
        if (document.getElementById('pg-freeze')) return;
        PG('freeze()');
        HTMLMediaElement.prototype.play = () => Promise.resolve();
        document.querySelectorAll('video,audio').forEach(m => { if (!m.paused) m.pause(); });
        const s = document.createElement('style');
        s.id = 'pg-freeze';
        const nonce = document.querySelector('[nonce]')?.nonce;
        if (nonce) s.nonce = nonce;
        s.textContent = '*,*::before,*::after{animation-play-state:paused!important;transition:none!important}';
        document.head?.appendChild(s);

        if (!origPushState) {
            origPushState = history.pushState.bind(history);
            origReplaceState = history.replaceState.bind(history);
            history.pushState = function (...a) {
                if (popupPending) { PG('freeze: blocked pushState'); return; }
                return origPushState(...a);
            };
            history.replaceState = function (...a) {
                if (popupPending) { PG('freeze: blocked replaceState'); return; }
                return origReplaceState(...a);
            };
        }

        if (!dialogGuard) {
            dialogGuard = new MutationObserver(mutations => {
                if (!popupPending) return;
                setTimeout(() => {
                    if (!popupPending) return;
                    const c = document.getElementById('pg-container');
                    if (c) { savedContainer = c; }
                    else if (savedContainer && document.body && !savedContainer.isConnected) {
                        PG('dialogGuard: re-appending pg-container after SPA swap');
                        document.body.appendChild(savedContainer);
                        if (!document.getElementById('pg-freeze')) {
                            const s2 = document.createElement('style');
                            s2.id = 'pg-freeze';
                            s2.textContent = '*,*::before,*::after{animation-play-state:paused!important;transition:none!important}';
                            document.head?.appendChild(s2);
                        }
                    }
                }, 10);
            });
            dialogGuard.observe(document, { childList: true, subtree: true });
        }
    };

    const unfreeze = () => {
        PG('unfreeze()');
        HTMLMediaElement.prototype.play = origPlay;
        document.getElementById('pg-freeze')?.remove();
        if (dialogGuard) { dialogGuard.disconnect(); dialogGuard = null; }
        savedContainer = null;
        if (origPushState) {
            history.pushState = origPushState;
            history.replaceState = origReplaceState;
            origPushState = null;
            origReplaceState = null;
        }
    };

    // ── ASK dialog bridge ─────────────────────────────────────────────────────

    let safetyTimer = null;

    const askPopup = (url, name, specs, isNav = false) => {
        PG('askPopup:', url, 'isNav=', isNav, 'name=', name);
        popupPending = true;
        freeze();
        let resolved = url;
        try { resolved = new URL(url, location.href).href; } catch (_) { }
        window.postMessage({ action: 'PG_ASK', url: resolved, name, specs, source: location.hostname.toLowerCase(), isNav, token: navToken }, '*');
        clearTimeout(safetyTimer);
        safetyTimer = setTimeout(() => {
            if (popupPending && !document.getElementById('pg-container')) {
                PG('safetyTimer: no dialog appeared, clearing popupPending');
                popupPending = false; unfreeze(); pendingNav = null;
            }
        }, 800);
    };

    window.addEventListener('message', e => {
        if (e.source !== window || !e.data?.action) return;
        if (e.data.action === 'PG_DIALOG_CLOSED') {
            PG('PG_DIALOG_CLOSED received, pendingNav=', pendingNav?.url);
            popupPending = false; unfreeze();
            if (pendingNav) { const { fn, url } = pendingNav; pendingNav = null; fn(url); }
        }
        if (e.data.action === 'PG_DO_OPEN') {
            PG('PG_DO_OPEN:', e.data.url);
            try { originalOpen.call(window, e.data.url, e.data.name, e.data.specs); } catch (_) { }
        }
    });

    // ── Replay click after block ──────────────────────────────────────────────

    const replayAfterBlock = () => {
        PG('replayAfterBlock: popupOpened=', popupOpened, 'lastPos=', lastPos, 'isReplaying=', isReplaying,
           'trustedUrl=', trustedUrl);
        if (popupOpened || !lastPos || isReplaying) {
            PG('replayAfterBlock: SKIPPED');
            return;
        }
        const { x, y } = lastPos;
        lastPos = null;

        let targetUrl = trustedUrl;
        if (!targetUrl) {
            const el = document.elementFromPoint(x, y);
            const a = el?.closest?.('a[href]');
            if (a) {
                try { if (new URL(a.href, location.href).origin === location.origin) targetUrl = a.href; } catch (_) { }
            }
        }
        PG('replayAfterBlock: targetUrl=', targetUrl);
        if (!targetUrl) { PG('replayAfterBlock: no targetUrl, giving up'); return; }

        clearTimeout(replayTimer);
        replayTimer = setTimeout(() => {
            PG('replayAfterBlock setTimeout: popupPending=', popupPending, 'targetUrl=', targetUrl);
            if (popupPending) {
                PG('replayAfterBlock: popupPending, setting pendingNav');
                pendingNav = { fn: u => { bypassNext = true; origAssign ? origAssign.call(location, u) : (location.href = u); }, url: targetUrl };
                return;
            }
            bypassNext = true;
            PG('replayAfterBlock: navigating to', targetUrl);
            try { origAssign ? origAssign.call(location, targetUrl) : location.assign(targetUrl); }
            catch (_) { location.href = targetUrl; }
        }, 100);
    };

    // ── window.open intercept ─────────────────────────────────────────────────

    const originalOpen = window.open;

    const fakeWindow = Object.freeze({
        closed: true, name: '',
        close() { }, focus() { }, blur() { }, postMessage() { },
        location: Object.freeze({ href: 'about:blank', assign() { }, replace() { } }),
    });

    const interceptedOpen = function (url, name, specs) {
        PG('window.open intercepted: url=', url, 'name=', name,
           '| popupPending=', popupPending, 'trustedClick=', trustedClick,
           'trustedUrl=', trustedUrl, '_ready=', _ready, 'action=', cachedAction);

        if (name && typeof name === 'string') {
            try { if (window.frames[name]) { PG('window.open: named frame, pass-through'); return originalOpen.call(window, url, name, specs); } } catch (_) { }
        }
        if (popupPending) { PG('window.open: popupPending, fakeWindow'); return fakeWindow; }
        const targetUrl = url || 'about:blank';
        if (getNavAction(targetUrl) === 'BLOCK') {
            PG('window.open: navBlock BLOCK, fakeWindow. trustedClick=', trustedClick, 'trustedUrl=', trustedUrl);
            if (trustedClick && !isReplaying) { popupBlocked = true; replayAfterBlock(); }
            return fakeWindow;
        }

        try {
            const proto = new URL(targetUrl).protocol;
            const SAFE = ['tel:', 'mailto:', 'callto:', 'sms:', 'ms-windows-store:', 'itms:', 'itms-apps:', 'market:'];
            if (SAFE.includes(proto)) { PG('window.open: safe scheme, pass-through'); return originalOpen.call(window, url, name, specs); }
        } catch (_) { }

        if (targetUrl !== 'about:blank') {
            try {
                const dest = new URL(targetUrl, location.href);
                if (dest.origin === getTopOrigin()) {
                    PG('window.open: same-origin target, trustedClick=', trustedClick, 'name=', name);
                    const isStd = !name || ['_blank', '_self', '_top', '_parent', '_new'].includes(name);
                    if (trustedClick && isStd) {
                        const isForcedNew = (name === '_blank' || name === '_new') && trustedTarget !== '_blank' && trustedTarget !== '_new';
                        if (isForcedNew) { PG('window.open: same-origin forcedNew, replayAfterBlock'); popupBlocked = true; if (!isReplaying) replayAfterBlock(); return fakeWindow; }
                        PG('window.open: same-origin trustedClick isStd, ALLOW');
                        popupOpened = true;
                        return originalOpen.call(window, url, name, specs);
                    }
                    if (trustedClick) { PG('window.open: same-origin trustedClick non-std, replayAfterBlock'); popupBlocked = true; if (!isReplaying) replayAfterBlock(); return fakeWindow; }
                    if (getAction() === 'BLOCK') { PG('window.open: same-origin BLOCK, fakeWindow'); return fakeWindow; }
                    PG('window.open: same-origin ASK/untrusted, askPopup');
                    askPopup(targetUrl, name, specs);
                    return fakeWindow;
                }
            } catch (_) { }
        }

        if (!isReady()) {
            PG('window.open: NOT READY, proxy pending');
            let _win = null;
            const proxy = { closed: false, name: name || '', close() { _win?.close(); }, focus() { _win?.focus(); }, blur() { _win?.blur(); }, postMessage(...a) { _win?.postMessage(...a); }, location: { href: 'about:blank', assign() { }, replace() { } } };
            _pendingOpens.push({ url: targetUrl, name, specs, resolve(w) { _win = w; if (w && w !== fakeWindow) proxy.closed = false; } });
            return proxy;
        }

        const action = getAction();
        PG('window.open: cross-origin action=', action, 'trustedClick=', trustedClick, 'trustedUrl=', trustedUrl);

        if (trustedClick && action === 'ASK' && trustedUrl === null) {
            try { if (!trustedIframeOrigin || new URL(targetUrl).origin === trustedIframeOrigin) { PG('window.open: iframe origin match, ALLOW'); return originalOpen.call(window, url, name, specs); } } catch (_) { }
        }

        if (trustedClick && action === 'ASK' && trustedUrl) {
            try {
                const dest = new URL(targetUrl, location.href);
                const trusted = new URL(trustedUrl);
                if (dest.origin === trusted.origin && dest.pathname === trusted.pathname) {
                    PG('window.open: origin+path match trustedUrl, ALLOW');
                    popupOpened = true;
                    return originalOpen.call(window, url, name, specs);
                }
            } catch (_) { }
        }

        if (action === 'BLOCK') {
            PG('window.open: BLOCK', trustedClick ? '(trustedClick→replayAfterBlock)' : '');
            if (trustedClick) { popupBlocked = true; if (!isReplaying) replayAfterBlock(); }
            return fakeWindow;
        }
        if (action === 'ASK') {
            PG('window.open: ASK → askPopup');
            popupBlocked = true;
            askPopup(targetUrl, name, specs);
            if (trustedClick && !isReplaying) replayAfterBlock();
            return fakeWindow;
        }

        PG('window.open: ALLOW (pass-through)');
        return originalOpen.call(window, url, name, specs);
    };

    try {
        Object.defineProperty(window, 'open', { get: () => interceptedOpen, set: () => { }, configurable: true });
    } catch (_) { window.open = interceptedOpen; }

    // ── Navigation intercept ──────────────────────────────────────────────────

    let bypassNext = false;

    const interceptNav = (url, doNav) => {
        PG('interceptNav:', url,
           '| ready=', _ready, 'action=', cachedAction,
           'popupPending=', popupPending, 'popupOpened=', popupOpened,
           'trustedClick=', trustedClick, 'trustedUrlForNav=', trustedUrlForNav,
           'bypassNext=', bypassNext);

        try { const p = new URL(url).protocol; const SAFE = ['tel:', 'mailto:', 'callto:', 'sms:', 'ms-windows-store:', 'itms:', 'itms-apps:', 'market:']; if (SAFE.includes(p)) { PG('interceptNav: safe scheme, pass'); doNav(url); return; } } catch (_) { }

        if (popupPending) {
            PG('interceptNav: popupPending, queuing if same-origin');
            try { if (new URL(url, location.href).origin === location.origin) pendingNav = { fn: doNav, url }; }
            catch (_) { }
            return;
        }

        if (popupOpened) {
            PG('interceptNav: popupOpened (ad hijack guard)');
            if (waitReady(() => interceptNav(url, doNav))) return;
            const a = getAction();
            PG('interceptNav: guard3 action=', a);
            if (a === 'ALLOW') { doNav(url); return; }
            if (a === 'BLOCK') return;
            askPopup(url, '_self', '', true);
            return;
        }

        try {
            if (new URL(url, location.href).origin === location.origin) { PG('interceptNav: same-origin, ALLOW'); doNav(url); return; }
        } catch (_) { doNav(url); return; }

        const navAct = getNavAction(url);
        PG('interceptNav: getNavAction=', navAct, 'for', url);
        if (navAct === 'BLOCK') {
            PG('interceptNav: navBlock BLOCK. trustedClick=', trustedClick, 'trustedUrlForNav=', trustedUrlForNav);
            if (trustedClick && trustedUrlForNav) {
                const snapNav = trustedUrlForNav;
                PG('interceptNav: navBlock → replaying trusted URL in 50ms:', snapNav);
                setTimeout(() => {
                    PG('interceptNav navBlock setTimeout: popupPending=', popupPending, 'navigating to', snapNav);
                    if (popupPending) return;
                    bypassNext = true;
                    try { origAssign ? origAssign.call(location, snapNav) : (location.href = snapNav); }
                    catch (_) { location.href = snapNav; }
                }, 50);
            } else {
                PG('interceptNav: navBlock, no trustedUrlForNav → silent block');
            }
            return;
        }

        if (trustedUrlForNav) {
            try {
                const destOrigin = new URL(url, location.href).origin;
                const navOrigin = new URL(trustedUrlForNav).origin;
                PG('interceptNav guard1: destOrigin=', destOrigin, 'navOrigin=', navOrigin);
                if (destOrigin !== navOrigin) {
                    PG('interceptNav guard1: DIFFERENT ORIGIN → waitReady');
                    if (waitReady(() => interceptNav(url, doNav))) return;
                    const a = getAction();
                    PG('interceptNav guard1 (ready): action=', a);
                    if (a === 'ALLOW') { doNav(url); return; }
                    if (a === 'BLOCK') return;
                    askPopup(url, '_self', '', true);
                    return;
                } else {
                    PG('interceptNav guard1: same origin as trustedUrlForNav, skip guard');
                }
            } catch (_) { }
        }

        if (trustedClick && trustedUrlForNav === null) {
            try {
                if (!trustedIframeOrigin || new URL(url, location.href).origin !== trustedIframeOrigin) {
                    PG('interceptNav guard2 (iframe): → waitReady');
                    if (waitReady(() => interceptNav(url, doNav))) return;
                    const a = getAction();
                    PG('interceptNav guard2 (ready): action=', a);
                    if (a === 'ALLOW') { doNav(url); return; }
                    if (a === 'BLOCK') return;
                    askPopup(url, '_self', '', true);
                    return;
                }
            } catch (_) { }
        }

        if (!isSiteBlocked()) { PG('interceptNav: site not blocked, ALLOW'); doNav(url); return; }

        if (trustedUrlForNav) {
            try { if (new URL(url, location.href).href === trustedUrlForNav) { PG('interceptNav: exact match trustedUrlForNav, ALLOW'); doNav(url); return; } } catch (_) { }
        }

        PG('interceptNav: fallthrough waitReady');
        if (waitReady(() => interceptNav(url, doNav))) return;
        const a = getAction();
        PG('interceptNav fallthrough (ready): action=', a);
        if (a === 'ALLOW') { doNav(url); return; }
        if (a === 'BLOCK') return;
        askPopup(url, '_self', '', true);
    };

    const locProto = Location.prototype;
    const origAssign = locProto.assign;
    const origReplace = locProto.replace;

    try { Object.defineProperty(locProto, 'assign', { value: function (url) { interceptNav(String(url), u => origAssign.call(this, u)); }, writable: true, configurable: true }); } catch (_) { }
    try { Object.defineProperty(locProto, 'replace', { value: function (url) { interceptNav(String(url), u => origReplace.call(this, u)); }, writable: true, configurable: true }); } catch (_) { }
    try {
        const d = Object.getOwnPropertyDescriptor(locProto, 'href');
        if (d?.set) {
            const origSet = d.set;
            Object.defineProperty(locProto, 'href', { get: d.get, set(v) { interceptNav(String(v), u => origSet.call(this, u)); }, configurable: true, enumerable: d.enumerable });
        }
    } catch (_) { }

    try {
        Object.defineProperty(document, 'location', {
            get() { return location; },
            set(v) { interceptNav(String(v), u => { location.href = u; }); },
            configurable: true, enumerable: true
        });
    } catch (_) { }

    // ── Navigation API (Chrome 102+) ──────────────────────────────────────────

    if (window.navigation) {
        window.navigation.addEventListener('navigate', e => {
            if (e.hashChange || e.downloadRequest) return;
            PG('Navigation API navigate:', e.destination.url,
               '| bypassNext=', bypassNext, 'popupPending=', popupPending,
               'popupOpened=', popupOpened, 'popupBlocked=', popupBlocked,
               'trustedUrlForNav=', trustedUrlForNav, 'trustedClick=', trustedClick,
               'userInitiated=', e.userInitiated);

            if (bypassNext) { PG('Navigation API: bypassNext, skip'); bypassNext = false; return; }

            if (popupPending) {
                PG('Navigation API: popupPending, prevent+maybe pendingNav');
                try {
                    const dest = new URL(e.destination.url);
                    e.preventDefault();
                    if (dest.origin === location.origin) {
                        pendingNav = { fn: u => { bypassNext = true; origAssign ? origAssign.call(location, u) : (location.href = u); }, url: e.destination.url };
                    }
                } catch (_) { }
                return;
            }

            if (popupOpened || popupBlocked) {
                const a = getAction();
                PG('Navigation API: popupOpened/Blocked, action=', a);
                if (a === 'ALLOW') return;
                const dest = new URL(e.destination.url);
                if (dest.origin === location.origin) {
                    if (popupOpened) e.preventDefault();
                    return;
                }
                e.preventDefault();
                if (a === 'ASK') askPopup(e.destination.url, '_self', '', true);
                return;
            }

            try { if (new URL(e.destination.url).origin === location.origin) { PG('Navigation API: same-origin, allow'); return; } } catch (_) { return; }

            const navAct = getNavAction(e.destination.url);
            PG('Navigation API: getNavAction=', navAct);
            if (navAct === 'BLOCK') { PG('Navigation API: navBlock BLOCK, prevent'); e.preventDefault(); return; }

            if (trustedUrlForNav) {
                try {
                    if (new URL(e.destination.url).origin !== new URL(trustedUrlForNav).origin) {
                        PG('Navigation API guard1: different origin trustedUrlForNav=', trustedUrlForNav, '→ waitReady');
                        if (waitReady(() => { bypassNext = true; origAssign ? origAssign.call(location, e.destination.url) : (location.href = e.destination.url); })) { e.preventDefault(); return; }
                        const a = getAction();
                        PG('Navigation API guard1 (ready): action=', a);
                        if (a === 'ALLOW') return;
                        e.preventDefault();
                        if (a === 'ASK') askPopup(e.destination.url, '_self', '', true);
                        return;
                    }
                } catch (_) { }
            }

            if (trustedClick && trustedUrlForNav === null) {
                try {
                    if (!trustedIframeOrigin || new URL(e.destination.url).origin !== trustedIframeOrigin) {
                        PG('Navigation API guard2 (iframe): → waitReady');
                        if (waitReady(() => { bypassNext = true; origAssign ? origAssign.call(location, e.destination.url) : (location.href = e.destination.url); })) { e.preventDefault(); return; }
                        const a = getAction();
                        PG('Navigation API guard2 (ready): action=', a);
                        if (a === 'ALLOW') return;
                        e.preventDefault();
                        if (a === 'ASK') askPopup(e.destination.url, '_self', '', true);
                        return;
                    }
                } catch (_) { }
            }

            if (!isSiteBlocked()) { PG('Navigation API: site not blocked, allow'); return; }
            if (e.userInitiated) { PG('Navigation API: userInitiated, allow'); return; }

            PG('Navigation API: fallthrough waitReady');
            if (waitReady(() => { bypassNext = true; origAssign ? origAssign.call(location, e.destination.url) : (location.href = e.destination.url); })) { e.preventDefault(); return; }
            const a = getAction();
            PG('Navigation API fallthrough (ready): action=', a);
            if (a === 'BLOCK') { e.preventDefault(); return; }
            if (a === 'ASK') { e.preventDefault(); askPopup(e.destination.url, '_self', '', true); }
        });
    }

    // ── PG_DO_NAV token ───────────────────────────────────────────────────────

    const navToken = Math.random().toString(36).slice(2);
    document.documentElement?.setAttribute('data-pg-nav-token', navToken);
    window.addEventListener('message', e => {
        if (e.source !== window || !e.data?.action) return;
        if (e.data.action === 'PG_DO_NAV') {
            PG('PG_DO_NAV:', e.data.url);
            bypassNext = true;
            origAssign ? origAssign.call(location, e.data.url) : (location.href = e.data.url);
        }
    });

    // ── Event helpers ─────────────────────────────────────────────────────────

    const origPD = Event.prototype.preventDefault;
    const origSP = Event.prototype.stopPropagation;
    const origSIP = Event.prototype.stopImmediatePropagation;

    const stopEvent = e => {
        e._pgStopped = true;
        try { origPD.call(e); } catch (_) { }
        try { origSP.call(e); } catch (_) { }
        try { origSIP.call(e); } catch (_) { }
    };

    const isNewTab = t => {
        if (t === '_blank' || t === '_new') return true;
        if (!t || t === '_self' || t === '_top' || t === '_parent') return false;
        try { if (window.frames[t]) return false; } catch (_) { }
        try { if (window.parent.frames[t]) return false; } catch (_) { }
        return true;
    };

    const effectiveTarget = el => {
        let t = (el.target || '').toLowerCase();
        if (!t) { const b = document.querySelector('base[target]'); if (b) t = b.target.toLowerCase(); }
        return t;
    };

    const crossOriginAction = url => {
        const top = getTopOrigin();
        if (!top) return null;
        try { if (new URL(url, location.href).origin === top) return null; } catch (_) { return null; }
        return getAction();
    };

    // ── Link / click handler ──────────────────────────────────────────────────

    const handleLink = e => {
        if (popupPending) {
            if (!e.isTrusted) { stopEvent(e); return; }
            if (e.type === 'click') {
                const a = e.composedPath().find(el => el.tagName === 'A');
                if (a?.href) {
                    try { if (getTopOrigin() && new URL(a.href, location.href).origin !== getTopOrigin()) stopEvent(e); } catch (_) { }
                }
            }
            return;
        }

        if (e.defaultPrevented && e.type !== 'mousedown') return;

        if (!e.isTrusted) {
            if ((e.metaKey || e.ctrlKey) && e.type === 'click') { stopEvent(e); return; }
            if (e.button !== 0 && e.type !== 'mousedown') { stopEvent(e); return; }
            const a = e.composedPath().find(el => el.tagName === 'A');
            if (a?.href) {
                PG('handleLink: synthetic click on <a> href=', a.href, 'ready=', _ready);
                if (!isReady()) {
                    stopEvent(e);
                    const type = e.type;
                    _pendingFns.push(() => {
                        PG('handleLink pendingFn: replaying', type, 'on <a>', a.href);
                        if (a.isConnected) {
                            if (type === 'click') a.click();
                            else if (type === 'auxclick') a.dispatchEvent(new MouseEvent('auxclick', { button: 1, bubbles: true }));
                        }
                    });
                    return;
                }
                if (getNavAction(a.href) === 'BLOCK') { PG('handleLink: synthetic navBlock BLOCK, stop'); stopEvent(e); return; }
                const act = crossOriginAction(a.href);
                PG('handleLink: synthetic crossOriginAction=', act);
                if (act === 'BLOCK') { stopEvent(e); return; }
                if (act === 'ASK') { const hrefSnapshot = a.href; stopEvent(e); askPopup(hrefSnapshot, a.target || '_self', '', true); return; }
            }
            return;
        }

        if (e.type === 'auxclick' && e.button !== 1) return;
        const a = e.composedPath().find(el => el.tagName === 'A');
        if (!a?.href || a.hasAttribute('download')) return;
        if (getNavAction(a.href) === 'BLOCK') { PG('handleLink: trusted navBlock BLOCK, stop'); stopEvent(e); return; }

        const forceNew = e.type === 'auxclick';
        if (!forceNew && !isNewTab(effectiveTarget(a))) {
            if (e.type === 'click' && popupBlocked) {
                PG('handleLink: trusted click, popupBlocked, checking same link');
                try { if (trustedUrl && new URL(a.href, location.href).href === trustedUrl) { PG('handleLink: same trustedUrl, allow'); return; } } catch (_) { }
                const act = crossOriginAction(a.href);
                PG('handleLink: crossOriginAction after popupBlocked=', act);
                if (act === 'BLOCK') { stopEvent(e); return; }
                if (act === 'ASK') { const hrefSnapshot = a.href; stopEvent(e); askPopup(hrefSnapshot, '_self', '', true); return; }
            }
            return;
        }

        let act = crossOriginAction(a.href);
        PG('handleLink: _blank/auxclick, crossOriginAction=', act, 'trustedUrl=', trustedUrl);
        if (act === null) return;

        if (e.isTrusted) {
            try {
                if (trustedUrl && new URL(a.href, location.href).href === trustedUrl) { PG('handleLink: legit _blank click, allow'); return; }
            } catch (_) { }
            if (trustedUrl) {
                PG('handleLink: trustedUrl mismatch, stopping + redirecting to trustedUrl');
                stopEvent(e);
                try {
                    if (new URL(trustedUrl).origin === location.origin) { origAssign.call(location, trustedUrl); return; }
                } catch (_) { }
                if (waitReady(() => { if (getAction() !== 'BLOCK') askPopup(trustedUrl, a.target || '_blank', '', true); })) return;
                if (getAction() !== 'BLOCK') askPopup(trustedUrl, a.target || '_blank', '', true);
                return;
            }
            return;
        }

        if (act === 'BLOCK') { stopEvent(e); return; }
        if (act === 'ASK') { const hrefSnapshot = a.href; const targetSnapshot = a.target; stopEvent(e); askPopup(hrefSnapshot, targetSnapshot || '_blank', '', true); }
    };

    // ── Form submit handler ───────────────────────────────────────────────────

    const handleSubmit = e => {
        if (popupPending) { stopEvent(e); return; }
        if (e.defaultPrevented) return;
        const form = e.target;
        if (!form?.action || form.tagName !== 'FORM') return;
        if (getNavAction(form.action) === 'BLOCK') { stopEvent(e); return; }
        if (!e.isTrusted) {
            if (!isReady()) { stopEvent(e); _pendingFns.push(() => { if (form.isConnected) form.submit(); }); return; }
            const act = crossOriginAction(form.action);
            if (act === 'BLOCK') { stopEvent(e); return; }
            if (act === 'ASK') { stopEvent(e); askPopup(form.action, form.target || '_self', '', true); return; }
            return;
        }
        if (isNewTab(effectiveTarget(form))) {
            if (!isSiteBlocked()) return;
            const act = crossOriginAction(form.action);
            if (act === 'BLOCK') { stopEvent(e); return; }
            if (act === 'ASK' && popupBlocked) { stopEvent(e); askPopup(form.action, form.target || '_blank', ''); }
        }
    };

    const attachListeners = doc => {
        if (!doc) return;
        doc.addEventListener('mousedown', handleLink, true);
        doc.addEventListener('click', handleLink, true);
        doc.addEventListener('auxclick', handleLink, true);
        doc.addEventListener('submit', handleSubmit, true);
    };
    attachListeners(document);

    // ── dispatchEvent / .click() hooks ────────────────────────────────────────

    const hookDispatch = proto => {
        if (!proto?.dispatchEvent || proto.dispatchEvent._pg) return;
        const orig = proto.dispatchEvent;
        proto.dispatchEvent = function (...args) {
            const e = args[0];
            if (e && (e.type === 'click' || e.type === 'auxclick') && !e.isTrusted) {
                if (popupPending) { return false; }
                let tgt = this;
                if (tgt.tagName !== 'A' && e.composedPath) tgt = e.composedPath().find(el => el.tagName === 'A') || this;
                if (tgt.tagName === 'A' && tgt.href && !tgt.hasAttribute('download')) {
                    if (getNavAction(tgt.href) === 'BLOCK') return false;
                    const act = crossOriginAction(tgt.href);
                    if (act === 'BLOCK') return false;
                    if (act === 'ASK') { const url = tgt.href; const tgt2 = tgt.target; askPopup(url, tgt2 || '_self', ''); return false; }
                }
            }
            return orig.apply(this, args);
        };
        proto.dispatchEvent._pg = true;
    };

    const hookClick = proto => {
        if (!proto?.click || proto.click._pg) return;
        const orig = proto.click;
        proto.click = function () {
            if (popupPending) { return; }
            if (this.tagName === 'A' && this.href && !this.hasAttribute('download')) {
                if (getNavAction(this.href) === 'BLOCK') return;
                const act = crossOriginAction(this.href);
                if (act === 'BLOCK') return;
                if (act === 'ASK') { const url = this.href; const target = this.target; askPopup(url, target || '_self', ''); return; }
            }
            return orig.call(this);
        };
        proto.click._pg = true;
    };

    hookDispatch(EventTarget.prototype);
    hookDispatch(Node.prototype);
    hookDispatch(HTMLElement.prototype);
    if (window.HTMLAnchorElement) hookDispatch(HTMLAnchorElement.prototype);
    hookClick(HTMLElement.prototype);
    if (window.HTMLAnchorElement) hookClick(HTMLAnchorElement.prototype);

    // ── Form.submit / requestSubmit hooks ────────────────────────────────────

    const origSubmit = HTMLFormElement.prototype.submit;
    HTMLFormElement.prototype.submit = function () {
        if (popupPending) { return; }
        if (this.action) {
            if (getNavAction(this.action) === 'BLOCK') return;
            const act = crossOriginAction(this.action);
            if (act === 'BLOCK') return;
            if (act === 'ASK') { askPopup(this.action, this.target || '_self', ''); return; }
        }
        if (this.isConnected) origSubmit.call(this);
    };

    if (HTMLFormElement.prototype.requestSubmit) {
        const origRS = HTMLFormElement.prototype.requestSubmit;
        HTMLFormElement.prototype.requestSubmit = function (s) {
            if (popupPending) { return; }
            if (this.action) {
                if (getNavAction(this.action) === 'BLOCK') return;
                const act = crossOriginAction(this.action);
                if (act === 'BLOCK') return;
                if (act === 'ASK') { askPopup(this.action, this.target || '_self', ''); return; }
            }
            if (this.isConnected) origRS.call(this, s);
        };
    }

    // ── Iframe / child window protection ──────────────────────────────────────

    const hookProp = (proto, prop, extract) => {
        if (!proto) return;
        const desc = Object.getOwnPropertyDescriptor(proto, prop);
        if (!desc?.get) return;
        const origGet = desc.get;
        Object.defineProperty(proto, prop, {
            get() { const v = origGet.call(this); try { protectWin(extract(v)); } catch (_) { } return v; },
            configurable: true, enumerable: true
        });
    };

    const protected_ = new WeakSet();
    protected_.add(window);

    const protectWin = w => {
        if (!w || protected_.has(w)) return;
        try { w.Object; } catch (_) { return; }
        protected_.add(w);

        try {
            const wOpen = w.open;
            Object.defineProperty(w, 'open', {
                get: () => function (url, name, specs) {
                    if (name && typeof name === 'string') {
                        try { if (w.frames[name]) return wOpen.call(w, url, name, specs); } catch (_) { }
                        try { if (w.parent.frames[name]) return wOpen.call(w, url, name, specs); } catch (_) { }
                        try { if (w.top.frames[name]) return wOpen.call(w, url, name, specs); } catch (_) { }
                    }
                    if (popupPending) { return fakeWindow; }
                    const targetUrl = url || 'about:blank';
                    if (getNavAction(targetUrl) === 'BLOCK') {
                        PG('protectWin window.open: navBlock BLOCK. trustedClick=', trustedClick);
                        if (trustedClick && !isReplaying) { popupBlocked = true; replayAfterBlock(); }
                        return fakeWindow;
                    }
                    try { const proto = new URL(targetUrl).protocol; const SAFE = ['tel:', 'mailto:', 'callto:', 'sms:', 'ms-windows-store:', 'itms:', 'itms-apps:', 'market:']; if (SAFE.includes(proto)) return wOpen.call(w, url, name, specs); } catch (_) { }
                    if (targetUrl !== 'about:blank') {
                        try {
                            const dest = new URL(targetUrl, location.href);
                            if (dest.origin === getTopOrigin()) {
                                const isStd = !name || ['_blank', '_self', '_top', '_parent', '_new'].includes(name);
                                if (trustedClick && isStd) { popupOpened = true; return wOpen.call(w, url, name, specs); }
                                if (trustedClick) { popupBlocked = true; if (!isReplaying) replayAfterBlock(); return fakeWindow; }
                                if (getAction() === 'BLOCK') return fakeWindow;
                                askPopup(targetUrl, name, specs);
                                return fakeWindow;
                            }
                        } catch (_) { }
                    }
                    const action = getAction();
                    if (trustedClick && action === 'ASK' && trustedUrl) {
                        try {
                            const dest = new URL(targetUrl, location.href);
                            const trusted = new URL(trustedUrl);
                            if (dest.origin === trusted.origin && dest.pathname === trusted.pathname) { popupOpened = true; return wOpen.call(w, url, name, specs); }
                        } catch (_) { }
                    }
                    if (action === 'BLOCK') { if (trustedClick) { popupBlocked = true; if (!isReplaying) replayAfterBlock(); } return fakeWindow; }
                    if (action === 'ASK') { popupBlocked = true; askPopup(targetUrl, name, specs); return fakeWindow; }
                    return wOpen.call(w, url, name, specs);
                },
                set: () => { }, configurable: true
            });
        } catch (_) { }

        try {
            const d = w.document;
            attachListeners(d);
            if (w.MutationObserver) {
                let curEl = d.documentElement;
                new w.MutationObserver(() => {
                    if (d.documentElement && curEl !== d.documentElement) { curEl = d.documentElement; attachListeners(d); }
                }).observe(d, { childList: true });
            }
        } catch (_) { }

        try {
            const cd = w.document;
            Object.defineProperty(cd, 'location', {
                get() { return cd.defaultView.location; },
                set(v) { interceptNav(String(v), u => { cd.defaultView.location.href = u; }); },
                configurable: true, enumerable: true
            });
        } catch (_) { }

        try {
            hookClick(w.HTMLElement?.prototype);
            hookClick(w.HTMLAnchorElement?.prototype);
            hookDispatch(w.EventTarget?.prototype);
            hookDispatch(w.Node?.prototype);
            hookDispatch(w.HTMLElement?.prototype);
            hookDispatch(w.HTMLAnchorElement?.prototype);
        } catch (_) { }

        try {
            if (w.HTMLIFrameElement) { hookProp(w.HTMLIFrameElement.prototype, 'contentWindow', x => x); hookProp(w.HTMLIFrameElement.prototype, 'contentDocument', x => x?.defaultView); }
            if (w.HTMLFrameElement) { hookProp(w.HTMLFrameElement.prototype, 'contentWindow', x => x); hookProp(w.HTMLFrameElement.prototype, 'contentDocument', x => x?.defaultView); }
        } catch (_) { }
    };

    hookProp(HTMLIFrameElement.prototype, 'contentWindow', w => w);
    hookProp(HTMLIFrameElement.prototype, 'contentDocument', d => d?.defaultView);
    if (window.HTMLFrameElement) {
        hookProp(HTMLFrameElement.prototype, 'contentWindow', w => w);
        hookProp(HTMLFrameElement.prototype, 'contentDocument', d => d?.defaultView);
    }

    const protectIframe = el => {
        if (el.tagName !== 'IFRAME' && el.tagName !== 'FRAME') return;
        try { protectWin(el.contentWindow); } catch (_) { }
        el.addEventListener('load', () => { try { protectWin(el.contentWindow); } catch (_) { } });
    };

    document.querySelectorAll('iframe,frame').forEach(protectIframe);

    let curDocEl = document.documentElement;
    new MutationObserver(mutations => {
        if (document.documentElement && curDocEl !== document.documentElement) {
            curDocEl = document.documentElement;
            attachListeners(document);
            if (!_ready) {
                try { _readyObs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-pg-popup-action'] }); } catch (_) { }
            }
        }
        for (const m of mutations) {
            for (const node of m.addedNodes) {
                if (node.nodeType !== 1) continue;
                if (node.tagName === 'IFRAME' || node.tagName === 'FRAME') { protectIframe(node); continue; }
                if (node.getElementsByTagName) {
                    for (const f of node.getElementsByTagName('iframe')) protectIframe(f);
                    for (const f of node.getElementsByTagName('frame')) protectIframe(f);
                }
            }
        }
    }).observe(document, { childList: true, subtree: true });

    PG('inject.js loaded on', location.href, '| _ready=', _ready);
})();
