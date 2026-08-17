# Nous — Design Redesign Handoff

Repo: AndyMDH/obsidian-nous. This spec REPLACES the old orange design (#EB6C36 accent, rounded-n-with-spark logo, gray-pill button grids). Delete old design code wherever it conflicts; this document wins.

## 1. Design language ("warm paper")

Quiet, editorial, Domus-inspired. Warm off-white surfaces, one deep moss accent, generous radius, small-caps labels, no emoji in UI, no gradients, no orange.

### Tokens — light
| Token | Value | Use |
|---|---|---|
| paper | `#F5F2ED` | modal/wizard background |
| surface | `#FFFFFF` | cards, inputs, option rows |
| surface-2 | `#F3F0EA` | properties panel, collapsed transcript bar |
| well | `#EDE9E1` | error-detail well, muted stamps |
| border | `#E7E2DA` | card/input borders |
| hairline | `#EBE6DE` / `#E1DCD3` | row dividers |
| text | `#1C1B19` | headings, primary text |
| body-serif | `#3A3733` | note body text (Georgia) |
| muted | `#8A857D` | secondary text |
| faint | `#A6A199` | timestamps, placeholders, ✕ |
| accent (Moss) | `#4C5138` | primary buttons, active dot, tag pills, toggles, logo badge, links |
| accent-soft | `#C7C9B4` | subtitle text on moss fills, link underlines |

### Tokens — dark
| Token | Value |
|---|---|
| bg | `#1E1D1B` |
| surface | `#262522` |
| border | `#35322D`, hairline `#2C2A26` |
| text | `#EDEAE4` |
| muted | `#8A857D`, faint `#6B6660` |
| accent fills | `#5E6647` (moss lifted for contrast) |
| accent icons/dots/link-hover | `#A9AF8C` |

### Type
- UI: **Hanken Grotesk** (bundle it; fall back `-apple-system, sans-serif`). Weights 400/500/600/700.
- Note body (reading view): Georgia / serif, 15px, line-height 1.65.
- Mono (paths, URLs, error codes, tag-page titles): SF Mono / Menlo.
- Small-caps section labels: 11px, 600, letter-spacing 0.14em, uppercase, faint color.

### Shape & spacing
- Modal radius 24; cards/option rows 14–16; inputs 12; wells 10; buttons/pills fully rounded (99px).
- Modal width ~360–400px, padding 24–28px.
- Modal shadow: `0 24px 60px rgba(30,28,24,0.16)` (dark: `rgba(0,0,0,0.4)`).

## 2. Logo — "Clip-n"

An n whose right leg bends back up like paperclip wire. Replace `assets/logo.svg` and every use of the old mark.

Bare wire (viewBox 0 0 96 96, stroke = text color, width 9–13 by size):
```svg
<path d="M28 78 V38 C28 25 37 16 48 16 C60 16 70 25 70 38 V62 A10 10 0 0 1 50 62 V44"
      stroke="currentColor" stroke-width="9" fill="none" stroke-linecap="round"/>
```
Badge (app icon / wizard hero, viewBox 0 0 112 112): rx-30 squircle filled accent (`#4C5138` light / `#5E6647` dark), wire in `#F5F2ED`, stroke-width 10:
```svg
<rect x="4" y="4" width="104" height="104" rx="30" fill="#4C5138"/>
<path d="M36 86 V46 C36 33 45 24 56 24 C68 24 78 33 78 46 V70 A10 10 0 0 1 58 70 V52"
      stroke="#F5F2ED" stroke-width="10" fill="none" stroke-linecap="round"/>
```
Usage: badge where an icon is expected (wizard hero 56px, settings header 26px); bare wire at ≤16px (ribbon, status bar — use `currentColor` so Obsidian themes it).

## 3. Onboarding wizard grammar

Every wizard screen follows this exact structure — no exceptions, screens not drawn here derive from it:

1. **Top row**: ‹ back chevron (muted, only when a previous step exists) + progress dots left; ✕ close right. Active dot = 16×5px moss pill; inactive = 5px faint dots.
2. **Hero** (tour/status screens): one 56px tile — white surface, border, 18px radius — containing a 26px 1.8-stroke outline icon in accent color. The final screen uses the logo badge instead.
3. **Title**: 21–22px, 600, centered on hero screens; left-aligned on form/list screens.
4. **Body**: ONE line, 14px muted, max ~240px wide. No paragraphs. Optional single underlined text link below.
5. **Bottom**: ONE full-width moss pill primary button (12px pad, 14px 600 text). Below it, ONE centered quiet Skip (13px faint). Nothing else. Never two side-by-side buttons, never button grids.

### Screen specs
- **Welcome**: ✕ only (no dots). Centered 56px badge, "Welcome to Nous", sub "Your vault, thinking with you. Pick a brain to start." Three provider rows: first (Claude subscription) pre-lit as a filled moss card with white text + "No extra billing · desktop only" in accent-soft; others white cards, border→moss on hover, each with title + one-line sub ("Free and private · 2-min setup" / "Anthropic, OpenAI, Gemini, etc."), trailing →. Centered quiet "Not now" below.
- **Connect a provider** (form): left-aligned title + "Changeable anytime in settings." Labels 13px 600 above white 12px-radius inputs; URLs in mono. Primary "Continue".
- **Error**: hero tile with outline alert-circle icon (accent, NOT red). Title "Couldn't connect", body "Nothing answered. Is Ollama running?" Raw error goes in a centered well (`#EDE9E1`, radius 10) in 12px mono muted — never raw in the body. Primary "Retry", quiet "Skip".
- **Tour slides** (voice/meetings/etc.): hero tile icon, title, one line. Voice copy: "Click, talk, click again. It becomes a note." (do NOT claim local transcription). Primary "Next".
- **What works now** (checklist): left title, numbered hairline rows — `01/02/03` in 12px faint tabular-nums + 15px 600 item — dividers `#E1DCD3`. Primary "Continue".
- **Done**: logo badge hero, "Nous is ready", body: Drop anything in `00-Inbox` (mono). It comes back tagged. Primary "Take the tour", quiet "Finish".

## 4. Settings page

Header: 26px logo badge + "Nous" 17px 600, version right in 12px mono faint.
Sections (PROVIDER / CAPTURE / VAULT) as small-caps labels; each setting a hairline row: name 14px 600 + one-line 12px muted description left; control right.
Controls: dropdowns as bordered white chips (13px + ▾); Test as a small outlined pill; toggles 38×22 pills — moss when on, border-gray with muted knob when off; folder values right-aligned 13px mono.
Footer: underlined quiet links "Rerun setup" · "Docs".
Status lines (e.g. `localhost:11434 · ok`) in 12px mono muted.

## 5. Note styling (styledNotes / CSS snippet + reading view)

Applies to the four note types. Replace the orange tag-pill / raw-properties look.

- **Header chip row** (replaces visible properties table): type badge — Meeting/Note = well-bg muted small-caps chip; Wiki = moss-filled chip; Tag = outlined chip — then date (tabular-nums faint) `· source · project`.
- **Title**: 24–26px 700, tight tracking. Tag pages title in mono.
- **Attendees**: white bordered pills, 12px 600, prefixed by muted "with". Same row, right side: **tags** as moss-filled white-text pills.
- **Sections**: Summary / Key points / Decisions / Action items / Open questions / Timeline / Sources as small-caps labels; body in Georgia 15px `#3A3733`; bullets as moss `·`; open questions use moss `?`.
- **Action items**: 14px squares radius 4 — empty bordered, done = moss fill + white check + strike-through faint text.
- **Transcript callout**: full-width `#F3F0EA` radius-12 bar, "Transcript" 13px 600 muted + "collapsed ▸" faint; keep Obsidian collapse behavior.
- **Related**: hairline-topped row, small-caps label + moss links underlined with accent-soft.
- **Wiki timeline**: hairline rows — `MM-DD` faint tabular + linked note title + one-line muted gloss.
- **Tag page**: mono title, serif one-line definition, "Notes with this tag" small-caps + italic faint "Backlinks panel fills this automatically."
- Dark mode: same structure with dark tokens (§1).

## 6. Delete / replace list

- `styles.css`: remove ALL `#EB6C36`/orange rules, gray-pill button grids, old modal styles → rewrite per §1–4.
- `assets/logo.svg`: replace with Clip-n badge (§2). Regenerate `assets/demo.svg`, `assets/pipeline.svg`, `assets/settings-nav.svg` accents to moss when practical (or defer, tracked as TODO).
- `src/onboarding.ts`: rewrite all modal DOM to the §3 grammar — remove Back/Next/Skip button grids, raw error strings in body, orange icons.
- `examples/nous-editorial-theme.css`: replace with the new note-styling snippet (§5) or delete if superseded.
- README badges/branding: orange `EB6C36` → `4C5138` when touching README.
- Copy changes: "Anthropic, OpenAI, Gemini, etc." (drop Z.ai from UI copy); voice copy per §3; all error screens per §3.

## 7. Reference

Full visual mockups live in the design canvas (Nous Redesign.dc.html): Turn 13 = final onboarding (light), Turn 14 = dark + settings, Turn 15 = note types, Turn 6 = logo lockups.
