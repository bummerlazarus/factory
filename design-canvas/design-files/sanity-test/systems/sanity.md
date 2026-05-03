# Sanity Design System / v0.1

Pre-design reference for the **Sanity** system. Source of truth: `Sanity - Tokens` (`1-0`) and `Sanity - Components` (`1Q-0`) in the `sanity test` Paper file. Read this *before* designing any Sanity artifact.

## Identity in one sentence

Dark-first editorial ground, brand red as a single dramatic moment per surface, Plus Jakarta heavy display against IBM Plex Mono micro-labels. Reads like an opinionated indie studio with one strong point of view.

## Surfaces

| Token | Hex | Use |
|---|---|---|
| `background` | `#0B0B0B` | Page ground (always dark) |
| `card` | `#141414` | Contained cards, nav cards, form cards |
| `muted` | `#1A1A1A` | Inset surfaces (input fields on a card) |
| `secondary` | `#222222` | Tertiary surfaces |
| `border` | `#2A2A2A` | Hairline rules and card borders |
| body-muted (informal) | `#B5B5B0` | Body copy on dark — used in artifacts but not yet a documented token |

## Accents

| Token | Hex | Reserved use |
|---|---|---|
| `brand red` | `#FF4100` | **CTAs and section eyebrows ONLY** |
| `blue · info` | `#0084FF` | Semantic only |
| `green · success` | `#00C853` | Semantic only — also used for `● CONNECTED`-style status dots |
| `yellow · attention` | `#FFEA00` | Semantic only |
| `purple · AI` | `#9C6AFF` | Semantic only |
| `magenta · hero` | `#FF00FF` | Semantic only |

**Discipline:** brand red lands at most twice on a long page (e.g. hero + footer CTA). Never decorate with it. Every other moment is grayscale on dark.

## Type

| Role | Family | Weight / Size |
|---|---|---|
| Hero | Plus Jakarta Sans | ExtraBold 800 / 80px+ / `-0.03em` |
| Section | Plus Jakarta Sans | ExtraBold 800 / 44px / `-0.02em` |
| Card heading | Plus Jakarta Sans | Bold 700 / 18px |
| Body | Plus Jakarta Sans | Regular 400 / 16/26 |
| Mono label | IBM Plex Mono | Medium 500 / 11px / `0.12–0.18em` / UPPERCASE |

**Stated principle:** *"Every label is mono. Every time."* If it's a label (eyebrow, badge, caption, micro-text), it's IBM Plex Mono. No exceptions.

## Buttons

**Stated principle:** *"Buttons are pills. Cards are sharp. The contrast between the two is the visual language."*

| Variant | Ground | Text | Use |
|---|---|---|---|
| Primary | brand red `#FF4100` | white | Main CTAs ("Get started", "Subscribe") |
| Dark pill | `#141414` card on `#1A1A1A` | white | Secondary action with subtle border |
| Filled dark | `#1A1A1A` muted | white | Tertiary |
| Mono pill | `#141414` | white IBM Plex Mono caps | Code-style action ("NPM INSTALL") |

All buttons use `border-radius: 999px` (full pill). Never rectangular.

## Cards

Sharp corners (no border-radius). Optional subtle 1px `border` token (`#2A2A2A`) for definition. The pill-vs-sharp contrast IS the system's signature — don't soften card corners.

## Nav

**Contained card** on `#141414`, NOT page-width with a border-bottom. Inside the card: brand mark left, white IBM Plex Mono caps nav links, status pill + brand-red pill CTA on the right.

The status pill is a Sanity signature: subtle border, colored dot (green for connected, lime/red etc. for state), mono caps label.

## Status indicators

- Green dot `#00C853` on `#1A1A1A` pill with `#2A2A2A` border, mono caps label — `● CONNECTED`
- Pattern reused for any system-state callout

## Brand-rule reminders (printed in the artboards)

- "Buttons are pills. Cards are sharp. The contrast between the two is the visual language." — `1Q-0`
- "Every label is mono. Every time." — `1-0`
- "Brand red is reserved for primary CTAs and section eyebrows only." — `1-0`
- "Dark-first." — `1-0`
- "One opinion per surface." — `1Q-0` (a stated content principle worth carrying through)

## Pre-design checklist

Before writing any HTML for a Sanity artifact:

- [ ] Screenshot `Sanity - Components` (`1Q-0`) and look at the nav (contained card!), button pills, badge variants, status pill pattern
- [ ] Count the brand-red moments planned for this artifact. If more than 2 on a single page, cut some
- [ ] Every label, eyebrow, caption is IBM Plex Mono uppercase — confirm before using any other font for labels
- [ ] Buttons are pills (radius 999px). Cards are sharp (radius 0). Both rules are non-negotiable
- [ ] Body text muted gray on dark — not pure white. Pure white is reserved for headlines and active text
- [ ] Status indicators (connected, subscribed, live) get the green-dot pill pattern
