(function () {
    'use strict';

    const checkMatch = (host, list) => {
        if (!host || !list) return false;
        return list.some(x => x.startsWith('*.')
            ? (host === x.slice(2) || host.endsWith('.' + x.slice(2)))
            : host === x);
    };

    const getPopupAction = () => {
        const pal = JSON.parse(document.documentElement.getAttribute('data-nmt-pal') || '[]');
        const pbl = JSON.parse(document.documentElement.getAttribute('data-nmt-pbl') || '[]');

        let topHost;
        try {
            topHost = new URL(window.top.location.href).hostname.toLowerCase();
        } catch (e) {
            if (window.location.ancestorOrigins && window.location.ancestorOrigins.length > 0) {
                try {
                    topHost = new URL(window.location.ancestorOrigins[window.location.ancestorOrigins.length - 1]).hostname.toLowerCase();
                } catch (err) { }
            }
        }

        if (!topHost) return 'ASK';

        if (checkMatch(topHost, pal)) return 'ALLOW';
        if (checkMatch(topHost, pbl)) return 'BLOCK';
        return 'ASK';
    };

    const getNavAction = (url) => {
        try {
            const dest = new URL(url, location.href);
            const nbl = JSON.parse(document.documentElement.getAttribute('data-nmt-nbl') || '[]');
            if (checkMatch(dest.hostname.toLowerCase(), nbl)) return 'BLOCK';
        } catch (e) { }
        return 'ALLOW';
    };

    let popupPending = false;
    let siteHasAds = false;
    let pendingNav = null;
    let lastMousedownPos = null;
    let isReplayingClick = false;
    const origPlay = HTMLMediaElement.prototype.play;

    document.addEventListener('mousedown', e => {
        if (e.isTrusted && !isReplayingClick) {
            lastMousedownPos = { x: e.clientX, y: e.clientY };
        }
    }, true);

    const freezePage = () => {
        if (document.getElementById('nmt-freeze')) return;
        HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
        document.querySelectorAll('video, audio').forEach(m => { if (!m.paused) m.pause(); });
        const style = document.createElement('style');
        style.id = 'nmt-freeze';
        style.textContent = '*, *::before, *::after { animation-play-state: paused !important; transition: none !important; }';
        document.head?.appendChild(style);
    };

    const unfreezePage = () => {
        HTMLMediaElement.prototype.play = origPlay;
        document.getElementById('nmt-freeze')?.remove();
    };

    const askPopup = (url, name, specs, isNav = false) => {
        popupPending = true;
        freezePage();
        let resolved = url;
        try { resolved = new URL(url, location.href).href; } catch (_) { }
        window.postMessage({
            action: 'NMT_ASK',
            url: resolved,
            name,
            specs,
            source: location.hostname,
            isNav
        }, '*');
    };

    window.addEventListener('message', e => {
        if (e.data?.action === 'NMT_DIALOG_CLOSED') {
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
        const targetUrl = url || 'about:blank';
        const action = getPopupAction();
        if (action === 'BLOCK') {
            siteHasAds = true;
            if (!isReplayingClick) replayClickAfterBlock();
            return fakeWindow;
        }
        if (action === 'ASK') { siteHasAds = true; askPopup(targetUrl, name, specs); return fakeWindow; }
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

        const action = getPopupAction();
        if (action === 'ALLOW') { doNavigate(url); return; }
        if (action === 'BLOCK') return;
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
            if (!siteHasAds) return;
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
    document.documentElement.setAttribute('data-nmt-nav-token', navToken);
    window.addEventListener('message', e => {
        if (e.data?.action === 'NMT_DO_NAV' && e.data.token === navToken) {
            bypassNext = true;
            if (origAssign) origAssign.call(location, e.data.url);
            else location.href = e.data.url;
        }
    });

    const stopEvent = (e) => {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
    };

    const isNewTabTarget = (t) =>
        t === '_blank' || t === '_new'
        || (t !== '' && t !== '_self' && t !== '_top' && t !== '_parent');

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
        if (!e.isTrusted || popupPending) return;
        if (e.type === 'auxclick' && e.button !== 1) return;
        const a = e.composedPath().find(el => el.tagName === 'A');
        if (!a || !a.href) return;

        if (getNavAction(a.href) === 'BLOCK') { stopEvent(e); return; }

        const forceNewTab = e.type === 'auxclick';
        if (!forceNewTab && !isNewTabTarget(getEffectiveTarget(a))) return;

        const action = checkCrossOriginPopup(a.href);
        if (action === 'BLOCK') { stopEvent(e); return; }
        if (action === 'ASK') { stopEvent(e); askPopup(a.href, a.target || '_blank', ''); }
    };

    document.addEventListener('mousedown', handleLinkEvent, true);
    document.addEventListener('click', handleLinkEvent, true);
    document.addEventListener('auxclick', handleLinkEvent, true);

    const originalClick = HTMLElement.prototype.click;
    HTMLElement.prototype.click = function () {
        if (this.tagName === 'A' && this.href && isNewTabTarget(getEffectiveTarget(this))) {
            const action = checkCrossOriginPopup(this.href);
            if (action === 'BLOCK') return;
            if (action === 'ASK') { askPopup(this.href, this.target || '_blank', ''); return; }
        }
        return originalClick.call(this);
    };

    const originalSubmit = HTMLFormElement.prototype.submit;
    HTMLFormElement.prototype.submit = function () {
        if (this.action && isNewTabTarget((this.target || '').toLowerCase())) {
            const action = checkCrossOriginPopup(this.action);
            if (action === 'BLOCK') return;
            if (action === 'ASK') { askPopup(this.action, this.target || '_blank', ''); return; }
        }
        if (!this.isConnected) return;
        return originalSubmit.call(this);
    };

    if (HTMLFormElement.prototype.requestSubmit) {
        const orig = HTMLFormElement.prototype.requestSubmit;
        HTMLFormElement.prototype.requestSubmit = function (s) {
            if (this.action && isNewTabTarget((s?.formTarget || this.target || '').toLowerCase())) {
                const action = checkCrossOriginPopup(this.action);
                if (action === 'BLOCK') return;
                if (action === 'ASK') { askPopup(this.action, this.target || '_blank', ''); return; }
            }
            if (!this.isConnected) return;
            return orig.call(this, s);
        };
    }

})();