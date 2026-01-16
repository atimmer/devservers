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

4. Publish in dependency order:

```
pnpm -C packages/shared publish --access public
pnpm -C packages/daemon publish --access public
pnpm -C packages/cli publish --access public
```

5. Tag the release in git and push.

## GitHub Actions (manual)

Run the `Publish to npm` workflow after setting `NPM_TOKEN` in repo secrets.
