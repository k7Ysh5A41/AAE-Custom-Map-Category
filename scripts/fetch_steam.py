#!/usr/bin/env python3
"""Build-time Steam Workshop metadata cache for the AAE map catalog.

The category JSON remains the sole source of UGC IDs. Steam titles are fetched
from the public GetPublishedFileDetails endpoint. This file is generated during
GitHub Pages deployment, not committed or maintained by hand.
"""
from __future__ import annotations

import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "custommap_cate.json"
DEST = ROOT / "steam_workshop.json"
API = "https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/"
BATCH_SIZE = 50
ATTEMPTS = 3


def workshop_ids():
    categories = json.loads(SOURCE.read_text(encoding="utf-8"))
    ids = []
    seen = set()
    for category in categories:
        for item in category.get("ugc", []):
            id_value = item.get("id") if isinstance(item, dict) else item
            key = str(id_value or "")
            if key.isdecimal() and key not in seen:
                ids.append(key)
                seen.add(key)
    return ids


def fetch_batch(batch):
    fields = [("itemcount", str(len(batch)))]
    fields += [(f"publishedfileids[{i}]", item_id) for i, item_id in enumerate(batch)]
    request = Request(
        API, data=urlencode(fields).encode("ascii"),
        headers={"User-Agent": "AAE-Workshop-Catalog/1.0", "Accept": "application/json",
                 "Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    with urlopen(request, timeout=35) as response:
        payload = json.load(response)
    details = payload.get("response", {}).get("publishedfiledetails", [])
    if not isinstance(details, list):
        raise ValueError("Steam response missing publishedfiledetails")
    return details


def collect(ids):
    output = {}
    failures = 0
    for offset in range(0, len(ids), BATCH_SIZE):
        batch = ids[offset:offset + BATCH_SIZE]
        for attempt in range(ATTEMPTS):
            try:
                details = fetch_batch(batch)
                for item in details:
                    if item.get("result") != 1:
                        continue
                    key = str(item.get("publishedfileid", ""))
                    title = str(item.get("title", "")).strip()
                    if not key or not title or key not in batch:
                        continue
                    record = {"title": title}
                    thumbnail = item.get("preview_url")
                    if isinstance(thumbnail, str) and urlsplit(thumbnail).scheme == "https":
                        record["preview_url"] = thumbnail
                    output[key] = record
                break
            except (HTTPError, URLError, OSError, ValueError, json.JSONDecodeError) as error:
                if attempt == ATTEMPTS - 1:
                    failures += 1
                    print(f"WARNING: Steam batch {offset // BATCH_SIZE + 1} failed: {error}", flush=True)
                else:
                    time.sleep(2 * (attempt + 1))
        print(f"Steam titles resolved: {len(output)}/{len(ids)}", flush=True)
        time.sleep(0.25)
    return output, failures


def main():
    ids = workshop_ids()
    metadata, errors = collect(ids)
    data = {
        "source": "Steam Workshop / ISteamRemoteStorage/GetPublishedFileDetails",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "items": metadata,
    }
    temp = DEST.with_suffix(".json.tmp")
    temp.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    os.replace(temp, DEST)
    print(f"Steam metadata: {len(metadata)} titles, {len(ids)} unique IDs, {errors} failed batches")
    if errors:
        print("WARNING: Some Steam batches failed; missing titles will display their UGC IDs.")


if __name__ == "__main__":
    main()
