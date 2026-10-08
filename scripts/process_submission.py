#!/usr/bin/env python3
"""Validate a community-submitted BO3 Workshop map and open a reviewable PR.

Runs only in the repository's GitHub Actions issue event. No untrusted shell
commands, downloaded executable code, or repository secrets are exposed to users.
"""
from __future__ import annotations

import base64
import json
import os
import re
import sys
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, quote
from urllib.request import Request, urlopen

REPOSITORY = "k7Ysh5A41/AAE-Custom-Map-Category"
API = "https://api.github.com/repos/" + REPOSITORY
STEAM_API = "https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/"
APP_ID = "311210"


def github(method: str, endpoint: str, data=None, not_found_ok=False):
    token = os.environ["GH_TOKEN"]
    payload = None if data is None else json.dumps(data).encode("utf-8")
    req = Request(API + endpoint, data=payload, method=method, headers={
        "Authorization": "Bearer " + token,
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "AAE-Community-Map-Review",
        **({"Content-Type": "application/json"} if payload else {}),
    })
    try:
        with urlopen(req, timeout=30) as res:
            return {} if res.status == 204 else json.load(res)
    except HTTPError as exc:
        if exc.code == 404 and not_found_ok:
            return None
        try:
            detail = json.loads(exc.read().decode("utf-8")).get("message", "")
        except (ValueError, UnicodeDecodeError):
            detail = ""
        raise RuntimeError(f"GitHub {method} {endpoint}: HTTP {exc.code}: {detail}") from exc


def workshop_details(workshop_id: str) -> dict:
    encoded = urlencode({"itemcount": "1", "publishedfileids[0]": workshop_id})
    request = Request(STEAM_API, data=encoded.encode("ascii"), method="POST",
                      headers={"User-Agent": "AAE-Community-Map-Review",
                               "Content-Type": "application/x-www-form-urlencoded"})
    try:
        with urlopen(request, timeout=35) as response:
            result = json.load(response)
    except (HTTPError, URLError, OSError, ValueError) as exc:
        raise ValueError("Steam Workshop verification is temporarily unavailable.") from exc
    items = result.get("response", {}).get("publishedfiledetails", [])
    if len(items) != 1 or str(items[0].get("publishedfileid")) != workshop_id:
        raise ValueError("Steam did not return the requested Workshop item.")
    item = items[0]
    if (str(item.get("result")) != "1" or str(item.get("visibility")) != "0"
            or item.get("banned", False)):
        raise ValueError("The Workshop item is not publicly available.")
    if str(item.get("consumer_app_id", "")) != APP_ID:
        raise ValueError("The item is not for Call of Duty: Black Ops III.")
    if not str(item.get("title", "")).strip():
        raise ValueError("The Workshop item does not have a valid title.")
    return item


def parse_proposal(issue: dict):
    title = str(issue.get("title") or "")
    body = str(issue.get("body") or "").replace("\r\n", "\n").replace("\r", "\n")
    match = re.fullmatch(
        r"<!-- aae-map-submission:v1 -->\n"
        r"Workshop ID: ([0-9]{7,20})\n"
        r"Category: (AAEP_[A-Z0-9_]+)\n"
        r"Notes:\n([\s\S]{1,400})\s*", body,
    )
    if not match or title != "[Map Submission] " + match.group(1):
        raise ValueError("Invalid map submission. Please use the website submission form.")
    return match.group(1), match.group(2), match.group(3).strip()


def map_ids(catalog: list):
    return {str(item.get("id") if isinstance(item, dict) else item)
            for category in catalog for item in category["ugc"]}


def updated_catalog(source: str, category_key: str, workshop_id: str) -> str:
    """Insert exactly one string entry, preserving the entire existing JSON layout."""
    parsed = json.loads(source)
    positions = [i for i, category in enumerate(parsed)
                 if category.get("button") == category_key]
    if len(positions) != 1:
        raise ValueError("The selected category does not exist.")
    if workshop_id in map_ids(parsed):
        raise ValueError("This Workshop ID is already in the catalog.")
    # Exactly one 'ugc' array per category. Index by parsed category order.
    arrays = list(re.finditer(r'"ugc"\s*:\s*\[', source))
    if len(arrays) != len(parsed):
        raise RuntimeError("Cannot safely locate the original category array.")
    open_index = arrays[positions[0]].end() - 1
    nesting, quoted, escaped = 0, False, False
    close_index = None
    for idx in range(open_index, len(source)):
        char = source[idx]
        if quoted:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                quoted = False
        elif char == '"':
            quoted = True
        elif char == "[":
            nesting += 1
        elif char == "]":
            nesting -= 1
            if nesting == 0:
                close_index = idx
                break
    if close_index is None:
        raise RuntimeError("Cannot safely locate the end of the category array.")
    interior = source[open_index + 1:close_index]
    match = re.search(r'(?m)^([ \t]+)(?:"|\{)', interior)
    item_indent = match.group(1) if match else "            "
    closing_indent = "        "
    if interior.strip():
        new_interior = (interior.rstrip() + ",\n" + item_indent +
                        json.dumps(workshop_id) + "\n" + closing_indent)
    else:
        new_interior = "\n" + item_indent + json.dumps(workshop_id) + "\n" + closing_indent
    result = source[:open_index + 1] + new_interior + source[close_index:]
    updated = json.loads(result)
    if len(updated) != len(parsed):
        raise RuntimeError("The resulting catalog has changed category count.")
    for i, (before, after) in enumerate(zip(parsed, updated)):
        if i == positions[0]:
            expected = {**before, "ugc": before["ugc"] + [workshop_id]}
            if after != expected:
                raise RuntimeError("The generated map entry failed verification.")
        elif before != after:
            raise RuntimeError("An unrelated category changed unexpectedly.")
    return result


def issue_comment(issue_number: int, message: str):
    try:
        github("POST", f"/issues/{issue_number}/comments", {"body": message})
    except Exception as exc:
        print("Unable to comment on issue:", exc, file=sys.stderr)


def find_open_pr(workshop_id: str):
    page = 1
    while page <= 10:
        pulls = github("GET", f"/pulls?state=open&per_page=100&page={page}")
        for pr in pulls:
            body = str(pr.get("body") or "")
            if re.search(r"(?m)^Workshop ID: " + re.escape(workshop_id) + r"$", body):
                return pr.get("html_url")
        if len(pulls) < 100:
            break
        page += 1
    if page > 10:
        raise RuntimeError("Cannot safely verify duplicates: more than 1000 open pull requests.")
    return None


def main():
    if os.environ.get("GITHUB_REPOSITORY") != REPOSITORY:
        raise RuntimeError("This script must run in its own repository.")
    event = json.loads(Path(os.environ["GITHUB_EVENT_PATH"]).read_text(encoding="utf-8"))
    issue = event["issue"]
    number = int(issue["number"])
    if issue.get("pull_request"):
        return
    try:
        workshop_id, category_key, notes = parse_proposal(issue)
        current = github("GET", "/contents/custommap_cate.json?ref=main")
        original = base64.b64decode(current["content"]).decode("utf-8")
        catalog = json.loads(original)
        selected = next((c for c in catalog if c.get("button") == category_key), None)
        if selected is None:
            raise ValueError("The selected category is not available.")
        if workshop_id in map_ids(catalog):
            raise ValueError("This Workshop ID already exists in the catalog.")
        existing = find_open_pr(workshop_id)
        if existing:
            issue_comment(number, "A review pull request already exists: " + existing)
            return
        item = workshop_details(workshop_id)
        # Refresh both checks after network validation, immediately before branch creation.
        current = github("GET", "/contents/custommap_cate.json?ref=main")
        original = base64.b64decode(current["content"]).decode("utf-8")
        catalog = json.loads(original)
        if workshop_id in map_ids(catalog):
            raise ValueError("This Workshop ID already exists in the catalog.")
        existing = find_open_pr(workshop_id)
        if existing:
            issue_comment(number, "A review pull request already exists: " + existing)
            return
        title = re.sub(r"[\r\n\t]+", " ", str(item["title"])).strip()[:95]
        changed = updated_catalog(original, category_key, workshop_id)
        branch = f"community-maps/issue-{number}"
        branch_ref = quote(branch, safe="/")
        branch_obj = github("GET", f"/git/ref/heads/{branch_ref}", not_found_ok=True)
        if branch_obj is None:
            main_branch = github("GET", "/git/ref/heads/main")
            github("POST", "/git/refs", {
                "ref": "refs/heads/" + branch,
                "sha": main_branch["object"]["sha"],
            })
            github("PUT", "/contents/custommap_cate.json", {
                "message": f"Add Workshop map {workshop_id} from issue #{number}",
                "content": base64.b64encode(changed.encode("utf-8")).decode("ascii"),
                "sha": current["sha"],
                "branch": branch,
            })
        else:
            # Recover if repository Actions permissions blocked PR creation on
            # the first run and the issue was reopened after enabling permissions.
            existing_file = github("GET", "/contents/custommap_cate.json?ref=" +
                                   quote(branch, safe=""))
            branch_catalog = json.loads(
                base64.b64decode(existing_file["content"]).decode("utf-8"))
            branch_cat = next((c for c in branch_catalog
                               if c.get("button") == category_key), None)
            if branch_cat is None or workshop_id not in {
                str(x.get("id") if isinstance(x, dict) else x)
                for x in branch_cat["ugc"]
            }:
                raise RuntimeError("The existing issue branch needs manual review.")
        safe_notes = notes.replace("@", "&#64;").replace("<", "&lt;")[:400]
        pr_body = (
            "<!-- aae-map-pr:v1 -->\n"
            f"Workshop ID: {workshop_id}\n"
            f"Category: {category_key}\n"
            f"Steam: https://steamcommunity.com/sharedfiles/filedetails/?id={workshop_id}\n\n"
            "Steam public visibility and BO3 app ownership verified before creating this PR.\n\n"
            "Submission notes:\n" +
            "\n".join("> " + line for line in safe_notes.splitlines()) +
            f"\n\nCloses #{number}"
        )
        pull = github("POST", "/pulls", {
            "title": f"Add {title} ({workshop_id})",
            "head": branch, "base": "main", "body": pr_body,
            "draft": False, "maintainer_can_modify": True,
        })
        issue_comment(number, "Verified the public Steam map and opened a PR for review: " +
                      pull["html_url"])
        # GITHUB_TOKEN-generated PRs do not emit new PR Actions events. Explicit
        # workflow_dispatch refreshes the public pending PR catalog immediately.
        try:
            github("POST", "/actions/workflows/pages.yml/dispatches", {"ref": "main"})
        except Exception as exc:
            print("WARNING: Pages refresh dispatch failed:", exc, file=sys.stderr)
        print("PR created:", pull["html_url"])
    except ValueError as exc:
        issue_comment(number, "Map submission rejected: " + str(exc))
        print("Rejected:", exc)
    except Exception as exc:
        error = str(exc)
        if "Resource not accessible by integration" in error or (
                "/pulls" in error and "HTTP 403" in error):
            issue_comment(number,
                "PR creation is blocked by GitHub Actions settings. The repository owner "
                "must enable Settings > Actions > General > Workflow permissions > "
                "'Allow GitHub Actions to create and approve pull requests', then "
                "close/reopen this issue to retry.")
        else:
            issue_comment(number, "Automatic map PR creation failed: " + error[:450])
        raise


if __name__ == "__main__":
    main()
