# Development

## Guides

- [Contributing](contributing.md) -- workflow rules, code quality, PR process
- [CI/CD](ci-cd.md) -- continuous integration pipeline
- [Changelog](changelog.md) -- project changelog

## Quick Verification

Run the full project check:

```bash
cd nozk_py && uv run pre-commit run --all-files && \
  uv run pytest -v && \
  cd ../nozk_ts && npx vitest run && \
  cd ../sol && forge build && forge test && \
  cd ../app && npm run build && \
  cd ../nozk_py && bash nozk_flow.sh --to 0x89205A3A3b2A69De6Dbf7f01ED13B2108B2c43e7 --mock
```
