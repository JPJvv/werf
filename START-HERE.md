# Start building Werf with Claude Code

This folder already held the full Werf specification pack (36 docs + `.claude/rules` + `settings.json`).
This file is the missing on-ramp: how to open it in Claude Code and start Phase 0. Everything below
runs on **Windows**, from either PowerShell or the VS Code integrated terminal.

## 0. One-time prerequisites

You need Node 18+ (20 LTS recommended), pnpm, Git, and Claude Code.

```powershell
# In PowerShell
winget install OpenJS.NodeJS.LTS
winget install Git.Git
# restart the terminal so PATH updates, then:
npm install -g pnpm
npm install -g @anthropic-ai/claude-code
```

Verify:

```powershell
node --version ; pnpm --version ; git --version ; claude --version
```

## 1. Initialise the repo and push to GitHub

Repo: **https://github.com/JPJvv/werf**

Run this from Windows PowerShell (do the git setup here, not from inside Cowork — the
sandbox can't manage `.git` cleanly and may have left a partial one; the first line clears it):

```powershell
cd "C:\Users\pjmvu\Claude\Projects\Werf Build"
if (Test-Path .git) { Remove-Item -Recurse -Force .git }   # clear any partial repo

git init
git branch -M main

# Author identity — MUST be the email on your GitHub account, or your
# contribution graph stays empty. Verify it matches github.com/JPJvv.
git config user.name  "JP van Vuuren"
git config user.email "your-github-email@example.com"

git add .
git commit -m "chore: import Werf specification pack and Claude Code config"
git remote add origin https://github.com/JPJvv/werf.git
git push -u origin main
```

If the push asks for credentials, sign in with your GitHub account (or install the GitHub CLI:
`winget install GitHub.cli`, then `gh auth login`). After the first Claude Code session, confirm
your email authored the commits:

```powershell
git log --format="%an <%ae>"
```

### Committing periodically

Commit at the end of each checklist item and push at the end of each work session — the
`/loop` prompt already commits per item (Conventional messages, FR refs). A simple session-end habit:

```powershell
git add . ; git commit -m "feat(...): ..." ; git push
```

Set **branch protection** on `main` in the repo settings (require a PR, require CI green) once the
first push lands — it stops a 2 a.m. force-push from becoming the thing you explain in an interview.

## 2. Make the hooks executable (Git Bash / WSL only)

The Stop-gate and migration-guard hooks are shell scripts. On native Windows they run under Git Bash.
If you use WSL or Git Bash:

```bash
chmod +x .claude/hooks/*.sh
```

## 3. Start Claude Code

### Option A — PowerShell

```powershell
cd "C:\Users\pjmvu\Claude\Projects\Werf Build"
claude
```

### Option B — VS Code

1. `code "C:\Users\pjmvu\Claude\Projects\Werf Build"` (or File → Open Folder).
2. Install the **Claude Code** extension from the Extensions panel if you want the inline UI, or just
   open the integrated terminal (`` Ctrl+` ``) and run `claude`.
3. Recommended: also install ESLint and Prettier extensions — the repo's PostToolUse hook already runs
   both on save via Claude.

## 4. The first session prompt

Claude Code auto-loads `CLAUDE.md` and the path-scoped rules in `.claude/rules/`. Start with:

```
Read README.md, CLAUDE.md, and docs/04-delivery/phase-checklists.md § Phase 0.
Plan the Phase 0 scaffold (pnpm monorepo, packages, tooling, the verify gate).
Do not write code yet — show me the plan first.
```

Approve the plan, then let it build Phase 0. The Stop hook (`.claude/hooks/verify-gate.sh`) will not
let a turn end on a red build once `package.json` exists. After the first session:

```powershell
git log --format="%an <%ae>"   # confirm YOUR GitHub email authored the commits
```

## 5. Working after Phase 0

- Use `/loop` (defined in `.claude/loop.md`) to work a phase one checklist item at a time.
- Read `docs/04-delivery/claude-code-playbook.md` for the autonomy loops — and for which phases
  (offline sync, payroll) you should **not** run unattended.
- Before writing the payroll engine, re-verify current SA wage rates against the Government Gazette.
  The pack gives you the shape of the calculation, not today's number.

## What's in this folder

```
README.md                     the 90-second pitch and reading order for the pack
CLAUDE.md                     project memory — auto-loaded by Claude Code
START-HERE.md                 this file
LICENSE / NOTICE              AGPL-3.0, copyright yours
SECURITY.md / CONTRIBUTING.md repo policy
.env.example                  copy to .env (git-ignored) and fill in
.gitignore
.claude/
  settings.json               permissions + hooks (prettier/eslint on save, migration guard, verify gate)
  rules/{domain,frontend,db}.md   path-scoped guardrails
  agents/{compliance-checker,sync-auditor,reviewer}.md   adversarial review sub-agents
  hooks/{verify-gate,guard-migrations}.sh                the gate and the migration guard
  loop.md                     the default /loop prompt
.github/                      CI (verify + gitleaks), issue & PR templates
docs/                         the full specification pack (business → requirements → design →
                              architecture/ADRs → delivery → operations → users)
```
