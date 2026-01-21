#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
Collect GitCode repository members (collaborators) and export as team.v1 JSON.

Primary endpoint:
  GET https://api.gitcode.com/api/v5/repos/:owner/:repo/collaborators?access_token=TOKEN&page=1&per_page=100

Notes:
- `email` is often null due to privacy settings; this script keeps it empty by default.
- Optional: `--email-lookup` will try `GET /api/v5/users/{username}` to fill missing emails (only public emails).
- 项目角色信息：优先从 `GET /repos/:owner/:repo/collaborators` 返回值中的 `role_name_cn/role_name/permission/access_level` 写入（如接口未返回则留空）。
- Manual fields can be preserved via `--merge-existing path/to/team.json`.
"""

from __future__ import annotations

import argparse
import datetime as _dt
import getpass
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, Iterable, List, Optional, Tuple


API_BASE = "https://api.gitcode.com/api/v5"


def utc_now_iso() -> str:
    return _dt.datetime.now(tz=_dt.timezone.utc).isoformat().replace("+00:00", "Z")


def eprint(*args: Any) -> None:
    print(*args, file=sys.stderr)


def parse_repo_ref(raw: str) -> Tuple[str, str]:
    s = raw.strip()
    if not s:
        raise ValueError("empty repo ref")

    # Common forms:
    # - owner/repo
    # - https://gitcode.com/owner/repo
    # - https://gitcode.com/owner/repo/
    # - https://gitcode.com/owner/repo/pull/123 (we only take first 2 segments)
    m = re.search(r"gitcode\.com/([^/\s]+)/([^/\s#?]+)", s)
    if m:
        return m.group(1), m.group(2)

    # API URL form:
    m = re.search(r"/repos/([^/\s]+)/([^/\s#?]+)", s)
    if m:
        return m.group(1), m.group(2)

    if "/" in s and not s.startswith("http"):
        parts = [p for p in s.split("/") if p]
        if len(parts) >= 2:
            return parts[0], parts[1]

    raise ValueError(f"无法解析仓库标识: {raw!r}（期望 owner/repo 或 https://gitcode.com/owner/repo）")


def load_repos_from_txt(path: str) -> List[Tuple[str, str]]:
    repos: List[Tuple[str, str]] = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            owner, repo = parse_repo_ref(line)
            repos.append((owner, repo))
    return repos


def load_repos_from_json(path: str) -> List[Tuple[str, str]]:
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)

    repos: List[Tuple[str, str]] = []
    if isinstance(data, list):
        for item in data:
            if isinstance(item, str):
                owner, repo = parse_repo_ref(item)
                repos.append((owner, repo))
            elif isinstance(item, dict):
                if "owner" in item and "repo" in item:
                    repos.append((str(item["owner"]), str(item["repo"])))
                elif "url" in item:
                    owner, repo = parse_repo_ref(str(item["url"]))
                    repos.append((owner, repo))
                else:
                    raise ValueError(f"repos.json item 不支持: {item!r}")
            else:
                raise ValueError(f"repos.json item 不支持: {item!r}")
    else:
        raise ValueError("repos.json 顶层应为数组（list）")

    return repos


def unique_repos(repos: Iterable[Tuple[str, str]]) -> List[Tuple[str, str]]:
    seen = set()
    out: List[Tuple[str, str]] = []
    for owner, repo in repos:
        key = (owner, repo)
        if key in seen:
            continue
        seen.add(key)
        out.append(key)
    return out


def http_get_json(url: str, timeout_s: int = 30) -> Any:
    req = urllib.request.Request(
        url,
        headers={
            "Accept": "application/json",
            "User-Agent": "cangjie-repo-robot/collect_gitcode_members.py",
        },
        method="GET",
    )
    with urllib.request.urlopen(req, timeout=timeout_s) as resp:
        raw = resp.read()
    try:
        return json.loads(raw.decode("utf-8"))
    except Exception:
        # Try to surface server responses on decode failures
        raise ValueError(f"无法解析JSON响应: {raw[:200]!r}")


def build_url(path: str, query: Dict[str, Any]) -> str:
    qs = urllib.parse.urlencode({k: v for k, v in query.items() if v is not None})
    return f"{API_BASE}{path}?{qs}"


def pick_real_name(member: Dict[str, Any]) -> str:
    for key in ("name_cn", "name", "nick_name"):
        v = member.get(key)
        if isinstance(v, str) and v.strip():
            return v.strip()
    username = member.get("username")
    if isinstance(username, str) and username.strip():
        return username.strip()
    return ""


def to_str_id(v: Any) -> str:
    if v is None:
        return ""
    return str(v)


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


def fetch_collaborators(owner: str, repo: str, token: str, per_page: int = 100) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    all_items: List[Dict[str, Any]] = []
    page = 1
    pages_fetched = 0
    while True:
        url = build_url(
            f"/repos/{urllib.parse.quote(owner)}/{urllib.parse.quote(repo)}/collaborators",
            {"access_token": token, "page": page, "per_page": per_page},
        )
        try:
            data = http_get_json(url)
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", errors="replace") if hasattr(e, "read") else ""
            # GitCode sometimes returns HTTP 400 with a JSON body describing real error code/message.
            msg = body[:400]
            try:
                obj = json.loads(body) if body else {}
                if isinstance(obj, dict):
                    ec = obj.get("error_code")
                    em = obj.get("error_message") or obj.get("message")
                    trace = obj.get("trace_id")
                    if em:
                        msg = f"{em}" + (f" (error_code={ec})" if ec is not None else "") + (f" trace_id={trace}" if trace else "")
            except Exception:
                pass
            raise RuntimeError(
                f"请求失败: {owner}/{repo} page={page} HTTP {e.code}: {msg}\n"
                f"建议：确认仓库地址正确、token 有权限访问该仓库（私有仓库需要相应权限）。"
            )
        except urllib.error.URLError as e:
            raise RuntimeError(f"网络错误: {owner}/{repo} page={page}: {e}")

        if not isinstance(data, list):
            raise RuntimeError(f"接口返回非数组: {owner}/{repo} page={page}: {data!r}")

        pages_fetched += 1
        all_items.extend([x for x in data if isinstance(x, dict)])

        if len(data) < per_page:
            break
        page += 1

        # Safety guard
        if pages_fetched > 200:
            raise RuntimeError(f"分页过多，可能陷入死循环: {owner}/{repo}")

    meta = {
        "pageSize": per_page,
        "pagesFetched": pages_fetched,
        "memberCount": len(all_items),
    }
    return all_items, meta


def try_lookup_email(username: str, token: str) -> Optional[str]:
    url = build_url(f"/users/{urllib.parse.quote(username)}", {"access_token": token})
    try:
        data = http_get_json(url)
    except Exception:
        return None
    if isinstance(data, dict):
        email = data.get("email")
        if isinstance(email, str) and email.strip():
            return email.strip()
    return None


def load_existing(path: str) -> Dict[str, Any]:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def index_people(existing: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    people = existing.get("people")
    if not isinstance(people, list):
        return {}
    out: Dict[str, Dict[str, Any]] = {}
    for p in people:
        if not isinstance(p, dict):
            continue
        username = p.get("username")
        if isinstance(username, str) and username.strip():
            out[username.strip()] = p
    return out


def merge_person(existing: Dict[str, Any], incoming: Dict[str, Any]) -> Dict[str, Any]:
    # Preserve manual-maintained fields if present in existing.
    merged = dict(existing)

    # Always refresh repo appearance + auto inference.
    merged["gitcodeId"] = incoming.get("gitcodeId", merged.get("gitcodeId", ""))

    # Keep realName/email if user already filled them; otherwise use incoming.
    if not (isinstance(merged.get("realName"), str) and merged["realName"].strip()):
        merged["realName"] = incoming.get("realName", "")
    if not (isinstance(merged.get("email"), str) and merged["email"].strip()):
        merged["email"] = incoming.get("email", "")

    merged.pop("isCommitterManual", None)
    merged.setdefault("isConfirmed", False)
    merged.setdefault("isLeader", False)
    merged.setdefault("notes", "")
    merged.setdefault("groups", [])

    # Merge repos by (owner, repo)
    merged_repos = merged.get("repos")
    if not isinstance(merged_repos, list):
        merged_repos = []
    seen = {(r.get("owner"), r.get("repo")) for r in merged_repos if isinstance(r, dict)}
    for r in incoming.get("repos", []):
        if not isinstance(r, dict):
            continue
        key = (r.get("owner"), r.get("repo"))
        if key not in seen:
            merged_repos.append(r)
            seen.add(key)
    merged["repos"] = merged_repos

    merged["isCommitter"] = any(
        is_cangjie_committer_role(r.get("roleNameCn"), r.get("roleName"))
        for r in merged_repos
        if isinstance(r, dict)
    )
    return merged


def main() -> int:
    parser = argparse.ArgumentParser(description="Collect GitCode repo collaborators into team.v1 JSON.")
    parser.add_argument("--repos-file", help="repos.txt 或 repos.json 路径")
    parser.add_argument("--repos", nargs="*", default=[], help="仓库列表：owner/repo 或 https://gitcode.com/owner/repo")
    parser.add_argument("--out", default="", help="输出文件路径（默认 stdout）")
    parser.add_argument("--merge-existing", default="", help="合并已有 team.json，保留手工字段（分组/备注/手动committer等）")
    parser.add_argument("--per-page", type=int, default=100, help="分页大小（默认 100）")
    parser.add_argument("--email-lookup", action="store_true", help="尝试通过 /users/{username} 补全缺失 email（通常仅公开邮箱）")
    parser.add_argument("--token", default="", help="可选：直接提供 token（不推荐，默认会交互输入）")
    parser.add_argument("--continue-on-error", action="store_true", help="遇到单个仓库失败时继续处理其它仓库")
    args = parser.parse_args()

    repos: List[Tuple[str, str]] = []
    if args.repos_file:
        if args.repos_file.lower().endswith(".json"):
            repos.extend(load_repos_from_json(args.repos_file))
        else:
            repos.extend(load_repos_from_txt(args.repos_file))
    repos.extend(parse_repo_ref(r) for r in args.repos)
    repos = unique_repos(repos)

    if not repos:
        eprint("未提供任何仓库。用法示例：")
        eprint("  python tools/collect_gitcode_members.py --repos owner/repo owner2/repo2 --out team.json")
        eprint("  python tools/collect_gitcode_members.py --repos-file tools/repos.example.txt --out team.json")
        return 2

    token = args.token.strip()
    if not token:
        token = getpass.getpass("GitCode Access Token（不会回显）: ").strip()
    if not token:
        eprint("token 为空，退出。")
        return 2

    existing: Dict[str, Any] = {}
    existing_people: Dict[str, Dict[str, Any]] = {}
    existing_groups: List[Dict[str, Any]] = []
    if args.merge_existing:
        existing = load_existing(args.merge_existing)
        existing_people = index_people(existing)
        if isinstance(existing.get("groups"), list):
            existing_groups = existing["groups"]

    people_by_username: Dict[str, Dict[str, Any]] = {}
    sources: List[Dict[str, Any]] = []

    for owner, repo in repos:
        eprint(f"[collect] {owner}/{repo} ...")
        try:
            members, meta = fetch_collaborators(owner, repo, token, per_page=args.per_page)
            sources.append(
                {
                    "owner": owner,
                    "repo": repo,
                    "fetchedAt": utc_now_iso(),
                    **meta,
                }
            )
        except RuntimeError as e:
            sources.append(
                {
                    "owner": owner,
                    "repo": repo,
                    "fetchedAt": utc_now_iso(),
                    "pageSize": args.per_page,
                    "pagesFetched": 0,
                    "memberCount": 0,
                    "notes": f"error: {str(e).splitlines()[0]}",
                }
            )
            if args.continue_on_error:
                eprint(f"[warn] {e}")
                continue
            raise

        for m in members:
            username = m.get("username")
            if not isinstance(username, str) or not username.strip():
                continue
            username = username.strip()

            permissions = m.get("permissions") if isinstance(m.get("permissions"), dict) else None
            email = m.get("email") if isinstance(m.get("email"), str) else ""
            email = email.strip() if isinstance(email, str) else ""

            if args.email_lookup and not email:
                looked = try_lookup_email(username, token)
                if looked:
                    email = looked

            # Role fields (best effort) from collaborators list response
            permission_str = m.get("permission") if isinstance(m.get("permission"), str) else ""
            role_name = m.get("role_name") if isinstance(m.get("role_name"), str) else ""
            role_name_cn = m.get("role_name_cn") if isinstance(m.get("role_name_cn"), str) else ""
            access_level = m.get("access_level") if isinstance(m.get("access_level"), int) else None
            perm_obj = permissions or {}
            is_committer = is_cangjie_committer_role(role_name_cn, role_name)

            incoming = {
                "username": username,
                "gitcodeId": to_str_id(m.get("id")),
                "realName": pick_real_name(m),
                "email": email or "",
                "isConfirmed": False,
                "isCommitter": bool(is_committer),
                "isLeader": False,
                "notes": "",
                "groups": [],
                "repos": [
                    {
                        "owner": owner,
                        "repo": repo,
                        "permission": permission_str,
                        "roleName": role_name,
                        "roleNameCn": role_name_cn,
                        "accessLevel": access_level,
                        "permissions": perm_obj,
                    }
                ],
            }

            # Merge within this run
            if username in people_by_username:
                people_by_username[username] = merge_person(people_by_username[username], incoming)
                continue

            # Merge with existing file (preserve manual fields)
            if username in existing_people:
                people_by_username[username] = merge_person(existing_people[username], incoming)
            else:
                people_by_username[username] = incoming

    out_obj: Dict[str, Any] = {
        "schemaVersion": "team.v1",
        "updatedAt": utc_now_iso(),
        "team": str(existing.get("team", "")) if isinstance(existing, dict) else "",
        "sources": sources,
        "groups": existing_groups if existing_groups else [],
        "people": sorted(people_by_username.values(), key=lambda p: (p.get("username") or "")),
    }

    text = json.dumps(out_obj, ensure_ascii=False, indent=2)
    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            f.write(text)
            f.write("\n")
        eprint(f"[ok] wrote: {args.out} (people={len(out_obj['people'])}, sources={len(sources)})")
    else:
        print(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

