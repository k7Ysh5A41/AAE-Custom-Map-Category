"use strict";

const DATA_URL = "./custommap_cate.json";
const STEAM_URL = "./steam_workshop.json";
const PENDING_URL = "./pending_pr_maps.json";
const RECENT_URL = "./recent_maps.json";
const MAP_RECENCY_URL = "./map_recency.json";
const RECENT_CATEGORY = "recently-updated";
const RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const PENDING_CATEGORY = "pending";
const PENDING_CHANGES = "pending-changes";
const PENDING_DELETION = "pending-deletion";
const INCOMPATIBLE_CATEGORY = "AAEP_INCP_MAP";
const NEW_PR_WINDOW_MS = RECENT_WINDOW_MS;
const RESOURCE_TIMEOUT_MS = 10000;
async function fetchWithTimeout(url, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), RESOURCE_TIMEOUT_MS);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}
const LOCALIZATION_BASE = "https://raw.githubusercontent.com/k7Ysh5A41/AAE-localizedstrings/main/";
const LOCALIZATION_MIRROR = "./localization/";
const LOCALIZATION_LANGUAGES = Object.freeze({
    en: "english", fr: "french", de: "german", it: "italian",
    ja: "japanese", pl: "polish", pt: "portuguese",
    ru: "russian", es: "spanish",
    "zh-CN": null, "zh-TW": null
});
const LANGUAGE_NAMES = Object.freeze({
    en: "English", fr: "Français", de: "Deutsch", it: "Italiano",
    ja: "日本語", pl: "Polski", pt: "Português", ru: "Русский", es: "Español",
    "zh-CN": "简体中文", "zh-TW": "繁體中文"
});
function normalizeBrowserLanguage(value) {
    const raw = String(value || "").replace(/_/g, "-").toLowerCase();
    if (raw === "zh" || raw.startsWith("zh-")) {
        return /(?:^|-)tw(?:-|$)|(?:^|-)hk(?:-|$)|(?:^|-)mo(?:-|$)|(?:^|-)hant(?:-|$)/.test(raw)
            ? "zh-TW" : "zh-CN";
    }
    return raw.split("-")[0];
}
const LANGUAGE_PREFERENCE_KEY = "aae-map-catalog-language";
function savedLanguageChoice() {
    try {
        const value = window.localStorage.getItem(LANGUAGE_PREFERENCE_KEY);
        return value && Object.hasOwn(LOCALIZATION_LANGUAGES, value) ? value : "auto";
    } catch (_) { return "auto"; }
}
function preferredLocalization() {
    const candidates = Array.isArray(navigator.languages) && navigator.languages.length
        ? navigator.languages : [navigator.language || "en"];
    for (const locale of candidates) {
        const code = normalizeBrowserLanguage(locale);
        if (Object.hasOwn(LOCALIZATION_LANGUAGES, code)) {
            return { code, folder: LOCALIZATION_LANGUAGES[code] };
        }
    }
    return { code: "en", folder: "english" };
}
function selectedLocalization() {
    return state.languageChoice === "auto" ? preferredLocalization() :
        { code: state.languageChoice, folder: LOCALIZATION_LANGUAGES[state.languageChoice] };
}
const $ = id => document.getElementById(id);
const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, char =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]
);
function t(key, variables = {}) {
    const locale = selectedLocalization().code;
    const resource = window.AAE_I18N?.ui || {};
    const text = resource[locale]?.[key] ?? resource.en?.[key] ?? key;
    return String(text).replace(/\{([a-zA-Z]+)\}/g, (_, k) =>
        Object.hasOwn(variables, k) ? String(variables[k]) : "{" + k + "}");
}
function applyUiText() {
    document.title = "All-Around Enhancement — " + t("mapCatalog");
    for (const el of document.querySelectorAll("[data-i18n]")) {
        // When an older translations.js is cached, preserve the readable
        // HTML fallback instead of displaying raw keys like submissionGameSync.
        if (!el.hasAttribute("data-i18n-fallback")) {
            el.setAttribute("data-i18n-fallback", el.textContent);
        }
        const localized = t(el.dataset.i18n);
        el.textContent = localized === el.dataset.i18n
            ? el.getAttribute("data-i18n-fallback") : localized;
    }
    for (const el of document.querySelectorAll("[data-i18n-placeholder]")) {
        el.placeholder = t(el.dataset.i18nPlaceholder);
    }
    for (const el of document.querySelectorAll("[data-i18n-aria-label]")) {
        el.setAttribute("aria-label", t(el.dataset.i18nAriaLabel));
    }
    // Chinese community channels follow the active UI locale, including AUTO.
    const showChineseChannels = ["zh-CN", "zh-TW"].includes(selectedLocalization().code);
    for (const el of document.querySelectorAll("[data-chinese-only]")) {
        el.hidden = !showChineseChannels;
    }
    // Keep the second-level GitHub guide translated when locale changes.
    if ($("githubGuideOverlay") && !$("githubGuideOverlay").hidden) {
        renderGithubGuide();
    }
}
const state = {
    categories: [], maps: [], selected: null, liteOnly: false,
    translations: new Map(), workshop: {}, steamReady: false, steamFailed: false,
    activeMapId: null, query: "", pendingReady: false,
    changeRequests: [], recentReady:false, mapRecency:new Map(), languageChoice: savedLanguageChoice()
};
let localizationRequestId = 0;
const localizationCache = new Map();

// Each language folder stores translated values under LANG_ENGLISH, with
// the original REFERENCE identifiers preserved (e.g. AAEP_ZC2_MAP).
function parseStringEd(source, prefix, output = new Map()) {
    let reference = null;
    let count = 0;
    for (const line of source.split(/\r?\n/)) {
        const key = line.match(/^\s*REFERENCE\s+([A-Za-z0-9_]+)/);
        if (key) { reference = key[1]; continue; }
        const translated = line.match(/^\s*LANG_ENGLISH\s+"((?:\\.|[^"\\])*)"/);
        if (!translated || !reference) continue;
        const value = translated[1]
            .replace(/\\([nrt"\\])/g, (_, code) =>
                code === "n" ? "\n" : code === "r" ? "\r" : code === "t" ? "\t" : code)
            .replace(/\^[0-9]/g, "");
        output.set(prefix + "_" + reference, value);
        count++;
    }
    return count;
}
async function loadStringEd(prefix, folder) {
    const key = folder + "/" + prefix;
    if (localizationCache.has(key)) return localizationCache.get(key);
    const pending = (async () => {
        const segment = encodeURIComponent(prefix) + ".str";
        const candidates = [
            LOCALIZATION_MIRROR + folder + "/" + segment,
            LOCALIZATION_BASE + folder + "/localizedstrings/" + segment
        ];
        const errors = [];
        for (const url of candidates) {
            try {
                const response = await fetchWithTimeout(url, { cache: "no-store" });
                if (!response.ok) throw new Error("HTTP " + response.status);
                const translations = new Map();
                if (!parseStringEd(await response.text(), prefix, translations))
                    throw new Error("Empty StringEd data");
                return translations;
            } catch (error) { errors.push(error.message); }
        }
        throw new Error(folder + "/" + prefix + ": " + errors.join("; "));
    })();
    localizationCache.set(key, pending);
    try { return await pending; }
    catch (error) {
        if (localizationCache.get(key) === pending) localizationCache.delete(key);
        throw error;
    }
}
async function loadLocalizations(categories, locale) {
    if (locale.code === "zh-CN" || locale.code === "zh-TW") {
        const entries = window.AAE_I18N?.categories?.[locale.code] || {};
        return { translations: new Map(Object.entries(entries)),
                 code: locale.code, errors: [] };
    }
    const prefixes = [...new Set(categories
        .flatMap(category => [category?.button, category?.description])
        .filter(key => typeof key === "string")
        .map(key => /^([A-Za-z0-9]+)_/.exec(key)?.[1])
        .filter(Boolean))];
    const results = await Promise.allSettled(prefixes.map(async prefix => {
        const requests = [loadStringEd(prefix, "english")];
        if (locale.folder !== "english") requests.push(loadStringEd(prefix, locale.folder));
        const settled = await Promise.allSettled(requests);
        const translations = new Map();
        if (settled[0].status === "fulfilled") {
            for (const [key, value] of settled[0].value) translations.set(key, value);
        }
        let selectedLanguageLoaded = false;
        if (settled[1]?.status === "fulfilled") {
            for (const [key, value] of settled[1].value) {
                if (value.trim()) translations.set(key, value);
            }
            selectedLanguageLoaded = true;
        }
        if (!translations.size) {
            throw new Error(settled.map(result => result.status === "rejected"
                ? result.reason.message : "").filter(Boolean).join("; "));
        }
        return { translations, selectedLanguageLoaded };
    }));
    const translations = new Map();
    let localized = false;
    for (const result of results) {
        if (result.status !== "fulfilled") continue;
        for (const [key, value] of result.value.translations) translations.set(key, value);
        localized ||= result.value.selectedLanguageLoaded;
    }
    return {
        translations,
        code: localized ? locale.code : "en",
        errors: results.filter(result => result.status === "rejected")
            .map(result => result.reason.message)
    };
}
async function refreshLocalization() {
    if (!state.categories.length) return;
    const requestId = ++localizationRequestId;
    const locale = selectedLocalization();
    try {
        const result = await loadLocalizations(state.categories, locale);
        if (requestId !== localizationRequestId) return;
        state.translations = result.translations;
        document.documentElement.lang = result.code;
        for (const category of state.categories) {
            category.name = categoryName(category);
            category.summary = localize(category.description) || "";
        }
        // Preserve the current map/category/search and update localized labels.
        render();
        updateLanguagePicker();
        applyUiText();
        reportResourceError("localization", result.errors.length
            ? t("localizationError", {detail:result.errors.join("; ")})
            : null);
    } catch (error) {
        if (requestId !== localizationRequestId) return;
        reportResourceError("localization", t("localizationError", {detail:error.message}));
    }
}
function updateLanguagePicker() {
    const locale = selectedLocalization();
    const displayed = LANGUAGE_NAMES[locale.code] || LANGUAGE_NAMES.en;
    $("languageCurrent").textContent = displayed;
    $("languageToggle").title = t("languageTitle", {language: state.languageChoice === "auto"
        ? t("browserLanguage", {language: LANGUAGE_NAMES[locale.code]})
        : LANGUAGE_NAMES[locale.code]});
    $("languageMenu").innerHTML =
        '<button type="button" class="language-option' +
        (state.languageChoice === "auto" ? " selected" : "") +
        '" data-language="auto" aria-pressed="' + (state.languageChoice === "auto") +
        '"><span>' + escapeHtml(t("autoBrowser")) + '</span><small>⌁</small></button>' +
        Object.keys(LOCALIZATION_LANGUAGES).map(code =>
            '<button type="button" class="language-option' +
            (state.languageChoice === code ? " selected" : "") +
            '" data-language="' + code + '" aria-pressed="' +
            (state.languageChoice === code) + '"><span>' +
            escapeHtml(LANGUAGE_NAMES[code]) + '</span></button>'
        ).join("");
}
function closeLanguagePicker(restoreFocus = false) {
    $("languageMenu").hidden = true;
    $("languageToggle").setAttribute("aria-expanded", "false");
    if (restoreFocus) $("languageToggle").focus({preventScroll:true});
}
function setLanguageChoice(code) {
    if (code !== "auto" && !Object.hasOwn(LOCALIZATION_LANGUAGES, code)) return;
    const changed = state.languageChoice !== code;
    state.languageChoice = code;
    if (changed) {
        try { window.localStorage.setItem(LANGUAGE_PREFERENCE_KEY, code); }
        catch (_) { /* Session-only preference if storage is unavailable. */ }
    }
    updateLanguagePicker();
    applyUiText();
    closeLanguagePicker(true);
    if (changed) refreshLocalization();
}
function bindLanguagePicker() {
    updateLanguagePicker();
    $("languageToggle").addEventListener("click", () => {
        const menu = $("languageMenu");
        menu.hidden = !menu.hidden;
        $("languageToggle").setAttribute("aria-expanded", String(!menu.hidden));
        if (!menu.hidden) menu.querySelector(".language-option.selected")?.focus({preventScroll:true});
    });
    $("languageMenu").addEventListener("click", event => {
        const option = event.target.closest("[data-language]");
        if (option) setLanguageChoice(option.dataset.language);
    });
    $("languageMenu").addEventListener("keydown", event => {
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
        const options = [...$("languageMenu").querySelectorAll("[data-language]")];
        const current = options.indexOf(document.activeElement);
        const next = (current + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
        event.preventDefault();
        options[next].focus({preventScroll:true});
    });
    document.addEventListener("click", event => {
        if (!$("languagePicker").contains(event.target)) closeLanguagePicker();
    });
    document.addEventListener("keydown", event => {
        if (event.key === "Escape" && !$("languageMenu").hidden) {
            event.preventDefault();
            closeLanguagePicker(true);
        }
    });
}

async function loadSteamMetadata() {
    try {
        const response = await fetchWithTimeout(STEAM_URL, { cache: "no-store" });
        if (!response.ok) throw new Error("HTTP " + response.status);
        const json = await response.json();
        if (json?.public_only !== true || !json.items ||
            typeof json.items !== "object" || Array.isArray(json.items))
            throw new Error("Public-only Steam verification data is missing");
        // Never expose unverified, private, friends-only or unlisted maps.
        state.workshop = Object.fromEntries(Object.entries(json.items).filter(([id, entry]) =>
            /^\d+$/.test(id) && entry && Number(entry.visibility) === 0 &&
            typeof entry.title === "string" && entry.title.trim().length > 0));
        state.steamReady = true;
        state.steamFailed = false;
        return null;
    } catch (error) {
        state.workshop = {};
        state.steamReady = false;
        state.steamFailed = true;
        return error.message;
    }
}
function localize(key) { return state.translations.get(key); }
function categoryName(category) {
    const key = String(category.button || "");
    const match = /^AAEP_(.+?)_MAP$/i.exec(key);
    return localize(key) || (match ? match[1].replaceAll("_", " · ") :
        (key || "Category " + category.index));
}
function normalize(raw) {
    if (!Array.isArray(raw)) throw new Error("The JSON root must be an array");
    const maps = [];
    const categories = raw.map((category, index) => {
        if (!category || !Array.isArray(category.ugc))
            throw new Error("Category " + (index + 1) + " has no UGC array");
        const record = {
            ...category, order: index, name: categoryName(category),
            summary: localize(category.description) || ""
        };
        category.ugc.forEach((item, position) => {
            const object = item !== null && typeof item === "object" && !Array.isArray(item);
            const id = String(object ? (item.id ?? "") : item);
            if (id) maps.push({
                id, liteOnly: object && item.lite_only === true,
                category: record, position: position + 1
            });
        });
        return record;
    });
    return { categories, maps };
}
async function loadPendingPRMaps() {
    // Snapshot is built from live open PRs at deployment and contains only
    // same-repository community submissions; public Steam verification is
    // still mandatory before a pending map can appear.
    const response = await fetchWithTimeout(PENDING_URL, { cache: "no-store" });
    if (!response.ok) throw new Error("Pending PR feed HTTP " + response.status);
    const payload = await response.json();
    if (!Array.isArray(payload?.items)) throw new Error("Invalid pending PR feed");
    const byCategory = new Map(state.categories.map(category => [category.button, category]));
    const seen = new Set(state.maps.map(map => map.id));
    for (const entry of payload.items) {
        const id = String(entry?.id || "");
        const number = entry?.pr_number;
        const category = byCategory.get(entry?.category);
        if (!/^\d{7,20}$/.test(id) || !category || !Number.isSafeInteger(number) || number < 1 ||
            entry?.pr_url !== "https://github.com/k7Ysh5A41/AAE-Custom-Map-Category/pull/" + number ||
            !Number.isFinite(Date.parse(entry?.created_at)) || seen.has(id)) continue;
        seen.add(id);
        state.maps.push({
            id, liteOnly:entry?.lite_only === true, category, position:category.ugc.length + 1,
            pending: { number, url:entry.pr_url, createdAt:entry.created_at }
        });
    }
    state.changeRequests = [];
    const official = new Map(state.maps.filter(map => !map.pending).map(map => [map.id, map]));
    const changeSeen = new Set();
    for (const change of Array.isArray(payload.changes) ? payload.changes : []) {
        const id = String(change?.id || "");
        const map = official.get(id);
        const action = change?.action;
        const target = change?.target;
        const number = change?.pr_number;
        if (!map || changeSeen.has(id) ||
            !["move","update","delete"].includes(action) ||
            change?.from !== map.category.button ||
            (action === "move" && (!state.categories.some(c => c.button === target) ||
                target === map.category.button)) ||
            (action === "update" && (target !== map.category.button ||
                typeof change?.lite_only !== "boolean" ||
                change.lite_only === map.liteOnly)) ||
            (action === "delete" && target !== "none") ||
            !Number.isSafeInteger(number) || number < 1 ||
            change.pr_url !== "https://github.com/k7Ysh5A41/AAE-Custom-Map-Category/pull/" + number ||
            !Number.isFinite(Date.parse(change?.created_at))) continue;
        changeSeen.add(id);
        const status = {
            id, action, from:change.from, target, liteOnly:change.lite_only,
            number, url:change.pr_url, createdAt:change.created_at
        };
        state.changeRequests.push(status);
        map.changeRequest = status;
    }
    state.pendingReady = true;
    render();
}
async function loadRecentMaps() {
    // This optional published feed contains only merged community changes.
    const response = await fetchWithTimeout(RECENT_URL, { cache: "no-store" });
    if (!response.ok) throw new Error("Recent approved maps HTTP " + response.status);
    const payload = await response.json();
    if (payload?.window_days !== 7 || !Array.isArray(payload?.items))
        throw new Error("Invalid recent-map index");
    const approved = new Map(state.maps.filter(map => !map.pending).map(map => [map.id, map]));
    const seen = new Set();
    for (const entry of payload.items) {
        const id = String(entry?.id || "");
        const map = approved.get(id);
        const timestamp = Date.parse(entry?.merged_at);
        const elapsed = Date.now() - timestamp;
        const prNumber = entry?.pr_number;
        if (!map || seen.has(id) || !/^\d{7,20}$/.test(id) ||
            !["added", "changed"].includes(entry?.kind) ||
            !Number.isFinite(timestamp) || elapsed < 0 || elapsed > RECENT_WINDOW_MS ||
            !Number.isSafeInteger(prNumber) || prNumber < 1) continue;
        map.recent = { kind:entry.kind, mergedAt:entry.merged_at, number:prNumber };
        seen.add(id);
    }
    state.recentReady = true;
    render();
}
function normalizeCatalogTitle(title) {
    return String(title || "").normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase("en");
}
async function loadMapRecency() {
    const response = await fetchWithTimeout(MAP_RECENCY_URL, {cache:"no-store"});
    if (!response.ok) throw new Error("Map recency metadata HTTP " + response.status);
    const payload = await response.json();
    if (payload?.schema_version !== 1 || !Array.isArray(payload?.items))
        throw new Error("Invalid map recency metadata");
    const next = new Map();
    for (const item of payload.items) {
        const title = normalizeCatalogTitle(item?.title);
        const until = Date.parse(item?.new_until);
        if (!title || !Number.isFinite(until)) continue;
        next.set(title, until);
    }
    state.mapRecency = next;
    render();
}
function isCatalogEntryEstablished(map) {
    const info = getSteamInfo(map.id);
    if (!info) return false;
    const until = state.mapRecency.get(normalizeCatalogTitle(info.title));
    return until !== undefined && Date.now() >= until;
}
function isRecentApproved(map) {
    if (isCatalogEntryEstablished(map)) return false;
    if (!map.recent) return false;
    const elapsed = Date.now() - Date.parse(map.recent.mergedAt);
    return Number.isFinite(elapsed) && elapsed >= 0 && elapsed <= RECENT_WINDOW_MS;
}
function isNewPR(map) {
    if (isCatalogEntryEstablished(map) || !map.pending) return false;
    const elapsed = Date.now() - Date.parse(map.pending.createdAt);
    return elapsed >= 0 && elapsed < NEW_PR_WINDOW_MS;
}
function pendingTags(map) {
    if (!map.pending) return "";
    return '<span class="pr-tags">' +
        (isNewPR(map) ? '<span class="chip new-pr">' + escapeHtml(t("newMap")) + '</span>' : '') +
        '<span class="chip pending-pr-chip" title="PR #' + map.pending.number + '">' +
        escapeHtml(t("pendingPR")) + '</span></span>';
}
function newMapTag(map) {
    if (isCatalogEntryEstablished(map)) return "";
    const pendingChange = map.changeRequest;
    const changeAge = pendingChange ? Date.now() - Date.parse(pendingChange.createdAt) : Infinity;
    if (!isRecentApproved(map) &&
        !(pendingChange && changeAge >= 0 && changeAge < NEW_PR_WINDOW_MS)) return "";
    return '<span class="chip recently-new" title="' +
        escapeHtml(t("recentCategorySummary")) + '">' +
        escapeHtml(t("newMap")) + '</span>';
}
function recentMaps() {
    return publicMaps().filter(map => !map.pending && !map.changeRequest &&
        isRecentApproved(map) && (!state.liteOnly || map.liteOnly));
}
function publicMaps() {
    if (!state.steamReady) return [];
    return state.maps.filter(map => Boolean(getSteamInfo(map.id)));
}
function filtered() {
    const query = state.query.trim().toLocaleLowerCase();
    const matches = publicMaps().filter(map => {
        const info = getSteamInfo(map.id);
        const categoryMatches = state.selected === PENDING_CATEGORY ? Boolean(map.pending) :
            state.selected === PENDING_CHANGES ? ["move","update"].includes(map.changeRequest?.action) :
            state.selected === PENDING_DELETION ? map.changeRequest?.action === "delete" :
            state.selected === RECENT_CATEGORY ?
                !map.pending && !map.changeRequest && isRecentApproved(map) :
            !map.pending && !map.changeRequest &&
                (state.selected === null || map.category.order === state.selected);
        return categoryMatches &&
            (!state.liteOnly || map.liteOnly) &&
            (!query || String(info?.title || "").toLocaleLowerCase().includes(query) ||
                map.id.includes(query));
    });
    if (state.selected === RECENT_CATEGORY)
        matches.sort((a, b) => Date.parse(b.recent.mergedAt) - Date.parse(a.recent.mergedAt));
    return matches;
}
function categoryMaps(category) {
    return publicMaps().filter(map =>
        !map.pending && !map.changeRequest && map.category.order === category.order &&
        (!state.liteOnly || map.liteOnly));
}
function approvedMaps() {
    return publicMaps().filter(map => !map.pending && !map.changeRequest);
}
function pendingMaps() {
    return publicMaps().filter(map => Boolean(map.pending) &&
        (!state.liteOnly || map.liteOnly));
}
function changeMaps(action) {
    return publicMaps().filter(map =>
        (action === "move" ? ["move","update"].includes(map.changeRequest?.action) :
            map.changeRequest?.action === action) &&
        (!state.liteOnly || map.liteOnly));
}
function categoryCount() {
    return state.categories.filter(cat => categoryMaps(cat).length).length +
        (recentMaps().length ? 1 : 0) +
        (pendingMaps().length ? 1 : 0) +
        (changeMaps("move").length ? 1 : 0) +
        (changeMaps("delete").length ? 1 : 0);
}
function getSteamInfo(id) {
    const entry = state.workshop[id];
    return state.steamReady && entry && Number(entry.visibility) === 0 &&
        typeof entry.title === "string" && entry.title.trim() ? entry : null;
}
let lastNavMarkup = "";
function renderNav() {
    const visible = state.steamReady ?
        state.categories.filter(category => categoryMaps(category).length > 0) :
        state.categories;
    const all = { order:null, name:t("allMaps"), visibleCount:approvedMaps().filter(map => !state.liteOnly || map.liteOnly).length };
    const recent = {order:RECENT_CATEGORY, name:t("recentCategory"),
        summary:t("recentCategorySummary")};
    const pending = {
        order:PENDING_CATEGORY, name:t("pendingCategory"),
        summary:t("pendingCategorySummary")
    };
    const pendingChanges = {order:PENDING_CHANGES, name:t("pendingChanges"),
        summary:t("pendingChangesSummary")};
    const pendingDeletion = {order:PENDING_DELETION, name:t("pendingDeletion"),
        summary:t("pendingDeletionSummary")};
    // Virtual review queues are shown only when at least one public map is in them.
    const reviewCategories = state.pendingReady && state.steamReady ? [
        ...(pendingMaps().length ? [pending] : []),
        ...(changeMaps("move").length ? [pendingChanges] : []),
        ...(changeMaps("delete").length ? [pendingDeletion] : [])
    ] : [];
    const recentCategories = state.recentReady && state.steamReady && recentMaps().length ? [recent] : [];
    const markup = [all, ...recentCategories, ...reviewCategories, ...visible].map(category => {
        const count = category.order === null ? category.visibleCount :
            category.order === RECENT_CATEGORY ? recentMaps().length :
            category.order === PENDING_CATEGORY ?
                (state.pendingReady && state.steamReady ? pendingMaps().length : "—") :
            category.order === PENDING_CHANGES ?
                (state.pendingReady && state.steamReady ? changeMaps("move").length : "—") :
            category.order === PENDING_DELETION ?
                (state.pendingReady && state.steamReady ? changeMaps("delete").length : "—") :
                state.steamReady ? categoryMaps(category).length : "—";
        return '<button class="nav-btn' + (category.order === state.selected ? " active" : "") +
            (category.order === RECENT_CATEGORY ? " recent-category" : "") +
            (category.button === INCOMPATIBLE_CATEGORY ? " incompatible-category" : "") +
            (category.order === PENDING_CATEGORY ? " pending-category" : "") +
            (category.order === PENDING_CHANGES ? " pending-change-category" : "") +
            (category.order === PENDING_DELETION ? " pending-delete-category" : "") +
            '" data-category="' + (category.order ?? "all") +
            '" title="' + escapeHtml(category.summary || "") + '">' +
            '<span>' + escapeHtml(category.name) + '</span><small>' + count +
            '</small></button>';
    }).join("");
    // Preserve sidebar elements while switching between maps in the same view,
    // so the origin-category beacon never restarts on every selection.
    if (lastNavMarkup !== markup) {
        $("categoryNav").innerHTML = markup;
        lastNavMarkup = markup;
    }
}
// Pulse only the approved, real category of the selected map when the
// current view is a different category (including All / Recent Additions).
// Virtual review queues and the incompatible category are never pulse targets.
function updateMapCategoryPulse(selectedMap) {
    const category = selectedMap && !selectedMap.pending ? selectedMap.category : null;
    const validCategory = category &&
        Number.isInteger(category.order) &&
        state.categories[category.order]?.button === category.button &&
        category.button !== INCOMPATIBLE_CATEGORY;
    const target = validCategory && state.selected !== category.order
        ? String(category.order) : null;
    for (const button of $("categoryNav").querySelectorAll(".nav-btn")) {
        const shouldPulse = target !== null &&
            button.dataset.category === target &&
            !button.classList.contains("active") &&
            !button.classList.contains("recent-category") &&
            !button.classList.contains("pending-category") &&
            !button.classList.contains("pending-change-category") &&
            !button.classList.contains("pending-delete-category") &&
            !button.classList.contains("incompatible-category");
        if (button.classList.contains("map-origin-pulse") !== shouldPulse)
            button.classList.toggle("map-origin-pulse", shouldPulse);
    }
}
function categoryRow(category) {
    const maps = categoryMaps(category);
    return '<article class="category-row" tabindex="0" role="button" data-open="' +
        category.order + '"><div class="category-copy"><div class="category-kicker">' + escapeHtml(t("category")) + ' ' +
        escapeHtml(category.index) + '</div><h3>' + escapeHtml(category.name) +
        '</h3><p>' + escapeHtml(category.summary) + '</p></div><div class="category-count">' +
        maps.length + '<small> ' + escapeHtml(t("maps")) + '</small>' +
        '</div><span class="category-chevron" aria-hidden="true">›</span></article>';
}
function squareCover(url, large = false) {
    const size = large ? 360 : 120;
    const isHttps = typeof url === "string" && /^https:\/\//i.test(url);
    return '<span class="' + (large ? "preview-cover" : "cover-square") + '">' +
        (isHttps ?
            '<img src="' + escapeHtml(url) + '" width="' + size +
            '" height="' + size + '" alt="" loading="' + (large ? "eager" : "lazy") +
            '" decoding="async" referrerpolicy="no-referrer" style="object-fit:contain;aspect-ratio:1/1">' :
            '<span class="cover-fallback">III</span>') + "</span>";
}
function publisherName(info) {
    return String(info.creator_name || (info.creator_id ? "Steam " + info.creator_id : t("unknownPublisher")));
}
function reviewCategoryHtml(map, preview = false) {
    // Category attribution is a compact tag, not a textual status line.
    // Keep the current and requested destinations distinct for move requests.
    const cls = preview ? "map-category-tags map-category-tags-preview" : "map-category-tags";
    const requested = map.changeRequest?.action === "move"
        ? state.categories.find(category => category.button === map.changeRequest.target)
        : null;
    const tag = (name, kind, title = "") =>
        '<span class="map-category-tag ' + kind + '"' +
        (title ? ' title="' + escapeHtml(title) + '"' : '') +
        '>' + escapeHtml(name) + '</span>';
    const sourceKind = map.category.button === INCOMPATIBLE_CATEGORY ? "category-incompatible" :
        (map.pending ? "category-proposed" : "category-current");
    const source = tag(map.category.name, sourceKind,
        map.pending ? t("reviewProposedCategory") : "");
    const move = requested ?
        '<span class="map-category-arrow" aria-hidden="true">→</span>' +
        tag(requested.name, requested.button === INCOMPATIBLE_CATEGORY ?
            "category-incompatible" : "category-target", t("reviewMoveToCategory")) : "";
    return '<div class="' + cls + '">' + source + move + '</div>';
}

function mapRow(map) {
    const info = getSteamInfo(map.id);
    if (!info) return "";
    const chosen = state.activeMapId === map.id;
    return '<div class="map-row' + (chosen ? ' active' : '') +
        (map.pending ? ' pending-proposal' : '') +
        (map.category.button === INCOMPATIBLE_CATEGORY ? ' incompatible-map' : '') +
        '" role="option" aria-selected="' + (chosen ? "true" : "false") +
        '" tabindex="0" data-map-id="' + escapeHtml(map.id) + '">' +
        squareCover(info.preview_url) +
        '<div class="map-copy"><h3 title="' + escapeHtml(info.title) + '">' +
        escapeHtml(info.title) + '</h3><div class="map-publisher">' +
        escapeHtml(publisherName(info)) + '</div>' +
        reviewCategoryHtml(map) + '</div>' +
        pendingTags(map) + newMapTag(map) +
        (map.changeRequest ? '<span class="chip change-chip">' +
            escapeHtml(t(map.changeRequest.action === "delete" ?
                "changePendingDelete" : map.changeRequest.action === "update" ? "changePendingUpdate" : "changePendingMove")) + '</span>' : '') +
        '</div>';
}
let lastRenderedPreviewMapId = null;
function renderPreview() {
    const map = filtered().find(item => item.id === state.activeMapId);
    const info = map ? getSteamInfo(map.id) : null;
    if (!map || !info) {
        lastRenderedPreviewMapId = null;
        $("previewContent").innerHTML =
            '<div class="preview-empty"><p>' + escapeHtml(t("selectMap")) + '</p>' +
            '<small>' + escapeHtml(t("previewHintLeft")) + '</small></div>';
        return;
    }
    const fresh = lastRenderedPreviewMapId !== map.id;
    lastRenderedPreviewMapId = map.id;
    const url = "https://steamcommunity.com/sharedfiles/filedetails/?id=" +
        encodeURIComponent(map.id);
    const desc = typeof info.description === "string" ? info.description
        .replace(/\[(?:\/)?[a-z0-9_*]+(?:=[^\]]+)?\]/gi, "")
        .replace(/<[^>]*>/g, "")
        .replace(/\r/g, "").trim().slice(0, 550) : "";
    $("previewContent").innerHTML =
        '<div class="preview-topline"></div>' + squareCover(info.preview_url, true) +
        '<div class="preview-title-band">' + escapeHtml(info.title) + '</div>' +
        (newMapTag(map) ?
            '<div class="preview-pr-status"><span class="preview-new-tag">' +
            newMapTag(map) + '</span></div>' : '') +
        (map.pending ? '<div class="preview-pr-status">' + pendingTags(map) +
            ' <span>#' + map.pending.number + '</span></div>' : '') +
        (map.changeRequest ?
            '<div class="preview-pr-status"><span class="chip change-chip">' +
            escapeHtml(t(map.changeRequest.action === "delete" ?
                "changePendingDelete" : map.changeRequest.action === "update" ? "changePendingUpdate" : "changePendingMove")) +
            '</span> <a href="' + escapeHtml(map.changeRequest.url) +
            '" target="_blank" rel="noopener noreferrer">' + escapeHtml(t("viewPR")) +
            ' #' + map.changeRequest.number + ' ↗</a></div>' :
            !map.pending ? '<button type="button" class="request-change-button" data-request-change="' +
                escapeHtml(map.id) + '"><span aria-hidden="true">↺</span> ' +
                escapeHtml(t("requestChange")) + ' <span aria-hidden="true">›</span></button>' : '') +
        '<section class="map-intel' + (fresh ? ' is-new' : '') +
        '" aria-label="' + escapeHtml(t("mapInformation")) + '">' +
        '<div class="map-intel-header"><span class="map-intel-emblem" aria-hidden="true">III</span>' +
        '<h3 class="map-intel-title">' + escapeHtml(t("mapInformation")) + '</h3>' +
        '<span class="map-intel-header-dash" aria-hidden="true"></span>' +
        '<span class="map-intel-light" aria-hidden="true"></span></div>' +
        '<div class="map-intel-grid">' +
        '<div class="map-intel-cell map-intel-author">' +
        '<span class="map-intel-cell-symbol" aria-hidden="true">◈</span>' +
        '<div class="map-intel-cell-copy"><span class="map-intel-label">' +
        escapeHtml(t("createdBy")) + '</span><strong class="map-intel-value">' +
        escapeHtml(publisherName(info)) + '</strong></div></div>' +
        '<div class="map-intel-cell map-intel-id">' +
        '<span class="map-intel-cell-symbol" aria-hidden="true">#</span>' +
        '<div class="map-intel-cell-copy"><span class="map-intel-label">' +
        escapeHtml(t("workshopId")) + '</span><strong class="map-intel-value map-intel-digits">' +
        escapeHtml(map.id) + '</strong></div>' +
        '<button type="button" class="map-intel-copy-button" data-copy="' +
        escapeHtml(map.id) + '" aria-label="' + escapeHtml(t("copyId")) +
        '" title="' + escapeHtml(t("copyId")) + '">' +
        '<svg class="map-intel-copy-svg" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
        '<rect x="8" y="8" width="11" height="11" rx="1"></rect>' +
        '<path d="M15 8V5.5C15 4.7 14.3 4 13.5 4h-8C4.7 4 4 4.7 4 5.5v8C4 14.3 4.7 15 5.5 15H8"></path>' +
        '</svg><svg class="map-intel-check-svg" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M4.5 12.5l5 5L20 7"></path></svg>' +
        '<span class="sr-only" data-copy-label>' + escapeHtml(t("copyId")) +
        '</span></button></div>' +
        '</div>' +
        '<div class="preview-buttons map-intel-actions">' +
        '<a class="map-action map-action-workshop" href="' + escapeHtml(url) +
        '" target="_blank" rel="noopener noreferrer" aria-label="' +
        escapeHtml(t("openWorkshop")) + '">' +
        '<span class="map-action-icon" aria-hidden="true">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M13 5h6v6M19 5l-9 9"></path><path d="M19 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"></path>' +
        '</svg></span><span class="map-action-label">' +
        escapeHtml(t("openWorkshop")) +
        '</span><span class="map-action-end" aria-hidden="true">↗</span>' +
        '<span class="map-action-sweep" aria-hidden="true"></span></a>' +
        (map.pending ? '<a class="map-action map-action-pr" target="_blank" rel="noopener noreferrer" href="' +
           escapeHtml(map.pending.url) + '"><span class="map-action-icon" aria-hidden="true">PR</span>' +
           '<span class="map-action-label">' + escapeHtml(t("viewPR")) + ' #' +
           map.pending.number + '</span><span class="map-action-end" aria-hidden="true">↗</span></a>' : '') +
        '</div><span class="map-intel-copy-status" role="status" aria-live="polite"></span>' +
        '</section>' +
        (desc ? '<h3 class="preview-heading">' + escapeHtml(t("missionBriefing")) + '</h3>' +
            '<p class="preview-blurb">' + escapeHtml(desc) + '</p>' : '');
}
function updateSearchVisualState(matchCount) {
    const module = $("searchModule");
    if (!module) return;
    const hasValue = $("searchInput").value.length > 0;
    module.classList.toggle("has-query", hasValue);
    module.classList.toggle("no-results",
        state.steamReady && matchCount === 0 && hasValue);
    $("searchClear").disabled = !hasValue;
    $("searchResultCount").textContent = state.steamReady ?
        matchCount.toLocaleString("en-US") : "—";
    $("searchFeedback").classList.toggle("has-query", hasValue);
    $("searchFeedback").classList.toggle("no-results",
        state.steamReady && matchCount === 0 && hasValue);
}
function render() {
    applyUiText();
    const publicItems = publicMaps();
    renderNav();
    const category = state.selected === null ? null : state.categories[state.selected];
    $("groupCount").textContent = state.steamReady ?
        categoryCount().toLocaleString("en-US") : "—";
    $("mapCount").textContent = state.steamReady ?
        publicItems.length.toLocaleString("en-US") : "—";
    const matches = filtered();
    if (state.activeMapId && !matches.some(map => map.id === state.activeMapId)) {
        state.activeMapId = null;
    }
    if (!state.activeMapId && matches.length) state.activeMapId = matches[0].id;
    $("catalog").innerHTML = !state.steamReady ?
        '<p class="empty">' + (state.steamFailed ?
        t("unavailable") :
        t("loading")) + '</p>' :
        matches.length ? matches.map(mapRow).join("") :
        '<p class="empty">' + escapeHtml(t("noMaps")) + '</p>';
    renderPreview();
    updateMapCategoryPulse(matches.find(map => map.id === state.activeMapId) || null);
    updateSearchVisualState(matches.length);
}
async function copyID(id) {
    if (navigator.clipboard?.writeText) {
        try {
            await navigator.clipboard.writeText(id);
            return true;
        } catch (_) { /* Use the legacy fallback if permissions block Clipboard API. */ }
    }
    const field=document.createElement("textarea");
    const previouslyFocused=document.activeElement;
    field.value=id;
    field.setAttribute("readonly","");
    field.style.cssText="position:fixed;left:0;top:0;opacity:0;pointer-events:none";
    document.body.appendChild(field);
    let copied=false;
    try {
        field.select();
        copied=Boolean(document.execCommand("copy"));
    } catch (_) {
        copied=false;
    } finally {
        field.remove();
        if(previouslyFocused?.isConnected && typeof previouslyFocused.focus==="function")
            previouslyFocused.focus({preventScroll:true});
    }
    return copied;
}
let categoryScrollEffect = null;
function animateCategoryList(previousScroll) {
    const list = $("catalog");
    if (categoryScrollEffect) {
        categoryScrollEffect.cancel();
        categoryScrollEffect = null;
    }
    const reducedMotion = typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion || !state.steamReady) {
        list.scrollTop = 0;
        return;
    }
    // Scroll the *list*, never the whole webpage, towards its first map.
    const maxScroll = Math.max(0, list.scrollHeight - list.clientHeight);
    const start = Math.min(maxScroll, Math.max(120, Math.min(previousScroll, 280)));
    if (start > 0 && typeof list.scrollTo === "function") {
        list.scrollTop = start;
        list.scrollTo({top:0, behavior:"smooth"});
    } else {
        list.scrollTop = 0;
    }
    // Also provide a short vertical transition for categories with too few
    // maps to scroll. No sideways motion or per-row slide-in is introduced.
    if (typeof list.animate === "function") {
        categoryScrollEffect = list.animate([
            {opacity:0.7, transform:"translateY(12px)"},
            {opacity:1, transform:"translateY(0)"}
        ], {duration:360, easing:"cubic-bezier(.22,.8,.24,1)"});
        categoryScrollEffect.onfinish = () => { categoryScrollEffect = null; };
    }
}
function selectCategory(value) {
    const virtual = [RECENT_CATEGORY, PENDING_CATEGORY, PENDING_CHANGES, PENDING_DELETION];
    const next = value === "all" ? null :
        virtual.includes(value) ? value : Number(value);
    // A repeat click does nothing: preserve the current scroll and map.
    if (next === state.selected) return;
    const previousScroll = $("catalog").scrollTop || 0;
    state.selected = next;
    state.query = "";
    $("searchInput").value = "";
    state.activeMapId = null;
    render(); // Automatically selects the first map in the new category.
    animateCategoryList(previousScroll);
}

/* Decorative but fully operable custom scrollbars. The original two list
   elements still perform native scrolling; these rails only visualize and
   control scrollTop. Native thumbs remain the fallback if initialization
   is unsupported. No timers or animations poll the scroll position. */
function setupAnimatedScrollbars(){
    const configurations=[
        {id:"categoryNav",label:"Category list scrollbar",railClass:"aae-rail-category"},
        {id:"catalog",label:"Map list scrollbar",railClass:"aae-rail-maps"}
    ];
    const controls=[];
    for(const entry of configurations){
        const list=$(entry.id);
        const parent=list.parentElement;
        const rail=document.createElement("div");
        rail.className="aae-scroll-rail "+entry.railClass;
        rail.tabIndex=0;
        rail.setAttribute("role","scrollbar");
        rail.setAttribute("aria-orientation","vertical");
        rail.setAttribute("aria-controls",entry.id);
        rail.setAttribute("aria-label",entry.label);
        rail.setAttribute("aria-valuemin","0");
        rail.setAttribute("aria-valuemax","100");
        rail.setAttribute("aria-valuenow","0");
        rail.innerHTML=
            '<span class="aae-rail-channel" aria-hidden="true"></span>'+
            '<span class="aae-rail-progress" aria-hidden="true"></span>'+
            '<span class="aae-rail-thumb" aria-hidden="true">'+
              '<span class="aae-rail-thumb-core"></span>'+
              '<span class="aae-rail-thumb-sheen"></span>'+
              '<span class="aae-rail-thumb-grip"></span>'+
            '</span>'+
            '<span class="aae-rail-beacon" aria-hidden="true"></span>';
        parent.appendChild(rail);
        const thumb=rail.querySelector(".aae-rail-thumb");
        let raf=0,settle=0,drag=null,prevTop=list.scrollTop;
        let thumbHeight=36,usableHeight=1,maxScroll=0;
        const sync=()=>{
            raf=0;
            const area=list.getBoundingClientRect();
            const frame=parent.getBoundingClientRect();
            rail.style.top=(area.top-frame.top-parent.clientTop)+"px";
            rail.style.height=Math.max(0,area.height)+"px";
            usableHeight=Math.max(1,rail.clientHeight-16);
            maxScroll=Math.max(0,list.scrollHeight-list.clientHeight);
            const available=maxScroll>1;
            rail.classList.toggle("is-empty",!available);
            thumbHeight=available ?
                Math.max(34,Math.min(usableHeight,
                    Math.round(usableHeight*list.clientHeight/Math.max(1,list.scrollHeight)))) :
                usableHeight;
            const progress=available ?
                Math.min(1,Math.max(0,list.scrollTop/maxScroll)) : 0;
            const travel=Math.max(0,usableHeight-thumbHeight);
            thumb.style.height=thumbHeight+"px";
            thumb.style.transform="translate3d(0,"+(travel*progress)+"px,0)";
            rail.style.setProperty("--aae-rail-progress",(100*progress)+"%");
            rail.setAttribute("aria-valuenow",String(Math.round(progress*100)));
            rail.setAttribute("aria-valuetext",Math.round(progress*100)+"%");
        };
        const queueSync=()=>{
            if(!raf)raf=requestAnimationFrame(sync);
        };
        const markMovement=()=>{
            rail.classList.add("is-moving");
            if(settle)clearTimeout(settle);
            settle=setTimeout(()=>rail.classList.remove("is-moving"),220);
        };
        list.addEventListener("scroll",()=>{
            if(Math.abs(list.scrollTop-prevTop)>.5){
                prevTop=list.scrollTop;
                markMovement();
            }
            queueSync();
        },{passive:true});
        const scrollFromPointer=event=>{
            const bounds=rail.getBoundingClientRect();
            const center=event.clientY-bounds.top-8-drag.offset;
            const room=Math.max(1,usableHeight-thumbHeight);
            list.scrollTop=Math.min(maxScroll,Math.max(0,center/room*maxScroll));
            markMovement();
            queueSync();
        };
        rail.addEventListener("pointerdown",event=>{
            if(event.button!==0||maxScroll<=1)return;
            event.preventDefault();
            const thumbBounds=thumb.getBoundingClientRect();
            const thumbHit=thumb.contains(event.target);
            drag={
                pointerId:event.pointerId,
                offset:thumbHit?event.clientY-thumbBounds.top:thumbHeight/2
            };
            rail.classList.add("is-dragging");
            rail.setPointerCapture(event.pointerId);
            scrollFromPointer(event);
        });
        rail.addEventListener("pointermove",event=>{
            if(!drag||drag.pointerId!==event.pointerId)return;
            event.preventDefault();
            scrollFromPointer(event);
        });
        const endDrag=event=>{
            if(!drag||drag.pointerId!==event.pointerId)return;
            drag=null;
            rail.classList.remove("is-dragging");
            if(rail.hasPointerCapture(event.pointerId))
                rail.releasePointerCapture(event.pointerId);
            queueSync();
        };
        rail.addEventListener("pointerup",endDrag);
        rail.addEventListener("pointercancel",endDrag);
        rail.addEventListener("lostpointercapture",()=>{
            drag=null;
            rail.classList.remove("is-dragging");
        });
        rail.addEventListener("keydown",event=>{
            if(maxScroll<=1)return;
            let increment=null;
            switch(event.key){
                case "ArrowUp":increment=-56;break;
                case "ArrowDown":increment=56;break;
                case "PageUp":increment=-list.clientHeight*.86;break;
                case "PageDown":increment=list.clientHeight*.86;break;
                case "Home":increment=-maxScroll;break;
                case "End":increment=maxScroll;break;
                default:return;
            }
            event.preventDefault();
            list.scrollTop+=increment;
            markMovement();
            queueSync();
        });
        if(typeof ResizeObserver==="function"){
            const sizes=new ResizeObserver(queueSync);
            sizes.observe(list);
            sizes.observe(parent);
        }
        if(typeof MutationObserver==="function"){
            const changes=new MutationObserver(queueSync);
            changes.observe(list,{childList:true,subtree:true,characterData:true});
        }
        window.addEventListener("resize",queueSync,{passive:true});
        controls.push({rail,queueSync,sync});
    }
    // Switch away from native scrollbars only after BOTH enhanced rails exist.
    document.documentElement.classList.add("aae-scroll-enhanced");
    for(const control of controls)control.sync();
    if(document.fonts?.ready)
        document.fonts.ready.then(()=>controls.forEach(c=>c.queueSync()));
}

function bind() {
    applyUiText();
    bindLanguagePicker();
    bindChangeRequests();
    bindGithubGuide();
    $("previewPane").addEventListener("click", event => {
        const button = event.target.closest("[data-request-change]");
        if (button) openChangeRequest(button.dataset.requestChange,button);
    });
    $("categoryNav").addEventListener("click", event => {
        const button = event.target.closest("[data-category]");
        if (button) selectCategory(button.dataset.category);
    });
    $("catalog").addEventListener("click", event => {
        const item = event.target.closest("[data-map-id]");
        if (!item) return;
        state.activeMapId = item.dataset.mapId;
        render();
    });
    $("catalog").addEventListener("keydown", event => {
        const node = event.target.closest("[data-map-id]");
        if (!node) return;
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            state.activeMapId = node.dataset.mapId;
            render();
        }
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            const matches = filtered();
            const index = matches.findIndex(map => map.id === node.dataset.mapId);
            const next = matches[Math.max(0, Math.min(matches.length - 1,
                index + (event.key === "ArrowDown" ? 1 : -1)))];
            if (next) {
                state.activeMapId = next.id;
                render();
                const selected = [...$("catalog").querySelectorAll("[data-map-id]")]
                    .find(item => item.dataset.mapId === next.id);
                if (selected) {
                    selected.focus({preventScroll:true});
                    selected.scrollIntoView({block:"nearest"});
                }
            }
        }
    });
    $("previewPane").addEventListener("click", async event => {
        const btn=event.target.closest("[data-copy]");
        if (!btn || btn.disabled) return;
        const label=btn.querySelector("[data-copy-label]");
        const panel=btn.closest(".map-intel");
        const status=panel?.querySelector(".map-intel-copy-status");
        btn.disabled=true;
        btn.classList.add("is-copying");
        const success=await copyID(btn.dataset.copy);
        if (!btn.isConnected) return;
        btn.disabled=false;
        btn.classList.remove("is-copying");
        btn.classList.toggle("is-copied",success);
        btn.classList.toggle("is-copy-error",!success);
        btn.setAttribute("aria-label",success?t("copied"):t("copyId"));
        btn.title=success?t("copied"):t("copyId");
        if (success) {
            if(label)label.textContent=t("copied");
            if(status)status.textContent=t("copied");
            const uid=Symbol("copied");
            btn.copyFeedbackId=uid;
            setTimeout(() => {
                if (!btn.isConnected || btn.copyFeedbackId!==uid) return;
                btn.classList.remove("is-copied","is-copy-error");
                btn.setAttribute("aria-label",t("copyId"));
                btn.title=t("copyId");
                if(label)label.textContent=t("copyId");
                if(status)status.textContent="";
            },1900);
        } else {
            if(status)status.textContent=t("copyId");
            setTimeout(() => {
                if (btn.isConnected) btn.classList.remove("is-copy-error");
                if (status?.isConnected && status.textContent===t("copyId"))
                    status.textContent="";
            },1400);
        }
    });
    $("previewPane").addEventListener("error", event => {
        if (event.target.matches(".preview-cover img")) {
            event.target.replaceWith(Object.assign(document.createElement("span"), {
                className:"cover-fallback",textContent:"III"
            }));
        }
    }, true);
    $("catalog").addEventListener("error", event => {
        if (event.target.matches(".cover-square img")) {
            event.target.replaceWith(Object.assign(document.createElement("span"), {
                className:"cover-fallback",textContent:"III"
            }));
        }
    }, true);
    $("liteToggle").addEventListener("change", event => {
        state.liteOnly = event.target.checked;
        // Never leave an active category selected when the Lite-only filter
        // has removed every map from that category.
        const selected = state.selected;
        const count = selected === RECENT_CATEGORY ? recentMaps().length :
            selected === PENDING_CATEGORY ? pendingMaps().length :
            selected === PENDING_CHANGES ? changeMaps("move").length :
            selected === PENDING_DELETION ? changeMaps("delete").length :
            selected === null ? approvedMaps().filter(map => !state.liteOnly || map.liteOnly).length :
            (state.categories[selected] ? categoryMaps(state.categories[selected]).length : 0);
        if (selected !== null && count === 0) {
            const first = state.categories.find(category => categoryMaps(category).length > 0);
            state.selected = first ? first.order :
                recentMaps().length ? RECENT_CATEGORY :
                pendingMaps().length ? PENDING_CATEGORY :
                changeMaps("move").length ? PENDING_CHANGES :
                changeMaps("delete").length ? PENDING_DELETION : null;
        }
        state.activeMapId = null;
        render();
        $("catalog").scrollTop = 0;
    });
    const searchInput = $("searchInput");
    searchInput.addEventListener("input", event => {
        state.query = event.target.value;
        if (state.query.trim()) state.selected = null;
        state.activeMapId = null;
        render();
    });
    $("searchClear").addEventListener("click", () => {
        if (!searchInput.value) return;
        searchInput.value = "";
        searchInput.dispatchEvent(new Event("input", {bubbles:true}));
        searchInput.focus({preventScroll:true});
    });
    // Accessible shortcuts: Ctrl/Command+K or "/" focuses the search.
    document.addEventListener("keydown", event => {
        if (!($("submitMapOverlay").hidden &&
              $("changeMapOverlay").hidden &&
              $("githubGuideOverlay").hidden)) return;
        const el = document.activeElement;
        const editing = el && (el.isContentEditable ||
            /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
        if ((event.ctrlKey || event.metaKey) &&
            event.key.toLowerCase() === "k" && !event.altKey) {
            event.preventDefault();
            searchInput.focus({preventScroll:true});
            searchInput.select();
        } else if (event.key === "/" && !editing &&
                   !event.ctrlKey && !event.metaKey && !event.altKey) {
            event.preventDefault();
            searchInput.focus({preventScroll:true});
        } else if (event.key === "Escape" &&
                   el === searchInput && searchInput.value) {
            event.preventDefault();
            searchInput.value = "";
            searchInput.dispatchEvent(new Event("input", {bubbles:true}));
        }
    });
    updateSearchVisualState(filtered().length);
    bindMapSubmission();
    setupAnimatedScrollbars();
}

// An authenticated GitHub Issue hands a validated proposal to PR automation.
const SUBMISSION_ISSUE_URL = "https://github.com/k7Ysh5A41/AAE-Custom-Map-Category/issues/new";

function parseWorkshopId(value) {
    const input = String(value || "").trim();
    if (/^\d{7,20}$/.test(input)) return input;
    try {
        const url = new URL(input);
        if (url.protocol !== "https:" ||
            !["steamcommunity.com", "www.steamcommunity.com"].includes(url.hostname) ||
            !/^\/(?:sharedfiles|workshop)\/filedetails\/?$/.test(url.pathname)) return null;
        const id = url.searchParams.get("id");
        return id && /^\d{7,20}$/.test(id) ? id : null;
    } catch (_) {
        return null;
    }
}
function setSubmissionError(message) {
    $("submitMapError").textContent = message || "";
    $("submitMapError").hidden = !message;
}
let submissionScrollY = 0;
let submissionPreviousTop = "";
let submissionValidationId = 0;
let submissionValidationPending = false;
function setSubmissionPending(pending) {
    submissionValidationPending = pending;
    const button = $("submitMapForm").querySelector(".submit-confirm");
    button.disabled = pending;
    button.textContent = t(pending ? "checking" : "submitRequest");
}

const modalMotions = new WeakMap();
const modalOrigins = new WeakMap();
function rememberModalOrigin(overlay,trigger) {
    if(!trigger||!trigger.isConnected)return;
    const box=trigger.getBoundingClientRect();
    const style=window.getComputedStyle(trigger);
    modalOrigins.set(overlay,{
        trigger,rect:{left:box.left,top:box.top,width:Math.max(1,box.width),
            height:Math.max(1,box.height)},
        label:(trigger.textContent||"").trim().replace(/\s+/g," "),
        background:style.background,color:style.color,font:style.font,
        border:style.border,borderLeft:style.borderLeft,
        shadow:style.boxShadow
    });
}
function stopModalMotion(overlay){
    const running=modalMotions.get(overlay);
    if(!running)return;
    modalMotions.delete(overlay);
    for(const animation of running)animation.cancel();
    delete overlay.dataset.motion;
    const stage=overlay.querySelector(".modal-flip-stage");
    if(stage)stage.inert=false;
}
function releaseModalOrigin(overlay){
    const source=modalOrigins.get(overlay);
    if(source?.trigger?.isConnected)
        source.trigger.classList.remove("modal-origin-occupied");
}
function runModalMotion(overlay,opening,onComplete=()=>{}){
    stopModalMotion(overlay);
    const stage=overlay.querySelector(".modal-flip-stage");
    const front=stage?.querySelector(".modal-flip-front");
    const label=front?.querySelector(".modal-flip-front-label");
    const source=modalOrigins.get(overlay);
    const reduced=window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if(!stage||!front||!label||!source||reduced||
        typeof stage.animate!=="function"){
        overlay.style.visibility="";
        if(!opening)releaseModalOrigin(overlay);
        onComplete();
        return;
    }

    // Opening is measured without becoming visible. The first rendered
    // frame has the exact button position and outer dimensions.
    stage.style.transform="";
    const dialogRect=stage.getBoundingClientRect();
    const buttonRect=source.rect;
    const dx=buttonRect.left+buttonRect.width/2-
        (dialogRect.left+dialogRect.width/2);
    const dy=buttonRect.top+buttonRect.height/2-
        (dialogRect.top+dialogRect.height/2);
    const sx=buttonRect.width/Math.max(1,dialogRect.width);
    const sy=buttonRect.height/Math.max(1,dialogRect.height);

    // One real 3D card: its front has the trigger's visual treatment,
    // its reverse is the existing interactive form. The duplicated text
    // was responsible for a large centered caption on the first frame.
    front.style.transform="rotateY(180deg) translateZ(1px)";
    front.style.background=source.background;
    front.style.color=source.color;
    front.style.border=source.border;
    front.style.borderLeft=source.borderLeft;
    front.style.boxShadow=source.shadow;
    label.replaceChildren();
    label.style.opacity="0";
    label.style.transform="none";

    const duration=overlay.id==="githubGuideOverlay" ? (opening?360:170) : 300;
    overlay.dataset.motion=opening?"enter":"exit";
    stage.inert=true;

    // Pronounced accelerate-to-brake motion on ONE continuous stage.
    // The opening/closing form has an 8x speed contrast: starts gently,
    // peaks at 60% elapsed, then slows continuously to a complete stop.
    // At 60% it has covered 60% of the total distance, leaving a real
    // 40% of rotation, translation and enlargement to taper over 120 ms.
    // Position and first derivative are continuous at the 60% join.
    const motionProgress=t=>{
        const value=Math.min(1,Math.max(0,t));
        if(overlay.id==="githubGuideOverlay"){
            return value*value*value*(value*(value*6-15)+10);
        }
        if(value<=.60){
            const u=value/.60;
            return .18*u+.42*u*u*u;
        }
        const u=(value-.60)/.40;
        return .60+.40*(1-Math.pow(1-u,2.4));
    };
    const frame=(t,expanding)=>{
        // Closing must use its OWN eased travel, not reversed timestamps.
        // All four properties share the same geometric progress.
        const traveled=motionProgress(t);
        const progress=expanding?traveled:1-traveled;
        const remaining=1-progress;
        return {
            offset:t,
            transform:`translate3d(${dx*remaining}px,${dy*remaining}px,0) rotateY(${180*remaining}deg) scale(${sx+(1-sx)*progress},${sy+(1-sy)*progress})`
        };
    };
    const atButton=frame(0,true).transform;
    const atWindow=frame(1,true).transform;
    const animationFrames=Array.from({length:81},(_,i)=>frame(i/80,opening));

    // Apply the first pose synchronously before the overlay is painted.
    stage.style.transform=opening?atButton:atWindow;
    const stageAnimation=stage.animate(animationFrames,{
        duration,fill:"both",easing:"linear"
    });
    modalMotions.set(overlay,[stageAnimation]);
    if(source.trigger?.isConnected)
        source.trigger.classList.add("modal-origin-occupied");
    overlay.style.visibility="";

    stageAnimation.finished.then(()=>{
        if(modalMotions.get(overlay)?.[0]!==stageAnimation)return;
        if(!opening)overlay.style.visibility="hidden";
        stage.style.transform=opening?atWindow:atButton;
        stopModalMotion(overlay);
        stage.style.transform="";
        if(!opening)releaseModalOrigin(overlay);
        onComplete();
        if(!opening)overlay.style.visibility="";
    },()=>{});
}
function closeSubmission() {
    const overlay=$("submitMapOverlay");
    if (overlay.hidden || overlay.dataset.motion==="exit") return;
    if (!$("githubGuideOverlay").hidden) closeGithubGuide(true,false);
    submissionValidationId++;
    setSubmissionPending(false);
    runModalMotion(overlay,false,() => {
        overlay.hidden=true;
        document.documentElement.classList.remove("submission-open");
        document.body.classList.remove("submission-open");
        document.body.style.top=submissionPreviousTop;
        window.scrollTo(0,submissionScrollY);
        $("submitMapOpen").focus({preventScroll:true});
    });
}
function openSubmission() {
    if (!$("submitMapOverlay").hidden) return;
    submissionValidationId++;
    setSubmissionPending(false);
    if (!state.categories.length) {
        setSubmissionError(t("loadingCatalog"));
        return;
    }
    const select = $("submitCategory");
    select.innerHTML = '<option value="">' + escapeHtml(t("selectCategory")) + '</option>' +
        state.categories.map(cat => '<option value="' +
        escapeHtml(cat.button) + '">' + escapeHtml(cat.name) + '</option>').join("");
    $("submitMapForm").reset();
    // A new submission must start without a category even if a category
    // (including Zombies Chronicles 2) is currently selected in the catalog.
    select.value = "";
    $("submitLiteOnly").checked = false;
    setSubmissionError("");
    submissionScrollY = window.scrollY || window.pageYOffset || 0;
    submissionPreviousTop = document.body.style.top;
    document.body.style.top = -submissionScrollY + "px";
    document.documentElement.classList.add("submission-open");
    document.body.classList.add("submission-open");
    const overlay=$("submitMapOverlay");
    rememberModalOrigin(overlay,$("submitMapOpen"));
    overlay.style.visibility="hidden";
    overlay.hidden=false;
    runModalMotion(overlay,true,()=>{
        if(!overlay.hidden)$("submitWorkshopId").focus({preventScroll:true});
    });
}
// Recheck current public main, not just the catalog snapshot loaded with this page.
async function isWorkshopIdInMain(workshopId) {
    const url = "https://raw.githubusercontent.com/k7Ysh5A41/" +
        "AAE-Custom-Map-Category/main/custommap_cate.json";
    const response = await fetchWithTimeout(url, { cache: "no-store" });
    if (!response.ok) throw new Error(t("latestCatalogError", {status:response.status}));
    const catalog = await response.json();
    if (!Array.isArray(catalog) || !catalog.every(category =>
        category && Array.isArray(category.ugc))) {
        throw new Error(t("invalidLatestCatalog"));
    }
    return catalog.some(category => category.ugc.some(item =>
        String(item && typeof item === "object" ? item.id : item) === workshopId));
}
async function findExistingMapPR(workshopId) {
    // The GitHub REST API can return 403 to anonymous browser clients.
    // This is a best-effort UX check: the issue-processing workflow independently
    // rejects duplicate open PRs, so API failures must not block submissions.
    const base = "https://api.github.com/repos/k7Ysh5A41/AAE-Custom-Map-Category/pulls";
    const exactLine = new RegExp("^Workshop ID: " + workshopId + "\\r?$", "m");
    try {
        for (let page = 1; page <= 10; page++) {
            const response = await fetchWithTimeout(
                base + "?state=open&per_page=100&page=" + page, {
                    cache: "no-store",
                    headers: { Accept: "application/vnd.github+json" }
                });
            if (!response.ok) return null;
            const pulls = await response.json();
            if (!Array.isArray(pulls)) return null;
            const existing = pulls.find(pr => exactLine.test(String(pr.body || "")) ||
                (String(pr.head?.ref || "").startsWith("community-maps/") &&
                    String(pr.title || "").includes("(" + workshopId + ")")));
            if (existing) return existing.html_url || "an open PR";
            if (pulls.length < 100) return null;
        }
    } catch (_) {
        return null;
    }
    return null;
}
async function submitMapProposal(event) {
    event.preventDefault();
    if (submissionValidationPending) return;
    const id = parseWorkshopId($("submitWorkshopId").value);
    const selectedKey = $("submitCategory").value;
    const category = state.categories.find(cat => cat.button === selectedKey);
    if (!id) return setSubmissionError(t("invalidWorkshop"));
    if (!category) return setSubmissionError(t("invalidCategory"));
    if (state.maps.some(map => map.id === id))
        return setSubmissionError(t("duplicateLocal"));
    const notes = $("submitNotes").value.trim().replace(/\r/g, "");
    if (notes.length > 400) return setSubmissionError(t("notesTooLong"));
    const requestId = ++submissionValidationId;
    setSubmissionError("");
    setSubmissionPending(true);
    try {
        const [alreadyListed, existingPR] = await Promise.all([
            isWorkshopIdInMain(id), findExistingMapPR(id)
        ]);
        if (requestId !== submissionValidationId || $("submitMapOverlay").hidden) return;
        if (alreadyListed) {
            setSubmissionError(t("duplicateMain"));
            return;
        }
        if (existingPR) {
            setSubmissionError(t("duplicatePr", {url:existingPR}));
            return;
        }
        const body = [
            "<!-- aae-map-submission:v1 -->",
            "Workshop ID: " + id,
            "Category: " + selectedKey,
            "Lite Only: " + String($("submitLiteOnly").checked),
            "Notes:",
            notes || "None"
        ].join("\n");
        const url = new URL(SUBMISSION_ISSUE_URL);
        url.searchParams.set("title", "[Map Submission] " + id);
        url.searchParams.set("body", body);
        openGithubGuide("new", url.toString());
    } catch (error) {
        if (requestId === submissionValidationId && !$("submitMapOverlay").hidden) {
            setSubmissionError(t("submissionBlocked", {detail:error.message}));
        }
    } finally {
        if (requestId === submissionValidationId) setSubmissionPending(false);
    }
}
// Reviewable move/delete requests always operate on an approved map.
let changeRequestMapId = null;
let changeValidationPending = false;
let changeValidationToken = 0;
let changeScrollY = 0;
let changePreviousTop = "";
function setChangeError(message) {
    $("changeMapError").textContent = message || "";
    $("changeMapError").hidden = !message;
}
function setChangePending(pending) {
    changeValidationPending = pending;
    const btn = $("changeMapSubmit");
    btn.disabled = pending;
    btn.textContent = t(pending ? "changeChecking" : "submitRequest");
}
function updateChangeAction() {
    const incompatible = $("changeIncompatible").checked;
    $("changeTargetLabel").hidden = incompatible;
    $("changeTargetCategory").hidden = incompatible;
    $("changeTargetCategory").required = !incompatible;
}
function openChangeRequest(id,trigger) {
    if (!$("changeMapOverlay").hidden || !$("submitMapOverlay").hidden) return;
    const map = state.maps.find(item => item.id === id);
    if (!map || map.pending || map.changeRequest || !getSteamInfo(map.id)) return;
    changeRequestMapId = id;
    changeValidationToken++;
    setChangePending(false);
    $("changeMapForm").reset();
    $("changeMove").checked = true;
    // Initialize from the approved map, never the form's previous state.
    const changeLiteCheckbox = $("changeLiteOnly");
    changeLiteCheckbox.checked = map.liteOnly === true;
    const incompatibleOption = $("changeIncompatible");
    incompatibleOption.disabled = map.category.button === INCOMPATIBLE_CATEGORY;
    incompatibleOption.closest("label").hidden = incompatibleOption.disabled;
    $("changeMapName").textContent = getSteamInfo(id).title + " · " + id;
    const available = state.categories.filter(c =>
        c.button !== map.category.button && c.button !== INCOMPATIBLE_CATEGORY);
    $("changeTargetCategory").innerHTML =
        '<option value="">' + escapeHtml(t("selectCategory")) + '</option>' +
        available.map(c => '<option value="' + escapeHtml(c.button) + '">' +
            escapeHtml(c.name) + '</option>').join("");
    setChangeError("");
    updateChangeAction();
    changeScrollY = window.scrollY || window.pageYOffset || 0;
    changePreviousTop = document.body.style.top;
    document.body.style.top = -changeScrollY + "px";
    document.documentElement.classList.add("submission-open");
    document.body.classList.add("submission-open");
    const overlay=$("changeMapOverlay");
    rememberModalOrigin(overlay,trigger);
    overlay.style.visibility="hidden";
    overlay.hidden=false;
    runModalMotion(overlay,true,()=>{
        if(!overlay.hidden)$("changeReason").focus({preventScroll:true});
    });
}
function closeChangeRequest() {
    const overlay=$("changeMapOverlay");
    if (overlay.hidden || overlay.dataset.motion==="exit") return;
    if (!$("githubGuideOverlay").hidden) closeGithubGuide(true,false);
    changeValidationToken++;
    setChangePending(false);
    runModalMotion(overlay,false,() => {
        overlay.hidden=true;
        document.documentElement.classList.remove("submission-open");
        document.body.classList.remove("submission-open");
        document.body.style.top=changePreviousTop;
        window.scrollTo(0,changeScrollY);
        const actionButton=$("previewPane").querySelector("[data-request-change]");
        if (actionButton) actionButton.focus({preventScroll:true});
        changeRequestMapId=null;
    });
}
async function findMapCategoryInMain(workshopId) {
    const response = await fetchWithTimeout(
        "https://raw.githubusercontent.com/k7Ysh5A41/AAE-Custom-Map-Category/main/custommap_cate.json",
        {cache:"no-store"});
    if (!response.ok) throw new Error(t("latestCatalogError", {status:response.status}));
    const catalog = await response.json();
    if (!Array.isArray(catalog) || !catalog.every(c => c && Array.isArray(c.ugc)))
        throw new Error(t("invalidLatestCatalog"));
    const matches = catalog.filter(c => c.ugc.some(x =>
        String(x && typeof x === "object" ? x.id : x) === workshopId));
    return matches.length === 1 ? matches[0].button : null;
}
async function submitChangeRequest(event) {
    event.preventDefault();
    if (changeValidationPending || $("changeMapOverlay").hidden) return;
    const id = changeRequestMapId;
    const map = state.maps.find(x => x.id === id && !x.pending);
    if (!map || map.changeRequest) return setChangeError(t("changeAlreadyPending"));
    const target = $("changeIncompatible").checked
        ? INCOMPATIBLE_CATEGORY : $("changeTargetCategory").value;
    if (!state.categories.some(c => c.button === target)) {
        return setChangeError(t("changeInvalidCategory"));
    }
    const liteOnly = $("changeLiteOnly").checked;
    const action = target === map.category.button ? "update" : "move";
    if (action === "update" && liteOnly === map.liteOnly)
        return setChangeError(t("changeNoChanges"));
    const reason = $("changeReason").value.trim().replace(/\r/g,"");
    if (reason.length < 5 || reason.length > 400)
        return setChangeError(t("changeInvalidReason"));
    const token = ++changeValidationToken;
    setChangeError("");
    setChangePending(true);
    try {
        const [currentCategory, existingPR] = await Promise.all([
            findMapCategoryInMain(id), findExistingMapPR(id)
        ]);
        if (token !== changeValidationToken || $("changeMapOverlay").hidden) return;
        if (currentCategory !== map.category.button) {
            setChangeError(t("changeStaleCategory"));
            return;
        }
        if (existingPR) {
            setChangeError(t("duplicatePr", {url:existingPR}));
            return;
        }
        const body = [
            "<!-- aae-map-change:v1 -->",
            "Workshop ID: " + id,
            "Action: " + action,
            "Original Category: " + map.category.button,
            "Target Category: " + target,
            "Current Lite Only: " + String(map.liteOnly),
            "Lite Only: " + String(liteOnly),
            "Reason:",
            reason
        ].join("\n");
        const url = new URL(SUBMISSION_ISSUE_URL);
        url.searchParams.set("title", "[Map Change] " + id);
        url.searchParams.set("body", body);
        openGithubGuide("change", url.toString());
    } catch (error) {
        if (token === changeValidationToken && !$("changeMapOverlay").hidden)
            setChangeError(t("submissionBlocked", {detail:error.message}));
    } finally {
        if (token === changeValidationToken) setChangePending(false);
    }
}
function bindChangeRequests() {
    $("changeMapForm").addEventListener("submit", submitChangeRequest);
    $("changeMove").addEventListener("change", updateChangeAction);
    $("changeIncompatible").addEventListener("change", updateChangeAction);
    $("changeMapClose").addEventListener("click", closeChangeRequest);
    $("changeMapCancel").addEventListener("click", closeChangeRequest);
    $("changeMapOverlay").addEventListener("click", event => {
        if (event.target === $("changeMapOverlay")) closeChangeRequest();
    });
    document.addEventListener("keydown", event => {
        if (event.key === "Escape" && $("githubGuideOverlay").hidden && !$("changeMapOverlay").hidden) {
            event.preventDefault();
            closeChangeRequest();
        }
    });
}

// Second-level guide is informational only. Keep the original form and its
// values intact while the guide is open, and return focus on dismissal.
let githubGuideMode = null;
let githubGuideReturnFocus = null;
let githubGuideDestination = null;
function githubGuideStepKeys() {
    const change = githubGuideMode === "change";
    return [
        "githubGuideLogin",
        change ? "githubGuideTitleChange" : "githubGuideTitleNew",
        change ? "githubGuideBodyChange" : "githubGuideBodyNew",
        "githubGuideKeepFields",
        "githubGuideSubmitIssue",
        "githubGuideIssueCreated",
        change ? "githubGuideAutomationChange" : "githubGuideAutomationNew",
        "githubGuidePR",
        "githubGuideReview",
        "githubGuideTrouble"
    ];
}
function renderGithubGuide() {
    if (!githubGuideMode) return;
    $("githubGuideIntro").textContent =
        t(githubGuideMode === "change" ? "githubGuideIntroChange" : "githubGuideIntroNew");
    $("githubGuideSteps").innerHTML = githubGuideStepKeys().map((key,index) =>
        '<li class="github-guide-tile" style="--step-index:' + index + '">' +
        '<span class="github-guide-step-number" aria-hidden="true">' +
        String(index+1).padStart(2,"0") + '</span>' +
        '<p>' + escapeHtml(t(key)) + '</p></li>').join("");
    $("githubGuideProceed").hidden = !githubGuideDestination;
}
function openGithubGuide(mode, destination) {
    if (!["new","change"].includes(mode) || !destination || !$("githubGuideOverlay").hidden) return;
    const parentId = mode === "change" ? "changeMapOverlay" : "submitMapOverlay";
    const parent = $(parentId);
    if (parent.hidden) return;
    githubGuideMode = mode;
    githubGuideDestination = destination;
    githubGuideReturnFocus = mode === "change"
        ? $("changeMapSubmit") : $("submitMapForm").querySelector(".submit-confirm");
    renderGithubGuide();
    const parentDialog = parent.querySelector(".submit-dialog");
    parentDialog.inert = true;
    parentDialog.setAttribute("aria-hidden", "true");
    const overlay=$("githubGuideOverlay");
    rememberModalOrigin(overlay,githubGuideReturnFocus);
    overlay.style.visibility="hidden";
    overlay.hidden=false;
    $("githubGuideDialog").scrollTop=0;
    runModalMotion(overlay,true,()=>{
        if(!overlay.hidden)$("githubGuideClose").focus({preventScroll:true});
    });
}
function closeGithubGuide(instant=false,restoreFocus=true) {
    const overlay=$("githubGuideOverlay");
    if (overlay.hidden || (!instant && overlay.dataset.motion==="exit")) return;
    const parent=githubGuideMode==="change" ? $("changeMapOverlay") : $("submitMapOverlay");
    const target=githubGuideReturnFocus;
    const finalize=() => {
        overlay.hidden=true;
        const parentDialog=parent.querySelector(".submit-dialog");
        parentDialog.inert=false;
        parentDialog.removeAttribute("aria-hidden");
        githubGuideMode=null;
        githubGuideReturnFocus=null;
        githubGuideDestination=null;
        if (restoreFocus && !parent.hidden && target) target.focus({preventScroll:true});
    };
    if (instant) {
        stopModalMotion(overlay);
        releaseModalOrigin(overlay);
        finalize();
    } else {
        runModalMotion(overlay,false,finalize);
    }
}
function bindGithubGuide() {
    $("githubGuideClose").addEventListener("click", () => closeGithubGuide());
    $("githubGuideBack").addEventListener("click", () => closeGithubGuide());
    $("githubGuideProceed").addEventListener("click", () => {
        if (!githubGuideDestination) return;
        const destination = githubGuideDestination;
        const mode = githubGuideMode;
        window.open(destination, "_blank", "noopener,noreferrer");
        closeGithubGuide(true,false);
        if (mode === "change") {
            closeChangeRequest();
        } else {
            closeSubmission();
        }
    });
    $("githubGuideOverlay").addEventListener("click", event => {
        if (event.target === $("githubGuideOverlay")) closeGithubGuide();
    });
    document.addEventListener("keydown", event => {
        if ($("githubGuideOverlay").hidden) return;
        if (event.key === "Escape") {
            event.preventDefault();
            closeGithubGuide();
            return;
        }
        if (event.key !== "Tab") return;
        // The form underneath is inert; cycle focus within the guide.
        const focusable = [...$("githubGuideDialog").querySelectorAll(
            "button:not([disabled]),a[href],input:not([disabled]),[tabindex]:not([tabindex='-1'])"
        )].filter(el => !el.hidden);
        if (!focusable.length) return;
        const first = focusable[0], last = focusable[focusable.length-1];
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault(); last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault(); first.focus();
        }
    });
}

function bindMapSubmission() {
    $("submitMapOpen").addEventListener("click", openSubmission);
    $("submitMapClose").addEventListener("click", closeSubmission);
    $("submitMapCancel").addEventListener("click", closeSubmission);
    $("submitMapOverlay").addEventListener("click", event => {
        if (event.target === $("submitMapOverlay")) closeSubmission();
    });
    document.addEventListener("keydown", event => {
        if (event.key === "Escape" && $("githubGuideOverlay").hidden && !$("submitMapOverlay").hidden) {
            event.preventDefault();
            closeSubmission();
        }
    });
    $("submitMapForm").addEventListener("submit", submitMapProposal);
}

// Rendering is independent of Steam / localization network requests.
// The category JSON is enough to show the UI immediately.
const resourceErrors = new Map();
function reportResourceError(source, message) {
    if (message) resourceErrors.set(source, message);
    else resourceErrors.delete(source);
    $("errorMessage").hidden = resourceErrors.size === 0;
    $("errorMessage").textContent = [...resourceErrors.values()].join(" ");
}
async function init() {
    bind();
    try {
        const response = await fetchWithTimeout(DATA_URL, { cache: "no-store" });
        if (!response.ok) throw new Error("HTTP " + response.status);
        const raw = await response.json();
        const data = normalize(raw);
        state.categories = data.categories;
        state.maps = data.maps;
        render();

        // Enrich the already visible map list as each optional source finishes.
        refreshLocalization();
        loadMapRecency().catch(error => {
            console.warn("Map recency metadata unavailable:", error);
        });
        loadRecentMaps().catch(error => {
            state.recentReady = true;
            render(); // The approved catalog still works when the optional recent feed fails.
            console.warn("Recent approved map feed unavailable:", error);
        });
        loadPendingPRMaps().catch(error => {
            // Approved catalog remains fully usable if the optional PR feed fails.
            console.warn("Pending PR map feed unavailable:", error);
        });

        loadSteamMetadata().then(error => {
            if (!error && state.selected === null && !state.liteOnly && !state.query.trim()) {
                const first = state.categories.find(category => categoryMaps(category).length > 0);
                if (first) state.selected = first.order;
            }
            render();
            reportResourceError("steam", error
                ? t("publicSteamError", {detail:error})
                : null);
        }).catch(error => {
            reportResourceError("steam", t("publicSteamError", {detail:error.message}));
        });
    } catch (error) {
        $("catalog").innerHTML = "";
        $("errorMessage").hidden = false;
        $("errorMessage").textContent = t("failedCatalog", {detail:error.message});
    }
}
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
    init();
}
