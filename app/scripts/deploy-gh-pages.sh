#!/usr/bin/env bash
# Build the frontend app and deploy to the gh-pages branch.
#
# Usage (from repo root or app/):
#   bash app/scripts/deploy-gh-pages.sh
#
# Prerequisites:
#   - npm dependencies installed in both nozk_ts/ and app/
#   - Push access to the remote repository
#
# The script:
#   1. Builds the app with base path /NozKash/ (repo name)
#   2. Copies a 404.html for SPA client-side routing on GitHub Pages
#   3. Uses a git worktree at ../nozkash-gh-pages for the gh-pages branch
#   4. Syncs build output into the worktree and pushes
#
# After the first deploy, enable GitHub Pages in repo Settings:
#   Settings → Pages → Source: "Deploy from a branch" → Branch: gh-pages / (root)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$APP_DIR/.." && pwd)"
WORKTREE_DIR="$(cd "$REPO_ROOT/.." && pwd)/nozkash-gh-pages"

# Base path for GitHub Pages (/<repo-name>/ by default).
# Override with VITE_BASE_PATH env var, e.g. "/" for a custom domain.
if [ -n "${VITE_BASE_PATH:-}" ]; then
    BASE_PATH="$VITE_BASE_PATH"
else
    # Derive repo name from git remote (works for forks/renames)
    REPO_NAME="${REPO_NAME:-$(basename -s .git "$(git -C "$REPO_ROOT" remote get-url origin 2>/dev/null)" 2>/dev/null || echo "NozKash")}"
    BASE_PATH="/${REPO_NAME}/"
fi

echo "==> Installing dependencies"
cd "$REPO_ROOT/nozk_ts" && npm ci --silent
cd "$APP_DIR" && npm ci --silent

echo "==> Building app with base path: ${BASE_PATH}"
VITE_BASE_PATH="$BASE_PATH" npm run build

# SPA fallback: GitHub Pages serves 404.html for unknown paths,
# which redirects to index.html preserving the route.
cp "$APP_DIR/dist/index.html" "$APP_DIR/dist/404.html"

echo "==> Preparing gh-pages worktree at ${WORKTREE_DIR}"
cd "$REPO_ROOT"

# Ensure the gh-pages branch exists locally
if ! git show-ref --verify --quiet refs/heads/gh-pages 2>/dev/null; then
    # Try fetching from remote first
    if git fetch origin gh-pages:gh-pages 2>/dev/null; then
        echo "    Fetched gh-pages from remote"
    else
        echo "    Creating orphan gh-pages branch"
        git checkout --orphan gh-pages
        git rm -rf . > /dev/null 2>&1 || true
        git commit --allow-empty -m "Initialize gh-pages branch"
        git checkout -
    fi
fi

# Set up the worktree (remove stale one if it exists)
if [ -d "$WORKTREE_DIR" ]; then
    git worktree remove --force "$WORKTREE_DIR" 2>/dev/null || rm -rf "$WORKTREE_DIR"
fi
git worktree add "$WORKTREE_DIR" gh-pages

echo "==> Syncing build output"
# Clear old files, copy new build
cd "$WORKTREE_DIR"
find . -maxdepth 1 ! -name '.git' ! -name '.' -exec rm -rf {} +
cp -r "$APP_DIR/dist/." .

echo "==> Committing and pushing"
git add -A
if git diff --cached --quiet; then
    echo "    No changes to deploy."
else
    git commit -m "Deploy frontend to GitHub Pages

Built from $(cd "$REPO_ROOT" && git rev-parse --short HEAD) on $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    git push origin gh-pages
    echo
    REMOTE_URL="$(cd "$REPO_ROOT" && git remote get-url origin)"
    echo "==> Deployed!"
    echo "    Site: https://$(echo "$REMOTE_URL" | sed 's|.*github.com[:/]\(.*\)\.git|\1|' | tr '/' '.').github.io${BASE_PATH}"
fi

# Clean up worktree (leave the directory for next deploy)
cd "$REPO_ROOT"
echo "==> Done. Worktree kept at ${WORKTREE_DIR}"
