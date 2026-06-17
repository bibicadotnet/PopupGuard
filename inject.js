(function () {
    'use strict';

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
            cachedAction = d.getAttribute('data-pg-popup-action');
            _ready = true;
        }
        if (d.hasAttribute('data-pg-nbl')) cachedNbl = d.getAttribute('data-pg-nbl');
    };

    const getAction = () => { updateCache(); return cachedAction; };
    const isReady = () => { updateCache(); return _ready; };
    const isSiteBlocked = () => getAction() === 'BLOCK';

    const _pendingOpens = [];
    const _pendingFns = [];

    const _readyObs = new MutationObserver(() => {
        if (!isReady()) return;
        _readyObs.disconnect();
        for (const item of _pendingOpens.splice(0)) item.resolve(interceptedOpen(item.url, item.name, item.specs));
        for (const fn of _pendingFns.splice(0)) fn();
    });
    if (document.documentElement) {
        _readyObs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-pg-popup-action'] });
    }

    const waitReady = fn => { if (isReady()) { fn(); return false; } _pendingFns.push(fn); return true; };

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
        } else if (iframe) {
            trustedTarget = '_self';
            try { trustedIframeOrigin = new URL(iframe.src).origin; } catch (_) { trustedIframeOrigin = null; }
            trustedTimer = setTimeout(() => { trustedClick = false; trustedIframeOrigin = null; }, 1000);
        } else {
            trustedIframeOrigin = null;
        }
    }, true);

    let clickCleanup = null;
    let replayTimer = null;

    document.addEventListener('click', e => {
        if (!e.isTrusted || isReplaying) return;
        if (!popupBlocked) clearTimeout(replayTimer);
        clearTimeout(clickCleanup);
        clickCleanup = setTimeout(() => { popupOpened = false; popupBlocked = false; }, 500);
        if (trustedClick) {
            clearTimeout(trustedTimer);
            setTimeout(() => {
                trustedClick = false; trustedUrl = null; trustedTarget = '_self';
            }, 0);
        }
    }, true);

    // Bubble-phase: if popupPending was set during this click cycle (e.g. ad script
    // called window.open → askPopup in bubble), stop the click entirely so
    // SPA frameworks (Turbo, etc.) cannot intercept it for AJAX navigation.
    window.addEventListener('click', e => {
        if (popupPending && e.isTrusted) {
            // Do not block clicks inside our own popup
            if (e.composedPath().some(el => el.id === 'pg-container')) return;
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
        HTMLMediaElement.prototype.play = () => Promise.resolve();
        document.querySelectorAll('video,audio').forEach(m => { if (!m.paused) m.pause(); });
        const s = document.createElement('style');
        s.id = 'pg-freeze';
        const nonce = document.querySelector('[nonce]')?.nonce;
        if (nonce) s.nonce = nonce;
        s.textContent = '*,*::before,*::after{animation-play-state:paused!important;transition:none!important}';
        document.head?.appendChild(s);

        // Prevent SPA frameworks (Turbo, etc.) from changing URL while dialog is up
        if (!origPushState) {
            origPushState = history.pushState.bind(history);
            origReplaceState = history.replaceState.bind(history);
            history.pushState = function (...a) {
                if (popupPending) { return; }
                return origPushState(...a);
            };
            history.replaceState = function (...a) {
                if (popupPending) { return; }
                return origReplaceState(...a);
            };
        }

        // Guard dialog from SPA body swaps: re-append #pg-container if removed
        if (!dialogGuard) {
            dialogGuard = new MutationObserver(mutations => {
                if (!popupPending) return;
                setTimeout(() => {
                    if (!popupPending) return;
                    const c = document.getElementById('pg-container');
                    if (c) { savedContainer = c; }
                    else if (savedContainer && document.body && !savedContainer.isConnected) {
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
        popupPending = true;
        freeze();
        let resolved = url;
        try { resolved = new URL(url, location.href).href; } catch (_) { }
        window.postMessage({ action: 'PG_ASK', url: resolved, name, specs, source: location.hostname.toLowerCase(), isNav, token: navToken }, '*');
        clearTimeout(safetyTimer);
        safetyTimer = setTimeout(() => {
            if (popupPending && !document.getElementById('pg-container')) {
                popupPending = false; unfreeze(); pendingNav = null;
            }
        }, 800);
    };

    window.addEventListener('message', e => {
        if (e.source !== window || !e.data?.action) return;
        if (e.data.action === 'PG_DIALOG_CLOSED') {
            popupPending = false; unfreeze();
            if (pendingNav) { const { fn, url } = pendingNav; pendingNav = null; fn(url); }
        }
        if (e.data.action === 'PG_DO_OPEN') {
            try { originalOpen.call(window, e.data.url, e.data.name, e.data.specs); } catch (_) { }
        }
    });

    // ── Replay click after block ──────────────────────────────────────────────

    const replayAfterBlock = () => {
        if (popupOpened || !lastPos || isReplaying) return;
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
        if (!targetUrl) return;

        clearTimeout(replayTimer);
        replayTimer = setTimeout(() => {
            if (popupPending) {
                pendingNav = { fn: u => { bypassNext = true; origAssign ? origAssign.call(location, u) : (location.href = u); }, url: targetUrl };
                return;
            }
            bypassNext = true;
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
        if (name && typeof name === 'string') {
            try { if (window.frames[name]) return originalOpen.call(window, url, name, specs); } catch (_) { }
        }
        if (popupPending) { return fakeWindow; }
        const targetUrl = url || 'about:blank';
        if (getNavAction(targetUrl) === 'BLOCK') {
            // navBlock: block the ad popup but replay navigation to what user intended
            if (trustedClick && !isReplaying) { popupBlocked = true; replayAfterBlock(); }
            return fakeWindow;
        }

        // Safe non-http(s) schemes (tel:, mailto:, ms-windows-store:, etc.) — pass through directly.
        // Dangerous schemes (javascript:, data:, blob:) are NOT passed through — fall into normal intercept.
        try {
            const proto = new URL(targetUrl).protocol;
            const SAFE = ['tel:', 'mailto:', 'callto:', 'sms:', 'ms-windows-store:', 'itms:', 'itms-apps:', 'market:'];
            if (SAFE.includes(proto)) return originalOpen.call(window, url, name, specs);
        } catch (_) { }
        if (targetUrl !== 'about:blank') {
            try {
                const dest = new URL(targetUrl, location.href);
                if (dest.origin === getTopOrigin()) {
                    const isStd = !name || ['_blank', '_self', '_top', '_parent', '_new'].includes(name);
                    if (trustedClick && isStd) {
                        const isForcedNew = (name === '_blank' || name === '_new') && trustedTarget !== '_blank' && trustedTarget !== '_new';
                        if (isForcedNew) { popupBlocked = true; if (!isReplaying) replayAfterBlock(); return fakeWindow; }
                        popupOpened = true;
                        return originalOpen.call(window, url, name, specs);
                    }
                    if (trustedClick) { popupBlocked = true; if (!isReplaying) replayAfterBlock(); return fakeWindow; }
                    if (getAction() === 'BLOCK') return fakeWindow;
                    askPopup(targetUrl, name, specs);
                    return fakeWindow;
                }
            } catch (_) { }
        }

        if (!isReady()) {
            let _win = null;
            const proxy = { closed: false, name: name || '', close() { _win?.close(); }, focus() { _win?.focus(); }, blur() { _win?.blur(); }, postMessage(...a) { _win?.postMessage(...a); }, location: { href: 'about:blank', assign() { }, replace() { } } };
            _pendingOpens.push({ url: targetUrl, name, specs, resolve(w) { _win = w; if (w && w !== fakeWindow) proxy.closed = false; } });
            return proxy;
        }

        const action = getAction();

        // Trusted click on iframe: allow if origin matches
        if (trustedClick && action === 'ASK' && trustedUrl === null) {
            try { if (!trustedIframeOrigin || new URL(targetUrl).origin === trustedIframeOrigin) return originalOpen.call(window, url, name, specs); } catch (_) { }
        }

        // Trusted click on link: allow if destination matches what user intended
        if (trustedClick && action === 'ASK' && trustedUrl) {
            try {
                const dest = new URL(targetUrl, location.href);
                const trusted = new URL(trustedUrl);
                if (dest.origin === trusted.origin && dest.pathname === trusted.pathname) {
                    popupOpened = true;
                    return originalOpen.call(window, url, name, specs);
                }
            } catch (_) { }
        }

        if (action === 'BLOCK') {
            if (trustedClick) { popupBlocked = true; if (!isReplaying) replayAfterBlock(); }
            return fakeWindow;
        }
        if (action === 'ASK') {
            popupBlocked = true;
            askPopup(targetUrl, name, specs);
            if (trustedClick && !isReplaying) replayAfterBlock();
            return fakeWindow;
        }

        return originalOpen.call(window, url, name, specs);
    };

    try {
        Object.defineProperty(Window.prototype, 'open', { value: interceptedOpen, writable: false, configurable: false });
    } catch (_) { }
    try {
        Object.defineProperty(window, 'open', { get: () => interceptedOpen, set: () => { }, configurable: false });
    } catch (_) { window.open = interceptedOpen; }

    // ── Navigation intercept ──────────────────────────────────────────────────

    let bypassNext = false;

    const interceptNav = (url, doNav) => {
        // Safe non-http(s) schemes — pass through immediately
        try { const p = new URL(url).protocol; const SAFE = ['tel:', 'mailto:', 'callto:', 'sms:', 'ms-windows-store:', 'itms:', 'itms-apps:', 'market:']; if (SAFE.includes(p)) { doNav(url); return; } } catch (_) { }

        if (popupPending) {
            try { if (new URL(url, location.href).origin === location.origin) pendingNav = { fn: doNav, url }; }
            catch (_) { }
            return;
        }

        // Guard 3: popup was already opened this click → this navigation is ad hijacking the tab
        if (popupOpened) {
            if (waitReady(() => interceptNav(url, doNav))) return;
            const a = getAction();
            if (a === 'ALLOW') { doNav(url); return; }
            if (a === 'BLOCK') return;
            askPopup(url, '_self', '', true);
            return;
        }

        // Same-origin: always allow
        try {
            if (new URL(url, location.href).origin === location.origin) { doNav(url); return; }
        } catch (_) { doNav(url); return; }

        if (getNavAction(url) === 'BLOCK') {
            // Navigation blocked - retry with original trusted URL if available
            if (trustedClick && trustedUrlForNav) {
                setTimeout(() => {
                    if (popupPending) return;
                    bypassNext = true;
                    try { origAssign ? origAssign.call(location, trustedUrlForNav) : (location.href = trustedUrlForNav); }
                    catch (_) { location.href = trustedUrlForNav; }
                }, 50);
            }
            return;
        }

        // Guard 1: user clicked a link but navigation goes to different origin
        if (trustedUrlForNav) {
            try {
                if (new URL(url, location.href).origin !== new URL(trustedUrlForNav).origin) {
                    if (waitReady(() => interceptNav(url, doNav))) return;
                    const a = getAction();
                    if (a === 'ALLOW') { doNav(url); return; }
                    if (a === 'BLOCK') return;
                    askPopup(url, '_self', '', true);
                    return;
                }
            } catch (_) { }
        }

        // Guard 2: user clicked iframe but top frame navigates to different origin
        if (trustedClick && trustedUrlForNav === null) {
            try {
                if (!trustedIframeOrigin || new URL(url, location.href).origin !== trustedIframeOrigin) {
                    if (waitReady(() => interceptNav(url, doNav))) return;
                    const a = getAction();
                    if (a === 'ALLOW') { doNav(url); return; }
                    if (a === 'BLOCK') return;
                    askPopup(url, '_self', '', true);
                    return;
                }
            } catch (_) { }
        }

        if (!isSiteBlocked()) { doNav(url); return; }

        // Exact match: nav to the URL user originally clicked
        if (trustedUrlForNav) {
            try { if (new URL(url, location.href).href === trustedUrlForNav) { doNav(url); return; } } catch (_) { }
        }

        if (waitReady(() => interceptNav(url, doNav))) return;
        const a = getAction();
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
            if (bypassNext) { bypassNext = false; return; }

            if (popupPending) {
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

            try { if (new URL(e.destination.url).origin === location.origin) return; } catch (_) { return; }
            if (getNavAction(e.destination.url) === 'BLOCK') { e.preventDefault(); return; }

            if (trustedUrlForNav) {
                try {
                    if (new URL(e.destination.url).origin !== new URL(trustedUrlForNav).origin) {
                        if (waitReady(() => { bypassNext = true; origAssign ? origAssign.call(location, e.destination.url) : (location.href = e.destination.url); })) { e.preventDefault(); return; }
                        const a = getAction();
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
                        if (waitReady(() => { bypassNext = true; origAssign ? origAssign.call(location, e.destination.url) : (location.href = e.destination.url); })) { e.preventDefault(); return; }
                        const a = getAction();
                        if (a === 'ALLOW') return;
                        e.preventDefault();
                        if (a === 'ASK') askPopup(e.destination.url, '_self', '', true);
                        return;
                    }
                } catch (_) { }
            }

            if (!isSiteBlocked()) return;
            if (e.userInitiated) return;

            if (waitReady(() => { bypassNext = true; origAssign ? origAssign.call(location, e.destination.url) : (location.href = e.destination.url); })) { e.preventDefault(); return; }
            const a = getAction();
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
            if ((e.metaKey || e.ctrlKey) && e.type === 'click') {
                stopEvent(e);
                return;
            }
            if (e.button !== 0 && e.type !== 'mousedown') { stopEvent(e); return; }
            const a = e.composedPath().find(el => el.tagName === 'A');
            if (a?.href) {
                if (!isReady()) {
                    stopEvent(e);
                    const type = e.type;
                    _pendingFns.push(() => {
                        if (a.isConnected) {
                            if (type === 'click') a.click();
                            else if (type === 'auxclick') a.dispatchEvent(new MouseEvent('auxclick', { button: 1, bubbles: true }));
                        }
                    });
                    return;
                }
                if (getNavAction(a.href) === 'BLOCK') { stopEvent(e); return; }
                const isNew = isNewTab(effectiveTarget(a));
                const act = isNew ? getAction() : crossOriginAction(a.href);
                if (act === 'BLOCK') { stopEvent(e); return; }
                if (act === 'ASK') { const hrefSnapshot = a.href; stopEvent(e); askPopup(hrefSnapshot, a.target || (isNew ? '_blank' : '_self'), '', true); return; }
            }
            return;
        }

        if (e.type === 'auxclick' && e.button !== 1) return;
        const a = e.composedPath().find(el => el.tagName === 'A');
        if (!a?.href || a.hasAttribute('download')) return;
        if (getNavAction(a.href) === 'BLOCK') { stopEvent(e); return; }

        const forceNew = e.type === 'auxclick';
        if (!forceNew && !isNewTab(effectiveTarget(a))) {
            if (e.type === 'click' && popupBlocked) {
                try { if (trustedUrl && new URL(a.href, location.href).href === trustedUrl) return; } catch (_) { }
                const act = crossOriginAction(a.href);
                if (act === 'BLOCK') { stopEvent(e); return; }
                if (act === 'ASK') { const hrefSnapshot = a.href; stopEvent(e); askPopup(hrefSnapshot, '_self', '', true); return; }
            }
            return;
        }

        let act = crossOriginAction(a.href);
        if (act === null) return; // same-origin _blank is fine

        if (e.isTrusted) {
            try {
                if (trustedUrl && new URL(a.href, location.href).href === trustedUrl) return; // legit click
            } catch (_) { }
            if (trustedUrl) {
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
                    const isNew = isNewTab(effectiveTarget(tgt));
                    const act = isNew ? getAction() : crossOriginAction(tgt.href);
                    if (act === 'BLOCK') return false;
                    if (act === 'ASK') { const url = tgt.href; const tgt2 = tgt.target; askPopup(url, tgt2 || (isNew ? '_blank' : '_self'), ''); return false; }
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
                const isNew = isNewTab(effectiveTarget(this));
                const act = isNew ? getAction() : crossOriginAction(this.href);
                if (act === 'BLOCK') return;
                if (act === 'ASK') { const url = this.href; const target = this.target; askPopup(url, target || (isNew ? '_blank' : '_self'), ''); return; }
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

        // Hook window.open on child window's Window prototype
        try {
            const wOpen = w.open;
            const wInterceptedOpen = function (url, name, specs) {
                if (name && typeof name === 'string') {
                    try { if (w.frames[name]) return wOpen.call(w, url, name, specs); } catch (_) { }
                    try { if (w.parent.frames[name]) return wOpen.call(w, url, name, specs); } catch (_) { }
                    try { if (w.top.frames[name]) return wOpen.call(w, url, name, specs); } catch (_) { }
                }
                if (popupPending) { return fakeWindow; }
                const targetUrl = url || 'about:blank';
                if (getNavAction(targetUrl) === 'BLOCK') {
                    if (trustedClick && !isReplaying) { popupBlocked = true; replayAfterBlock(); }
                    return fakeWindow;
                }
                // Safe non-http(s) schemes — pass through
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
            };

            if (w.Window?.prototype) {
                try {
                    Object.defineProperty(w.Window.prototype, 'open', { value: wInterceptedOpen, writable: false, configurable: false });
                } catch (_) { }
            }
            Object.defineProperty(w, 'open', {
                get: () => wInterceptedOpen,
                set: () => { }, configurable: false
            });
        } catch (_) { }

        // Attach listeners to child doc
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

    try {
        const origCreateElement = document.createElement;
        document.createElement = function (tagName, options) {
            const el = origCreateElement.call(this, tagName, options);
            if (el && typeof tagName === 'string' && (tagName.toLowerCase() === 'iframe' || tagName.toLowerCase() === 'frame')) {
                try {
                    Object.defineProperty(el, 'contentWindow', {
                        get() {
                            const desc = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow') ||
                                Object.getOwnPropertyDescriptor(HTMLFrameElement.prototype, 'contentWindow');
                            const w = desc?.get ? desc.get.call(el) : el.contentWindow;
                            if (w) protectWin(w);
                            return w;
                        },
                        configurable: true, enumerable: true
                    });
                } catch (_) { }
            }
            return el;
        };
    } catch (_) { }

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

})();
