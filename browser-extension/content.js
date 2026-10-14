"use strict";
(() => {
    // Only the exact AAE catalog receives subscription identifiers.
    if (location.origin !== "https://k7ysh5a41.github.io" ||
        !/^\/AAE-Custom-Map-Category(?:\/|$)/.test(location.pathname)) return;
    const TAG = "AAE_STEAM_SUBSCRIPTIONS_EXTENSION_V1";
    const APP_ID = "311210";
    const MAX_PAGES = 100;
    const SYNC_EVERY_MS = 5 * 60 * 1000;
    let working = false;
    let lastStarted = 0;
    const send = (type,data = {}) => window.postMessage({tag:TAG,type,...data},location.origin);

    function parsePage(html) {
        const doc = new DOMParser().parseFromString(html,"text/html");
        const items = new Set();
        const add = id => {
            if (/^\d{7,20}$/.test(String(id || ""))) items.add(String(id));
        };
        const cards = doc.querySelectorAll([
            ".workshopItem",".workshopItemSubscription",".workshopItemPreviewHolder",
            "[data-publishedfileid]","[id^='sharedfile_']"
        ].join(","));
        for (const card of cards) {
            add(card.getAttribute("data-publishedfileid"));
            const match=(card.id || "").match(/^sharedfile_(\d{7,20})$/);
            if (match) add(match[1]);
            for (const link of card.querySelectorAll("a[href]")) {
                let url;
                try { url=new URL(link.getAttribute("href"),"https://steamcommunity.com"); }
                catch (_) { continue; }
                if (url.hostname === "steamcommunity.com" &&
                    /^\/(?:sharedfiles|workshop)\/filedetails\/?$/.test(url.pathname)) {
                    add(url.searchParams.get("id"));
                }
            }
        }
        // Do not treat unrelated links, recommendations or Steam login as subscriptions.
        const confirmed = cards.length > 0 ||
            Boolean(doc.querySelector(".workshopBrowsePaging,.pagingPageLinks,.workshopItemList")) ||
            /browsefilter=mysubscriptions/i.test(html);
        return {ids:[...items],confirmed};
    }
    async function fetchPage(page) {
        const r=await chrome.runtime.sendMessage({type:"AAE_STEAM_FETCH_PAGE",page});
        if (!r?.ok) throw new Error(r?.error || "Steam Community request failed");
        return parsePage(r.html);
    }
    async function sync(force = false) {
        if (working || (!force && Date.now()-lastStarted < 30000)) return;
        working=true;
        lastStarted=Date.now();
        send("syncing");
        try {
            const found=new Set();
            let confirmed=false;
            for (let page=1;page<=MAX_PAGES;page++) {
                const result=await fetchPage(page);
                if (!result.confirmed && page===1)
                    throw new Error("Unable to verify Steam subscriptions. Sign in to steamcommunity.com in this browser.");
                confirmed ||= result.confirmed;
                let newCount=0;
                for (const id of result.ids) {
                    if (!found.has(id)) {found.add(id);newCount++;}
                }
                if (!result.ids.length || newCount===0) break;
                if (page===MAX_PAGES)
                    throw new Error("Steam subscription list is too large to verify completely.");
            }
            if (!confirmed) throw new Error("Subscription page could not be verified.");
            send("synced",{ids:[...found],checkedAt:new Date().toISOString(),appId:APP_ID});
        } catch (error) {
            send("error",{message:String(error?.message || error)});
        } finally {
            working=false;
        }
    }
    window.addEventListener("message",event => {
        if (event.source!==window || event.origin!==location.origin ||
            event.data?.tag!=="AAE_STEAM_SUBSCRIPTIONS_CATALOG_V1") return;
        if (event.data.type==="request") {
            send("ready");
            sync(true);
        }
    });
    send("ready");
    sync(true);
    setInterval(() => sync(false),SYNC_EVERY_MS);
})();
