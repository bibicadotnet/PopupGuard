'use strict';

const RESOURCE_TYPES = [
    'main_frame', 'sub_frame', 'script', 'stylesheet',
    'image', 'font', 'object', 'xmlhttprequest',
    'ping', 'csp_report', 'media', 'websocket', 'other'
];

const syncNetworkRules = async () => {
    const data = await chrome.storage.sync.get(['navBlock']);
    const navBlock = data.navBlock || [];

    const existing = await chrome.declarativeNetRequest.getDynamicRules();
    const removeRuleIds = existing.map(r => r.id);

    const addRules = navBlock.map((domain, i) => {
        const isWildcard = domain.startsWith('*.');
        const base = isWildcard ? domain.slice(2) : domain;
        let condition;
        if (isWildcard) {
            condition = { urlFilter: `||${base}^`, resourceTypes: RESOURCE_TYPES };
        } else {
            const escaped = base.replace(/\./g, '\\.');
            condition = { regexFilter: `^https?://${escaped}([/:?#]|$)`, resourceTypes: RESOURCE_TYPES };
        }
        return { id: i + 1, priority: 1, action: { type: 'block' }, condition };
    });

    await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds,
        addRules
    });
};

chrome.runtime.onInstalled.addListener(syncNetworkRules);
chrome.runtime.onStartup.addListener(syncNetworkRules);
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.navBlock) syncNetworkRules();
});
