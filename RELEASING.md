# Releasing

1. Update package versions in `packages/*/package.json`.
2. Update `CHANGELOG.md`.
3. Run checks:

```
pnpm install
pnpm -r build
pnpm run lint
pnpm run typecheck
pnpm run test
```

4. Tag the release in git and push to GitHub.
5. GitHub Actions will automatically create a GitHub Release from the matching `CHANGELOG.md` version section.
