# Hackathon — push to GitHub and onboard the team

Your local repo is already on **`main`** with an initial commit. You still need to create the GitHub remote and **push** (this guide uses **SSH**).

## 1. Create the repository on GitHub

### Option A — from the web (simple)

1. Open **[github.com/new](https://github.com/new)**.
2. **Repository name:** e.g. **`aleph-hackathon-m2026`** (team repo on GitHub).
3. **Public** is common for hackathons (or private if the event requires it).
4. **Do not** check “Add a README” or .gitignore (this project already has them).
5. Create repository.

### Option B — with GitHub CLI

On your Mac (with `gh auth login` done):

```bash
gh config set git_protocol ssh
cd ~/nozkash
gh repo create aleph-hackathon-m2026 --public --source=. --remote=origin --push
```

Change `--public` to `--private` if needed. If the repo **already exists** on the web, only add the remote (step 2) and run `git push`.

## 2. Link `origin` and push (SSH)

Team repo: **`Simonethg/aleph-hackathon-m2026`**.

**HTTPS:**

```bash
cd ~/nozkash
git remote add origin https://github.com/Simonethg/aleph-hackathon-m2026.git
git push -u origin main
```

If `origin` already exists:

```bash
git remote set-url origin https://github.com/Simonethg/aleph-hackathon-m2026.git
git push -u origin main
```

**SSH (if you prefer):**

```bash
git remote set-url origin git@github.com:Simonethg/aleph-hackathon-m2026.git
git push -u origin main
```

## 3. Invite teammates

On GitHub: repo → **Settings** → **Collaborators** (or **Manage access**) → **Add people**.

Share the repo link:  
`https://github.com/Simonethg/aleph-hackathon-m2026`

## 4. First-time setup for teammates

```bash
git clone https://github.com/Simonethg/aleph-hackathon-m2026.git
cd aleph-hackathon-m2026
npm install
npm run dev
```

or via SSH:

```bash
git clone git@github.com:Simonethg/aleph-hackathon-m2026.git
cd aleph-hackathon-m2026
npm install
npm run dev
```

## 5. Minimal workflow to avoid conflicts

1. Before you start: `git pull origin main`.
2. Each person commits locally and runs `git push`.
3. If two people touched the same lines: the second runs `git pull` (or `git pull --rebase origin main`), resolves conflicts if any, then `git push` again.

For more structure, use task branches (`feature/name`) and **Pull Requests** on GitHub; for a short hackathon, **everything on `main`** with a clean `pull` before work is often enough.

## 6. Variables and secrets

If you later use API keys or RPC URLs, **do not commit them**. Use a local `.env` (and add `.env` to `.gitignore` if needed) or **GitHub Actions Secrets** if you automate deploy.

---

**Summary:** create an empty repo on GitHub → `git remote add origin git@github.com:USER/REPO.git` → `git push -u origin main` → invite collaborators → team clones and runs `npm install`.
