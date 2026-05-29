'use strict';

const syncNetworkRules = async () => {
    const data = await chrome.storage.sync.get(['navBlock']);
    const navBlock = data.navBlock || [];

    const existing = await chrome.declarativeNetRequest.getDynamicRules();
    const removeRuleIds = existing.map(r => r.id);

    const resourceTypes = [
        'main_frame', 'sub_frame', 'script', 'stylesheet',
        'image', 'font', 'object', 'xmlhttprequest',
        'ping', 'csp_report', 'media', 'websocket', 'other'
    ];

    const addRules = navBlock.map((domain, i) => {
        const base = domain.startsWith('*.') ? domain.slice(2) : domain;
        const condition = { urlFilter: `||${base}^`, resourceTypes };
        return { id: i + 1, priority: 1, action: { type: 'block' }, condition };
    });

    await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: removeRuleIds,
        addRules: addRules
    });
};

chrome.runtime.onInstalled.addListener(syncNetworkRules);
chrome.runtime.onStartup.addListener(syncNetworkRules);
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.navBlock) syncNetworkRules();
});
