/* global window, document, fetch */

(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);

  const els = {
    btnOpenWithHandle: $("btnOpenWithHandle"),
    fileInput: $("fileInput"),
    remoteUrl: $("remoteUrl"),
    btnLoadRemote: $("btnLoadRemote"),
    btnSave: $("btnSave"),
    btnDownload: $("btnDownload"),
    btnAddGroup: $("btnAddGroup"),
    groupsList: $("groupsList"),
    teamLeaderSelect: $("teamLeaderSelect"),
    btnSetTeamLeader: $("btnSetTeamLeader"),
    btnClearTeamLeader: $("btnClearTeamLeader"),
    searchInput: $("searchInput"),
    repoFilterInput: $("repoFilterInput"),
    roleFilterInput: $("roleFilterInput"),
    filterUnconfirmed: $("filterUnconfirmed"),
    filterMissingEmail: $("filterMissingEmail"),
    filterMissingName: $("filterMissingName"),
    filterMissingRole: $("filterMissingRole"),
    filterCommitter: $("filterCommitter"),
    filterLeader: $("filterLeader"),
    statusFile: $("statusFile"),
    statusGroups: $("statusGroups"),
    statusPeople: $("statusPeople"),
    statusDirty: $("statusDirty"),
    statusHint: $("statusHint"),
    peopleTbody: $("peopleTbody"),
    toast: $("toast"),

    btnNameInferPreview: $("btnNameInferPreview"),
    btnNameInferApply: $("btnNameInferApply"),
    nameInferSummary: $("nameInferSummary"),
    nameInferModal: $("nameInferModal"),
    nameInferMeta: $("nameInferMeta"),
    nameInferList: $("nameInferList"),
    btnNameInferApplyInModal: $("btnNameInferApplyInModal"),
  };

  const state = {
    data: null,
    fileHandle: null,
    fileName: "",
    activeGroupId: "ALL",
    dirty: false,

    nameInferChanges: [],

    teamCatalog: [],
  };

  const DEFAULT_TEAMS = [
    "AgentDSL",
    "CJNative",
    "Codegen",
    "Framework",
    "IDE 插件",
    "Interop",
    "Lib",
    "Macro",
    "MutiPlatform",
    "Spec",
    "Test",
    "Tools",
    "资料团队",
    "南京工程构建团队",
    "VM",
    "爱丁堡",
    "公共",
    "前端变换",
    "可信使能",
    "无团队人员",
  ];

  function setTeamCatalog(list) {
    const arr = Array.isArray(list) ? list : [];
    const cleaned = arr.map((x) => String(x).trim()).filter(Boolean);
    state.teamCatalog = cleaned.length ? cleaned : DEFAULT_TEAMS.slice();
  }

  function getCatalogOrderedTeams() {
    const catalog = state.teamCatalog && state.teamCatalog.length ? state.teamCatalog : DEFAULT_TEAMS;
    const groups = ensureArray(state.data && state.data.groups);
    const byName = new Map(groups.map((g) => [String(g.name || ""), g]));
    const ordered = [];
    for (const name of catalog) {
      const g = byName.get(name);
      if (g) ordered.push(g);
    }
    return ordered;
  }

  function toast(msg) {
    els.toast.textContent = msg;
    els.toast.classList.add("isShow");
    window.clearTimeout(toast._t);
    toast._t = window.setTimeout(() => els.toast.classList.remove("isShow"), 2400);
  }

  function hasFsAccess() {
    return typeof window.showOpenFilePicker === "function" && typeof window.showSaveFilePicker === "function";
  }

  function isCangjieCommitterRole(roleNameCn, roleName) {
    const cn = String(roleNameCn || "").replace(/\s+/g, "");
    if (cn === "仓颉Committer" || cn === "仓颉committer") return true;
    // Best-effort fallback: some APIs may not provide roleNameCn consistently.
    const en = String(roleName || "").toLowerCase();
    if (!en) return false;
    return en === "committer" || en.endsWith(":committer") || en.includes("committer");
  }

  function computeIsCommitterFromRepos(repos) {
    for (const r of ensureArray(repos)) {
      const rr = ensureObject(r);
      if (isCangjieCommitterRole(rr.roleNameCn, rr.roleName)) return true;
    }
    return false;
  }

  function isMissingRealName(realName, username) {
    const rn = String(realName || "").trim();
    const un = String(username || "").trim();
    if (!rn) return true;
    if (un && rn === un) return true; // placeholder
    return false;
  }

  function repoKeysOfPerson(p) {
    return ensureArray(p.repos).map((r) => {
      const rr = ensureObject(r);
      const owner = ensureString(rr.owner, "");
      const repo = ensureString(rr.repo, "");
      return owner && repo ? `${owner}/${repo}` : "";
    }).filter(Boolean);
  }

  function roleLabelsOfRepos(repos) {
    const out = [];
    for (const r of ensureArray(repos)) {
      const rr = ensureObject(r);
      const roleCn = ensureString(rr.roleNameCn, "");
      const role = ensureString(rr.roleName, "");
      const perm = ensureString(rr.permission, "");
      const label = roleCn || role || perm;
      if (label) out.push(label);
    }
    return out;
  }

  function ensureString(v, fallback = "") {
    return typeof v === "string" ? v : fallback;
  }

  function ensureArray(v) {
    return Array.isArray(v) ? v : [];
  }

  function ensureObject(v) {
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  }

  function uuidGroup() {
    return `group-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function normalizeData(raw) {
    const obj = ensureObject(raw);
    const schemaVersion = ensureString(obj.schemaVersion, "team.v1");
    const updatedAt = ensureString(obj.updatedAt, new Date().toISOString());
    const sources = ensureArray(obj.sources);

    const groups = ensureArray(obj.groups).map((g) => {
      const gg = ensureObject(g);
      return {
        id: ensureString(gg.id, uuidGroup()),
        name: ensureString(gg.name, "未命名小组"),
        leaderUsernames: ensureArray(gg.leaderUsernames).filter((x) => typeof x === "string"),
        memberUsernames: ensureArray(gg.memberUsernames).filter((x) => typeof x === "string"),
        notes: ensureString(gg.notes, ""),
      };
    });

    const people = ensureArray(obj.people).map((p) => {
      const pp = ensureObject(p);
      const isLeader = !!pp.isLeader;

      const username = ensureString(pp.username, "").trim();
      const groupsRaw = ensureArray(pp.groups).filter((x) => typeof x === "string");
      const groupSingle = groupsRaw.length ? [groupsRaw[0]] : [];
      const repos = ensureArray(pp.repos).filter((x) => x && typeof x === "object");
      return {
        username,
        gitcodeId: ensureString(pp.gitcodeId ?? "", ""),
        realName: ensureString(pp.realName, ""),
        email: ensureString(pp.email, ""),
        isConfirmed: !!pp.isConfirmed,
        isCommitter: computeIsCommitterFromRepos(repos),
        isLeader,
        notes: ensureString(pp.notes, ""),
        groups: groupSingle,
        repos,
      };
    }).filter((p) => p.username);

    // ---- Normalize group membership between `people[].groups` and `groups[].memberUsernames` / `leaderUsernames`
    const groupMap = new Map(groups.map((g) => [g.id, g]));
    const peopleMap = new Map(people.map((p) => [p.username, p]));

    // If group.memberUsernames contains someone but that person has no groups info, backfill.
    for (const g of groups) {
      for (const u of g.memberUsernames) {
        const p = peopleMap.get(u);
        if (!p) continue;
        if (!p.groups.includes(g.id)) p.groups.push(g.id);
      }
    }

    // Rebuild memberUsernames from people[].groups to avoid drift.
    for (const g of groups) {
      g.memberUsernames = [];
    }
    for (const p of people) {
      for (const gid of p.groups) {
        const g = groupMap.get(gid);
        if (!g) continue;
        if (!g.memberUsernames.includes(p.username)) g.memberUsernames.push(p.username);
      }
    }

    // Leaders: ensure leader is member; mark person.isLeader if they lead any group.
    for (const p of people) p.isLeader = false;
    for (const g of groups) {
      g.leaderUsernames = ensureArray(g.leaderUsernames).filter((u) => typeof u === "string");
      for (const u of g.leaderUsernames) {
        if (!g.memberUsernames.includes(u)) g.memberUsernames.push(u);
        const p = peopleMap.get(u);
        if (p) p.isLeader = true;
      }
    }

    // Ensure committer final
    for (const p of people) {
      p.isCommitter = computeIsCommitterFromRepos(p.repos);
    }

    return { schemaVersion, updatedAt, sources, groups, people };
  }

  function setDirty(v) {
    state.dirty = !!v;
    updateStatus();
  }

  function updateStatus() {
    els.statusFile.textContent = state.fileName || "未加载";
    const gCount = state.data ? state.data.groups.length : 0;
    const pCount = state.data ? state.data.people.length : 0;
    els.statusGroups.textContent = String(gCount);
    els.statusPeople.textContent = String(pCount);
    els.statusDirty.textContent = state.dirty ? "是" : "否";

    if (!hasFsAccess()) {
      els.statusHint.textContent =
        "提示：当前浏览器不支持 File System Access API，将以“下载JSON”方式保存。建议 Chrome/Edge 并通过 http(s) 方式打开页面。";
    } else if (!state.fileHandle) {
      els.statusHint.textContent =
        "提示：使用“打开本地JSON（可回写）”可实现原文件回写；用“选择文件（仅加载）”加载时无法回写原文件。";
    } else {
      els.statusHint.textContent = "提示：已获得文件句柄，可直接“保存到文件”回写原文件。";
    }
  }

  function ensureTeamsInitializedFromList(teams) {
    if (!state.data) return;
    const list = Array.isArray(teams) && teams.length ? teams : DEFAULT_TEAMS;
    const unique = Array.from(new Set(list.map((x) => String(x).trim()).filter(Boolean)));
    // If groups empty -> initialize all.
    if (!state.data.groups || !state.data.groups.length) {
      state.data.groups = unique.map((name) => ({
        id: uuidGroup(),
        name,
        leaderUsernames: [],
        memberUsernames: [],
        notes: "",
      }));
    } else {
      // If groups exist -> ensure every catalog name exists (do not delete extras, but UI will only show catalog).
      const existingByName = new Map(state.data.groups.map((g) => [String(g.name || ""), g]));
      for (const name of unique) {
        if (existingByName.has(name)) continue;
        state.data.groups.push({
          id: uuidGroup(),
          name,
          leaderUsernames: [],
          memberUsernames: [],
          notes: "",
        });
      }
    }
    normalizeInPlace();
  }

  async function tryLoadTeamsFromReadme() {
    // When served from /web, README is at ../README.md
    try {
      const resp = await fetch("../README.md", { cache: "no-store" });
      if (!resp.ok) return;
      const text = await resp.text();
      const lines = text.split(/\r?\n/);
      const teams = [];
      let inSection = false;
      for (const line of lines) {
        if (/^##\s+团队信息/.test(line)) {
          inSection = true;
          continue;
        }
        if (inSection && /^##\s+/.test(line)) break;
        if (!inSection) continue;
        const m = line.match(/^\s*-\s+(.+?)\s*$/);
        if (m) teams.push(m[1]);
      }
      if (teams.length) {
        setTeamCatalog(teams);
        ensureTeamsInitializedFromList(teams);
        renderGroups();
        renderPeople();
      }
    } catch (e) {
      // ignore
    }
  }

  function renderGroups() {
    if (!state.data) {
      els.groupsList.innerHTML = "";
      return;
    }

    const groups = getCatalogOrderedTeams();

    const rows = [];
    rows.push(renderGroupItem({ id: "ALL", name: "全部成员", memberUsernames: state.data.people.map((p) => p.username), leaderUsernames: [] }, true));
    for (const g of groups) {
      rows.push(renderGroupItem(g, false));
    }
    els.groupsList.innerHTML = rows.join("");

    // Bind actions
    els.groupsList.querySelectorAll("[data-action='select']").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.activeGroupId = btn.getAttribute("data-id");
        renderGroups();
        renderPeople();
        updateTeamLeaderUI();
      });
    });
  }

  function renderGroupItem(g, isAll) {
    const isActive = state.activeGroupId === g.id;
    const meta = `${g.memberUsernames.length} 人` + (g.leaderUsernames && g.leaderUsernames.length ? ` · leader: ${g.leaderUsernames.join(",")}` : "");
    const actions = "";
    return `
      <div class="groupItem ${isActive ? "isActive" : ""}">
        <button class="btn btn--ghost" data-action="select" data-id="${escapeHtml(g.id)}" type="button" style="padding:0;border:0;background:transparent;text-align:left;flex:1;min-width:0;">
          <div class="groupItem__main">
            <div class="groupItem__name">${escapeHtml(g.name)}</div>
            <div class="groupItem__meta">${escapeHtml(meta)}</div>
          </div>
        </button>
        <div class="groupItem__actions">${actions}</div>
      </div>
    `;
  }

  function escapeHtml(s) {
    return String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  // ---------- Email -> pinyin name inference (UI helper) ----------
  function derivePinyinFromEmail(email) {
    const e = String(email || "").trim();
    if (!e || !e.includes("@")) return "";
    const lower = e.toLowerCase();
    if (!(lower.includes("@huawei") || lower.includes("@h-partners"))) return "";
    const local = e.split("@", 1)[0];
    const noDigits = local.replace(/[0-9]+/g, "");
    const lettersOnly = noDigits.replace(/[^a-zA-Z]/g, "");
    return lettersOnly.toLowerCase();
  }

  function shouldOverwriteRealName(realName, username) {
    const rn = String(realName || "").trim();
    const un = String(username || "").trim();
    if (!rn) return true;
    if (rn === un) return true;
    return false;
  }

  function computeNameInferChanges() {
    if (!state.data) return [];
    const out = [];
    for (const p of state.data.people) {
      if (p.isConfirmed) continue;
      const derived = derivePinyinFromEmail(p.email);
      if (!derived) continue;
      if (!shouldOverwriteRealName(p.realName, p.username)) continue;
      if (String(p.realName || "") === derived) continue;
      out.push({
        username: p.username,
        email: p.email || "",
        oldRealName: p.realName || "",
        newRealName: derived,
      });
    }
    return out;
  }

  function updateNameInferUI({ recompute } = { recompute: false }) {
    if (!state.data) {
      els.btnNameInferPreview.disabled = true;
      els.btnNameInferApply.disabled = true;
      els.nameInferSummary.textContent = "未加载数据";
      state.nameInferChanges = [];
      return;
    }

    if (recompute) {
      state.nameInferChanges = computeNameInferChanges();
    }

    const n = state.nameInferChanges.length;
    if (!n) {
      els.btnNameInferPreview.disabled = true;
      els.btnNameInferApply.disabled = true;
      els.nameInferSummary.textContent = "无可推断/可覆盖的成员";
      return;
    }

    els.btnNameInferPreview.disabled = false;
    els.btnNameInferApply.disabled = false;
    const sample = state.nameInferChanges.slice(0, 3).map((x) => `${x.username}→${x.newRealName}`).join("，");
    els.nameInferSummary.textContent = `可推断并建议覆盖：${n} 人` + (sample ? `（例如：${sample}${n > 3 ? "…" : ""}）` : "");
  }

  function openNameInferModal() {
    updateNameInferUI({ recompute: true });
    const changes = state.nameInferChanges || [];
    if (!changes.length) {
      toast("无可应用的变更");
      return;
    }

    els.nameInferMeta.textContent = `将更新 ${changes.length} 人的真实姓名（仅影响 realName 字段）。`;
    els.nameInferList.innerHTML = changes
      .slice(0, 200)
      .map((c) => {
        const oldV = c.oldRealName ? escapeHtml(c.oldRealName) : "<空>";
        return `
          <div class="changeRow">
            <div class="changeRow__top">
              <div class="changeRow__user">${escapeHtml(c.username)}</div>
              <div class="changeRow__email">${escapeHtml(c.email)}</div>
            </div>
            <div class="changeRow__diff">
              <span class="pill">旧：<code>${oldV}</code></span>
              <span class="pill">新：<code>${escapeHtml(c.newRealName)}</code></span>
            </div>
          </div>
        `;
      })
      .join("") + (changes.length > 200 ? `<div class="hint">仅预览前 200 条（总计 ${changes.length} 条）。</div>` : "");

    els.nameInferModal.classList.add("isOpen");
    els.nameInferModal.setAttribute("aria-hidden", "false");
  }

  function closeNameInferModal() {
    els.nameInferModal.classList.remove("isOpen");
    els.nameInferModal.setAttribute("aria-hidden", "true");
  }

  function applyNameInferChanges() {
    updateNameInferUI({ recompute: true });
    const changes = state.nameInferChanges || [];
    if (!changes.length) {
      toast("无可应用的变更");
      return;
    }
    const map = new Map(changes.map((c) => [c.username, c.newRealName]));
    let applied = 0;
    for (const p of state.data.people) {
      if (p.isConfirmed) continue;
      const v = map.get(p.username);
      if (!v) continue;
      if (!shouldOverwriteRealName(p.realName, p.username)) continue;
      p.realName = v;
      applied += 1;
    }
    if (applied) {
      setDirty(true);
      renderPeople();
      updateNameInferUI({ recompute: true });
      toast(`已应用：${applied} 人`);
    } else {
      toast("没有产生实际修改");
    }
  }

  function normalizeInPlace() {
    state.data = normalizeData(state.data);
  }

  function getActiveGroupIdOrNull() {
    return state.activeGroupId === "ALL" ? null : state.activeGroupId;
  }

  function filterPeople(people) {
    const q = els.searchInput.value.trim().toLowerCase();
    const repoQ = (els.repoFilterInput.value || "").trim().toLowerCase();
    const roleQ = (els.roleFilterInput.value || "").trim().toLowerCase();
    const onlyUnconfirmed = els.filterUnconfirmed.checked;
    const onlyMissingEmail = els.filterMissingEmail.checked;
    const onlyMissingName = els.filterMissingName.checked;
    const onlyMissingRole = els.filterMissingRole.checked;
    const onlyCommitter = els.filterCommitter.checked;
    const onlyLeader = els.filterLeader.checked;
    const gid = getActiveGroupIdOrNull();

    return people.filter((p) => {
      if (gid && !p.groups.includes(gid)) return false;
      if (onlyUnconfirmed && p.isConfirmed) return false;
      if (onlyMissingEmail && String(p.email || "").trim()) return false;
      if (onlyMissingName && !isMissingRealName(p.realName, p.username)) return false;
      if (onlyMissingRole && roleLabelsOfRepos(p.repos).length) return false;
      if (onlyCommitter && !p.isCommitter) return false;
      if (onlyLeader && !p.isLeader) return false;

      if (repoQ) {
        const keys = repoKeysOfPerson(p).join(",").toLowerCase();
        if (!keys.includes(repoQ)) return false;
      }
      if (roleQ) {
        const labels = roleLabelsOfRepos(p.repos).join(",").toLowerCase();
        if (!labels.includes(roleQ)) return false;
      }

      if (!q) return true;
      return (
        (p.username || "").toLowerCase().includes(q) ||
        (p.realName || "").toLowerCase().includes(q) ||
        (p.email || "").toLowerCase().includes(q)
      );
    });
  }

  function renderPeople() {
    if (!state.data) {
      els.peopleTbody.innerHTML = `<tr><td colspan="11" class="empty">请先加载 team.json（本地或远程）</td></tr>`;
      return;
    }

    normalizeInPlace();
    const people = filterPeople(state.data.people);
    if (!people.length) {
      els.peopleTbody.innerHTML = `<tr><td colspan="11" class="empty">无匹配成员</td></tr>`;
      return;
    }

    const groupOptions = getCatalogOrderedTeams()
      .map((g) => `<option value="${escapeHtml(g.id)}">${escapeHtml(g.name)}</option>`)
      .join("");

    const rows = people.map((p) => {
      const roleBadge = renderRoleBadge(p.repos || []);
      const committerBadge = renderBoolBadge(p.isCommitter);
      const leaderBadge = renderBoolBadge(p.isLeader);
      const confirmedBadge = p.isConfirmed ? `<span class="badge badge--ok">已确认</span>` : `<span class="badge badge--warn">未确认</span>`;
      const repoText = (p.repos || []).map((r) => `${r.owner}/${r.repo}`).join(", ");

      const teamId = (p.groups && p.groups.length) ? p.groups[0] : "";
      const allGroupsById = new Map(ensureArray(state.data.groups).map((g) => [String(g.id), g]));
      const unknownGroup = teamId && !getCatalogOrderedTeams().some((g) => g.id === teamId) ? allGroupsById.get(teamId) : null;
      const unknownOpt = unknownGroup
        ? `<option value="${escapeHtml(teamId)}" selected>未知团队：${escapeHtml(ensureString(unknownGroup.name, teamId))}</option>`
        : "";

      const teamSelect = `
        <select class="input" data-action="setTeam" data-username="${escapeHtml(p.username)}">
          <option value="">未设置</option>
          ${unknownOpt}
          ${getCatalogOrderedTeams()
            .map((g) => {
              const sel = g.id === teamId ? " selected" : "";
              return `<option value="${escapeHtml(g.id)}"${sel}>${escapeHtml(g.name)}</option>`;
            })
            .join("")}
        </select>
      `;

      return `
        <tr>
          <td><span class="badge badge--no">${escapeHtml(p.gitcodeId || "")}</span></td>
          <td><span class="badge">${escapeHtml(p.username)}</span></td>
          <td><input class="input" data-action="setRealName" data-username="${escapeHtml(p.username)}" value="${escapeHtml(p.realName || "")}" /></td>
          <td><input class="input" data-action="setEmail" data-username="${escapeHtml(p.username)}" value="${escapeHtml(p.email || "")}" /></td>
          <td>
            <label class="check" style="color:inherit;">
              <input data-action="toggleConfirmed" data-username="${escapeHtml(p.username)}" type="checkbox" ${p.isConfirmed ? "checked" : ""} />
              <span>${confirmedBadge}</span>
            </label>
          </td>
          <td>${roleBadge}</td>
          <td>${committerBadge}</td>
          <td>${leaderBadge}</td>
          <td>
            ${teamSelect}
          </td>
          <td><input class="input" data-action="setNotes" data-username="${escapeHtml(p.username)}" value="${escapeHtml(p.notes || "")}" /></td>
          <td style="color:rgba(255,255,255,0.78);">${escapeHtml(repoText)}</td>
        </tr>
      `;
    });

    els.peopleTbody.innerHTML = rows.join("");

    bindTableEvents();
    // Keep inference summary in sync with edits
    updateNameInferUI({ recompute: true });
  }

  function renderRoleBadge(repos) {
    const items = ensureArray(repos)
      .map((r) => {
        const rr = ensureObject(r);
        const owner = ensureString(rr.owner, "");
        const repo = ensureString(rr.repo, "");
        const roleCn = ensureString(rr.roleNameCn, "");
        const role = ensureString(rr.roleName, "");
        const perm = ensureString(rr.permission, "");
        const label = roleCn || role || perm;
        if (!owner || !repo || !label) return null;
        return `${owner}/${repo}:${label}`;
      })
      .filter(Boolean);

    if (!items.length) return `<span class="badge badge--warn">缺少</span>`;

    // Keep it compact: show up to 2 unique labels, with tooltip for full list
    const uniq = Array.from(new Set(items));
    const shown = uniq.slice(0, 2);
    const more = uniq.length > 2 ? ` +${uniq.length - 2}` : "";
    const title = escapeHtml(uniq.join("\n"));
    return `<span class="badge" title="${title}">${escapeHtml(shown.join("，"))}${more}</span>`;
  }

  function renderBoolBadge(v) {
    return v ? `<span class="badge badge--ok">是</span>` : `<span class="badge badge--no">否</span>`;
  }

  function getPerson(username) {
    return state.data.people.find((p) => p.username === username);
  }

  function bindTableEvents() {
    // team (single) per person, stored in people[].groups[0]
    els.peopleTbody.querySelectorAll("select[data-action='setTeam']").forEach((el) => {
      el.addEventListener("change", () => {
        const uu = el.getAttribute("data-username");
        const pp = getPerson(uu);
        if (!pp) return;
        const gid = el.value || "";
        pp.groups = gid ? [gid] : [];
        normalizeInPlace();
        setDirty(true);
        renderGroups();
        renderPeople();
        updateTeamLeaderUI();
      });
    });

    // text inputs
    els.peopleTbody.querySelectorAll("input[data-action='setRealName']").forEach((el) => {
      el.addEventListener("input", () => {
        const u = el.getAttribute("data-username");
        const p = getPerson(u);
        if (!p) return;
        p.realName = el.value;
        setDirty(true);
        updateNameInferUI({ recompute: true });
      });
    });
    els.peopleTbody.querySelectorAll("input[data-action='setEmail']").forEach((el) => {
      el.addEventListener("input", () => {
        const u = el.getAttribute("data-username");
        const p = getPerson(u);
        if (!p) return;
        p.email = el.value;
        setDirty(true);
        updateNameInferUI({ recompute: true });
      });
    });

    // confirmed flag
    els.peopleTbody.querySelectorAll("input[data-action='toggleConfirmed']").forEach((el) => {
      el.addEventListener("change", () => {
        const u = el.getAttribute("data-username");
        const p = getPerson(u);
        if (!p) return;
        p.isConfirmed = !!el.checked;
        setDirty(true);
        renderPeople();
      });
    });
    els.peopleTbody.querySelectorAll("input[data-action='setNotes']").forEach((el) => {
      el.addEventListener("input", () => {
        const u = el.getAttribute("data-username");
        const p = getPerson(u);
        if (!p) return;
        p.notes = el.value;
        setDirty(true);
      });
    });

    // committer is auto-derived from repos role, no manual toggles.

  }

  function updateTeamLeaderUI() {
    if (!state.data) {
      els.teamLeaderSelect.disabled = true;
      els.btnSetTeamLeader.disabled = true;
      els.btnClearTeamLeader.disabled = true;
      return;
    }
    const gid = getActiveGroupIdOrNull();
    if (!gid) {
      els.teamLeaderSelect.innerHTML = `<option value="">选择当前团队 leader…</option>`;
      els.teamLeaderSelect.disabled = true;
      els.btnSetTeamLeader.disabled = true;
      els.btnClearTeamLeader.disabled = true;
      return;
    }

    const g = state.data.groups.find((x) => x.id === gid);
    if (!g) return;
    const members = ensureArray(g.memberUsernames);
    const current = ensureArray(g.leaderUsernames)[0] || "";
    const options = [
      `<option value="">（无 leader）</option>`,
      ...members.map((u) => `<option value="${escapeHtml(u)}">${escapeHtml(u)}</option>`),
    ].join("");
    els.teamLeaderSelect.innerHTML = options;
    els.teamLeaderSelect.value = current;
    els.teamLeaderSelect.disabled = false;
    els.btnSetTeamLeader.disabled = false;
    els.btnClearTeamLeader.disabled = false;
  }

  function setCurrentTeamLeader(username) {
    const gid = getActiveGroupIdOrNull();
    if (!gid) return;
    const g = state.data.groups.find((x) => x.id === gid);
    if (!g) return;
    if (!username) return;
    g.leaderUsernames = [username];
    normalizeInPlace();
    setDirty(true);
    toast(`已设置 ${username} 为「${g.name}」leader`);
    renderGroups();
    renderPeople();
    updateTeamLeaderUI();
  }

  function clearCurrentTeamLeader() {
    const gid = getActiveGroupIdOrNull();
    if (!gid) return;
    const g = state.data.groups.find((x) => x.id === gid);
    if (!g) return;
    g.leaderUsernames = [];
    normalizeInPlace();
    setDirty(true);
    toast(`已清除「${g.name}」leader`);
    renderGroups();
    renderPeople();
    updateTeamLeaderUI();
  }

  function exportData() {
    if (!state.data) return null;
    normalizeInPlace();
    const out = {
      schemaVersion: "team.v1",
      updatedAt: new Date().toISOString(),
      sources: ensureArray(state.data.sources),
      groups: state.data.groups.map((g) => ({
        id: g.id,
        name: g.name,
        leaderUsernames: ensureArray(g.leaderUsernames),
        memberUsernames: ensureArray(g.memberUsernames),
        notes: ensureString(g.notes, ""),
      })),
      people: state.data.people.map((p) => ({
        username: p.username,
        gitcodeId: p.gitcodeId,
        realName: p.realName,
        email: p.email,
        isConfirmed: !!p.isConfirmed,
        isCommitter: computeIsCommitterFromRepos(p.repos),
        isLeader: !!p.isLeader,
        notes: p.notes,
        groups: ensureArray(p.groups),
        repos: ensureArray(p.repos),
      })),
    };
    return out;
  }

  async function openLocalWithHandle() {
    if (!hasFsAccess()) {
      toast("浏览器不支持文件回写；请用 Chrome/Edge 并通过 http(s) 打开页面");
      return;
    }
    const [handle] = await window.showOpenFilePicker({
      multiple: false,
      types: [{ description: "JSON", accept: { "application/json": [".json"] } }],
    });
    const file = await handle.getFile();
    const text = await file.text();
    loadFromText(text, file.name, handle);
  }

  async function loadFromFileInput(file) {
    const text = await file.text();
    loadFromText(text, file.name, null);
  }

  async function loadRemote(url) {
    const resp = await fetch(url, { cache: "no-store" });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const text = await resp.text();
    loadFromText(text, url, null);
  }

  function loadFromText(text, name, handle) {
    let obj;
    try {
      obj = JSON.parse(text);
    } catch (e) {
      toast("JSON 解析失败，请检查格式");
      throw e;
    }
    state.data = normalizeData(obj);
    setTeamCatalog(DEFAULT_TEAMS);
    ensureTeamsInitializedFromList(state.teamCatalog);
    state.fileHandle = handle || null;
    state.fileName = name || "";
    state.activeGroupId = "ALL";
    setDirty(false);
    renderGroups();
    renderPeople();
    updateStatus();
    updateNameInferUI({ recompute: true });
    updateTeamLeaderUI();
    toast("加载成功");
  }

  async function saveToFile() {
    const data = exportData();
    if (!data) {
      toast("未加载数据");
      return;
    }
    const text = JSON.stringify(data, null, 2) + "\n";

    // Prefer saving back to opened handle
    if (state.fileHandle && typeof state.fileHandle.createWritable === "function") {
      const writable = await state.fileHandle.createWritable();
      await writable.write(text);
      await writable.close();
      setDirty(false);
      toast("已保存到原文件");
      return;
    }

    if (typeof window.showSaveFilePicker === "function") {
      const handle = await window.showSaveFilePicker({
        suggestedName: guessSaveName(),
        types: [{ description: "JSON", accept: { "application/json": [".json"] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(text);
      await writable.close();
      state.fileHandle = handle;
      state.fileName = guessSaveName();
      setDirty(false);
      updateStatus();
      toast("已保存到文件");
      return;
    }

    downloadText(text, guessSaveName());
    setDirty(false);
    toast("已下载JSON（浏览器不支持直接保存）");
  }

  function guessSaveName() {
    if (state.fileName && state.fileName.endsWith(".json")) return state.fileName;
    return "team.json";
  }

  function downloadText(text, filename) {
    const blob = new Blob([text], { type: "application/json;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename || "team.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
  }

  function wireEvents() {
    els.btnOpenWithHandle.addEventListener("click", async () => {
      try {
        await openLocalWithHandle();
      } catch (e) {
        // user canceled, ignore
      }
    });

    els.fileInput.addEventListener("change", async () => {
      const file = els.fileInput.files && els.fileInput.files[0];
      if (!file) return;
      try {
        await loadFromFileInput(file);
      } catch (e) {
        // ignore
      } finally {
        els.fileInput.value = "";
      }
    });

    els.btnLoadRemote.addEventListener("click", async () => {
      const url = els.remoteUrl.value.trim();
      if (!url) return;
      try {
        await loadRemote(url);
      } catch (e) {
        toast(`远程加载失败：${e.message || e}`);
      }
    });

    els.btnSave.addEventListener("click", async () => {
      try {
        await saveToFile();
      } catch (e) {
        toast(`保存失败：${e.message || e}`);
      }
    });

    els.btnDownload.addEventListener("click", () => {
      const data = exportData();
      if (!data) {
        toast("未加载数据");
        return;
      }
      const text = JSON.stringify(data, null, 2) + "\n";
      downloadText(text, guessSaveName());
      toast("已下载JSON");
    });

    els.btnAddGroup.addEventListener("click", () => {
      toast("团队列表固定来自 README 的“团队信息”章节，不支持在页面新增/改名/删除。");
    });

    els.btnSetTeamLeader.addEventListener("click", () => {
      if (!state.data) return;
      const u = els.teamLeaderSelect.value || "";
      if (!u) {
        toast("请先选择一个成员作为 leader");
        return;
      }
      setCurrentTeamLeader(u);
    });
    els.btnClearTeamLeader.addEventListener("click", () => {
      if (!state.data) return;
      if (!window.confirm("确定清除当前团队 leader？")) return;
      clearCurrentTeamLeader();
    });

    els.btnNameInferPreview.addEventListener("click", () => {
      if (!state.data) return;
      openNameInferModal();
    });
    els.btnNameInferApply.addEventListener("click", () => {
      if (!state.data) return;
      if (!window.confirm("确定一键应用邮箱推断姓名？仅在姓名为空或等于 username 的情况下才会覆盖。")) return;
      applyNameInferChanges();
    });
    els.btnNameInferApplyInModal.addEventListener("click", () => {
      applyNameInferChanges();
      closeNameInferModal();
    });
    els.nameInferModal.querySelectorAll("[data-action='close']").forEach((el) => {
      el.addEventListener("click", () => closeNameInferModal());
    });
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && els.nameInferModal.classList.contains("isOpen")) {
        closeNameInferModal();
      }
    });

    els.searchInput.addEventListener("input", () => renderPeople());
    els.repoFilterInput.addEventListener("input", () => renderPeople());
    els.roleFilterInput.addEventListener("input", () => renderPeople());
    els.filterUnconfirmed.addEventListener("change", () => renderPeople());
    els.filterMissingEmail.addEventListener("change", () => renderPeople());
    els.filterMissingName.addEventListener("change", () => renderPeople());
    els.filterMissingRole.addEventListener("change", () => renderPeople());
    els.filterCommitter.addEventListener("change", () => renderPeople());
    els.filterLeader.addEventListener("change", () => renderPeople());

    window.addEventListener("beforeunload", (e) => {
      if (!state.dirty) return;
      e.preventDefault();
      e.returnValue = "";
    });
  }

  function init() {
    updateStatus();
    setTeamCatalog(DEFAULT_TEAMS);
    tryLoadTeamsFromReadme();
    updateNameInferUI({ recompute: false });
    wireEvents();
  }

  init();
})();

