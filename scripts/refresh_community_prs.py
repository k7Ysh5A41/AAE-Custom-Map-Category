#!/usr/bin/env python3
"""Safely refresh bot-created catalog PRs after approved changes reach main.

Never merges or approves PRs. Only adjusts the catalog file on verified
single-file community PR branches, preserving their original review intent.
"""
from __future__ import annotations

import base64
import json
import os
import re
import sys
from urllib.parse import quote

from process_submission import REPOSITORY, github, parse_proposal, updated_catalog
from process_change_request import parse_change, updated_change_catalog

CATALOG = "custommap_cate.json"
NEW_BRANCH = re.compile(r"community-maps/issue-([1-9][0-9]*)\Z")
CHANGE_BRANCH = re.compile(r"community-changes/issue-([1-9][0-9]*)\Z")
API_PR_MARKER = "<!-- aae-map-pr:v1 -->\n"
API_CHANGE_MARKER = "<!-- aae-map-change-pr:v1 -->\n"
MAX_PRS = 100


def entry_id(item):
    return str(item["id"] if isinstance(item, dict) else item)


def entries_as_raw(source, start):
    """Read original JSON tokens without changing formatting on unaffected items."""
    decoder = json.JSONDecoder()
    values, length = decoder.raw_decode(source[start:])
    if not isinstance(values, list):
        raise ValueError("Expected a catalog array")
    pos = start + 1
    raw_items = []
    for item in values:
        while pos < len(source) and source[pos].isspace():
            pos += 1
        value, end = decoder.raw_decode(source, pos)
        if value != item:
            raise ValueError("Unexpected catalog token")
        raw_items.append(source[pos:end])
        pos = end
        while pos < len(source) and source[pos].isspace():
            pos += 1
        if pos < len(source) and source[pos] == ",":
            pos += 1
    if len(raw_items) != len(values):
        raise ValueError("Catalog array token mismatch")
    return values, raw_items, start + length


def preserve_catalog_format(source, desired):
    """Patch only changed UGC arrays, retaining the original raw entries."""
    before = json.loads(source)
    after = json.loads(desired)
    if len(before) != len(after):
        raise ValueError("Unexpected catalog category count")
    indexes = list(re.finditer(r'"ugc"\s*:\s*\[', source))
    if len(indexes) != len(before):
        raise ValueError("Catalog array count mismatch")
    edits = []
    for i, (original, proposed) in enumerate(zip(before, after)):
        if original.keys() != proposed.keys() or any(
            original[k] != proposed[k] for k in original if k != "ugc"
        ):
            raise ValueError("Unrelated category metadata changed")
        if original["ugc"] == proposed["ugc"]:
            continue
        start = indexes[i].end() - 1
        values, raw, end = entries_as_raw(source, start)
        originals = {entry_id(value): (value, token)
                     for value, token in zip(values, raw)}
        if len(originals) != len(values):
            raise ValueError("Duplicated Workshop IDs in original catalog")
        before_line = source.rfind("\n", 0, indexes[i].start()) + 1
        indent = source[before_line:indexes[i].start()]
        if indent.strip():
            raise ValueError("Invalid catalog indentation")
        item_indent = indent + "    "
        updated_tokens = []
        for entry in proposed["ugc"]:
            key = entry_id(entry)
            existing = originals.get(key)
            if existing and existing[0] == entry:
                updated_tokens.append(existing[1])
            else:
                updated_tokens.append(json.dumps(entry, ensure_ascii=False))
        rendered = ("[\n" + ",\n".join(item_indent + token
                    for token in updated_tokens) + "\n" + indent + "]"
                    if updated_tokens else "[]")
        edits.append((start, end, rendered))
    result = source
    for start, end, replacement in sorted(edits, reverse=True):
        result = result[:start] + replacement + result[end:]
    if json.loads(result) != after:
        raise ValueError("Catalog formatting rewrite changed map data")
    return result


def open_prs():
    result = []
    for page in range(1, 3):
        rows = github("GET", f"/pulls?state=open&per_page=100&page={page}")
        if not isinstance(rows, list):
            raise ValueError("GitHub PR response must be an array")
        result.extend(rows)
        if len(rows) < 100:
            break
    if len(result) > MAX_PRS:
        raise ValueError("Too many open PRs to refresh safely")
    return result


def proposal_for(pr, main_content):
    head = pr.get("head") or {}
    base = pr.get("base") or {}
    if (pr.get("state") != "open" or pr.get("draft") or
            (pr.get("user") or {}).get("login") != "github-actions[bot]" or
            (head.get("repo") or {}).get("full_name") != REPOSITORY or
            base.get("ref") != "main"):
        return None
    branch = str(head.get("ref") or "")
    new = NEW_BRANCH.fullmatch(branch)
    change = CHANGE_BRANCH.fullmatch(branch)
    if not new and not change:
        return None
    issue_number = int((new or change).group(1))
    body = str(pr.get("body") or "")
    if not body.startswith(API_PR_MARKER if new else API_CHANGE_MARKER):
        return None

    # Only change a bot PR that edits the expected catalog file, nothing else.
    pr_number = int(pr["number"])
    files = github("GET", f"/pulls/{pr_number}/files?per_page=100")
    if (len(files) != 1 or files[0].get("filename") != CATALOG or
            files[0].get("status") not in ("modified",)):
        return None
    issue = github("GET", f"/issues/{issue_number}")
    if issue.get("pull_request"):
        return None

    try:
        if new:
            workshop_id, category, notes, lite_only = parse_proposal(issue)
            if (f"Workshop ID: {workshop_id}\n" not in body or
                    f"Category: {category}\n" not in body or
                    f"Lite Only: {str(lite_only).lower()}\n" not in body):
                return None
            desired = updated_catalog(main_content, category, workshop_id, lite_only)
        else:
            workshop_id, action, original, target, reason, current_lite, lite_only = (
                parse_change(issue))
            if not all(field in body for field in (
                    f"Workshop ID: {workshop_id}\n",
                    f"Action: {action}\n",
                    f"From Category: {original}\n",
                    f"Target Category: {target}\n",
            )):
                return None
            if current_lite is not None and (
                f"Current Lite Only: {str(current_lite).lower()}\n" not in body):
                return None
            if lite_only is not None and (
                f"Lite Only: {str(lite_only).lower()}\n" not in body):
                return None
            desired = updated_change_catalog(
                main_content, workshop_id, action, original, target,
                current_lite, lite_only)
    except ValueError as exc:
        print(f"PR #{pr_number}: not refreshed; request is stale: {exc}")
        return None
    return branch, workshop_id, preserve_catalog_format(main_content, desired)


def main():
    if (os.environ.get("GITHUB_REPOSITORY") != REPOSITORY or
            os.environ.get("GITHUB_REF") != "refs/heads/main"):
        raise RuntimeError("Only authorized pushes to this repository's main are supported")
    base_ref = github("GET", "/git/ref/heads/main")
    base_sha = base_ref["object"]["sha"]
    base_commit = github("GET", f"/git/commits/{base_sha}")
    base_tree = base_commit["tree"]["sha"]
    main_file = github("GET", "/contents/" + CATALOG + "?ref=" + base_sha)
    main_content = base64.b64decode(main_file["content"]).decode("utf-8")

    refreshed = 0
    for pr in open_prs():
        candidate = proposal_for(pr, main_content)
        if candidate is None:
            continue
        branch, workshop_id, content = candidate
        current_head = pr["head"]["sha"]
        # Avoid rewriting PR branches that already incorporate this main commit.
        comparison = github("GET", f"/compare/{base_sha}...{current_head}")
        if comparison.get("behind_by") == 0:
            continue
        fresh_main = github("GET", "/git/ref/heads/main")
        if fresh_main["object"]["sha"] != base_sha:
            raise RuntimeError("Main changed while updating PRs; retry the workflow")
        ref_path = "/git/ref/heads/" + quote(branch, safe="/")
        latest_head = github("GET", ref_path)
        if latest_head["object"]["sha"] != current_head:
            print(f"PR #{pr['number']}: branch changed during refresh; skipping")
            continue
        blob = github("POST", "/git/blobs", {"content": content, "encoding": "utf-8"})
        tree = github("POST", "/git/trees", {
            "base_tree": base_tree,
            "tree": [{"path": CATALOG, "mode": "100644",
                      "type": "blob", "sha": blob["sha"]}],
        })
        commit = github("POST", "/git/commits", {
            "message": f"Refresh PR #{pr['number']} against approved catalog",
            "tree": tree["sha"],
            # Merge main into the existing PR history; never force-push.
            "parents": [current_head, base_sha],
        })
        github("PATCH", ref_path, {"sha": commit["sha"], "force": False})
        refreshed += 1
        print(f"PR #{pr['number']}: preserved map {workshop_id}; main merged into {branch}")
    print(f"Safely refreshed {refreshed} community PR branch(es).")


if __name__ == "__main__":
    main()
