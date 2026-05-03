# Design Canvas

This folder is the docs/index for Edmund's Paper-based design exploration work. Paper files themselves live in [Paper](https://paper.design)'s cloud — they can't be checked in. What lives here:

- **One folder per Paper file** under `design-files/`
- **Each Paper file folder** has its own `README.md` (purpose, artboards, decisions, changelog), a `snapshots/` folder of dated PNG exports, and an `exports/` folder for any code (JSX/CSS/SVG) that graduates from the canvas to a real build.

This is intentionally separate from `architecture-rebuild-2026-04-17/` — that folder tracks the stack rebuild; this folder tracks brand and product design exploration (websites, social, decks, marketing artifacts).

## Paper files

| File | Purpose |
|---|---|
| [sanity-test](design-files/sanity-test/README.md) | Three-system comparison canvas (Sanity / EM / Claude) — tokens, components, mobile blog post examples. Edmund's working space for evaluating how Paper supports collaborative design across surfaces. |

## Conventions

- **Naming snapshots**: `YYYY-MM-DD-<artboard>-<short-pass-description>.png` (e.g. `2026-04-29-claude-mobile-blog-tokens-pass.png`).
- **Changelog entries**: dated, one short paragraph, in the per-file README. Capture *what* changed and *why* — visual judgment lives in the snapshot.
- **Don't try to mirror the Paper file structure here.** Paper is the source of truth for the design itself; this folder is the journal around it.
