# AAE Custom Map Category

A static, searchable catalog of custom Zombies map categories for All-Around Enhancement (AAE). The site reads its data directly from the repository's JSON file.

## Data source

[custommap_cate.json](./custommap_cate.json) is the **single source of truth** for the catalog.

- The original category order and fields (`index`, `button`, `description`, `ugc`) are preserved.
- Each `ugc` item can be a Steam Workshop ID string or an object with `id` and `lite_only`.
- Update and commit this JSON file to change the catalog. No changes to HTML or JavaScript are necessary.
- The site fetches the JSON on every visit instead of embedding a separate copy.

## Features

- Browse maps by category.
- Search by UGC ID, category index, category name, or localization key.
- Filter for `lite_only: true` entries.
- Copy UGC IDs, open Steam Workshop pages, and export the currently filtered entries to CSV.
- Responsive layout for desktop and mobile devices.

## Enable GitHub Pages (required)

**The website link will return 404 until GitHub Pages has been enabled.**

1. Open [Settings → Pages](https://github.com/k7Ysh5A41/AAE-Custom-Map-Category/settings/pages).
2. Under **Build and deployment**, select **GitHub Actions** as the source.
3. Open [Actions](https://github.com/k7Ysh5A41/AAE-Custom-Map-Category/actions) and confirm that **Deploy GitHub Pages** completes successfully. If necessary, open the workflow and select **Run workflow**.

After a successful deployment, the website will be available at:

**https://k7ysh5a41.github.io/AAE-Custom-Map-Category/**

The automatic deployment workflow is located at [`.github/workflows/pages.yml`](./.github/workflows/pages.yml) and runs when `main` is updated.

### Local preview

From the repository directory, run:

```bash
python -m http.server 8000
```

Then open http://localhost:8000/. Opening `index.html` directly using `file://` will not work because browsers restrict local JSON fetching.
