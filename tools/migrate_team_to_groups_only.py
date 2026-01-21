#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
Migration:
- Remove top-level "team" field (legacy).
- Remove people[].team field if present (legacy).
- Keep people[].groups as the only source of team membership (expects 0..1 element; if multiple, keeps first).

This aligns with: "所属小组其实就是所属团队... 只保留设置团队即可。小组leader即为团队leader".
"""

from __future__ import annotations

import argparse
import datetime as _dt
import json
from typing import Any, Dict, Tuple


def utc_now_iso() -> str:
    return _dt.datetime.now(tz=_dt.timezone.utc).isoformat().replace("+00:00", "Z")


def process(obj: Dict[str, Any]) -> Tuple[Dict[str, Any], Dict[str, int]]:
    stats = {
        "removed_top_team": 0,
        "people_total": 0,
        "removed_people_team": 0,
        "trimmed_groups_to_single": 0,
    }

    if "team" in obj:
        obj.pop("team", None)
        stats["removed_top_team"] = 1

    people = obj.get("people")
    if isinstance(people, list):
        for p in people:
            if not isinstance(p, dict):
                continue
            stats["people_total"] += 1
            if "team" in p:
                p.pop("team", None)
                stats["removed_people_team"] += 1
            groups = p.get("groups")
            if isinstance(groups, list) and len(groups) > 1:
                p["groups"] = [groups[0]]
                stats["trimmed_groups_to_single"] += 1

    obj["updatedAt"] = utc_now_iso()
    return obj, stats


def main() -> int:
    ap = argparse.ArgumentParser(description="Remove legacy team fields and keep groups as team membership.")
    ap.add_argument("--in", dest="in_path", required=True, help="Input team.json")
    ap.add_argument("--out", dest="out_path", default="", help="Output path (default: overwrite input)")
    args = ap.parse_args()

    with open(args.in_path, "r", encoding="utf-8") as f:
        obj = json.load(f)
    if not isinstance(obj, dict):
        raise SystemExit("team.json 顶层必须是 object")

    obj2, stats = process(obj)
    out_path = args.out_path or args.in_path
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(obj2, f, ensure_ascii=False, indent=2)
        f.write("\n")

    print(json.dumps({"ok": True, "out": out_path, "stats": stats}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

