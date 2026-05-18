# NoMoreTabs

**[🇻🇳 Tiếng Việt](README.vi.md)**

![NoMoreTabs Banner](https://img.bibica.net/srvMVjnP.png)

Browser extension to block unwanted popups, new tabs, and automatic redirects.

## How it Works
When a website tries to open a new tab, window, or redirect you to another site, a confirmation dialog appears inside your current tab.

### Action Buttons
* **Allow this time** (green): Allow the request once.
* **Block this time** (red): Block the request once.

### Checkboxes (Saves permanent rules)
Checking one box automatically disables the opposite action button:
* **Always allow [source] to open new tabs**: Future popup/tab requests from this domain are automatically allowed. (Automatically disables the *Block this time* button).
* **Always block [source] from opening new tabs**: Future popup/tab requests from this domain are silently blocked without asking. (Automatically disables the *Allow this time* button).
* **Block all network requests to [destination]**: Completely blocks all resource requests (scripts, images, frames, etc.) to the destination domain at the network level (declarativeNetRequest). The dialog only shows this option when the destination domain differs from the source domain. If checked, the page reloads automatically after clicking **Block this time**. *(Default allowlisted domains like shopee.vn, tiktok.com... are automatically bypassed).*

---

## Extension Popup
Click the extension icon in your toolbar to manage rules manually:

* **Dynamic Status Card**: Automatically detects the active website's status (Blocked, Allowed, Network, Default, or No rule). Easily toggle or remove rules directly via quick action buttons (Block, Allow, Clear).
* **Intuitive Tabbed Filtering**:
  * **All**: All custom rules + default safe list.
  * **Blocked**: Source domains blocked from opening popups (`popupBlock`).
  * **Allowed**: Source domains allowed to open popups (`popupAllow`).
  * **Network**: Destination domains blocked at the network level (`navBlock`).
  * **Default**: Built-in safe list (`allowlist.json`), containing trusted domains (Google, Facebook, banks...) that are always allowed and cannot be blocked to prevent breaking crucial websites.
* **Manual Input**: Supports standard domains `example.com` and wildcards `*.example.com`.
* Honestly, there isn't much to configure. Managing rules on-the-fly through the active dialog alerts is usually more than enough. You'll mostly open the popup to review if you accidentally added or blocked a domain. The built-in search bar makes it super fast and simple.

---

## Installation
1. Download and extract **[NoMoreTabs.zip](https://github.com/bibicadotnet/NoMoreTabs/releases/latest/download/NoMoreTabs.zip)**.
2. Open `chrome://extensions/` in your browser.
3. Enable **Developer mode**.
4. Click **Load unpacked** and select the extracted folder.

*Note: This extension must be installed manually. It is not available on chromewebstore.google.com because registration costs $5 :]]*