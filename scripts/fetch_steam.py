#!/usr/bin/env python3
"""Build an authoritative public-only Steam Workshop catalog.

Only UGC items confirmed as publicly visible (visibility == 0) appear in the
deployed cache. Workshop IDs come exclusively from custommap_cate.json.
Published item creators come from Steam's creator field; display names are
resolved from publicly available Steam Community profiles when possible.
"""
from __future__ import annotations

import json
import os
import time
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor, as_completed
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
USER_AGENT = "AAE-Workshop-Catalog/1.1"


def workshop_ids():
    categories = json.loads(SOURCE.read_text(encoding="utf-8"))
    ids = []
    seen = set()
    for category in categories:
        for item in category.get("ugc", []):
            value = item.get("id") if isinstance(item, dict) else item
            key = str(value or "")
            if key.isdecimal() and key not in seen:
                ids.append(key)
                seen.add(key)
    return ids


def fetch_batch(batch):
    fields = [("itemcount", str(len(batch)))]
    fields.extend((f"publishedfileids[{i}]", item_id)
                  for i, item_id in enumerate(batch))
    request = Request(
        API, data=urlencode(fields).encode("ascii"), method="POST",
        headers={"User-Agent": USER_AGENT, "Accept": "application/json",
                 "Content-Type": "application/x-www-form-urlencoded"},
    )
    with urlopen(request, timeout=35) as response:
        result = json.load(response)
    details = result.get("response", {}).get("publishedfiledetails", [])
    if not isinstance(details, list):
        raise ValueError("Steam response missing publishedfiledetails")
    return details


def published_public(item):
    """Never infer public visibility from the mere presence of a title."""
    return (str(item.get("result")) == "1"
            and str(item.get("visibility", "")) == "0"
            and not item.get("banned", False))


def collect(ids):
    output = {}
    failures = 0
    non_public = 0
    for offset in range(0, len(ids), BATCH_SIZE):
        batch = ids[offset:offset + BATCH_SIZE]
        for attempt in range(ATTEMPTS):
            try:
                details = fetch_batch(batch)
                for item in details:
                    if not published_public(item):
                        non_public += 1
                        continue
                    key = str(item.get("publishedfileid", ""))
                    title = str(item.get("title", "")).strip()
                    if key not in batch or not title:
                        continue
                    record = {"title": title, "visibility": 0}
                    description = str(item.get("file_description") or "").strip()
                    if description:
                        record["description"] = description[:1200]
                    preview = item.get("preview_url")
                    if (isinstance(preview, str)
                            and urlsplit(preview).scheme == "https"):
                        record["preview_url"] = preview
                    creator = str(item.get("creator") or "")
                    if creator.isdecimal():
                        record["creator_id"] = creator
                    output[key] = record
                break
            except (HTTPError, URLError, OSError, ValueError,
                    json.JSONDecodeError) as error:
                if attempt == ATTEMPTS - 1:
                    failures += 1
                    print(f"WARNING: Steam batch {offset // BATCH_SIZE + 1} "
                          f"failed: {error}", flush=True)
                else:
                    time.sleep(2 * (attempt + 1))
        print(f"Verified public Steam items: {len(output)}/{len(ids)}",
              flush=True)
        time.sleep(0.20)
    return output, failures, non_public


def fetch_creator_name(steam_id):
    """Steam's public XML profile (deprecated, best effort; no API key)."""
    url = f"https://steamcommunity.com/profiles/{steam_id}/?xml=1"
    try:
        request = Request(url, headers={"User-Agent": USER_AGENT,
                                        "Accept": "text/xml"})
        with urlopen(request, timeout=7) as response:
            xml = response.read(1048576)
        name = ET.fromstring(xml).findtext("steamID", default="").strip()
        return steam_id, name or None
    except (HTTPError, URLError, OSError, ET.ParseError, ValueError):
        return steam_id, None


def add_publisher_names(items):
    creators = sorted({item["creator_id"] for item in items.values()
                       if "creator_id" in item})
    if not creators:
        print("No creator IDs in public Steam metadata", flush=True)
        return
    names = {}
    with ThreadPoolExecutor(max_workers=24) as pool:
        jobs = [pool.submit(fetch_creator_name, steam_id)
                for steam_id in creators]
        for job in as_completed(jobs):
            steam_id, name = job.result()
            if name:
                names[steam_id] = name
    for item in items.values():
        name = names.get(item.get("creator_id"))
        if name:
            item["creator_name"] = name
    print(f"Publisher names resolved: {len(names)}/{len(creators)}",
          flush=True)


def main():
    ids = workshop_ids()
    items, failed, excluded = collect(ids)
    add_publisher_names(items)
    generated = {
        "source": "Steam Workshop / ISteamRemoteStorage/GetPublishedFileDetails",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "public_only": True,
        "items": items
    }
    temporary = DEST.with_suffix(".json.tmp")
    temporary.write_text(
        json.dumps(generated, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8")
    os.replace(temporary, DEST)
    print(f"Published {len(items)} verified public items from {len(ids)} "
          f"UGC IDs; excluded/unavailable results: {excluded}; "
          f"failed batches: {failed}", flush=True)
    if failed:
        print("WARNING: Failed batches were excluded (fail closed).")


if __name__ == "__main__":
    main()
