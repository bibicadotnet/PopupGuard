# PopupGuard

![XS84xGJp](https://img.bibica.net/XS84xGJp.png)

**[🇻🇳 Tiếng Việt](README.vi.md)**

> This extension prevents unwanted popups, automated new tabs, and sneaky redirects, giving you the final say.

---

## Installation Guide

- Go to [PopupGuard](https://chromewebstore.google.com/detail/popupguard/ebpnmjkhlljiilkobejkdbhjjmjmjiaf), and install it like a regular plugin.

## Core Features

When a website attempts to sneakily open a new tab, a new window, or navigate to another page, an alert dialog will appear right in the current tab.

![rwT0lHDJ](https://img.bibica.net/rwT0lHDJ.png)

### Action Buttons
* **Allow this time** (Green): Allow this request once.
* **Block this time** (Red): Block this request once.

### Checkboxes (Remember Rules)
Your choices will be saved (you can change or delete them anytime via the extension icon). Checking one box will automatically uncheck the opposing option:
* **Always allow `[source]` to open new tabs**: Automatically allow all future attempts to open new tabs/windows from this source domain.
* **Always block `[source]` from opening new tabs**: Automated requests to open popups (via hidden scripts) from this source domain will be silently blocked. However, if you **manually click (physical click)** on a link, the system will still show a prompt to ensure valid links are not mistakenly blocked.
* **Block all network requests to `[destination]`**: All connections to the destination domain (scripts, images, iframes, navigation...) will be completely blocked at the network level (DNS level). The page will automatically reload after you click the *Block this time* button to apply the rule.

*(Note: Domains that navigate to the whitelist such as shopee.vn, tiktok.com, etc. will automatically be ignored).*

## Control Panel (Extension Popup)

Click the extension icon on the toolbar to manage manually:

![P2g7510N](https://img.bibica.net/P2g7510N.webp)

- **Current Tab:** View and quickly change the rules for the current tab.
- **Allowed / Blocked:** Manage the list of sites that are allowed or blocked from opening popups.
- **Network:** List of sites completely blocked at the network/DNS level.
- **Default:** Whitelist of reputable sites (Google, Facebook...), which are always allowed and cannot be blocked.
- **Manual Addition:** Supports domains (`example.com`) or wildcards (`*.example.com`). In the **All** tab, you can add rules with options. In other tabs, the added domain will default to that tab.
- **Search & Delete:** Filter and quickly delete rules.

## User Experience

After installation, you will rarely need to open the control panel. Alert dialogs will appear directly on the website for you to quickly handle (Allow/Block) without interrupting your browsing.

PopupGuard is not designed to block ads, or block when users manually click on an ad banner; its purpose is to block popups/redirects called stealthily.

---

## Privacy & Security

The extension works completely offline on your device:
* **No remote code execution:** All source code is packaged and runs locally.
* **No tracking:** Does not collect or send browsing history externally.
* **Secure storage:** Rules are stored directly using the browser's `storage.sync` feature.
