# cangjie-repo-robot

本仓库用于 **收集 GitCode 仓库成员信息** 并生成/维护团队人员 `team.v1` JSON，同时提供一个可离线使用的静态页面用于展示与编辑。

> 安全提示：不要把 GitCode Access Token 写入仓库/文档/JSON。请使用运行时交互输入（本仓库工具默认如此）。如果曾经泄露过 Token，请在 GitCode 侧立即撤销并重新生成。

## 团队信息（占位）

- AgentDSL
- CJNative
- Codegen
- Framework
- IDE 插件
- Interop
- Lib
- Macro
- MutiPlatform
- Spec
- Test
- Tools
- 资料团队
- 南京工程构建团队
- VM
- 爱丁堡
- 公共
- 前端变换
- 可信使能
- 无团队人员

## 1) 采集仓库成员并生成 `team.json`

采集接口为：`GET https://api.gitcode.com/api/v5/repos/:owner/:repo/collaborators`

### 准备仓库列表

- 文本格式：[`tools/repos.example.txt`](./tools/repos.example.txt)（每行一个 `owner/repo` 或 `https://gitcode.com/owner/repo`）
- JSON 格式：[`tools/repos.example.json`](./tools/repos.example.json)

> 注意：示例文件里的仓库名是示例占位，请替换成你真实存在且 token 有权限访问的仓库。

### 运行采集脚本（会提示输入 token，不会回显）

```bash
python3 tools/collect_gitcode_members.py \
  --repos-file tools/repos.example.txt \
  --out team.json
```

如果仓库列表中可能包含无权限/已删除仓库，建议加上 `--continue-on-error`，让脚本跳过失败项继续采集其它仓库：

```bash
python3 tools/collect_gitcode_members.py \
  --repos-file tools/repos.example.txt \
  --continue-on-error \
  --out team.json
```

如果你已经在 `team.json` 里手工维护了分组/备注等字段，重新采集时建议使用合并模式以保留手工字段：

```bash
python3 tools/collect_gitcode_members.py \
  --repos-file tools/repos.example.txt \
  --merge-existing team.json \
  --out team.json
```

> 说明：由于隐私设置限制，`email` 可能获取不到（接口返回 `null`）。你可以在页面里手工补全。你也可以增加 `--email-lookup` 尝试通过 `GET /api/v5/users/{username}` 补全公开邮箱（仍然不保证有值）。

## 1.5) 刷新成员在项目中的角色（role_name_cn）

为避免触发 GitCode API **每分钟 50 次** 的限制，角色信息通过“获取仓库的所有成员”接口一次性获取（单仓库分页请求，远少于按人查询）。

接口参考（本地文档“获取仓库的所有成员”）：

`GET https://api.gitcode.com/api/v5/repos/:owner/:repo/collaborators`

脚本会优先读取接口返回中的 `role_name_cn`（以及 `role_name/permission/access_level/permissions` 若存在）并写回到 `people[].repos[]`：

```bash
python3 tools/refresh_member_roles.py --in team.json --continue-on-error
```

只刷新指定仓库（可选）：

```bash
python3 tools/refresh_member_roles.py --in team.json --repos Cangjie/cangjie_compiler Cangjie/cangjie_runtime --continue-on-error
```

## 2) 静态页面：加载 / 编辑 / 保存 JSON

页面目录：[`web/`](./web/)

### 启动本地静态服务（推荐）

```bash
cd web
python3 -m http.server 8000
```

然后在浏览器打开 `http://localhost:8000`。

### 页面功能

- **加载 JSON**：
  - “打开本地JSON（可回写）”：Chrome/Edge 下可获得文件句柄，支持直接保存回原文件
  - “选择文件（仅加载）”：仅加载内容，无法回写原文件（可用“保存到文件/下载JSON”）
  - 远程 URL：需要目标站点支持 CORS
- **展示与编辑**：
  - 团队管理（使用 `groups` 作为团队列表；团队名称建议与 README 的团队信息章节一致）
  - 团队下拉选项固定来自 README 的“团队信息”章节（以该章节的条目列表为准）
  - 设置团队（每人仅能选择 1 个团队；字段仍使用 `people[].groups[0]` 以兼容历史结构）
  - 团队 leader（即成员 leader；在团队侧栏中设置，自动同步到成员）
  - 成员信息编辑（姓名/邮箱/备注）
  - committer：自动判断（任一仓库项目角色为「仓颉Committer」则为 committer）
- **保存**：
  - 优先保存回原文件；否则弹出另存为；再否则下载 JSON

## 参考文件

- JSON Schema：[`team.schema.json`](./team.schema.json)
- 示例数据：[`team.example.json`](./team.example.json)