# Contributing

## Workflow Rules

- **Never push directly to main.** Always create a PR branch and merge.
- **Never delete tags or force-push.** Versions and releases are immutable.
- **All commits must be signed.** Configure GPG, SSH, or gitsign.
- **Always use merge commits** when merging PRs (no squash, no rebase).
- **Always run pre-commit before pushing.**
- **Never amend published commits.** Create new commits to fix issues.

## Branch Naming

- Feature: `feat/description`
- Fix: `fix/description`
- Chore: `chore/description`
- Release: `release/description`

## Commit Messages

Conventional Commits with component scope prefixes:

- `py: add derive_token_secrets function`
- `ts: fix hash-to-curve counter encoding`
- `sol: optimize ecPairing gas cost`
- `app: implement deposit flow UI`
- `docs: update architecture section`
- `test: add cross-language vector for blinding`

## Code Quality

- All `# noqa` / `// biome-ignore` comments must document why
- Prefer narrow exception types over broad `Exception` catches
- Review `git diff` before committing after bulk edits
- Run `uv run pre-commit run --all-files` before pushing

## PR Review Process

After creating a PR, the author must:

1. Request AI reviews (Copilot, Gemini Code Assist, CodeRabbit)
2. Triage every review comment, including hidden low-confidence ones
3. For each actionable comment: fix in PR, or create an issue and link it
4. Never dismiss review comments without owner confirmation
5. After addressing comments, request a new review before merging

## Modifying Crypto Code

1. Update `nozk_py/nozk_library.py` (source of truth)
2. Port changes to `nozk_ts/nozk-library.ts` (byte-for-byte equivalent)
3. Regenerate test vectors: `cd nozk_py && uv run generate_vectors.py`
4. Verify Python: `cd nozk_py && uv run pytest test_vectors.py -v`
5. Verify TypeScript: `cd nozk_ts && npx vitest run`
