#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
Migration:
- Remove people[].isCommitterAuto from existing team.json (legacy field).
- Remove legacy manual field: isCommitterManual (no longer used).
- Recompute isCommitter from repo role fields: if any repos[].roleNameCn == "仓颉Committer" then true.

This matches the latest rule: "基于项目角色进行判断，只要有一个项目是仓颉Committer角色，那该成员就是committer".
"""

from __future__ import annotations

import argparse
import datetime as _dt
import json
from typing import Any, Dict, Tuple


def utc_now_iso() -> str:
    return _dt.datetime.now(tz=_dt.timezone.utc).isoformat().replace("+00:00", "Z")


def compute_final(is_manual: Any) -> bool:
    return bool(is_manual is True)


def _norm_role_name_cn(s: Any) -> str:
    if not isinstance(s, str):
        return ""
    return "".join(s.split())


def is_cangjie_committer_role(role_name_cn: Any, role_name: Any) -> bool:
    cn = _norm_role_name_cn(role_name_cn)
    if cn in ("仓颉Committer", "仓颉committer"):
        return True
    rn = role_name.lower().strip() if isinstance(role_name, str) else ""
    if not rn:
        return False
    return ("committer" in rn) or rn.endswith(":committer") or rn == "committer"


def process(obj: Dict[str, Any]) -> Tuple[Dict[str, Any], Dict[str, int]]:
    stats = {"people_total": 0, "removed_isCommitterAuto": 0, "removed_isCommitterManual": 0, "recomputed": 0}
    people = obj.get("people")
    if not isinstance(people, list):
        return obj, stats

    for p in people:
        if not isinstance(p, dict):
            continue
        stats["people_total"] += 1
        if "isCommitterAuto" in p:
            p.pop("isCommitterAuto", None)
            stats["removed_isCommitterAuto"] += 1
        if "isCommitterManual" in p:
            p.pop("isCommitterManual", None)
            stats["removed_isCommitterManual"] += 1
        repos = p.get("repos")
        if not isinstance(repos, list):
            repos = []
        p["isCommitter"] = any(
            is_cangjie_committer_role(r.get("roleNameCn"), r.get("roleName"))
            for r in repos
            if isinstance(r, dict)
        )
        stats["recomputed"] += 1

    obj["updatedAt"] = utc_now_iso()
    return obj, stats


def main() -> int:
    ap = argparse.ArgumentParser(description="Remove legacy isCommitterAuto from team.json and keep manual committer.")
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

