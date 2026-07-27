# Contributing to Nous

## Branch strategy

- **`main`** is always release-ready. Every commit on `main` corresponds to
  what's tagged and published as a GitHub release (and picked up by the
  Obsidian community plugin store). Nothing lands here except by merging
  `dev` in.
- **`dev`** is the integration branch for day-to-day work. Feature branches
  and fixes branch off `dev` and merge back into `dev` via PR.
- Feature branches: `feature/<short-name>` or `fix/<short-name>`, branched
  from `dev`.

```
feature/x ─┐
fix/y      ├──> dev ──(release cut)──> main ──(tag)──> GitHub Release
feature/z ─┘
```

To cut a release: merge `dev` into `main`, then follow the release steps
below on `main`.

## Local development

```bash
npm install
npm run dev      # esbuild watch mode
npm run lint
npm test
npm run build     # typecheck + production bundle
```

All three (`lint`, `test`, `build`) run in CI (`.github/workflows/ci.yml`)
on every push and PR.

## Release process

1. On `main`, with a clean working tree: `npm version patch|minor|major`
   (bumps `package.json`, runs `version-bump.mjs` to sync `manifest.json`/
   `versions.json`, commits, and tags).
2. `git push origin main --follow-tags`.
3. Pushing the tag triggers `.github/workflows/release.yml`, which builds
   `main.js`, attaches build provenance attestation, and publishes a GitHub
   Release with `main.js`, `manifest.json`, and `styles.css` as assets - the
   files the Obsidian community plugin store expects.
