# Contributing to Nous

Two docs go deeper on how Nous works, before you change anything:

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — the design behind Nous:
  layers, data flow, and choices.
- [`docs/TECHNICAL.md`](docs/TECHNICAL.md) — a map of the code.

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
npm run build:recorder
```

All three (`lint`, `test`, `build`) run in CI (`.github/workflows/ci.yml`)
on every push and PR.

## Release process

1. On `main`, with a clean working tree: `npm version patch|minor|major`
   (bumps `package.json`, runs `version-bump.mjs` to sync `manifest.json`/
   `versions.json`, commits, and tags).
2. `git push origin main --follow-tags`.
3. Pushing the tag triggers `.github/workflows/release.yml` on macOS. It
   builds `main.js`, builds/packages the universal `nous-recorder` helper,
   attaches build provenance attestation, and publishes a GitHub Release with
   `main.js`, `manifest.json`, `styles.css`,
   `nous-recorder-macos-universal`, and
   `nous-recorder-macos-universal.sha256`. The first three files are what the
   Obsidian community plugin store expects; the helper assets are what the
   in-plugin meeting recorder installer downloads.
