#!/usr/bin/env python3
"""Prepare review PRs for requests to move or remove an approved Workshop map."""
from __future__ import annotations

import base64
import json
import os
import re
import sys
from pathlib import Path
from urllib.parse import quote

from process_submission import REPOSITORY, github, issue_comment, find_open_pr, map_ids

MARKER = "<!-- aae-map-change:v1 -->"
PR_MARKER = "<!-- aae-map-change-pr:v1 -->"
KEY_PATTERN = r"AAEP_[A-Z0-9_]+"
ID_PATTERN = r"[0-9]{7,20}"


def parse_change(issue):
    body = str(issue.get("body") or "").replace("\r\n", "\n").replace("\r", "\n")
    pattern = (re.escape(MARKER) + "\n"
               + rf"Workshop ID: ({ID_PATTERN})\n"
               + r"Action: (move|delete)\n"
               + rf"Original Category: ({KEY_PATTERN})\n"
               + rf"Target Category: ({KEY_PATTERN}|none)\n"
               + r"Reason:\n([\s\S]{5,500})")
    match = re.fullmatch(pattern, body)
    if not match or issue.get("title") != f"[Map Change] {match.group(1)}":
        raise ValueError("Invalid map change request. Use the website map preview form.")
    workshop_id, action, original, target, reason = match.groups()
    reason = reason.strip()
    if len(reason) < 5 or len(reason) > 400:
        raise ValueError("Explain the proposed change in 5–400 characters.")
    if (action == "delete" and target != "none") or (action == "move" and target == "none"):
        raise ValueError("Invalid target for the selected action.")
    return workshop_id, action, original, target, reason


def find_map(catalog, workshop_id):
    found = []
    for category in catalog:
        for index, item in enumerate(category["ugc"]):
            existing = str(item.get("id") if isinstance(item, dict) else item)
            if existing == workshop_id:
                found.append((category, index, item))
    if len(found) != 1:
        raise ValueError("The map must exist exactly once in the approved catalog.")
    return found[0]


def updated_change_catalog(source, workshop_id, action, original_key, target_key):
    parsed = json.loads(source)
    if not isinstance(parsed, list) or not all(
            isinstance(c, dict) and isinstance(c.get("ugc"), list)
            for c in parsed):
        raise ValueError("Invalid approved catalog.")
    category, index, item = find_map(parsed, workshop_id)
    if category.get("button") != original_key:
        raise ValueError("The map changed category; refresh and submit again.")
    destination = None
    if action == "move":
        destination = next((c for c in parsed if c.get("button") == target_key), None)
        if destination is None or destination is category:
            raise ValueError("Choose another existing approved category.")
    elif action != "delete" or target_key != "none":
        raise ValueError("Invalid change action.")
    # Preserve object entries such as {"id":"...","lite_only":true} on moves.
    del category["ugc"][index]
    if destination is not None:
        destination["ugc"].append(item)
    # Patch only affected UGC arrays to minimize review diffs.
    matches = list(re.finditer(r'"ugc"\s*:\s*\[', source))
    if len(matches) != len(parsed):
        raise ValueError("Cannot identify category arrays safely.")
    before = json.loads(source)
    changed = [(i, c["ugc"]) for i, c in enumerate(parsed)
               if c["ugc"] != before[i]["ugc"]]
    replacements = []
    decoder = json.JSONDecoder()
    for pos, items in changed:
        start = matches[pos].end() - 1
        original_items, used = decoder.raw_decode(source[start:])
        if original_items != before[pos]["ugc"]:
            raise ValueError("Catalog array positions are inconsistent.")
        match_indent = re.search(r'(?m)^([ \t]*)"ugc"', source[:start])
        # Category keys use 8-space indentation; each item uses 12 spaces.
        before_line = source.rfind("\n", 0, matches[pos].start()) + 1
        closing_indent = source[before_line:matches[pos].start()]
        item_indent = closing_indent + "    "
        replacement = ("[\n" + ",\n".join(
            item_indent + json.dumps(item, ensure_ascii=False,
                                     separators=(",", ":")) for item in items
        ) + "\n" + closing_indent + "]") if items else "[]"
        replacements.append((start, start + used, replacement))
    result = source
    for start, end, replacement in sorted(replacements, reverse=True):
        result = result[:start] + replacement + result[end:]
    if json.loads(result) != parsed:
        raise RuntimeError("Change output verification failed.")
    if len(before) != len(parsed) or any(
            before[i]["button"] != parsed[i]["button"] for i in range(len(parsed))):
        raise RuntimeError("The change modified a category definition.")
    return result


def main():
    if os.getenv("GITHUB_REPOSITORY") != REPOSITORY:
        raise RuntimeError("This workflow must run in its own repository.")
    event = json.loads(Path(os.environ["GITHUB_EVENT_PATH"]).read_text(encoding="utf-8"))
    issue = event["issue"]
    number = int(issue["number"])
    if issue.get("pull_request"):
        return
    try:
        workshop_id, action, old_category, target, reason = parse_change(issue)
        existing = find_open_pr(workshop_id)
        if existing:
            issue_comment(number, "A pull request for this map already exists: " + existing)
            return
        latest = github("GET", "/contents/custommap_cate.json?ref=main")
        original = base64.b64decode(latest["content"]).decode("utf-8")
        changed = updated_change_catalog(original, workshop_id, action, old_category, target)
        # Check again before creating a branch; reject conflicting open requests.
        existing = find_open_pr(workshop_id)
        if existing:
            issue_comment(number, "A pull request for this map already exists: " + existing)
            return
        branch = f"community-changes/issue-{number}"
        branch_ref = quote(branch, safe="/")
        existing_ref = github("GET", f"/git/ref/heads/{branch_ref}", not_found_ok=True)
        if existing_ref is None:
            current_ref = github("GET", "/git/ref/heads/main")
            current_file = github("GET", "/contents/custommap_cate.json?ref=main")
            source_now = base64.b64decode(current_file["content"]).decode("utf-8")
            if source_now != original:
                original = source_now
                changed = updated_change_catalog(original, workshop_id, action, old_category, target)
            github("POST", "/git/refs", {
                "ref": "refs/heads/" + branch,
                "sha": current_ref["object"]["sha"],
            })
            github("PUT", "/contents/custommap_cate.json", {
                "message": f"{action.title()} map {workshop_id} (issue #{number})",
                "content": base64.b64encode(changed.encode("utf-8")).decode("ascii"),
                "sha": current_file["sha"], "branch": branch
            })
        else:
            # A retry may re-use the previously created branch.
            branch_file = github("GET", "/contents/custommap_cate.json?ref=" +
                                 quote(branch, safe=""))
            branch_catalog = json.loads(
                base64.b64decode(branch_file["content"]).decode("utf-8"))
            if action == "delete":
                valid = workshop_id not in map_ids(branch_catalog)
            else:
                found_cat, _, _ = find_map(branch_catalog, workshop_id)
                valid = found_cat.get("button") == target
            if not valid:
                raise RuntimeError("The existing change branch requires manual review.")
        safe_reason = reason.replace("@", "&#64;").replace("<", "&lt;")
        pr_body = (
            PR_MARKER + "\n"
            f"Workshop ID: {workshop_id}\n"
            f"Action: {action}\n"
            f"From Category: {old_category}\n"
            f"Target Category: {target}\n"
            f"Steam: https://steamcommunity.com/sharedfiles/filedetails/?id={workshop_id}\n\n"
            "This change is pending maintainer review; the published catalog is unchanged.\n\n"
            "Reason:\n" +
            "\n".join("> " + line for line in safe_reason.splitlines()) +
            f"\n\nCloses #{number}"
        )
        pull = github("POST", "/pulls", {
            "title": f"{'Remove' if action == 'delete' else 'Move'} map {workshop_id}",
            "head": branch, "base": "main", "body": pr_body,
            "draft": False, "maintainer_can_modify": True,
        })
        issue_comment(number, "Map change PR prepared for review: " + pull["html_url"])
        try:
            github("POST", "/actions/workflows/pages.yml/dispatches", {"ref": "main"})
        except Exception as exc:
            print("Pages refresh dispatch failed:", exc, file=sys.stderr)
        print("Change PR created:", pull["html_url"])
    except ValueError as exc:
        issue_comment(number, "Map change request rejected: " + str(exc))
        print("Rejected:", exc)
    except Exception as exc:
        issue_comment(number, "Automatic map change PR creation failed: " + str(exc)[:450])
        raise


if __name__ == "__main__":
    main()
