#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
Refresh people[].realName from corporate email prefix.

Rule:
- If email ends with @huawei... or @h-partners...
- Take local-part (before @), remove all digits, then keep only letters [a-zA-Z] as "pinyin"
- If derived pinyin is non-empty, update realName only when:
  - realName is empty, OR
  - realName equals username (common placeholder from API)

Also ensures top-level "team" field exists (default: "").
"""

from __future__ import annotations

import argparse
import datetime as _dt
import json
import re
from typing import Any, Dict, Tuple


EMAIL_DOMAIN_RE = re.compile(r"@(huawei|h-partners)(\.[^@]+)?$", re.IGNORECASE)


def utc_now_iso() -> str:
    return _dt.datetime.now(tz=_dt.timezone.utc).isoformat().replace("+00:00", "Z")


def derive_pinyin_from_email(email: str) -> str:
    email = (email or "").strip()
    if not email or "@" not in email:
        return ""
    if not EMAIL_DOMAIN_RE.search(email):
        return ""
    local = email.split("@", 1)[0]
    local = re.sub(r"\d+", "", local)
    local = re.sub(r"[^a-zA-Z]", "", local)
    return local.lower()


def should_overwrite_realname(real_name: str, username: str) -> bool:
    rn = (real_name or "").strip()
    un = (username or "").strip()
    if not rn:
        return True
    if rn == un:
        return True
    return False


def process(obj: Dict[str, Any], default_team: str) -> Tuple[Dict[str, Any], Dict[str, int]]:
    stats = {
        "people_total": 0,
        "email_matched": 0,
        "realname_updated": 0,
        "team_added": 0,
    }

    if "team" not in obj:
        obj["team"] = default_team
        stats["team_added"] = 1

    people = obj.get("people")
    if not isinstance(people, list):
        return obj, stats

    for p in people:
        if not isinstance(p, dict):
            continue
        stats["people_total"] += 1

        email = p.get("email")
        username = p.get("username") or ""
        real_name = p.get("realName") or ""

        derived = derive_pinyin_from_email(email if isinstance(email, str) else "")
        if not derived:
            continue
        stats["email_matched"] += 1

        if should_overwrite_realname(real_name if isinstance(real_name, str) else "", str(username)):
            p["realName"] = derived
            stats["realname_updated"] += 1

    # Update timestamp to reflect post-processing
    if isinstance(obj.get("updatedAt"), str):
        obj["updatedAt"] = utc_now_iso()

    return obj, stats


def main() -> int:
    ap = argparse.ArgumentParser(description="Refresh realName from @huawei/@h-partners emails in team.v1 JSON.")
    ap.add_argument("--in", dest="in_path", required=True, help="Input team.json")
    ap.add_argument("--out", dest="out_path", default="", help="Output path (default: overwrite input)")
    ap.add_argument("--default-team", default="", help="Default value for top-level team field if missing")
    args = ap.parse_args()

    with open(args.in_path, "r", encoding="utf-8") as f:
        obj = json.load(f)
    if not isinstance(obj, dict):
        raise SystemExit("team.json 顶层必须是 object")

    obj2, stats = process(obj, args.default_team)
    out_path = args.out_path or args.in_path
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(obj2, f, ensure_ascii=False, indent=2)
        f.write("\n")

    print(json.dumps({"ok": True, "out": out_path, "stats": stats}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

