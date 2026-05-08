# Connect this project to GitHub

Your Git identity (commits) should match your GitHub account:

```bash
cd ~/nozkash

git config user.name "Simonethg"
git config user.email "simonethfernandez@gmail.com"
```

Use `--global` instead of repo-only config if you want the same name and email in all repos:

```bash
git config --global user.name "Simonethg"
git config --global user.email "simonethfernandez@gmail.com"
```

## 1. Initialize Git (if there is no valid repo yet)

In **Terminal.app** or **iTerm** (does not have to be inside Cursor):

```bash
cd ~/nozkash

# If .git is broken or empty, remove it and start over:
rm -rf .git

git init
git add -A
git commit -m "chore: initial commit v1.0.0 (eNozkCash wallet)"
```

`node_modules` and `dist` are in `.gitignore` and are not pushed.

## 2. Sign in to GitHub (CLI)

If you have [GitHub CLI](https://cli.github.com/) (`gh`):

```bash
gh auth login
```

Choose **GitHub.com**, **HTTPS** or **SSH** as you prefer, and finish login in the browser.

## 3. Create the remote repository and push

### Option A — with `gh` (recommended)

From the project folder:

```bash
cd ~/nozkash
gh repo create nozkash --private --source=. --remote=origin --push
```

You can change `nozkash` to any repo name on GitHub. Remove `--private` for a **public** repo.

### Option B — manual on github.com

1. Open [github.com/new](https://github.com/new) and create a repo **without** README or `.gitignore` (empty repo).
2. In the terminal:

```bash
cd ~/nozkash
git remote add origin https://github.com/Simonethg/NOMBRE_DEL_REPO.git
git branch -M main
git push -u origin main
```

Replace `Simonethg` and `NOMBRE_DEL_REPO` with your username and repo name.

## 4. Verify email on GitHub

On GitHub: **Settings → Emails** — make sure `simonethfernandez@gmail.com` is added and verified so commits link to your profile.

---

If `git init` fails inside Cursor, use the **system terminal** in the project folder (e.g. `~/nozkash`).
