(function () {
    'use strict';


    const checkMatch = (host, list) => {
        if (!host || !list) return false;
        return list.some(x => x.startsWith('*.')
            ? (host === x.slice(2) || host.endsWith('.' + x.slice(2)))
            : host === x);
    };

    const getPopupAction = () => {
        return document.documentElement?.getAttribute('data-pg-popup-action') || 'ASK';
    };

    // True once content.js has written data-pg-popup-action at least once.
    const isReady = () => document.documentElement.hasAttribute('data-pg-popup-action');

    // Each entry: { resolve, url, name, specs }
    const _pendingOpens = [];
    const _pendingActions = [];

    // When data-pg-popup-action is first written, flush the queue.
    const _readyObserver = new MutationObserver(() => {
        if (!isReady()) return;
        _readyObserver.disconnect();
        // Process buffered calls now that we have the correct action.
        for (const item of _pendingOpens.splice(0)) {
            item.resolve(interceptedOpen(item.url, item.name, item.specs));
        }
        for (const fn of _pendingActions.splice(0)) {
            fn();
        }
    });
    _readyObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-pg-popup-action']
    });

    const waitForReady = (fn) => {
        if (isReady()) { fn(); return false; }
        _pendingActions.push(fn);
        return true;
    };

    const getTopOrigin = () => {
        if (window === window.top) {
            try { return location.origin; } catch (_) { }
        } else {
            try { return window.top.location.origin; } catch (_) {
                if (location.ancestorOrigins?.length > 0) {
                    const topOrigin = location.ancestorOrigins[location.ancestorOrigins.length - 1];
                    if (topOrigin) return topOrigin;
                }
            }
        }
        return '';
    };

    const getNavAction = (url) => {
        try {
            const dest = new URL(url, location.href);
            const nbl = JSON.parse(document.documentElement?.getAttribute('data-pg-nbl') || '[]');
            if (checkMatch(dest.hostname.toLowerCase(), nbl)) return 'BLOCK';
        } catch (e) { }
        return 'ALLOW';
    };

    let popupPending = false;
    const isSiteHasAds = () =>
        document.documentElement?.getAttribute('data-pg-popup-action') === 'BLOCK';

    let pendingNav = null;
    let lastMousedownPos = null;
    let isReplayingClick = false;
    let popupBlockedDuringClick = false;
    let popupOpenedDuringClick = false;
    let isTrustedClickOnLink = false;
    let trustedLinkUrl = null;
    let trustedLinkTarget = '_self';
    let trustedIframeOrigin = null;
    let trustedClickSafetyTimer = null;
    // Survives the setTimeout(0) clear in the click handler so interceptNav can still use it.
    let trustedLinkUrlForNav = null;
    const origPlay = HTMLMediaElement.prototype.play;

    document.addEventListener('mousedown', e => {
        if (e.isTrusted && !isReplayingClick) {
            lastMousedownPos = { x: e.clientX, y: e.clientY };
            popupBlockedDuringClick = false;
            popupOpenedDuringClick = false;
            const path = e.composedPath ? e.composedPath() : [];
            const a = path.find(el => el.tagName === 'A') || e.target?.closest?.('a');
            const iframe = path.find(el => el.tagName === 'IFRAME' || el.tagName === 'FRAME');
            isTrustedClickOnLink = !!(a && a.href);
            trustedLinkUrl = null;
            trustedLinkUrlForNav = null;
            clearTimeout(trustedClickSafetyTimer);
            if (isTrustedClickOnLink) {
                trustedLinkUrl = a.href;
                trustedLinkTarget = a.getAttribute('target') || '_self';
                try { trustedLinkUrl = new URL(a.href, location.href).href; } catch (_) { }
                trustedLinkUrlForNav = trustedLinkUrl;
                trustedClickSafetyTimer = setTimeout(() => { isTrustedClickOnLink = false; trustedLinkUrl = null; trustedLinkUrlForNav = null; }, 1000);
            } else if (iframe) {
                isTrustedClickOnLink = true;
                trustedLinkUrl = null;
                // Store iframe origin so interceptedOpen can verify destination matches.
                try { trustedIframeOrigin = new URL(iframe.src).origin; } catch (_) { trustedIframeOrigin = null; }
                trustedClickSafetyTimer = setTimeout(() => { isTrustedClickOnLink = false; trustedIframeOrigin = null; }, 1000);
            } else {
                trustedIframeOrigin = null;
            }
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
            source: location.hostname.toLowerCase(),
            isNav
        }, '*');


        clearTimeout(askSafetyTimer);
        askSafetyTimer = setTimeout(() => {
            if (!popupPending) return;

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
    let clickCleanupTimer = null;

    document.addEventListener('click', e => {
        if (e.isTrusted && !isReplayingClick) {
            clearTimeout(replayTimeoutId);
            clearTimeout(clickCleanupTimer);
            clickCleanupTimer = setTimeout(() => {
                popupOpenedDuringClick = false;
                popupBlockedDuringClick = false;
            }, 500);
            if (isTrustedClickOnLink) {
                clearTimeout(trustedClickSafetyTimer);
                setTimeout(() => { isTrustedClickOnLink = false; trustedLinkUrl = null; trustedLinkTarget = '_self'; }, 0);
            }
        }
    }, true);

    const replayClickAfterBlock = () => {
        // If a legitimate popup was already opened during this click cycle, the user's intent
        // is fulfilled in the new tab. We don't need to replay the navigation.
        if (popupOpenedDuringClick) return;

        if (!lastMousedownPos || isReplayingClick) return;
        const { x, y } = lastMousedownPos;
        lastMousedownPos = null;

        // Capture the target URL immediately before any overlays (like askPopup) cover the screen,
        // and before trustedLinkUrl is cleared by the click handler's setTimeout(0).
        let targetUrl = trustedLinkUrl;
        if (!targetUrl) {
            const el = document.elementFromPoint(x, y);
            const a = el?.closest?.('a[href]');
            if (a) {
                try {
                    if (new URL(a.href, location.href).origin === location.origin) {
                        targetUrl = a.href;
                    }
                } catch (_) { }
            }
        }

        if (!targetUrl) return;

        clearTimeout(replayTimeoutId);
        replayTimeoutId = setTimeout(() => {
            if (popupPending) {
                // The askPopup UI is visible. Queue the navigation to happen AFTER the user clicks Block/Allow.
                pendingNav = {
                    fn: u => {
                        bypassNext = true;
                        if (origAssign) origAssign.call(location, u);
                        else location.href = u;
                    },
                    url: targetUrl
                };
                return;
            }

            // Manually navigate the current tab to the trusted link URL.
            bypassNext = true;
            if (origAssign) origAssign.call(location, targetUrl);
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
        if (!isReady()) console.warn('PopupGuard not ready yet');
        if (name && typeof name === 'string') {
            try { if (window.frames[name]) return originalOpen.call(window, url, name, specs); } catch (_) { }
        }
        const targetUrl = url || 'about:blank';
        if (getNavAction(targetUrl) === 'BLOCK') return fakeWindow;
        if (targetUrl !== 'about:blank') {
            try {
                const dest = new URL(targetUrl, location.href);
                if (dest.origin === getTopOrigin()) {
                    const isStandardTarget = !name || name === '_blank' || name === '_self' ||
                        name === '_top' || name === '_parent' || name === '_new';
                    if (isTrustedClickOnLink && isStandardTarget) {
                        const isForcedNewTab = (name === '_blank' || name === '_new') && (trustedLinkTarget !== '_blank' && trustedLinkTarget !== '_new');

                        if (isForcedNewTab) {
                            popupBlockedDuringClick = true;
                            if (!isReplayingClick) replayClickAfterBlock();
                            return fakeWindow;
                        }
                        popupOpenedDuringClick = true;
                        return originalOpen.call(window, url, name, specs);
                    }
                    if (isTrustedClickOnLink) {
                        popupBlockedDuringClick = true;
                        if (!isReplayingClick) replayClickAfterBlock();
                        return fakeWindow;
                    }
                    if (getPopupAction() === 'BLOCK') return fakeWindow;
                    askPopup(targetUrl, name, specs);
                    return fakeWindow;
                }
            } catch (_) { }
        }

        if (!isReady()) {
            let _realWin = null;
            const proxy = {
                closed: false,
                name: name || '',
                close() { _realWin?.close(); },
                focus() { _realWin?.focus(); },
                blur() { _realWin?.blur(); },
                postMessage(...a) { _realWin?.postMessage(...a); },
                location: { href: 'about:blank', assign() { }, replace() { } },
            };
            _pendingOpens.push({
                url: targetUrl, name, specs,
                resolve(win) { _realWin = win; if (win && win !== fakeWindow) proxy.closed = false; }
            });
            return proxy;
        }

        const action = getPopupAction();
        if (isTrustedClickOnLink && action === 'ASK' && trustedLinkUrl === null) {
            try {
                if (!trustedIframeOrigin || new URL(targetUrl).origin === trustedIframeOrigin)
                    return originalOpen.call(window, url, name, specs);
            } catch (_) { }
        }
        if (isTrustedClickOnLink && action === 'ASK' && trustedLinkUrl) {
            try {
                const dest = new URL(targetUrl, location.href);
                const trusted = new URL(trustedLinkUrl);
                if (dest.origin === trusted.origin && dest.pathname === trusted.pathname) {
                    popupOpenedDuringClick = true;
                    return originalOpen.call(window, url, name, specs);
                }
            } catch (_) { }
        }
        if (action === 'BLOCK') {
            if (isTrustedClickOnLink) {
                popupBlockedDuringClick = true;
                if (!isReplayingClick) replayClickAfterBlock();
            }
            return fakeWindow;
        }
        if (action === 'ASK') {
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
        // ── Hijack guard 3: popup opened during this click cycle ──────────────
        // Pattern: window.open(realUrl, "_blank") then document.location = adUrl
        // Real content opened in new tab, this navigation is the ad hijacking the tab.
        // MUST be above popupPending to catch hijacks that happen while a previous block is replaying.
        if (popupOpenedDuringClick) {
            if (waitForReady(() => interceptNav(url, doNavigate))) return;
            const action = getPopupAction();
            if (action === 'ALLOW') { doNavigate(url); return; }
            if (action === 'BLOCK') return;
            askPopup(url, '_self', '', true);
            return;
        }

        if (popupPending) {
            try {
                const dest = new URL(url, location.href);
                if (dest.origin === location.origin) {
                    pendingNav = { fn: doNavigate, url };
                }
            } catch (_) { }
            return;
        }

        try {
            const dest = new URL(url, location.href);
            if (dest.origin === location.origin) {
                doNavigate(url);
                return;
            }
        } catch (e) { doNavigate(url); return; }

        if (getNavAction(url) === 'BLOCK') return;

        // ── Hijack guard 1: user clicked a real <a> link ────────────────────────
        // Navigation cross-origin but doesn't match what the user intended → hijack.
        // Checked BEFORE !isSiteHasAds() so ASK-mode sites are also protected.
        if (trustedLinkUrlForNav) {
            try {
                const intended = new URL(trustedLinkUrlForNav);
                const actual = new URL(url, location.href);
                if (actual.origin !== intended.origin) {
                    if (waitForReady(() => interceptNav(url, doNavigate))) return;
                    const action = getPopupAction();
                    if (action === 'ALLOW') { doNavigate(url); return; }
                    if (action === 'BLOCK') return;
                    askPopup(url, '_self', '', true);
                    return;
                }
            } catch (_) { }
        }

        // ── Hijack guard 2: user clicked an iframe (transparent overlay trick) ──
        // isTrustedClickOnLink=true + trustedLinkUrlForNav=null means the click
        // landed on an <iframe>. The navigation is only legitimate if its origin
        // matches the iframe's own origin (e.g. YouTube embed opening YouTube).
        if (isTrustedClickOnLink && trustedLinkUrlForNav === null) {
            try {
                const actual = new URL(url, location.href);
                if (!trustedIframeOrigin || actual.origin !== trustedIframeOrigin) {
                    if (waitForReady(() => interceptNav(url, doNavigate))) return;
                    const action = getPopupAction();
                    if (action === 'ALLOW') { doNavigate(url); return; }
                    if (action === 'BLOCK') return;
                    askPopup(url, '_self', '', true);
                    return;
                }
            } catch (_) { }
        }

        if (!isSiteHasAds()) { doNavigate(url); return; }

        // Allow if this navigation exactly matches the URL the user originally clicked, even if
        // isTrustedClickOnLink was already cleared by the click event's setTimeout(0).
        if (trustedLinkUrlForNav) {
            try { if (new URL(url, location.href).href === trustedLinkUrlForNav) { doNavigate(url); return; } } catch (_) { }
        }

        if (waitForReady(() => interceptNav(url, doNavigate))) return;

        const action = getPopupAction();
        if (action === 'ALLOW') { doNavigate(url); return; }
        if (action === 'BLOCK') { return; }
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

    // Hook document.location setter (instance-level shadow).
    // document.location = url does NOT go through Location.prototype.href setter in Chrome.
    // By defining our own property on document, we shadow the prototype and catch assignments.
    try {
        Object.defineProperty(document, 'location', {
            get() { return location; },
            set(v) {
                interceptNav(String(v), u => { if (origAssign) origAssign.call(location, u); else location.href = u; });
            },
            configurable: true,
            enumerable: true
        });
    } catch (_) { }

    if (window.navigation) {
        window.navigation.addEventListener('navigate', e => {
            if (e.hashChange || e.downloadRequest) return;
            if (bypassNext) { bypassNext = false; return; }

            // Hijack guard 3: script tried to double-navigate (either popup opened or popup blocked).
            if (popupOpenedDuringClick || popupBlockedDuringClick) {
                const action = getPopupAction();
                if (action === 'ALLOW') return;

                const dest = new URL(e.destination.url);
                if (dest.origin === location.origin) {
                    if (popupBlockedDuringClick) {
                        // Same-origin fallback navigation (often the article). Silently cancel it.
                        // replayClickAfterBlock will handle the true navigation.
                        e.preventDefault();
                    }
                    return;
                }
                // Delay window.stop() slightly to allow legitimate window.open to escape,
                // while still aborting the cross-origin ad navigation.
                setTimeout(() => window.stop(), 50);

                e.preventDefault();
                // If we blocked the popup, replayClickAfterBlock is already scheduled to navigate the tab.
                // We queue the navigation in pendingNav so it waits for the user to answer the ASK popup.
                if (action === 'ASK') askPopup(e.destination.url, '_self', '', true);

                return;
            }

            if (popupPending) {
                try {
                    const dest = new URL(e.destination.url);
                    if (dest.origin === location.origin) {
                        e.preventDefault();
                        pendingNav = {
                            fn: u => {
                                bypassNext = true;
                                if (origAssign) origAssign.call(location, u);
                                else location.href = u;
                            },
                            url: e.destination.url
                        };
                    } else {
                        e.preventDefault();
                    }
                } catch (_) { }
                return;
            }

            // Same-origin navigations are always fine.
            try {
                const dest = new URL(e.destination.url);
                if (dest.origin === location.origin) return;
            } catch (_) { return; }

            if (getNavAction(e.destination.url) === 'BLOCK') { e.preventDefault(); return; }

            // Safety-net hijack guard 1 (catches meta-refresh and other Location-hook bypasses):
            // user clicked a real link but the navigate event fires with a different origin.
            if (trustedLinkUrlForNav) {
                try {
                    const intended = new URL(trustedLinkUrlForNav);
                    const actual = new URL(e.destination.url);
                    if (actual.origin !== intended.origin) {
                        if (waitForReady(() => {
                            bypassNext = true;
                            if (origAssign) origAssign.call(location, e.destination.url);
                            else location.href = e.destination.url;
                        })) { e.preventDefault(); return; }
                        const action = getPopupAction();
                        if (action === 'ALLOW') return;
                        e.preventDefault();
                        if (action === 'ASK') askPopup(e.destination.url, '_self', '', true);
                        return;
                    }
                } catch (_) { }
            }

            // Safety-net hijack guard 2 (transparent iframe overlay):
            // user clicked on an iframe but the top frame navigates to a foreign origin.
            if (isTrustedClickOnLink && trustedLinkUrlForNav === null) {
                try {
                    const actual = new URL(e.destination.url);
                    if (!trustedIframeOrigin || actual.origin !== trustedIframeOrigin) {
                        if (waitForReady(() => {
                            bypassNext = true;
                            if (origAssign) origAssign.call(location, e.destination.url);
                            else location.href = e.destination.url;
                        })) { e.preventDefault(); return; }
                        const action = getPopupAction();
                        if (action === 'ALLOW') return;
                        e.preventDefault();
                        if (action === 'ASK') askPopup(e.destination.url, '_self', '', true);
                        return;
                    }
                } catch (_) { }
            }

            if (!isSiteHasAds()) return;
            if (e.userInitiated) return;

            if (waitForReady(() => {
                bypassNext = true;
                if (origAssign) origAssign.call(location, e.destination.url);
                else location.href = e.destination.url;
            })) {
                e.preventDefault();
                return;
            }

            const action = getPopupAction();
            if (action === 'BLOCK') { e.preventDefault(); return; }
            if (action === 'ASK') { e.preventDefault(); askPopup(e.destination.url, '_self', '', true); }
        });
    }


    const navToken = Math.random().toString(36).slice(2);
    document.documentElement?.setAttribute('data-pg-nav-token', navToken);
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
        const topOrigin = getTopOrigin();
        if (!topOrigin) return null;
        try {
            const dest = new URL(url, location.href);
            if (dest.origin === topOrigin) return null;
        } catch (_) { return null; }
        return getPopupAction();
    };

    const handleLinkEvent = (e) => {
        if (popupPending) {
            if (e.isTrusted && e.type === 'click') {
                const a = e.composedPath().find(el => el.tagName === 'A');
                if (a?.href && isNewTabTarget(getEffectiveTarget(a))) {
                    try {
                        const topOrigin = getTopOrigin();
                        if (topOrigin && new URL(a.href, location.href).origin !== topOrigin)
                            e.preventDefault();
                    } catch (_) { }
                }
            }
            return;
        }

        if (e.defaultPrevented && e.type !== 'mousedown') return;

        if (!e.isTrusted) {
            if ((e.metaKey || e.ctrlKey) && e.type === 'click') {

                stopEvent(e);
                const a = e.composedPath().find(el => el.tagName === 'A');
                if (a && a.href) a.removeAttribute('href');
                return;
            }
            if (e.button !== 0 && e.type !== 'mousedown') { stopEvent(e); return; }
            const a = e.composedPath().find(el => el.tagName === 'A');
            if (a && a.href) {
                if (!isReady()) {
                    stopEvent(e);
                    const type = e.type;
                    _pendingActions.push(() => {
                        if (a.isConnected) {
                            if (type === 'click') a.click();
                            else if (type === 'auxclick') a.dispatchEvent(new MouseEvent('auxclick', { button: 1, bubbles: true }));
                        }
                    });
                    return;
                }
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
            // _self link: only interfere if a popup was blocked during this click
            // AND the current href doesn't match what user originally clicked.
            // If it matches → genuine user click → let it through.
            if (e.type === 'click' && popupBlockedDuringClick) {
                try {
                    if (trustedLinkUrl && new URL(a.href, location.href).href === trustedLinkUrl) return;
                } catch (_) { }
                const action = checkCrossOriginPopup(a.href);
                if (action === 'BLOCK') { stopEvent(e); return; }
                if (action === 'ASK') { stopEvent(e); askPopup(a.href, '_self', '', true); return; }
            }
            return;
        }


        let action = checkCrossOriginPopup(a.href);
        if (action === null) return; // same-origin _blank is fine

        // Trusted click: user explicitly clicked this <a> element.
        // If the href matches what was recorded at mousedown (trustedLinkUrl), the link
        // was not rewritten — this is genuine user intent. Always allow, regardless of
        // site action. Never ask or block a real user click on a real link.
        if (e.isTrusted) {
            try {
                if (trustedLinkUrl && new URL(a.href, location.href).href === trustedLinkUrl) {
                    return; // legit click, let browser handle normally
                }
            } catch (_) { }

            // href differs from what was recorded at mousedown → ad script rewrote it.
            // Navigate to the original URL the user intended (trustedLinkUrl).
            if (trustedLinkUrl) {
                stopEvent(e);
                try {
                    const trustedDest = new URL(trustedLinkUrl);
                    if (trustedDest.origin === location.origin) {
                        // Same-origin rewrite → navigate same-tab via raw assign (bypass interceptNav).
                        origAssign.call(location, trustedLinkUrl);
                        return;
                    }
                } catch (_) { }

                if (waitForReady(() => {
                    if (getPopupAction() === 'BLOCK') return;
                    askPopup(trustedLinkUrl, a.target || '_blank', '', true);
                })) return;

                // Cross-origin rewrite → ask with the original URL, using isNav so ALLOW works.
                if (getPopupAction() === 'BLOCK') return;
                askPopup(trustedLinkUrl, a.target || '_blank', '', true);
                return;
            }

            // No trustedLinkUrl: safety timer expired or user clicked non-<a> element.
            // Can't confirm this is a real content link, but it IS a trusted browser event,
            // so give benefit of the doubt — let it through. Worst case: an ad opens, which
            // the browser popup blocker will likely catch anyway.
            return;
        }

        // Untrusted (synthetic) click on _blank link.
        if (action === 'BLOCK') { stopEvent(e); return; }
        if (action === 'ASK') { stopEvent(e); askPopup(a.href, a.target || '_blank', '', true); }
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
            if (!isReady()) {
                stopEvent(e);
                _pendingActions.push(() => { if (form.isConnected) form.submit(); });
                return;
            }
            const action = checkCrossOriginPopup(form.action);
            if (action === 'BLOCK') { stopEvent(e); return; }
            if (action === 'ASK') { stopEvent(e); askPopup(form.action, form.target || '_self', '', true); return; }
            return;
        }

        if (isNewTabTarget(getEffectiveTarget(form))) {
            if (!isSiteHasAds()) return;
            let action = checkCrossOriginPopup(form.action);
            if (action === 'BLOCK') {
                stopEvent(e);
                return;
            }
            if (action === 'ASK') {
                if (e.isTrusted && !popupBlockedDuringClick) return;
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

    // Note: no bubble-phase click listener needed here — handleLinkEvent (capture)
    // already handles all trusted clicks correctly using trustedLinkUrl.

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
        try { w.Object; } catch (_) { return; } // cross-origin → bail
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
                    if (getNavAction(targetUrl) === 'BLOCK') return fakeWindow;
                    if (targetUrl !== 'about:blank') {
                        try {
                            const dest = new URL(targetUrl, location.href);
                            if (dest.origin === getTopOrigin()) {
                                const isStandardTarget = !name || name === '_blank' || name === '_self' ||
                                    name === '_top' || name === '_parent' || name === '_new';
                                if (isTrustedClickOnLink && isStandardTarget) {
                                    const isForcedNewTab = (name === '_blank' || name === '_new') && (trustedLinkTarget !== '_blank' && trustedLinkTarget !== '_new');

                                    if (isForcedNewTab) {
                                        popupBlockedDuringClick = true;
                                        if (!isReplayingClick) replayClickAfterBlock();
                                        return fakeWindow;
                                    }

                                    popupOpenedDuringClick = true;
                                    return wOpen.call(w, url, name, specs);
                                }
                                // Suspicious named window + trusted click → silent block + replay.
                                if (isTrustedClickOnLink) {
                                    popupBlockedDuringClick = true;
                                    if (!isReplayingClick) replayClickAfterBlock();
                                    return fakeWindow;
                                }
                                // No trusted click → auto popup → ASK.
                                if (getPopupAction() === 'BLOCK') return fakeWindow;
                                askPopup(targetUrl, name, specs);
                                return fakeWindow;
                            }
                        } catch (_) { }
                    }
                    const action = getPopupAction();
                    if (isTrustedClickOnLink && action === 'ASK' && trustedLinkUrl) {
                        try {
                            const dest = new URL(targetUrl, location.href);
                            const trusted = new URL(trustedLinkUrl);
                            if (dest.origin === trusted.origin && dest.pathname === trusted.pathname) {
                                popupOpenedDuringClick = true;
                                return wOpen.call(w, url, name, specs);
                            }
                        } catch (_) { }
                    }

                    if (action === 'BLOCK') {
                        if (isTrustedClickOnLink) {
                            popupBlockedDuringClick = true;
                            if (!isReplayingClick) replayClickAfterBlock();
                        }
                        return fakeWindow;
                    }
                    if (action === 'ASK') {
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
        } catch (_) { }

        // Hook document.location setter on child window's document.
        try {
            const childDoc = w.document;
            Object.defineProperty(childDoc, 'location', {
                get() { return childDoc.defaultView.location; },
                set(v) {
                    interceptNav(String(v), u => { origAssign.call(childDoc.defaultView.location, u); });
                },
                configurable: true,
                enumerable: true
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
        // Try immediately (works if iframe already loaded)
        try { protectWindow(el.contentWindow); } catch (_) { }
        // Also hook on load — iframe may not have documentElement yet when added to DOM
        el.addEventListener('load', () => {
            try { protectWindow(el.contentWindow); } catch (_) { }
        });
    };

    // Protect iframes already in the DOM at injection time
    document.querySelectorAll('iframe, frame').forEach(protectIframe);


    new MutationObserver(mutations => {
        if (document.documentElement && currentDocEl !== document.documentElement) {
            currentDocEl = document.documentElement;
            attachDocListeners(document);
        }
        for (const m of mutations) {
            for (const node of m.addedNodes) {
                if (node.nodeType !== 1) continue;
                if (node.tagName === 'IFRAME' || node.tagName === 'FRAME') {
                    protectIframe(node);
                } else if (node.getElementsByTagName) {
                    const frames = node.getElementsByTagName('iframe');
                    for (let i = 0; i < frames.length; i++) protectIframe(frames[i]);
                    const frames2 = node.getElementsByTagName('frame');
                    for (let i = 0; i < frames2.length; i++) protectIframe(frames2[i]);
                }
            }
        }
    }).observe(document, { childList: true, subtree: true });



})();