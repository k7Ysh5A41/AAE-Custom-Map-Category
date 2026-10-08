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
const LOCALIZATION_BASE = "https://raw.githubusercontent.com/k7Ysh5A41/AAE-localizedstrings/main/english/localizedstrings/";
const LOCALIZATION_MIRROR = "./localization/";
const $ = id => document.getElementById(id);
const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, char =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]
);
const state = {
    categories: [], maps: [], selected: null, liteOnly: false,
    translations: new Map(), workshop: {}
};

// StringEd .str files pair REFERENCE with LANG_ENGLISH. The file name supplies
// the namespace (AAEP.str + REFERENCE ZC2_MAP = AAEP_ZC2_MAP).
function parseStringEd(source, prefix) {
    let reference = null;
    let count = 0;
    for (const line of source.split(/\r?\n/)) {
        const key = line.match(/^\s*REFERENCE\s+([A-Za-z0-9_]+)/);
        if (key) { reference = key[1]; continue; }
        const english = line.match(/^\s*LANG_ENGLISH\s+"((?:\\.|[^"\\])*)"/);
        if (!english || !reference) continue;
        const value = english[1]
            .replace(/\\([nrt"\\])/g, (_, code) =>
                code === "n" ? "\n" : code === "r" ? "\r" : code === "t" ? "\t" : code)
            .replace(/\^[0-9]/g, "");
        state.translations.set(prefix + "_" + reference, value);
        count++;
    }
    return count;
}

async function loadStringEd(prefix) {
    const candidates = [
        LOCALIZATION_MIRROR + encodeURIComponent(prefix) + ".str",
        LOCALIZATION_BASE + encodeURIComponent(prefix) + ".str"
    ];
    const errors = [];
    for (const url of candidates) {
        try {
            const response = await fetchWithTimeout(url, { cache: "no-store" });
            if (!response.ok) throw new Error("HTTP " + response.status);
            if (!parseStringEd(await response.text(), prefix)) throw new Error("Empty StringEd data");
            return;
        } catch (error) { errors.push(error.message); }
    }
    throw new Error(prefix + ": " + errors.join("; "));
}

async function loadLocalizations(categories) {
    state.translations.clear();
    const prefixes = [...new Set(categories
        .flatMap(category => [category?.button, category?.description])
        .filter(key => typeof key === "string")
        .map(key => /^([A-Za-z0-9]+)_/.exec(key)?.[1])
        .filter(Boolean))];
    const settled = await Promise.allSettled(prefixes.map(loadStringEd));
    return settled.filter(result => result.status === "rejected")
        .map(result => result.reason.message);
}

async function loadSteamMetadata() {
    try {
        const response = await fetchWithTimeout(STEAM_URL, { cache: "no-store" });
        if (!response.ok) throw new Error("HTTP " + response.status);
        const json = await response.json();
        if (!json || typeof json.items !== "object" || !json.items)
            throw new Error("Invalid Steam metadata");
        state.workshop = json.items;
        return null;
    } catch (error) {
        state.workshop = {};
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
function filtered() {
    return state.maps.filter(map =>
        (state.selected === null || map.category.order === state.selected) &&
        (!state.liteOnly || map.liteOnly));
}
function getSteamInfo(id) {
    const entry = state.workshop[id];
    return entry && typeof entry.title === "string" && entry.title.trim() ? entry : null;
}
function renderNav() {
    const all = { order: null, name: "All Maps", ugc: state.maps };
    $("categoryNav").innerHTML = [all, ...state.categories].map(category =>
        '<button class="nav-btn' + (category.order === state.selected ? " active" : "") +
        '" data-category="' + (category.order ?? "all") +
        '" title="' + escapeHtml(category.summary || "") + '"><span>' +
        escapeHtml(category.name) + '</span><small>' + category.ugc.length +
        "</small></button>").join("");
}
function categoryRow(category) {
    const liteCount = category.ugc.filter(item =>
        item && typeof item === "object" && item.lite_only === true).length;
    return '<article class="category-row" tabindex="0" role="button" data-open="' +
        category.order + '"><div class="category-copy"><div class="category-kicker">CATEGORY ' +
        escapeHtml(category.index) + '</div><h3>' + escapeHtml(category.name) +
        '</h3><p>' + escapeHtml(category.summary) + '</p></div><div class="category-count">' +
        category.ugc.length + '<small> maps</small>' +
        (liteCount ? '<span class="lite-count">' + liteCount + ' Lite-only</span>' : '') +
        '</div><span class="category-chevron" aria-hidden="true">→</span></article>';
}
function mapRow(map) {
    const info = getSteamInfo(map.id);
    const title = info ? info.title : map.id;
    const preview = info?.preview_url;
    const thumbnail = typeof preview === "string" && /^https:\/\//.test(preview) ?
        '<img class="map-thumbnail" src="' + escapeHtml(preview) +
        '" alt="" loading="lazy" referrerpolicy="no-referrer">' :
        '<div class="map-thumbnail map-placeholder" aria-hidden="true">AAE</div>';
    const url = "https://steamcommunity.com/sharedfiles/filedetails/?id=" +
        encodeURIComponent(map.id);
    return '<article class="map-row">' + thumbnail +
        '<div class="map-copy"><h3 title="' + escapeHtml(title) + '">' +
        escapeHtml(title) + '</h3><div class="map-id">Workshop ID: ' +
        escapeHtml(map.id) + '</div></div>' +
        (map.liteOnly ? '<span class="chip lite">LITE ONLY</span>' : '') +
        '<div class="map-actions"><button type="button" data-copy="' +
        escapeHtml(map.id) + '">Copy ID</button><a target="_blank" rel="noopener noreferrer" href="' +
        url + '">Steam Workshop ↗</a></div></article>';
}
function render() {
    renderNav();
    const category = state.selected === null ? null : state.categories[state.selected];
    $("viewTitle").textContent = category?.name || (state.liteOnly ? "Lite-only Maps" : "Categories");
    $("viewDescription").textContent = category?.summary || "";
    const matches = filtered();
    $("resultCount").textContent = matches.length.toLocaleString("en-US") + " maps";
    if (state.selected === null && !state.liteOnly) {
        $("catalog").innerHTML = state.categories.map(categoryRow).join("");
    } else {
        $("catalog").innerHTML = matches.length ? matches.map(mapRow).join("") :
            '<p class="empty">No maps in this category.</p>';
    }
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
function csvEscape(value) { return '"' + String(value ?? "").replaceAll('"', '""') + '"'; }
function exportCsv() {
    const rows = [["category_index", "category_key", "category_description", "category_name",
        "steam_title", "ugc_id", "lite_only"],
        ...filtered().map(map => [
            map.category.index, map.category.button, map.category.description,
            map.category.name, getSteamInfo(map.id)?.title || "", map.id, map.liteOnly
        ])];
    const csv = "\ufeff" + rows.map(row => row.map(csvEscape).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "aae-custom-maps.csv";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function selectCategory(value) {
    state.selected = value === "all" ? null : Number(value);
    render();
}
function bind() {
    $("categoryNav").addEventListener("click", event => {
        const button = event.target.closest("[data-category]");
        if (button) selectCategory(button.dataset.category);
    });
    $("catalog").addEventListener("click", async event => {
        const copy = event.target.closest("[data-copy]");
        if (copy) {
            await copyID(copy.dataset.copy);
            copy.textContent = "Copied";
            setTimeout(() => { if (copy.isConnected) copy.textContent = "Copy ID"; }, 1300);
            return;
        }
        const row = event.target.closest("[data-open]");
        if (row) selectCategory(row.dataset.open);
    });
    $("catalog").addEventListener("keydown", event => {
        if ((event.key === "Enter" || event.key === " ") &&
            event.target.matches("[data-open]")) {
            event.preventDefault();
            selectCategory(event.target.dataset.open);
        }
    });
    $("catalog").addEventListener("error", event => {
        if (event.target.matches("img.map-thumbnail")) {
            const placeholder = document.createElement("div");
            placeholder.className = "map-thumbnail map-placeholder";
            placeholder.textContent = "AAE";
            event.target.replaceWith(placeholder);
        }
    }, true);
    $("liteToggle").addEventListener("change", event => {
        state.liteOnly = event.target.checked;
        render();
    });
    $("exportCsv").addEventListener("click", exportCsv);
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
        $("groupCount").textContent = data.categories.length.toLocaleString("en-US");
        $("mapCount").textContent = data.maps.length.toLocaleString("en-US");
        $("liteCount").textContent = data.maps.filter(map => map.liteOnly).length.toLocaleString("en-US");
        render();

        // Enrich the already visible map list as each optional source finishes.
        loadLocalizations(raw).then(errors => {
            for (const category of state.categories) {
                category.name = categoryName(category);
                category.summary = localize(category.description) || "";
            }
            render();
            reportResourceError("localization", errors.length
                ? "Localization unavailable: " + errors.join("; ")
                : null);
        }).catch(error => {
            reportResourceError("localization", "Localization unavailable: " + error.message);
        });

        loadSteamMetadata().then(error => {
            render();
            reportResourceError("steam", error
                ? "Steam metadata unavailable (" + error + "). Showing Workshop IDs."
                : null);
        }).catch(error => {
            reportResourceError("steam", "Steam metadata unavailable: " + error.message);
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
