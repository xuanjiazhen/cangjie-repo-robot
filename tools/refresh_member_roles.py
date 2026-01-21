#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
Refresh repo role info for members in an existing team.json.

Data source:
  GET https://api.gitcode.com/api/v5/repos/:owner/:repo/collaborators?access_token=...&page=...&per_page=...

Reason:
- GitCode API has a request limit (e.g. 50/min). Per-user permission endpoint is too expensive.
- Prefer reading role fields from collaborators list response (e.g. role_name_cn if present).

We read the response and write back into:
  people[].repos[].roleNameCn   <- role_name_cn
  people[].repos[].roleName     <- role_name
  people[].repos[].permission   <- permission
  people[].repos[].accessLevel  <- access_level
  people[].repos[].permissions  <- permissions

Manual fields are preserved (committer/leader/notes/groups, etc.).
"""

from __future__ import annotations

import argparse
import datetime as _dt
import getpass
import json
import sys
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional, Set, Tuple


API_BASE = "https://api.gitcode.com/api/v5"


def utc_now_iso() -> str:
    return _dt.datetime.now(tz=_dt.timezone.utc).isoformat().replace("+00:00", "Z")


def eprint(*args: Any) -> None:
    print(*args, file=sys.stderr)


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


def recompute_committers(team: Dict[str, Any]) -> int:
    people = team.get("people")
    if not isinstance(people, list):
        return 0
    changed = 0
    for p in people:
        if not isinstance(p, dict):
            continue
        # Remove legacy manual field if present
        if "isCommitterManual" in p:
            p.pop("isCommitterManual", None)
        repos = p.get("repos")
        if not isinstance(repos, list):
            repos = []
        v = any(
            is_cangjie_committer_role(r.get("roleNameCn"), r.get("roleName"))
            for r in repos
            if isinstance(r, dict)
        )
        old = p.get("isCommitter")
        if old is not v:
            p["isCommitter"] = bool(v)
            changed += 1
    return changed

def http_get_json(url: str, timeout_s: int = 30) -> Any:
    req = urllib.request.Request(
        url,
        headers={
            "Accept": "application/json",
            "User-Agent": "cangjie-repo-robot/refresh_member_roles.py",
        },
        method="GET",
    )
    with urllib.request.urlopen(req, timeout=timeout_s) as resp:
        raw = resp.read()
    return json.loads(raw.decode("utf-8"))


def build_url(path: str, query: Dict[str, Any]) -> str:
    qs = urllib.parse.urlencode({k: v for k, v in query.items() if v is not None})
    return f"{API_BASE}{path}?{qs}"


def fetch_collaborators(owner: str, repo: str, token: str, per_page: int = 100) -> List[Dict[str, Any]]:
    """
    GET /repos/:owner/:repo/collaborators (paged)
    """
    all_items: List[Dict[str, Any]] = []
    page = 1
    while True:
        url = build_url(
            f"/repos/{urllib.parse.quote(owner)}/{urllib.parse.quote(repo)}/collaborators",
            {"access_token": token, "page": page, "per_page": per_page},
        )
        try:
            data = http_get_json(url)
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", errors="replace") if hasattr(e, "read") else ""
            msg = body[:400]
            try:
                obj = json.loads(body) if body else {}
                if isinstance(obj, dict):
                    em = obj.get("error_message") or obj.get("message")
                    trace = obj.get("trace_id")
                    if em:
                        msg = str(em) + (f" trace_id={trace}" if trace else "")
            except Exception:
                pass
            raise RuntimeError(f"HTTP {e.code}: {msg}")
        except urllib.error.URLError as e:
            raise RuntimeError(f"URLError: {e}")

        if not isinstance(data, list):
            raise RuntimeError(f"Unexpected response (not list): {data!r}")
        all_items.extend([x for x in data if isinstance(x, dict)])
        if len(data) < per_page:
            break
        page += 1
        if page > 200:
            raise RuntimeError("Too many pages, abort")
    return all_items


def iter_repo_entries(
    team: Dict[str, Any],
    only_repos: Optional[Set[Tuple[str, str]]],
    include_confirmed: bool = False,
) -> List[Tuple[str, str, str, Dict[str, Any]]]:
    """
    Return list of (owner, repo, username, repo_entry_dict_ref) from team.json
    """
    out: List[Tuple[str, str, str, Dict[str, Any]]] = []
    people = team.get("people")
    if not isinstance(people, list):
        return out
    for p in people:
        if not isinstance(p, dict):
            continue
        # Skip confirmed people by default; they are considered finalized.
        if (not include_confirmed) and (p.get("isConfirmed") is True):
            continue
        username = p.get("username")
        if not isinstance(username, str) or not username.strip():
            continue
        username = username.strip()
        repos = p.get("repos")
        if not isinstance(repos, list):
            continue
        for r in repos:
            if not isinstance(r, dict):
                continue
            owner = r.get("owner")
            repo = r.get("repo")
            if not isinstance(owner, str) or not isinstance(repo, str):
                continue
            key = (owner, repo)
            if only_repos is not None and key not in only_repos:
                continue
            out.append((owner, repo, username, r))
    return out


def parse_repos_list(values: List[str]) -> Set[Tuple[str, str]]:
    out: Set[Tuple[str, str]] = set()
    for v in values:
        s = v.strip()
        if not s:
            continue
        if "/" not in s:
            raise ValueError(f"--repos 需要 owner/repo 形式：{v!r}")
        owner, repo = s.split("/", 1)
        out.add((owner.strip(), repo.strip()))
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description="Refresh member role_name_cn for people[].repos[] in team.json.")
    ap.add_argument("--in", dest="in_path", required=True, help="输入 team.json")
    ap.add_argument("--out", dest="out_path", default="", help="输出路径（默认覆盖输入）")
    ap.add_argument("--token", default="", help="可选：直接提供 token（不推荐，默认会交互输入）")
    ap.add_argument("--continue-on-error", action="store_true", help="遇到单个成员/仓库失败时继续")
    ap.add_argument("--repos", nargs="*", default=[], help="仅刷新指定仓库（owner/repo ...），不传则刷新 team.json 中出现的全部 repos")
    ap.add_argument("--limit", type=int, default=0, help="仅刷新前 N 个目标（调试用）")
    ap.add_argument("--include-confirmed", action="store_true", help="包含已确认（isConfirmed=true）的人员（默认会跳过）")
    args = ap.parse_args()

    token = args.token.strip()
    if not token:
        token = getpass.getpass("GitCode Access Token（不会回显）: ").strip()
    if not token:
        raise SystemExit("token 为空，退出。")

    with open(args.in_path, "r", encoding="utf-8") as f:
        team = json.load(f)
    if not isinstance(team, dict):
        raise SystemExit("team.json 顶层必须是 object")

    only_repos = parse_repos_list(args.repos) if args.repos else None
    entries = iter_repo_entries(team, only_repos, include_confirmed=bool(args.include_confirmed))

    # Group repo-entry refs by repo, and dedupe by username within repo
    by_repo: Dict[Tuple[str, str], Dict[str, List[Dict[str, Any]]]] = {}
    for owner, repo, username, repo_ref in entries:
        by_repo.setdefault((owner, repo), {}).setdefault(username, []).append(repo_ref)

    repo_keys = sorted(by_repo.keys())
    if args.limit and args.limit > 0:
        # limit in "targets" sense; keep first N repo keys
        repo_keys = repo_keys[: args.limit]

    stats = {"repos": len(repo_keys), "updated_entries": 0, "errors": 0}
    eprint(f"[start] repos={stats['repos']} repos_filter={'on' if only_repos else 'off'}")

    for i, (owner, repo) in enumerate(repo_keys, start=1):
        try:
            eprint(f"[progress] repo {i}/{stats['repos']} {owner}/{repo} ...")
            members = fetch_collaborators(owner, repo, token, per_page=100)
            role_map: Dict[str, Dict[str, Any]] = {}
            for m in members:
                u = m.get("username")
                if not isinstance(u, str) or not u.strip():
                    continue
                role_map[u.strip()] = m

            # Update each repo_entry for usernames present in this repo
            per_repo_updated = 0
            for username, refs in by_repo[(owner, repo)].items():
                m = role_map.get(username)
                if not m:
                    continue
                permission_str = m.get("permission") if isinstance(m.get("permission"), str) else ""
                role_name = m.get("role_name") if isinstance(m.get("role_name"), str) else ""
                role_name_cn = m.get("role_name_cn") if isinstance(m.get("role_name_cn"), str) else ""
                access_level = m.get("access_level") if isinstance(m.get("access_level"), int) else None
                perm_obj = m.get("permissions") if isinstance(m.get("permissions"), dict) else {}

                for repo_ref in refs:
                    repo_ref["permission"] = permission_str
                    repo_ref["roleName"] = role_name
                    repo_ref["roleNameCn"] = role_name_cn
                    repo_ref["accessLevel"] = access_level
                    repo_ref["permissions"] = perm_obj or repo_ref.get("permissions", {})
                    if "notes" in repo_ref and isinstance(repo_ref["notes"], str) and repo_ref["notes"].startswith("error:"):
                        repo_ref["notes"] = ""
                    per_repo_updated += 1

            stats["updated_entries"] += per_repo_updated
            eprint(f"[progress] repo {i}/{stats['repos']} {owner}/{repo} updated_entries={per_repo_updated}")
        except Exception as e:
            stats["errors"] += 1
            eprint(f"[error] repo {i}/{stats['repos']} {owner}/{repo}: {e}")
            if not args.continue_on_error:
                raise

    team["updatedAt"] = utc_now_iso()
    committer_changed = recompute_committers(team)

    out_path = args.out_path or args.in_path
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(team, f, ensure_ascii=False, indent=2)
        f.write("\n")

    eprint(
        f"[done] out={out_path} updated_entries={stats['updated_entries']} errors={stats['errors']} committer_recomputed={committer_changed}"
    )
    print(json.dumps({"ok": True, "out": out_path, "stats": {**stats, "committer_recomputed": committer_changed}}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

