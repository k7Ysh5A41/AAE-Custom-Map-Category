#!/usr/bin/env python3
"""Build a website-only index of recently merged, approved community maps.

Never changes custommap_cate.json. Only verified bot PRs merged into main
and still reflected in the current approved catalog are included.
"""
from __future__ import annotations

import json
import os
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / "recent_maps.json"
CATALOG = ROOT / "custommap_cate.json"
REPOSITORY = "k7Ysh5A41/AAE-Custom-Map-Category"
API = "https://api.github.com/repos/" + REPOSITORY
RECENT_DAYS = 7
MAX_PAGES = 5
ID = re.compile(r"(?m)^Workshop ID: ([0-9]{7,20})\r?$")
CATEGORY = re.compile(r"(?m)^Category: (AAEP_[A-Z0-9_]+)\r?$")
TARGET = re.compile(r"(?m)^Target Category: (AAEP_[A-Z0-9_]+|none)\r?$")
ACTION = re.compile(r"(?m)^Action: (move|update|delete)\r?$")
NEW_BRANCH = re.compile(r"community-maps/issue-[1-9][0-9]*\Z")
CHANGE_BRANCH = re.compile(r"community-changes/issue-[1-9][0-9]*\Z")


def parse_recent(pr, approved, now):
    if not isinstance(pr, dict) or not pr.get("merged_at"):
        return None
    try:
        when = datetime.fromisoformat(str(pr["merged_at"]).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    if when.tzinfo is None or not (now - timedelta(days=RECENT_DAYS) <= when <= now):
        return None
    head, base = pr.get("head") or {}, pr.get("base") or {}
    if ((pr.get("user") or {}).get("login") != "github-actions[bot]" or
            (head.get("repo") or {}).get("full_name", "").lower() != REPOSITORY.lower() or
            base.get("ref") != "main"):
        return None
    body, branch = str(pr.get("body") or ""), str(head.get("ref") or "")
    if body.startswith("<!-- aae-map-pr:v1 -->\n") and NEW_BRANCH.fullmatch(branch):
        categories = CATEGORY.findall(body)
        if len(categories) != 1:
            return None
        kind, target = "added", categories[0]
    elif body.startswith("<!-- aae-map-change-pr:v1 -->\n") and CHANGE_BRANCH.fullmatch(branch):
        actions, categories = ACTION.findall(body), TARGET.findall(body)
        if len(actions) != 1 or len(categories) != 1 or actions[0] == "delete":
            return None
        kind, target = "changed", categories[0]
    else:
        return None
    ids = ID.findall(body)
    if len(ids) != 1 or approved.get(ids[0]) != target:
        return None
    number = pr.get("number")
    if (not isinstance(number, int) or number < 1 or
            pr.get("html_url") != f"https://github.com/{REPOSITORY}/pull/{number}"):
        return None
    return {
        "id": ids[0], "kind": kind, "pr_number": number,
        "merged_at": when.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
    }


def fetch_closed_prs():
    results = []
    token = os.environ.get("GH_TOKEN")
    for page in range(1, MAX_PAGES + 1):
        headers = {
            "User-Agent": "AAE-Recent-Approved-Maps",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        }
        if token:
            headers["Authorization"] = "Bearer " + token
        req = Request(f"{API}/pulls?state=closed&sort=updated&direction=desc"
                      f"&per_page=100&page={page}", headers=headers)
        with urlopen(req, timeout=30) as response:
            batch = json.load(response)
        if not isinstance(batch, list):
            raise ValueError("Invalid merged PR response")
        results.extend(batch)
        if len(batch) < 100:
            break
    return results


def main():
    catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
    approved = {
        str(entry.get("id") if isinstance(entry, dict) else entry): cat["button"]
        for cat in catalog for entry in cat["ugc"]
    }
    now = datetime.now(timezone.utc)
    entries = []
    try:
        candidates = fetch_closed_prs()
        seen = set()
        # The newest approved update for each map wins.
        for pr in sorted(candidates, key=lambda item: str(item.get("merged_at") or ""),
                         reverse=True):
            info = parse_recent(pr, approved, now)
            if info and info["id"] not in seen:
                seen.add(info["id"])
                entries.append(info)
    except (HTTPError, URLError, OSError, ValueError) as error:
        print(f"WARNING: Unable to verify recently merged PRs: {error}. "
              "No recent flags will be published.", flush=True)
        entries = []
    payload = {
        "source": "Verified merged community map PRs",
        "window_days": RECENT_DAYS,
        "generated_at": now.isoformat(),
        "items": entries,
    }
    temporary = DEST.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n",
                         encoding="utf-8")
    os.replace(temporary, DEST)
    print(f"Published {len(entries)} recent approved map updates.", flush=True)


if __name__ == "__main__":
    main()
