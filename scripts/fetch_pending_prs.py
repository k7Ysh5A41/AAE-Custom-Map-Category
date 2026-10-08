#!/usr/bin/env python3
"""Publish an unmerged community PR index for the static map catalog.

Only same-repository, conventionally named submission PRs are accepted.
This is a list of *pending* proposals, never merged catalog data.
"""
from __future__ import annotations

import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / "pending_pr_maps.json"
CATALOG = ROOT / "custommap_cate.json"
REPOSITORY = "k7Ysh5A41/AAE-Custom-Map-Category"
API = "https://api.github.com/repos/" + REPOSITORY
ID_PATTERN = re.compile(r"(?m)^Workshop ID: ([0-9]{7,20})\r?$")
CATEGORY_PATTERN = re.compile(r"(?m)^Category: (AAEP_[A-Z0-9_]+)\r?$")
BRANCH_PATTERN = re.compile(r"community-maps/issue-[0-9]+")


def catalog_info():
    categories = json.loads(CATALOG.read_text(encoding="utf-8"))
    category_keys = {category["button"] for category in categories}
    ids = {str(item.get("id") if isinstance(item, dict) else item)
           for category in categories for item in category["ugc"]}
    return category_keys, ids


def parse_pending(pr, category_keys, existing):
    """Accept only eligible PRs, and avoid exposing merged or invalid IDs."""
    if pr.get("state") != "open" or pr.get("draft"):
        return None
    head = pr.get("head") or {}
    base = pr.get("base") or {}
    if ((head.get("repo") or {}).get("full_name", "").lower() != REPOSITORY.lower()
            or not BRANCH_PATTERN.fullmatch(str(head.get("ref", "")))
            or base.get("ref") != "main"):
        return None
    body = str(pr.get("body") or "")
    if not body.startswith("<!-- aae-map-pr:v1 -->\n"):
        return None
    matches_id = ID_PATTERN.findall(body)
    matches_category = CATEGORY_PATTERN.findall(body)
    if len(matches_id) != 1 or len(matches_category) != 1:
        return None
    workshop_id, category = matches_id[0], matches_category[0]
    if category not in category_keys or workshop_id in existing:
        return None
    number = pr.get("number")
    url = pr.get("html_url")
    created_at = pr.get("created_at")
    if not isinstance(number, int) or number < 1:
        return None
    if url != f"https://github.com/{REPOSITORY}/pull/{number}":
        return None
    try:
        created = datetime.fromisoformat(str(created_at).replace("Z", "+00:00"))
        if created.tzinfo is None:
            return None
    except ValueError:
        return None
    return {"id": workshop_id, "category": category,
            "pr_number": number, "pr_url": url, "created_at": created_at}


def fetch_open_prs():
    items = []
    for page in range(1, 11):
        url = f"{API}/pulls?state=open&per_page=100&page={page}"
        headers = {"User-Agent": "AAE-Pending-Workshop-PRs/1.0",
                   "Accept": "application/vnd.github+json",
                   "X-GitHub-Api-Version": "2022-11-28"}
        token = os.environ.get("GH_TOKEN")
        if token:
            headers["Authorization"] = "Bearer " + token
        request = Request(url, headers=headers)
        with urlopen(request, timeout=30) as response:
            batch = json.load(response)
        if not isinstance(batch, list):
            raise ValueError("GitHub open PR response was not an array")
        items.extend(batch)
        if len(batch) < 100:
            return items
    raise ValueError("Too many open pull requests to verify without truncation")


def main():
    categories, existing = catalog_info()
    try:
        prs = fetch_open_prs()
    except (HTTPError, URLError, OSError, ValueError) as error:
        # Do not publish potentially outdated pending status from earlier runs.
        print(f"WARNING: Cannot verify open PRs: {error}. No pending items published.",
              flush=True)
        prs = []
    entries = []
    seen = set()
    for pr in sorted(prs, key=lambda x: (str(x.get("created_at", "")), x.get("number", 0))):
        item = parse_pending(pr, categories, existing)
        if item and item["id"] not in seen:
            seen.add(item["id"])
            entries.append(item)
    payload = {
        "source": "GitHub / public open community map pull requests",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "items": entries,
    }
    temporary = DEST.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n",
                         encoding="utf-8")
    os.replace(temporary, DEST)
    print(f"Included {len(entries)} pending PR maps from {len(prs)} open PRs.",
          flush=True)


if __name__ == "__main__":
    main()
