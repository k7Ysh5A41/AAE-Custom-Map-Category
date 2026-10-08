"use strict";

const DATA_URL = "./custommap_cate.json";
const STEAM_URL = "./steam_workshop.json";
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
    ru: "russian", es: "spanish"
});
const LANGUAGE_NAMES = Object.freeze({
    en: "English", fr: "Français", de: "Deutsch", it: "Italiano",
    ja: "日本語", pl: "Polski", pt: "Português", ru: "Русский", es: "Español"
});
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
        const code = String(locale || "").split(/[-_]/)[0].toLowerCase();
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
const state = {
    categories: [], maps: [], selected: null, liteOnly: false,
    translations: new Map(), workshop: {}, steamReady: false, steamFailed: false,
    activeMapId: null, query: "", languageChoice: savedLanguageChoice()
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
        reportResourceError("localization", result.errors.length
            ? "Localization unavailable: " + result.errors.join("; ")
            : null);
    } catch (error) {
        if (requestId !== localizationRequestId) return;
        reportResourceError("localization", "Localization unavailable: " + error.message);
    }
}
function updateLanguagePicker() {
    const locale = selectedLocalization();
    const displayed = state.languageChoice === "auto" ? "AUTO · " + locale.code.toUpperCase() :
        state.languageChoice.toUpperCase();
    $("languageCurrent").textContent = displayed;
    $("languageToggle").title = "Language: " + (state.languageChoice === "auto"
        ? "Browser (" + LANGUAGE_NAMES[locale.code] + ")" : LANGUAGE_NAMES[locale.code]);
    $("languageMenu").innerHTML =
        '<button type="button" class="language-option' +
        (state.languageChoice === "auto" ? " selected" : "") +
        '" data-language="auto" aria-pressed="' + (state.languageChoice === "auto") +
        '"><span>AUTO · BROWSER</span><small>⌁</small></button>' +
        Object.keys(LOCALIZATION_LANGUAGES).map(code =>
            '<button type="button" class="language-option' +
            (state.languageChoice === code ? " selected" : "") +
            '" data-language="' + code + '" aria-pressed="' +
            (state.languageChoice === code) + '"><span>' +
            escapeHtml(LANGUAGE_NAMES[code]) + '</span><small>' +
            code.toUpperCase() + '</small></button>'
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
function publicMaps() {
    if (!state.steamReady) return [];
    return state.maps.filter(map => Boolean(getSteamInfo(map.id)));
}
function filtered() {
    const query = state.query.trim().toLocaleLowerCase();
    return publicMaps().filter(map => {
        const info = getSteamInfo(map.id);
        return (state.selected === null || query || map.category.order === state.selected) &&
            (!state.liteOnly || map.liteOnly) &&
            (!query || String(info?.title || "").toLocaleLowerCase().includes(query) ||
                map.id.includes(query));
    });
}
function categoryMaps(category) {
    return publicMaps().filter(map => map.category.order === category.order);
}
function getSteamInfo(id) {
    const entry = state.workshop[id];
    return state.steamReady && entry && Number(entry.visibility) === 0 &&
        typeof entry.title === "string" && entry.title.trim() ? entry : null;
}
function renderNav() {
    const visible = state.steamReady ?
        state.categories.filter(category => categoryMaps(category).length > 0) :
        state.categories;
    const all = { order:null, name:"ALL MAPS", visibleCount:publicMaps().length };
    $("categoryNav").innerHTML = [all, ...visible].map(category => {
        const count = category.order === null ? category.visibleCount :
            state.steamReady ? categoryMaps(category).length : "—";
        return '<button class="nav-btn' + (category.order === state.selected ? " active" : "") +
            '" data-category="' + (category.order ?? "all") +
            '" title="' + escapeHtml(category.summary || "") + '">' +
            '<span>' + escapeHtml(category.name) + '</span><small>' + count +
            '</small></button>';
    }).join("");
}
function categoryRow(category) {
    const maps = categoryMaps(category);
    const liteCount = maps.filter(map => map.liteOnly).length;
    return '<article class="category-row" tabindex="0" role="button" data-open="' +
        category.order + '"><div class="category-copy"><div class="category-kicker">CATEGORY ' +
        escapeHtml(category.index) + '</div><h3>' + escapeHtml(category.name) +
        '</h3><p>' + escapeHtml(category.summary) + '</p></div><div class="category-count">' +
        maps.length + '<small> MAPS</small>' +
        (liteCount ? '<span class="lite-count">' + liteCount + ' LITE ONLY</span>' : '') +
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
    return String(info.creator_name || (info.creator_id ? "Steam " + info.creator_id : "Unknown publisher"));
}
function mapRow(map) {
    const info = getSteamInfo(map.id);
    if (!info) return "";
    const chosen = state.activeMapId === map.id;
    return '<div class="map-row' + (chosen ? ' active' : '') +
        '" role="option" aria-selected="' + (chosen ? "true" : "false") +
        '" tabindex="0" data-map-id="' + escapeHtml(map.id) + '">' +
        squareCover(info.preview_url) +
        '<div class="map-copy"><h3 title="' + escapeHtml(info.title) + '">' +
        escapeHtml(info.title) + '</h3><div class="map-publisher">' +
        escapeHtml(publisherName(info)) + '</div></div>' +
        (map.liteOnly ? '<span class="chip lite">LITE</span>' : '') +
        '</div>';
}
function renderPreview() {
    const map = filtered().find(item => item.id === state.activeMapId);
    const info = map ? getSteamInfo(map.id) : null;
    if (!map || !info) {
        $("previewPane").innerHTML =
            '<div class="preview-empty"><p>SELECT A MAP</p>' +
            '<small>Choose a public Steam Workshop map from the left.</small></div>';
        return;
    }
    const url = "https://steamcommunity.com/sharedfiles/filedetails/?id=" +
        encodeURIComponent(map.id);
    const desc = typeof info.description === "string" ? info.description
        .replace(/\[(?:\/)?[a-z0-9_*]+(?:=[^\]]+)?\]/gi, "")
        .replace(/<[^>]*>/g, "")
        .replace(/\r/g, "").trim().slice(0, 550) : "";
    $("previewPane").innerHTML =
        '<div class="preview-topline"></div>' + squareCover(info.preview_url, true) +
        '<div class="preview-title-band">' + escapeHtml(info.title) + '</div>' +
        '<h3 class="preview-heading">MAP INFORMATION</h3>' +
        '<div class="preview-details"><p>CREATED BY <strong>' +
        escapeHtml(publisherName(info)) + '</strong></p>' +
        '<p>WORKSHOP ID <strong>' + escapeHtml(map.id) + '</strong></p>' +
        (map.liteOnly ? '<p><strong>LITE ONLY</strong></p>' : '') + '</div>' +
        (desc ? '<h3 class="preview-heading">MISSION BRIEFING</h3>' +
            '<p class="preview-blurb">' + escapeHtml(desc) + '</p>' : '') +
        '<div class="preview-buttons"><button data-copy="' + escapeHtml(map.id) +
        '">COPY WORKSHOP ID</button><a href="' + url +
        '" target="_blank" rel="noopener noreferrer">OPEN WORKSHOP ↗</a></div>';
}
function render() {
    const publicItems = publicMaps();
    renderNav();
    const category = state.selected === null ? null : state.categories[state.selected];
    $("groupCount").textContent = state.steamReady ?
        state.categories.filter(cat => categoryMaps(cat).length).length.toLocaleString("en-US") : "—";
    $("mapCount").textContent = state.steamReady ?
        publicItems.length.toLocaleString("en-US") : "—";
    $("liteCount").textContent = state.steamReady ?
        publicItems.filter(map => map.liteOnly).length.toLocaleString("en-US") : "—";
    const matches = filtered();
    if (state.activeMapId && !matches.some(map => map.id === state.activeMapId)) {
        state.activeMapId = null;
    }
    if (!state.activeMapId && matches.length) state.activeMapId = matches[0].id;
    $("catalog").innerHTML = !state.steamReady ?
        '<p class="empty">' + (state.steamFailed ?
        "PUBLIC WORKSHOP DATA UNAVAILABLE. MAPS HIDDEN." :
        "VERIFYING PUBLIC WORKSHOP MAPS…") + '</p>' :
        matches.length ? matches.map(mapRow).join("") :
        '<p class="empty">NO PUBLIC MAPS FOUND.</p>';
    renderPreview();
}
async function copyID(id) {
    try {
        await navigator.clipboard.writeText(id);
    } catch (_) {
        const field = document.createElement("textarea");
        field.value = id;
        document.body.appendChild(field);
        field.select();
        document.execCommand("copy");
        field.remove();
    }
}
function selectCategory(value) {
    state.selected = value === "all" ? null : Number(value);
    state.query = "";
    $("searchInput").value = "";
    state.activeMapId = null;
    render();
}
function bind() {
    bindLanguagePicker();
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
        const btn = event.target.closest("[data-copy]");
        if (!btn) return;
        await copyID(btn.dataset.copy);
        btn.textContent = "COPIED";
        setTimeout(() => {
            if (btn.isConnected) btn.textContent = "COPY WORKSHOP ID";
        }, 1300);
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
        state.activeMapId = null;
        render();
    });
    $("searchInput").addEventListener("input", event => {
        state.query = event.target.value;
        if (state.query.trim()) state.selected = null;
        state.activeMapId = null;
        render();
    });
    bindMapSubmission();
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
function closeSubmission() {
    if ($("submitMapOverlay").hidden) return;
    $("submitMapOverlay").hidden = true;
    document.documentElement.classList.remove("submission-open");
    document.body.classList.remove("submission-open");
    document.body.style.top = submissionPreviousTop;
    window.scrollTo(0, submissionScrollY);
    $("submitMapOpen").focus({ preventScroll: true });
}
function openSubmission() {
    if (!$("submitMapOverlay").hidden) return;
    if (!state.categories.length) {
        setSubmissionError("The catalog is still loading.");
        return;
    }
    const select = $("submitCategory");
    select.innerHTML = '<option value="">SELECT CATEGORY</option>' +
        state.categories.map(cat => '<option value="' +
        escapeHtml(cat.button) + '">' + escapeHtml(cat.name) + '</option>').join("");
    $("submitMapForm").reset();
    if (state.selected !== null && state.categories[state.selected]) {
        select.value = state.categories[state.selected].button;
    }
    setSubmissionError("");
    submissionScrollY = window.scrollY || window.pageYOffset || 0;
    submissionPreviousTop = document.body.style.top;
    document.body.style.top = -submissionScrollY + "px";
    document.documentElement.classList.add("submission-open");
    document.body.classList.add("submission-open");
    $("submitMapOverlay").hidden = false;
    $("submitWorkshopId").focus({ preventScroll: true });
}
function submitMapProposal(event) {
    event.preventDefault();
    const id = parseWorkshopId($("submitWorkshopId").value);
    const selectedKey = $("submitCategory").value;
    const category = state.categories.find(cat => cat.button === selectedKey);
    if (!id) return setSubmissionError("Enter a valid Steam Workshop URL or Workshop ID.");
    if (!category) return setSubmissionError("Select an existing map category.");
    if (state.maps.some(map => map.id === id))
        return setSubmissionError("This Workshop ID is already in the catalog.");
    const notes = $("submitNotes").value.trim().replace(/\r/g, "");
    if (notes.length > 400) return setSubmissionError("Notes must be at most 400 characters.");
    const body = [
        "<!-- aae-map-submission:v1 -->",
        "Workshop ID: " + id,
        "Category: " + selectedKey,
        "Notes:",
        notes || "None"
    ].join("\n");
    const url = new URL(SUBMISSION_ISSUE_URL);
    url.searchParams.set("title", "[Map Submission] " + id);
    url.searchParams.set("body", body);
    window.location.assign(url.toString());
}
function bindMapSubmission() {
    $("submitMapOpen").addEventListener("click", openSubmission);
    $("submitMapClose").addEventListener("click", closeSubmission);
    $("submitMapCancel").addEventListener("click", closeSubmission);
    $("submitMapOverlay").addEventListener("click", event => {
        if (event.target === $("submitMapOverlay")) closeSubmission();
    });
    document.addEventListener("keydown", event => {
        if (event.key === "Escape" && !$("submitMapOverlay").hidden) {
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

        loadSteamMetadata().then(error => {
            if (!error && state.selected === null && !state.liteOnly && !state.query.trim()) {
                const first = state.categories.find(category => categoryMaps(category).length > 0);
                if (first) state.selected = first.order;
            }
            render();
            reportResourceError("steam", error
                ? "Public Steam verification unavailable (" + error + "). Maps are hidden."
                : null);
        }).catch(error => {
            reportResourceError("steam", "Public Steam verification unavailable: " + error.message);
        });
    } catch (error) {
        $("catalog").innerHTML = "";
        $("errorMessage").hidden = false;
        $("errorMessage").textContent = "Unable to load the map catalog: " + error.message;
    }
}
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
    init();
}
