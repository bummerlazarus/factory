# Claude.com Design System / v0.1

Pre-design reference for the **Claude.com** brand system. Source of truth: `Claude · Tokens` (`AB-0`) and `Claude · Components` (`C9-0`) in the `sanity test` Paper file. Read this *before* designing any Claude artifact.

> **Filename note:** this file is `claude-com.md` (not `claude.md`) because Claude Code auto-loads any file named `CLAUDE.md` as project context. `claude-com.md` matches the system's actual identifier ("Claude.com Design System / v0.1") and avoids that collision.

## Identity in one sentence

Cream editorial canvas with a literary serif pulling the visual weight, one disciplined coral moment per surface, dark-navy reserved for product chrome. Reads like a thinking-partner brand, not a marketing template.

## Surfaces

**Stated rhythm:** *"The page rhythm alternates surfaces — cream, then dark, then coral."* Long Claude pages should feature all three.

| Token | Hex | Use |
|---|---|---|
| `canvas` | `#faf9f5` | Cream page ground (the everyday surface) |
| `surface-soft` | `#f5f0e8` | Tinted cream for sections |
| `surface-card` | `#efe9de` | Card fills on cream |
| `cream-strong` | `#e8e0d2` | Heavier cream surfaces |
| `surface-dark` | `#181715` | Dark navy for product chrome and dark sections |

## Accents

| Token | Hex | Reserved use |
|---|---|---|
| `primary · coral` | `#cc785c` | **CTAs and full-bleed callout cards only** |
| `primary-active` | `#a9583e` | Pressed/active state of coral CTAs |
| `accent · teal` | `#5db8a6` | Secondary accent (use sparingly) |
| `accent · amber` | `#e8a55a` | Secondary accent |
| `success` | `#5db872` | Semantic |
| `error` | `#c64545` | Semantic |

**Discipline:** coral is the brand signature. One coral CTA + one coral callout panel per long page is the upper bound. Don't tint dividers or icons with it.

## Type

The Cormorant + Inter pairing is the most identifying choice. Heavy literary serif against humanist sans is what makes Claude visually distinct from every other AI brand.

| Role | Family | Weight / Size |
|---|---|---|
| `display-xl` | Cormorant Garamond | Medium 500 / 96px / `-2px` letter-spacing |
| `display-lg` | Cormorant Garamond | Medium 500 / 48px / `-1px` |
| `title-md` | Inter | Medium 500 / 18px |
| `body-md` | Inter | Regular 400 / 16/25 |
| `caption-uppercase` | Inter | Medium 500 / 12px / `1.5px` UPPERCASE |
| `code` | JetBrains Mono | Regular 400 / 14px |

**Important:** Inter substitutes for Anthropic's StyreneB. Don't replace with Helvetica or a geometric sans — it breaks the "warm-editorial" feel and the page reads as generic SaaS.

## Buttons

Slightly rounded rectangles (~4–6px radius). NOT pills, NOT fully sharp.

| Variant | Ground | Text | Use |
|---|---|---|---|
| Primary | coral `#cc785c` | white | Main CTAs ("Try Claude") |
| Secondary | `surface-card #efe9de` cream | ink | Quiet secondary action ("Talk to sales") |
| Text link | transparent | ink + arrow icon | Inline link with `→` ("Sign in →") |
| Text underline | transparent | coral underlined | "Read the docs" pattern |
| Cream pill on coral | `#fff8f3` near-white | ink | Inverse CTA on a coral surface ("Try Claude" inside a coral feature card) |

## Cards

The "cream–dark–coral trinity" is the system's card pattern:

1. **Cream feature card** — `surface-card #efe9de` ground, serif heading, small asterisk badge in a cream tile, body in Inter, "Read about → " text link in coral
2. **Dark code card** — `surface-dark #181715` ground, terminal-frame chrome, JetBrains Mono code, "Run with…" caption + "Copy →" link
3. **Coral feature card** — coral `#cc785c` ground, white serif heading, white-pill button inside ("Try Claude")

Three together create the page rhythm. A Claude long page feels right when all three appear.

## Nav

**Page-width on cream**, NOT a contained card the way Sanity does it. Asterisk `✻` glyph + "Claude" wordmark on the left, plain text nav links (Inter, sentence case — NOT mono caps) in dark, "Sign in" text + coral pill "Try Claude" on the right.

The nav posture is editorial-print, not SaaS-toolbar.

## Status indicators

- Cream pill with `success #5db872` dot, Inter caps caption inside: `● ALL SYSTEMS OPERATIONAL`
- Solid coral pill: `BETA`, `NEW` (for emphasis)
- Cream pill: `Anthropic` (parent-brand attribution)

## Brand-rule reminders (printed in the artboards)

- "Cream-canvas first. Coral is reserved for primary CTAs and full-bleed callout cards. Dark navy carries product chrome." — `AB-0`
- "Coral CTAs, cream feature cards, dark-navy product surfaces. The page rhythm alternates surfaces — cream, then dark, then coral." — `C9-0`
- "Body type carries the system's quiet warmth. Inter substitutes for StyreneB; both are humanist sans designed for screen reading." — `AB-0`
- "Meet your thinking partner." / "Built to be steady, careful, and deeply useful." — voice samples for headlines

## Pre-design checklist

Before writing any HTML for a Claude artifact:

- [ ] Screenshot `Claude · Components` (`C9-0`) and study the cream-dark-coral card trinity, button shapes, nav posture
- [ ] Plan the surface rhythm: where does cream sit, where does dark sit, where does coral sit? A Claude page should *use* all three at long form
- [ ] Pick the *one* coral moment for the page (CTA or callout panel — not both)
- [ ] Display headlines are Cormorant Garamond serif. If you're reaching for a sans-serif headline, you're in the wrong system
- [ ] Body and titles are Inter — don't substitute
- [ ] Buttons get ~4–6px radius. Not pills (Sanity), not sharp (Sanity cards). Slight softness
- [ ] Labels are Inter caps with ~1.5px tracking — NOT a mono font (that's EM/Sanity)
- [ ] No drop shadows on cards. Border or no border, but no shadow
