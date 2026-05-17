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
            return 'ASK';
        }

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
        HTMLMediaElement.prototype.play = function() { return Promise.resolve(); };
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

    const replayClickAfterBlock = () => {
        if (!lastMousedownPos || isReplayingClick) return;
        const { x, y } = lastMousedownPos;
        lastMousedownPos = null;

        setTimeout(() => {
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
                } catch (_) {}
            }

            isReplayingClick = true;
            el.dispatchEvent(new MouseEvent('click', {
                bubbles: true, cancelable: true,
                clientX: x, clientY: y, view: window
            }));
            isReplayingClick = false;
        }, 50);
    };

    const originalOpen = window.open;

    const fakeWindow = Object.freeze({
        closed: true,
        name: '',
        close()  {},
        focus()  {},
        blur()   {},
        postMessage() {},
        location: Object.freeze({ href: 'about:blank', assign() {}, replace() {} }),
    });

    const interceptedOpen = function (url, name, specs) {
        const targetUrl = url || 'about:blank';
        const action = getPopupAction();
        if (action === 'BLOCK') {
            siteHasAds = true;
            if (!isReplayingClick) replayClickAfterBlock();
            return fakeWindow;
        }
        if (action === 'ASK')   { siteHasAds = true; askPopup(targetUrl, name, specs); return fakeWindow; }
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
        askPopup(url, '_self', '');
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

    const handleLinkEvent = (e) => {
        if (!e.isTrusted) return;
        const a = e.composedPath().find(el => el.tagName === 'A');
        if (!a || !a.href) return;

        const navAction = getNavAction(a.href);
        if (navAction === 'BLOCK') {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            return;
        }

        const t = (a.target || '').toLowerCase();
        const isNewTab = t === '_blank' || t === '_new'
            || (t !== '' && t !== '_self' && t !== '_top' && t !== '_parent');

        if (isNewTab) {
            try {
                const dest = new URL(a.href, location.href);
                if (dest.origin === location.origin) return;
            } catch (_) { return; }

            const action = getPopupAction();
            if (action === 'BLOCK') {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                return;
            }
            if (action === 'ASK') {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                askPopup(a.href, a.target || '_blank', '');
                return;
            }
        }
    };

    document.addEventListener('mousedown', handleLinkEvent, true);
    document.addEventListener('click', handleLinkEvent, true);

    const originalClick = HTMLElement.prototype.click;
    HTMLElement.prototype.click = function () {
        if (this.tagName === 'A' && this.href) {
            try {
                const dest = new URL(this.href, location.href);
                if (dest.origin !== location.origin) {
                    const t = (this.target || '').toLowerCase();
                    const isNewTab = t === '_blank' || t === '_new'
                        || (t !== '' && t !== '_self' && t !== '_top' && t !== '_parent');
                    if (isNewTab) {
                        const action = getPopupAction();
                        if (action === 'BLOCK') return;
                        if (action === 'ASK') { askPopup(this.href); return; }
                    }
                }
            } catch (e) { }
        }
        return originalClick.call(this);
    };

})();
