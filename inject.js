(function () {
    'use strict';

    const checkMatch = (host, list) => {
        if (!host || !list) return false;
        return list.some(x => x.startsWith('*.')
            ? (host === x.slice(2) || host.endsWith('.' + x.slice(2)))
            : host === x);
    };

    const getPopupAction = () => {
        return document.documentElement.getAttribute('data-pg-popup-action') || 'ASK';
    };

    const getNavAction = (url) => {
        try {
            const dest = new URL(url, location.href);
            const nbl = JSON.parse(document.documentElement.getAttribute('data-pg-nbl') || '[]');
            if (checkMatch(dest.hostname.toLowerCase(), nbl)) return 'BLOCK';
        } catch (e) { }
        return 'ALLOW';
    };

    let popupPending = false;
    let _siteHasAds = false;
    const isSiteHasAds = () => _siteHasAds
        || document.documentElement.getAttribute('data-pg-ads') === '1'
        || document.documentElement.getAttribute('data-pg-popup-action') === 'BLOCK';

    let pendingNav = null;
    let lastMousedownPos = null;
    let isReplayingClick = false;
    let popupBlockedDuringClick = false;
    const origPlay = HTMLMediaElement.prototype.play;

    const markSiteHasAds = () => {
        if (_siteHasAds) return;
        _siteHasAds = true;
        document.documentElement.setAttribute('data-pg-ads', '1');
        window.postMessage({ action: 'PG_SITE_HAS_ADS' }, '*');
    };

    document.addEventListener('mousedown', e => {
        if (e.isTrusted && !isReplayingClick) {
            lastMousedownPos = { x: e.clientX, y: e.clientY };
            popupBlockedDuringClick = false;
        }
    }, true);

    const freezePage = () => {
        if (document.getElementById('pg-freeze')) return;
        HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
        document.querySelectorAll('video, audio').forEach(m => { if (!m.paused) m.pause(); });
        const style = document.createElement('style');
        style.id = 'pg-freeze';
        style.textContent = '*, *::before, *::after { animation-play-state: paused !important; transition: none !important; }';
        document.head?.appendChild(style);
    };

    const unfreezePage = () => {
        HTMLMediaElement.prototype.play = origPlay;
        document.getElementById('pg-freeze')?.remove();
    };

    let askSafetyTimer = null;

    const askPopup = (url, name, specs, isNav = false) => {
        popupPending = true;
        freezePage();
        let resolved = url;
        try { resolved = new URL(url, location.href).href; } catch (_) { }
        window.postMessage({
            action: 'PG_ASK',
            url: resolved,
            name,
            specs,
            source: location.hostname,
            isNav
        }, '*');

        // Safety timeout: if content.js is orphaned (extension updated/reloaded),
        // the dialog will never appear. Auto-unfreeze after 800ms so the page
        // doesn't stay permanently locked on already-loaded tabs.
        clearTimeout(askSafetyTimer);
        askSafetyTimer = setTimeout(() => {
            if (!popupPending) return;
            // Check if dialog actually appeared (content.js creates #pg-container)
            if (!document.getElementById('pg-container')) {
                popupPending = false;
                unfreezePage();
                pendingNav = null;
            }
        }, 800);
    };

    window.addEventListener('message', e => {
        if (e.source !== window) return;
        if (!e.data || typeof e.data !== 'object') return;
        if (e.data?.action === 'PG_DIALOG_CLOSED') {
            popupPending = false;
            unfreezePage();
            if (pendingNav) {
                const { fn, url } = pendingNav;
                pendingNav = null;
                fn(url);
            }
        }
    });

    let replayTimeoutId = null;

    document.addEventListener('click', e => {
        if (e.isTrusted && !isReplayingClick) clearTimeout(replayTimeoutId);
    }, true);

    const replayClickAfterBlock = () => {
        if (!lastMousedownPos || isReplayingClick) return;
        const { x, y } = lastMousedownPos;
        lastMousedownPos = null;

        clearTimeout(replayTimeoutId);
        replayTimeoutId = setTimeout(() => {
            const el = document.elementFromPoint(x, y);
            if (!el || el === document.body || el === document.documentElement) return;

            const a = el.closest('a[href]');
            if (a) {
                try {
                    const dest = new URL(a.href, location.href);
                    if (dest.origin === location.origin && origAssign) {
                        origAssign.call(location, a.href);
                        return;
                    }
                } catch (_) { }
            }

            isReplayingClick = true;
            el.dispatchEvent(new MouseEvent('click', {
                bubbles: true, cancelable: true,
                clientX: x, clientY: y, view: window
            }));
            isReplayingClick = false;
        }, 100);
    };

    const originalOpen = window.open;

    const fakeWindow = Object.freeze({
        closed: true,
        name: '',
        close() { },
        focus() { },
        blur() { },
        postMessage() { },
        location: Object.freeze({ href: 'about:blank', assign() { }, replace() { } }),
    });

    const interceptedOpen = function (url, name, specs) {
        if (name && typeof name === 'string') {
            try { if (window.frames[name]) return originalOpen.call(window, url, name, specs); } catch (_) { }
        }
        const targetUrl = url || 'about:blank';
        const action = getPopupAction();
        if (action === 'BLOCK') {
            markSiteHasAds();
            popupBlockedDuringClick = true;
            if (!isReplayingClick) replayClickAfterBlock();
            return fakeWindow;
        }
        if (action === 'ASK') {
            markSiteHasAds();
            popupBlockedDuringClick = true;
            askPopup(targetUrl, name, specs);
            return fakeWindow;
        }
        return originalOpen.call(window, url, name, specs);
    };

    try {
        Object.defineProperty(window, 'open', {
            get: () => interceptedOpen,
            set: () => { },
            configurable: true
        });
    } catch (e) {
        window.open = interceptedOpen;
    }

    let bypassNext = false;

    const interceptNav = (url, doNavigate) => {
        try {
            const dest = new URL(url, location.href);
            if (dest.origin === location.origin) {
                if (!popupPending) {
                    doNavigate(url);
                } else {
                    pendingNav = { fn: doNavigate, url };
                }
                return;
            }
        } catch (e) { doNavigate(url); return; }

        if (getNavAction(url) === 'BLOCK') return;

        // Only intercept cross-origin navigations if the site has ads
        if (!isSiteHasAds()) { doNavigate(url); return; }

        const action = getPopupAction();
        if (action === 'ALLOW') { doNavigate(url); return; }
        if (action === 'BLOCK') { markSiteHasAds(); return; }
        markSiteHasAds();
        askPopup(url, '_self', '', true);
    };

    const locProto = Location.prototype;
    const origAssign = locProto.assign;
    const origReplace = locProto.replace;

    try {
        Object.defineProperty(locProto, 'assign', {
            value: function (url) { interceptNav(String(url), u => origAssign.call(this, u)); },
            writable: true, configurable: true
        });
    } catch (_) { }

    try {
        Object.defineProperty(locProto, 'replace', {
            value: function (url) { interceptNav(String(url), u => origReplace.call(this, u)); },
            writable: true, configurable: true
        });
    } catch (_) { }

    try {
        const hrefDesc = Object.getOwnPropertyDescriptor(locProto, 'href');
        if (hrefDesc?.set) {
            const origSet = hrefDesc.set;
            Object.defineProperty(locProto, 'href', {
                get: hrefDesc.get,
                set(v) { interceptNav(String(v), u => origSet.call(this, u)); },
                configurable: true,
                enumerable: hrefDesc.enumerable
            });
        }
    } catch (_) { }

    if (window.navigation) {
        window.navigation.addEventListener('navigate', e => {
            if (!isSiteHasAds()) return;
            if (e.hashChange || e.downloadRequest) return;
            if (bypassNext) { bypassNext = false; return; }
            try {
                const dest = new URL(e.destination.url);
                if (dest.origin === location.origin) {
                    if (popupPending) {
                        e.preventDefault();
                        pendingNav = {
                            fn: u => {
                                bypassNext = true;
                                if (origAssign) origAssign.call(location, u);
                                else location.href = u;
                            },
                            url: e.destination.url
                        };
                    }
                    return;
                }
            } catch (_) { return; }
            const action = getPopupAction();
            if (action === 'BLOCK') { e.preventDefault(); return; }
            if (action === 'ASK') { e.preventDefault(); askPopup(e.destination.url, '_self', '', true); }
        });
    }


    const navToken = Math.random().toString(36).slice(2);
    document.documentElement.setAttribute('data-pg-nav-token', navToken);
    window.addEventListener('message', e => {
        if (e.source !== window) return;
        if (!e.data || typeof e.data !== 'object') return;
        if (e.data?.action === 'PG_DO_NAV' && e.data.token === navToken) {
            bypassNext = true;
            if (origAssign) origAssign.call(location, e.data.url);
            else location.href = e.data.url;
        }
    });

    const origPreventDefault = Event.prototype.preventDefault;
    const origStopPropagation = Event.prototype.stopPropagation;
    const origStopImmediatePropagation = Event.prototype.stopImmediatePropagation;

    const stopEvent = (e) => {
        try {
            // Ad scripts may nullify preventDefault (set to undefined) before dispatching.
            // Always use the prototype method to ensure it works.
            if (typeof e.preventDefault === 'function') {
                e.preventDefault();
            } else {
                origPreventDefault.call(e);
            }
            if (typeof e.stopPropagation === 'function') {
                e.stopPropagation();
            } else {
                origStopPropagation.call(e);
            }
            if (typeof e.stopImmediatePropagation === 'function') {
                e.stopImmediatePropagation();
            } else {
                origStopImmediatePropagation.call(e);
            }
        } catch (_) { }
        if (e && !e.isTrusted && e.type === 'click') {
            const a = e.composedPath ? e.composedPath().find(el => el.tagName === 'A') : e.target?.closest?.('a');
            if (a && a.href) a.removeAttribute('href');
        }
    };

    const isNewTabTarget = (t) => {
        if (t === '_blank' || t === '_new') return true;
        if (!t || t === '_self' || t === '_top' || t === '_parent') return false;
        try { if (window.frames[t]) return false; } catch (_) { }
        try { if (window.parent.frames[t]) return false; } catch (_) { }
        return true;
    };

    const getEffectiveTarget = (el) => {
        let t = (el.target || '').toLowerCase();
        if (!t) { const b = document.querySelector('base[target]'); if (b) t = b.target.toLowerCase(); }
        return t;
    };

    const checkCrossOriginPopup = (url) => {
        try {
            const dest = new URL(url, location.href);
            if (dest.origin === location.origin) return null;
        } catch (_) { return null; }
        return getPopupAction();
    };

    const handleLinkEvent = (e) => {
        if (popupPending) {
            if (e.isTrusted && e.type === 'click') {
                const a = e.composedPath().find(el => el.tagName === 'A');
                if (a?.href && isNewTabTarget(getEffectiveTarget(a))) {
                    try {
                        if (new URL(a.href, location.href).origin !== location.origin)
                            e.preventDefault();
                    } catch (_) { }
                }
            }
            return;
        }

        if (e.defaultPrevented && e.type !== 'mousedown') return;

        if (!e.isTrusted) {
            if ((e.metaKey || e.ctrlKey) && e.type === 'click') {
                // Ad scripts (popMagic chromeTab) create temp <a>, dispatch fake
                // click with ctrlKey+metaKey to force open in new tab.
                // They also set event.preventDefault = undefined to bypass blocks.
                stopEvent(e);
                const a = e.composedPath().find(el => el.tagName === 'A');
                if (a && a.href) a.removeAttribute('href');
                return;
            }
            if (e.button !== 0 && e.type !== 'mousedown') { stopEvent(e); return; }
            const a = e.composedPath().find(el => el.tagName === 'A');
            if (a && a.href) {
                if (getNavAction(a.href) === 'BLOCK') { stopEvent(e); return; }
                const action = checkCrossOriginPopup(a.href);
                if (action === 'BLOCK') { stopEvent(e); return; }
                if (action === 'ASK') { stopEvent(e); askPopup(a.href, a.target || '_self', '', true); return; }
            }
            return;
        }

        if (e.type === 'auxclick' && e.button !== 1) return;
        const a = e.composedPath().find(el => el.tagName === 'A');
        if (!a || !a.href) return;
        if (a.hasAttribute('download')) return;

        if (getNavAction(a.href) === 'BLOCK') { stopEvent(e); return; }

        const forceNewTab = e.type === 'auxclick';
        if (!forceNewTab && !isNewTabTarget(getEffectiveTarget(a))) {
            if (e.type === 'click' && popupBlockedDuringClick) {
                const action = checkCrossOriginPopup(a.href);
                if (action === 'BLOCK') { stopEvent(e); return; }
                if (action === 'ASK') { stopEvent(e); askPopup(a.href, '_self', '', true); return; }
            }
            return;
        }

        // Only intercept trusted clicks on new-tab links if the site has ads.
        // On clean sites, let all user clicks through normally.
        if (!isSiteHasAds()) return;

        let action = checkCrossOriginPopup(a.href);

        if (action === 'ASK') { stopEvent(e); askPopup(a.href, a.target || '_blank', ''); }
    };

    const handleFormSubmitEvent = (e) => {
        if (e.defaultPrevented) return;
        const form = e.target;
        if (!form || form.tagName !== 'FORM' || !form.action) return;

        if (getNavAction(form.action) === 'BLOCK') {
            stopEvent(e);
            return;
        }

        if (!e.isTrusted) {
            const action = checkCrossOriginPopup(form.action);
            if (action === 'BLOCK') { stopEvent(e); return; }
            if (action === 'ASK') { stopEvent(e); askPopup(form.action, form.target || '_self', '', true); return; }
            return;
        }

        if (isNewTabTarget(getEffectiveTarget(form))) {
            if (!isSiteHasAds()) return;
            let action = checkCrossOriginPopup(form.action);
            if (action === 'ASK') {
                stopEvent(e);
                askPopup(form.action, form.target || '_blank', '');
            }
        }
    };

    const attachDocListeners = (doc) => {
        if (!doc) return;
        doc.addEventListener('mousedown', handleLinkEvent, true);
        doc.addEventListener('click', handleLinkEvent, true);
        doc.addEventListener('auxclick', handleLinkEvent, true);
        doc.addEventListener('submit', handleFormSubmitEvent, true);
    };

    attachDocListeners(document);

    const hookDispatch = (proto) => {
        if (!proto || !proto.dispatchEvent) return;
        const origDispatch = proto.dispatchEvent;
        if (origDispatch._pgHooked) return;

        proto.dispatchEvent = function (...args) {
            const e = args[0];
            if (e && (e.type === 'click' || e.type === 'auxclick')) {
                let target = this;
                if (target.tagName !== 'A' && e.composedPath) {
                    target = e.composedPath().find(el => el.tagName === 'A') || this;
                }
                if (target.tagName === 'A' && target.href && !e.isTrusted) {
                    if (target.hasAttribute('download')) return origDispatch.apply(this, args);

                    if (getNavAction(target.href) === 'BLOCK') {
                        target.removeAttribute('href');
                        return false;
                    }
                    const action = checkCrossOriginPopup(target.href);
                    if (action === 'BLOCK') {
                        target.removeAttribute('href');
                        return false;
                    }
                    if (action === 'ASK') {
                        const url = target.href;
                        target.removeAttribute('href');
                        askPopup(url, target.target || '_self', '');
                        return false;
                    }
                }
            }
            return origDispatch.apply(this, args);
        };
        proto.dispatchEvent._pgHooked = true;
    };

    hookDispatch(EventTarget.prototype);
    hookDispatch(Node.prototype);
    hookDispatch(HTMLElement.prototype);
    if (window.HTMLAnchorElement) hookDispatch(HTMLAnchorElement.prototype);

    document.addEventListener('click', (e) => {
        if (!popupBlockedDuringClick || !e.isTrusted || isReplayingClick) return;
        const a = e.composedPath().find(el => el.tagName === 'A');
        if (!a || !a.href) return;
        const action = checkCrossOriginPopup(a.href);
        if (action === 'BLOCK') { e.preventDefault(); return; }
        if (action === 'ASK') { e.preventDefault(); askPopup(a.href, '_self', '', true); }
    }, false);

    const hookClick = (proto) => {
        if (!proto || !proto.click) return;
        const origClick = proto.click;
        if (origClick._pgHooked) return;

        proto.click = function () {
            if (this.tagName === 'A' && this.href) {
                if (this.hasAttribute('download')) return origClick.call(this);
                if (getNavAction(this.href) === 'BLOCK') {
                    this.removeAttribute('href');
                    return;
                }
                const action = checkCrossOriginPopup(this.href);
                if (action === 'BLOCK') {
                    this.removeAttribute('href');
                    return;
                }
                if (action === 'ASK') {
                    const url = this.href;
                    this.removeAttribute('href');
                    askPopup(url, this.target || '_self', '');
                    return;
                }
            }
            return origClick.call(this);
        };
        proto.click._pgHooked = true;
    };

    hookClick(HTMLElement.prototype);
    if (window.HTMLAnchorElement) hookClick(HTMLAnchorElement.prototype);

    const originalSubmit = HTMLFormElement.prototype.submit;
    HTMLFormElement.prototype.submit = function () {
        if (this.action) {
            if (getNavAction(this.action) === 'BLOCK') return;
            const action = checkCrossOriginPopup(this.action);
            if (action === 'BLOCK') return;
            if (action === 'ASK') { askPopup(this.action, this.target || '_self', ''); return; }
        }
        if (!this.isConnected) return;
        return originalSubmit.call(this);
    };

    if (HTMLFormElement.prototype.requestSubmit) {
        const orig = HTMLFormElement.prototype.requestSubmit;
        HTMLFormElement.prototype.requestSubmit = function (s) {
            if (this.action) {
                if (getNavAction(this.action) === 'BLOCK') return;
                const action = checkCrossOriginPopup(this.action);
                if (action === 'BLOCK') return;
                if (action === 'ASK') { askPopup(this.action, this.target || '_self', ''); return; }
            }
            if (!this.isConnected) return;
            return orig.call(this, s);
        };
    }

    const hookProp = (proto, prop, extract) => {
        if (!proto) return;
        const desc = Object.getOwnPropertyDescriptor(proto, prop);
        if (!desc?.get) return;
        const origGet = desc.get;
        Object.defineProperty(proto, prop, {
            get: function () {
                const val = origGet.call(this);
                try { protectWindow(extract(val)); } catch (_) { }
                return val;
            },
            configurable: true,
            enumerable: true
        });
    };

    const protectedWindows = new WeakSet();
    protectedWindows.add(window);

    const protectWindow = (w) => {
        if (!w || protectedWindows.has(w)) return;
        try { w.Object; } catch (_) { return; }
        protectedWindows.add(w);
        try {
            const wOpen = w.open;
            Object.defineProperty(w, 'open', {
                get: () => function (url, name, specs) {
                    if (name && typeof name === 'string') {
                        try { if (w.frames[name]) return wOpen.call(w, url, name, specs); } catch (_) { }
                        try { if (w.parent.frames[name]) return wOpen.call(w, url, name, specs); } catch (_) { }
                        try { if (w.top.frames[name]) return wOpen.call(w, url, name, specs); } catch (_) { }
                    }
                    const targetUrl = url || 'about:blank';
                    const action = getPopupAction();
                    if (action === 'BLOCK') {
                        markSiteHasAds();
                        popupBlockedDuringClick = true;
                        if (!isReplayingClick) replayClickAfterBlock();
                        return fakeWindow;
                    }
                    if (action === 'ASK') {
                        markSiteHasAds();
                        popupBlockedDuringClick = true;
                        askPopup(targetUrl, name, specs);
                        return fakeWindow;
                    }
                    return wOpen.call(w, url, name, specs);
                },
                set: () => { },
                configurable: true
            });
        } catch (_) { }
        try {
            const d = w.document;
            attachDocListeners(d);

            if (w.MutationObserver) {
                let currentDocEl = d.documentElement;
                new w.MutationObserver(() => {
                    if (d.documentElement && currentDocEl !== d.documentElement) {
                        currentDocEl = d.documentElement;
                        attachDocListeners(d);
                    }
                }).observe(d, { childList: true });
            }

            if (w.Document && w.Document.prototype && !w.Document.prototype.write._pgHooked) {
                const wOrigWrite = w.Document.prototype.write;
                const wOrigWriteln = w.Document.prototype.writeln;
                w.Document.prototype.write = function (...args) {
                    const r = wOrigWrite.apply(this, args);
                    attachDocListeners(this);
                    return r;
                };
                w.Document.prototype.write._pgHooked = true;
                w.Document.prototype.writeln = function (...args) {
                    const r = wOrigWriteln.apply(this, args);
                    attachDocListeners(this);
                    return r;
                };
                w.Document.prototype.writeln._pgHooked = true;
            }
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
            if (w.HTMLIFrameElement) {
                hookProp(w.HTMLIFrameElement.prototype, 'contentWindow', win => win);
                hookProp(w.HTMLIFrameElement.prototype, 'contentDocument', doc => doc?.defaultView);
            }
            if (w.HTMLFrameElement) {
                hookProp(w.HTMLFrameElement.prototype, 'contentWindow', win => win);
                hookProp(w.HTMLFrameElement.prototype, 'contentDocument', doc => doc?.defaultView);
            }
        } catch (_) { }
    };

    hookProp(HTMLIFrameElement.prototype, 'contentWindow', w => w);
    hookProp(HTMLIFrameElement.prototype, 'contentDocument', d => d?.defaultView);
    if (window.HTMLFrameElement) {
        hookProp(HTMLFrameElement.prototype, 'contentWindow', w => w);
        hookProp(HTMLFrameElement.prototype, 'contentDocument', d => d?.defaultView);
    }

    let currentDocEl = document.documentElement;

    const protectIframe = (el) => {
        if (el.tagName !== 'IFRAME' && el.tagName !== 'FRAME') return;
        try { protectWindow(el.contentWindow); } catch (_) { }
    };

    // ── Intercept ad scripts that dynamically create <a> elements and
    //    dispatch fake clicks with ctrlKey/metaKey (popMagic chromeTab technique).
    //    We hook appendChild/insertBefore so that when a new <a> is added to
    //    the DOM, we immediately attach our capture-phase listener to it,
    //    ensuring we run BEFORE the ad script's synthetic dispatchEvent.
    // ── Watch for dynamically added <a> elements using MutationObserver instead
    //    of monkey-patching Node.prototype.appendChild / insertBefore.
    //    Monkey-patching those methods breaks CSP nonce propagation on strict
    //    pages (e.g. GitHub), because the browser loses the originating-script
    //    context when the call passes through the extension wrapper, causing
    //    legitimate nonce'd <script> insertions to be flagged as CSP violations.
    //    MutationObserver achieves the same goal without touching native methods.
    const domObserver = new MutationObserver(mutations => {
        if (!isSiteHasAds()) return;
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                try {
                    if (node.nodeType === 1 && node.tagName === 'A') {
                        node.addEventListener('click', handleLinkEvent, true);
                    }
                } catch (_) { }
            }
        }
    });
    try {
        domObserver.observe(document.documentElement, { childList: true, subtree: true });
    } catch (_) { }

    // ── Protect MouseEvent constructor: ad scripts set preventDefault = undefined
    //    on the event object. We make preventDefault non-configurable/non-writable
    //    by wrapping the constructor. However, they assign directly on the instance
    //    AFTER construction, so we use Object.defineProperty on the instance.
    const OrigMouseEvent = window.MouseEvent;
    window.MouseEvent = function (type, init) {
        const evt = new OrigMouseEvent(type, init);
        // If the event has ctrlKey or metaKey and is synthetic (likely ad trick),
        // protect preventDefault from being overwritten
        if (init && (init.ctrlKey || init.metaKey)) {
            try {
                Object.defineProperty(evt, 'preventDefault', {
                    value: Event.prototype.preventDefault,
                    writable: false,
                    configurable: false
                });
            } catch (_) { }
        }
        return evt;
    };
    window.MouseEvent.prototype = OrigMouseEvent.prototype;
    Object.defineProperty(window.MouseEvent, 'name', { value: 'MouseEvent' });

    new MutationObserver(mutations => {
        if (document.documentElement && currentDocEl !== document.documentElement) {
            currentDocEl = document.documentElement;
            // Re-attach all listeners (matches attachDocListeners) when
            // document.write replaces documentElement. submit is included here
            // because we no longer hook Document.prototype.write for the main
            // document (doing so caused false "parser-blocking cross-site script"
            // warnings in Chrome attributed to inject.js instead of ad scripts).
            attachDocListeners(document);
        }
        for (const m of mutations) {
            for (const node of m.addedNodes) {
                if (node.nodeType !== 1) continue;
                protectIframe(node);
                if (node.querySelectorAll) {
                    node.querySelectorAll('iframe, frame').forEach(protectIframe);
                }
            }
        }
    }).observe(document, { childList: true, subtree: true });

    // ── Main-document reset detection: no document.write hook needed here.
    //    Hooking Document.prototype.write at the main-document level causes:
    //    1. Chrome attributes every document.write call (including ad-site calls)
    //       to inject.js in the stack trace, producing misleading "cross-site
    //       parser-blocking script via document.write" warnings that blame the
    //       extension instead of the ad script.
    //    2. The wrapper prevents Chrome from correctly tracking the originating
    //       script for its own intervention mechanism, breaking its protection.
    //    The MutationObserver below replaces this path. submit is added so the
    //    observer fully covers what the former checkDocReset(document) path did.
    //    Per-iframe hooks inside protectIframe() are kept because they run in
    //    the iframe's own window scope and do not affect main-page attribution.

})();