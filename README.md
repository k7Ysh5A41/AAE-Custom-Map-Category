# AAE Custom Map Category

A Call of Duty: Black Ops III Zombies-inspired interface for publicly listed custom maps compatible with **All-Around Enhancement**, hosted on GitHub Pages.

**Website:** https://k7ysh5a41.github.io/AAE-Custom-Map-Category/

## Data source

[custommap_cate.json](./custommap_cate.json) is the **single source of truth** for categories and UGC IDs. The original fields (`index`, `button`, `description`, `ugc`) and order are preserved. Each `ugc` item may be a string ID or an object containing `id` and `lite_only`.

To add, delete, or reorganize maps, edit and commit this JSON. No edits to the webpage code are required.

## Names and descriptions

### Category localization

Category labels and descriptions are **not hardcoded or stored** in this repository. On deployment, GitHub Actions fetches the original [English AAEP.str](https://github.com/k7Ysh5A41/AAE-localizedstrings/blob/main/english/localizedstrings/AAEP.str) from the separate AAE localization repository.

The JavaScript parser pairs each `REFERENCE` with its `LANG_ENGLISH` line, adds the `AAEP_` namespace, and resolves the JSON category's `button` and `description` values. The browser prefers the localization file bundled during deployment, with the upstream repository as a fallback.

### Public maps, publishers, and cover art from Steam

The [Steam metadata fetcher](./scripts/fetch_steam.py) reads UGC IDs from `custommap_cate.json` and requests titles and preview images from Steam's public `ISteamRemoteStorage/GetPublishedFileDetails/v1/` endpoint in batches.

- The generated `steam_workshop.json` is included in the **deployed website**, not committed to this repository.
- Steam metadata is refreshed with each deployment and via the daily scheduled workflow.
- Only Workshop items independently verified as **public** (`visibility == 0`) are displayed. Friends-only, private, unlisted, deleted, and unverified items are excluded from the map list and CSV export.
- If the deployed verification data cannot load, the site hides all map entries rather than exposing potentially non-public items.
- Steam Workshop uploader IDs come from the item's `creator` field. The build fetches publicly available Steam profile display names when possible, and displays their names as **non-clickable, small text**, without linking to Steam profiles.
- Cover images are placed inside strictly square 1:1 clipping containers, with fixed HTML dimensions and CSS `object-fit:cover` (47 × 47 for list thumbnails and up to 350 × 350 for the selected preview).
- Titles and cover images originate from Steam Workshop, with direct links to the Workshop pages.
- No Steam API key is needed for the public published-file-details endpoint.

## Website features

- A BO3 Zombies map-selection-inspired layout, using nearly black backgrounds, slate-blue horizontal separators, condensed white typography, and full-row red-orange highlights.
- No separate top navigation bar. Main heading: **ALL-AROUND ENHANCEMENT MAP CATALOG**.
- Three sections: left category navigation, compact map-selection list in the middle, and the selected map's large preview and Workshop information on the right.
- Verified public Steam Workshop map titles, non-clickable uploader names, UGC IDs, square cover images, and Workshop-sourced mission briefing excerpts when available.
- Keyboard navigable map list, Lite-only filter, Copy ID button in the preview, direct Steam Workshop link, and CSV export.
- Responsive desktop/mobile layout.

There is no search field or View JSON button.

## GitHub Pages

[Deploy GitHub Pages](./.github/workflows/pages.yml) publishes the site on commits to `main`, by manual dispatch, and on a daily schedule (03:17 UTC). Check the [Actions dashboard](https://github.com/k7Ysh5A41/AAE-Custom-Map-Category/actions) for the latest deployment.

Under [Settings → Pages](https://github.com/k7Ysh5A41/AAE-Custom-Map-Category/settings/pages), the source should be **GitHub Actions**.

## Local development

Serve the repository over HTTP:

```bash
python -m http.server 8000
```

Open http://localhost:8000/. To display Steam titles locally, run `python scripts/fetch_steam.py` with Internet access. Without generated public-only metadata, map rows are hidden to avoid displaying unverified Workshop content. Opening `index.html` directly through `file://` is not supported because the browser restricts file-based JSON loading.
