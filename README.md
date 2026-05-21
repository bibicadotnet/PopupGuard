# PopupGuard

**[🇻🇳 Tiếng Việt](README.vi.md)**

> **Take back control of your browsing experience.** This extension stops unwanted popups, automatic new tabs, and sneaky redirects, giving you the final say before any page opens.

---

## Core Features

When a website tries to open a new tab, window, or navigate to another page, an alert dialog will appear directly in the current tab.

### Action Buttons
* **Allow this time** (Green): Allow the request once.
* **Block this time** (Red): Block the request once.

### Checkboxes (Remember Rules)
Your choice will be saved (you can change or delete it anytime via the extension popup). Checking one option will automatically uncheck its opposite:
* **Always allow `[source]` to open new tabs**: Automatically allow all future attempts to open new tabs/windows from this source domain.
* **Always block `[source]` from opening new tabs**: Programmatic requests to open new tabs/windows from this source domain will be silently blocked. However, if you **physically click** a link, the system will still prompt you (ASK) to ensure legitimate links are not blocked by mistake.
* **Block all network requests to `[destination]`**: All connections to the destination domain (scripts, images, iframes, navigation...) will be completely blocked at the network level (DNS level). The page will automatically reload after you click the *Block this time* button to apply the rule.

*(Note: Domains in the whitelist such as shopee.vn, tiktok.com, etc., will be automatically bypassed).*

---

## Dashboard (Extension Popup)

Click on the extension icon in the toolbar to manually manage rules:

- **Current Tab:** View and quickly change the rule for the current tab.
- **Allowed / Blocked:** Manage the list of domains allowed or blocked from opening popups.
- **Network:** List of domains completely blocked at the network/DNS level.
- **Default:** A whitelist of trusted domains (Google, Facebook...), which are always allowed and cannot be blocked.
- **Manual Add:** Supports domains (`example.com`) or wildcards (`*.example.com`). In the **All** tab, allows adding rules by option. Other tabs, the added domain will default to that tab.
- **Search & Delete:** Quickly filter and remove rules.

---

## Installation Guide

1. Download and extract the **[PopupGuard.zip](https://github.com/bibicadotnet/PopupGuard/releases/latest/download/PopupGuard.zip)** file.
2. Open `chrome://extensions/` in your browser.
3. Enable **Developer mode**.
4. Click **Load unpacked** and select the extracted folder.

---

## User Experience

Once installed, you'll rarely need to open the dashboard. Alert dialogs appear directly on the page, letting you quickly handle them (Allow/Block) without interrupting your browsing flow.

---

## Privacy & Security

The extension works completely offline on your device:
* **No remote code execution:** All source code is bundled and runs locally.
* **No tracking:** We do not collect or send your browsing history anywhere.
* **Secure storage:** Your rules are saved directly using your browser's built-in `storage.sync` API.
