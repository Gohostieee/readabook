---
name: readabook-branding-direction
description: ReadABook's visual brand direction — the "card-catalog mainframe" fusion of webv1 terminal styling with bookish warmth
metadata:
  type: project
---

ReadABook adopted a branding direction (2026-06-06) blending **webv1.com**'s terminal/dossier aesthetic with its own bookworm warmth. Concept: **"The Card-Catalog Mainframe"** — a vintage amber-phosphor library reference terminal.

**Token rule (3-token discipline, mirrors webv1's single-accent restraint):**
- **Green = identity** (`--primary`, `--worm`) — the bookworm soul, never replaced.
- **Amber phosphor = the glow** (`--glow`, hue ~80) — webv1's electric-blue rotated to warm amber. Dark mode `oklch(0.83 0.14 82)`.
- **Warm paper = substrate** — cream light mode kept; dark mode reworked into deep warm-CRT sepia with a Material-3 `--surface`/`-low`/`-high`/`-highest` ladder and faint amber hairline borders.

**Typography rule:** Serif = content a human wrote (Source Serif reading, Libre Baskerville titles, untouched/sacred). Space Grotesk (`--font-terminal`) = the system voice (chrome, HUD labels). Real Geist Mono (`.call-number`) for accession/page numerics.

**Signature utility classes in app/globals.css:** `.hud-label` (spaced 10px uppercase, the connective tissue), `.phosphor-glow` (webv1's title-glow recolored amber), `.worm-cursor` (blinking amber ▍ mascot), `.record-card` (hover phosphor bloom), `.call-number` (tabular mono).

**Voice/vocabulary:** card-catalog/dossier framing — volume.record, stacks index, accession log, reading log, signal.authenticate, reference terminal, call number. Reading prose itself stays pure serif; terminal styling is chrome + subtle page-number readouts only.

Applied across: AppHeader, home shelf/cards/empty state, book detail, reader (CoverPage, IndexPage, ReaderControls, PageView), cost dashboard, sign-in/up.
