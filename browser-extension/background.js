"use strict";
// Host access is limited to Steam Community. No Steam Web API key or password.
const APP_ID = "311210";
const CATALOG_ORIGIN = "https://k7ysh5a41.github.io";
const CATALOG_PATH = "/AAE-Custom-Map-Category/";
const MAX_HTML_BYTES = 2500000;
function isTrustedCatalog(sender) {
    try {
        const u = new URL(sender.url || "");
        return u.origin === CATALOG_ORIGIN &&
            (u.pathname === CATALOG_PATH.slice(0,-1) || u.pathname.startsWith(CATALOG_PATH));
    } catch (_) { return false; }
}
async function getSubscriptionsPage(page) {
    const url = new URL("https://steamcommunity.com/my/myworkshopfiles/");
    url.searchParams.set("appid",APP_ID);
    url.searchParams.set("browsefilter","mysubscriptions");
    url.searchParams.set("p",String(page));
    const response = await fetch(url.toString(),{
        credentials:"include",cache:"no-store",redirect:"follow",
        referrerPolicy:"no-referrer"
    });
    if (!response.ok) throw new Error("Steam HTTP " + response.status);
    const finalUrl = new URL(response.url);
    if (finalUrl.hostname !== "steamcommunity.com" ||
        /\/login(?:\/|$)/i.test(finalUrl.pathname)) {
        throw new Error("Sign in to Steam Community in this browser first.");
    }
    const html = await response.text();
    if (html.length > MAX_HTML_BYTES) throw new Error("Steam page exceeds safe size.");
    return {ok:true,html,finalUrl:finalUrl.href};
}
chrome.runtime.onMessage.addListener((message,sender,sendResponse) => {
    if (!isTrustedCatalog(sender) || message?.type !== "AAE_STEAM_FETCH_PAGE" ||
        !Number.isSafeInteger(message.page) || message.page < 1 || message.page > 100) return false;
    getSubscriptionsPage(message.page).then(sendResponse)
        .catch(error => sendResponse({ok:false,error:String(error.message || error)}));
    return true;
});
