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
            "[data-publishedfileid]","[id^='sharedfile_']",
            "[id^='UnsubscribeItemBtn']", ".subscribeOption.subscribeOptionUnsubscribe"
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
        // Steam's subscribed-item controls provide a more specific signal than
        // general Workshop links (which may contain recommendations).
        for (const link of doc.querySelectorAll('a[id^="UnsubscribeItemBtn"]')) {
            const target = String(link.getAttribute("href") || "");
            const match = target.match(/(?:id=|\()(\d{7,20})(?:\D|$)/);
            if (match) add(match[1]);
        }
        const paging = doc.querySelector(".workshopBrowsePagingInfo");
        const pagingText = paging?.textContent || "";
        const matchTotal = pagingText.match(/(?:of|von|de|共|／)\s*([\d,]+)/i) ||
            pagingText.match(/([\d,]+)\s*(?:items|results|Workshop)/i);
        const expectedTotal = matchTotal ? Number(matchTotal[1].replace(/,/g, "")) : null;
        // Reject login / CAPTCHA pages; never silently overwrite prior data.
        const confirmed = Boolean(doc.querySelector(
            '[id^="UnsubscribeItemBtn"],.workshopBrowsePagingInfo,#no_items'
        )) || (cards.length > 0 &&
            /browsefilter=mysubscriptions|subscribed items|已订阅|登録済み/i.test(html));
        const explicitEmpty = Boolean(doc.querySelector("#no_items")) || expectedTotal === 0;
        return {ids:[...items],confirmed,expectedTotal,explicitEmpty};

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
            let expectedTotal=null;
            let completed=false;
            for (let page=1;page<=MAX_PAGES;page++) {
                const result=await fetchPage(page);
                if (!result.confirmed)
                    throw new Error("Unable to verify Steam subscriptions. Sign in to Steam Community.");
                confirmed=true;
                if (page===1 && Number.isSafeInteger(result.expectedTotal))
                    expectedTotal=result.expectedTotal;
                if (page===1 && result.ids.length===0 && !result.explicitEmpty)
                    throw new Error("Steam returned no verifiable subscribed items; previous marks were preserved.");
                let newCount=0;
                for (const id of result.ids) {
                    if (!found.has(id)) {found.add(id);newCount++;}
                }
                if (!result.ids.length || newCount===0) {
                    completed=true;
                    break;
                }
                if (expectedTotal!==null && found.size>=expectedTotal) {
                    completed=true;
                    break;
                }
            }
            if (!confirmed || !completed || (expectedTotal!==null && found.size<expectedTotal))
                throw new Error("Unable to verify all Steam subscription pages; existing marks were preserved.");
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
        if (event.data.type==="request") sync(true);
    });
    send("ready");
    sync(true);
    setInterval(() => sync(false),SYNC_EVERY_MS);
})();
