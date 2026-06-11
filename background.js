'use strict';

const RES = [
    'main_frame','sub_frame','script','stylesheet','image','font',
    'object','xmlhttprequest','ping','csp_report','media','websocket','other'
];

const syncRules = async () => {
    const { navBlock = [] } = await chrome.storage.sync.get('navBlock');
    const existing = await chrome.declarativeNetRequest.getDynamicRules();
    await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: existing.map(r => r.id),
        addRules: navBlock.map((domain, i) => ({
            id: i + 1, priority: 1,
            action: { type: 'block' },
            condition: { urlFilter: `||${domain.startsWith('*.') ? domain.slice(2) : domain}^`, resourceTypes: RES }
        }))
    });
};

chrome.runtime.onInstalled.addListener(syncRules);
chrome.runtime.onStartup.addListener(syncRules);
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.navBlock) syncRules();
});
