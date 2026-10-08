# AAE Custom Map Category

All-Around Enhancement 自定义地图分类目录。通过 GitHub Pages 展示地图分类、UGC ID 和 Lite 专属条目。

## 数据

- 根目录的 [custommap_cate.json](./custommap_cate.json) 是网页的**唯一数据源**。
- 保留原有 JSON 分类数组顺序和字段：`index`、`button`、`description`、`ugc`。
- `ugc` 支持字符串 ID，以及包含 `id` 和 `lite_only` 的对象。
- 修改并提交 JSON 后，GitHub Pages 自动重新发布。页面每次访问均重新读取 JSON。

## 网页功能

- 按分类浏览
- 根据 UGC ID、分类序号或本地化 key 搜索
- 仅显示 `lite_only: true` 条目
- 复制 ID、跳转 Steam Workshop、按当前筛选结果导出 CSV
- 桌面与移动设备自适应

## 发布

访问仓库 **Settings → Pages → Build and deployment**，将 **Source** 设为 **GitHub Actions**。项目中的 [pages.yml](./.github/workflows/pages.yml) 会在推送到 `main` 时部署。

网页地址：[https://k7ysh5a41.github.io/AAE-Custom-Map-Category/](https://k7ysh5a41.github.io/AAE-Custom-Map-Category/)

如页面尚未上线，请查看 **Actions** 中的部署任务以及 Pages 设置。

本地预览：在项目目录运行 `python -m http.server 8000`，访问 `http://localhost:8000`。
