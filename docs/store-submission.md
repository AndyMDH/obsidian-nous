# Community Plugins store submission checklist

Everything needed to submit Cortex to the official Obsidian plugin directory.
The submission itself is one PR against
[obsidianmd/obsidian-releases](https://github.com/obsidianmd/obsidian-releases).

## Pre-flight (state of this repo)

- [x] `manifest.json` at repo root with `id`, `name`, `version`, `minAppVersion`, `description`, `author`, `authorUrl`, `isDesktopOnly`
- [x] `versions.json` mapping plugin version → minimum app version
- [x] LICENSE (MIT)
- [x] README explains what the plugin does, setup, and privacy/network use
- [x] GitHub release whose **tag exactly matches** `manifest.json` version, with `main.js` + `manifest.json` attached as individual assets (not just the source zip)
- [ ] Verify latest release tag == current manifest version at submission time

## Guideline sweep (things reviewers commonly flag)

- [x] Network use disclosed in README (Privacy section: which providers, what data)
- [x] API keys stored locally, marked sensitive (password-type input)
- [x] No telemetry
- [x] `isDesktopOnly: false` is honest — API mode works on mobile; CLI mode
      degrades with a clear notice
- [x] No remote code execution beyond the user-installed `claude` binary,
      disclosed in README
- [ ] Plugin id/name uniqueness: check `community-plugins.json` for an existing
      "cortex" — if taken, pick e.g. id `cortex-brain`, name "Cortex Brain"
      (id must never change after acceptance; renaming later is painful)

## Submission steps

1. Cut the release for the current version (tag = manifest version, assets:
   `main.js`, `manifest.json`).
2. Fork `obsidianmd/obsidian-releases`, edit `community-plugins.json`, append:

   ```json
   {
     "id": "cortex",
     "name": "Cortex",
     "author": "Andy Ho",
     "description": "Turn dictated or pasted notes into a linked, tagged knowledge graph, right inside Obsidian - uses Claude Code (your subscription) or a direct API key from Anthropic, OpenAI, Gemini, or a local model, your choice.",
     "repo": "AndyMDH/obsidian-cortex"
   }
   ```

   (`description` must match `manifest.json` exactly.)
3. Open the PR using their template; check every box honestly.
4. An automated bot reviews first (common bot flags: missing release assets,
   description mismatch, `var` usage, innerHTML). Fix, push to the same PR.
5. Human review follows — typically days to a few weeks. Respond in-PR.

## After acceptance

- Releases are picked up automatically — publishing a new GitHub release with
  a bumped `manifest.json`/`versions.json` is the entire update flow.
- Users on BRAT can switch to the store listing; BRAT installs keep working.
