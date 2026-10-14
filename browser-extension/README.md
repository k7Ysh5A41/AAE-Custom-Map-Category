# AAE Steam subscription automatic sync (Chrome / Edge)

The AAE map catalog is a static GitHub Pages website. Browser JavaScript alone cannot read the active Steam desktop client's subscriptions. This optional browser extension uses the signed-in **Steam Community session in the same browser** to fetch your own Workshop subscriptions for **Black Ops III (AppID 311210)**.

## Install once

1. Sign into [Steam Community](https://steamcommunity.com/) in Chrome or Edge. This may differ from the account used by the desktop Steam client.
2. Download the repository ZIP (Code → Download ZIP) and extract it.
3. Open `chrome://extensions` (or `edge://extensions`), enable **Developer mode**, select **Load unpacked**, and choose this `browser-extension` folder.
4. Open or refresh the [AAE map catalog](https://k7ysh5a41.github.io/AAE-Custom-Map-Category/).

Once installed, the extension refreshes subscriptions automatically on page load and approximately every five minutes while the catalog remains open. No Steam API key, password entry into AAE, HTML export, or manual ID import is necessary.

## Privacy and limitations

- Permissions: reading `steamcommunity.com`, and a content script **only** on `k7ysh5a41.github.io`.
- The extension uses browser Steam Community cookies for authenticated page requests. It never reads, stores, transmits, or exposes cookie values or passwords to the catalog.
- Only Workshop IDs are passed to the AAE page and saved in its local browser storage; no backend upload.
- If the Steam Community account is not logged in, a request fails, Steam changes its HTML layout, or pagination cannot be completed, the page displays an error rather than claiming a successful sync.
- Steam's HTML is not an official stable subscription API. This feature may need maintenance if Steam changes its page.
- Does not detect Steam desktop login or switch accounts automatically; it follows the signed-in Steam Community account in this browser.
