# design-canvas/ — Working Notes

Project-specific operating context for Paper-based design exploration. Read this before designing anything in a Paper file referenced from this folder.

## What this folder is

Markdown journal + snapshots for Edmund's Paper canvases. Paper files themselves live in Paper's cloud and can't be checked in. See [`README.md`](README.md) for the index of files; each file gets its own folder under `design-files/<file-slug>/` with a per-file `README.md`, a `snapshots/` directory, and an `exports/` directory.

## Working rules

### When designing in a Paper canvas that has a design system

**Always read both the `Tokens` and `Components` artboards before designing.** Tokens give you color, type, and surface foundations. Components show the system's *posture* — pill-vs-sharp shapes, card containment (does a nav sit on a contained card or page-width with a border?), status indicators, button language. Posture is what makes a system recognizable; tokens alone aren't enough.

For the `sanity test` Paper file specifically, pre-digested system references already exist as markdown:

- `design-canvas/design-files/sanity-test/systems/sanity.md`
- `design-canvas/design-files/sanity-test/systems/em.md`
- `design-canvas/design-files/sanity-test/systems/claude-com.md` (named `claude-com` to avoid `CLAUDE.md` collision)

Each is a one-screen pre-design checklist. **Read the matching one first**, then screenshot the live Components artboard to verify it's still current — the markdown can drift from the canvas.

> **Why:** On 2026-04-29 I shipped a Sanity email signup with sharp-rectangle CTAs (rule: pills) and a page-width nav (rule: contained card) — the Components artboard had a worked example I didn't read. Same day I shipped an EM newsletter modal with an indigo Subscribe button when Components specifically documents a lime SUBSCRIBE button variant. Both were caught by Edmund. Two misses of the same lesson in one day. The `systems/*.md` files exist so the third miss doesn't happen.

> **How to apply:** First tool call when starting any design in `sanity test`: read the matching `systems/<slug>.md`. Second: screenshot the live `<System> · Components` artboard to spot any drift from the markdown. Then design.

### When adapting an existing skill into a canvas design system

When a Paper file in this folder represents a design system (Sanity / EM / Claude / etc.) and the user wants an artifact type a separate skill already covers (carousel, deck, blog post template), **fork the skill's *workflow* but rebuild its *visual treatment* from the canvas's own tokens.** The skill's house-style choices (fonts, colors, accents) are usually a cousin of the canvas system, not an expression of it. Carrying them over breaks the side-by-side comparison the canvas exists to enable.

> **Why:** On 2026-04-29 Edmund asked for "Sanity-themed carousel posts." A carousel-builder skill already exists at `dashboard/skills/carousel-builder/` using a dark + orange + Sixtyfour dot-matrix house style — visually adjacent to Sanity but not Sanity. Borrowing the skill's workflow (1080×1350 IG portrait, 4-panel content layout, cover with mixed-color headline, outline-first) saved a lot of structural thinking. Borrowing its colors and fonts would have produced an artifact that didn't actually express the Sanity system.

> **How to apply:** When asked to make `<system>-themed <artifact>` and a generic `<artifact>` skill exists: read the skill, identify which parts are *workflow/structure* (keep) vs *visual house style* (rebuild from canvas tokens). Cite the skill in the README log so future-you knows the lineage.

### When the user pastes screenshots as references

Confirm what role the screenshots play before designing. They might be inspiration ("we want this *vibe*"), an exact target ("match this"), or — as on 2026-04-29 — *examples* of a third-party site whose design system we're separately defining and shouldn't slavishly copy. Wrong assumption here wastes a whole pass.

## Snapshot conventions

- Filename: `YYYY-MM-DD-<artboard-slug>-<short-pass-description>.png`
- Default scale `2x`
- Add `-vN` suffix when re-snapping the same artboard later the same day after a correction
- Always log a one-paragraph entry in the per-file `README.md` changelog when you snapshot

## Per-file README structure

Every file under `design-files/<slug>/README.md` should have these sections in order:

1. **Header paragraph** — what this Paper file is, in one or two sentences
2. **What we're using this for** — bullet list of intent
3. **Artboard index** — table of `id | name | dimensions | purpose`. Update when artboards are added or renamed.
4. **Design decisions log** — dated entries (`### YYYY-MM-DD — <pass title>`), most recent at the bottom of the section. Include rationale, not just what changed. Reference the snapshot.
5. **Open threads** — what's outstanding; refresh on every pass.

## When in doubt

- Don't create a new Paper file for an exploration that fits an existing one — add a new artboard to the existing file instead.
- Don't write a new top-level folder under `design-canvas/`. Per-file folders go under `design-files/`.
- Save lessons that are specific to *how to work in design-canvas/* here. Save lessons that apply to all Edmund's projects to auto-memory instead.
