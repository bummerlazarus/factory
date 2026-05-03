# EM Brand System / v0.1

Pre-design reference for the **EM** system. Source of truth: `EM · Tokens` (`6Y-0`) and the EM component artboards in the `sanity test` Paper file (see IDs below). Read this *before* designing any EM artifact, then screenshot the live artboards to catch drift.

## Identity in one sentence

Warm linen editorial ground, heavy uppercase Honeychrome display, indigo + lime + peach as a tight trio with rhythmic full-bleed contrast. Reads like a self-published essayist's brand, not a SaaS app.

## Component artboards

| Artboard | ID |
|---|---|
| EM · Tokens | `6Y-0` |
| EM · Buttons | `15D-0` |
| EM · Cards | `15E-0` |
| EM · Badges & status | `15F-0` |
| EM · Nav | `15G-0` |
| EM · Tiles | `15H-0` |
| EM · Diagrams | `162-0` |

## Surfaces (neutrals)

| Token | Hex | Use |
|---|---|---|
| `--color-linen` (Warm Linen) | `#F1EFE9` | Light-mode ground; warm white in dark mode |
| `--color-stone` (Soft Stone) | `#E5E3DD` | Hairline rules, muted dividers, card borders on cream |
| `--color-near-black` (Near Black) | `#1D1D1F` | Dark surface, primary text on cream |
| `--color-teal` (Deep Teal) | `#253238` | Alternative dark surface (status pill grounds, accent panels) |

## Accents

| Token | Hex | Reserved use |
|---|---|---|
| `--color-indigo` (Electric Blue) | `#3C42FB` | Brand accent — primary CTAs (the "Get started" / "Subscribe" pattern), full-bleed pull quotes |
| `--color-lime` (Electric Lime) | `#C1FF72` | Highlight moments only — newsletter callouts, status dots, the EM monogram chip, "now writing" feature card |
| `--color-blush` (Peach) | `#F5D5C8` | Soft accent for cards, monograms (e.g. IP Lab), and lifestyle / human-warmth surfaces |

**Discipline:** indigo and lime should not both be loud in the same composition. Indigo is the brand accent (primary intent); lime is the highlight (look-here moment); peach is the warm tertiary that softens dark grounds and gives the system its human edge.

## Type

| Role | Family | Weight / Size |
|---|---|---|
| Display | Honeychrome Black | 900 / 80px+ / `0.02em` / **UPPERCASE** |
| H1 | Space Grotesk | Bold 700 / 48px |
| H2 | Space Grotesk | SemiBold 600 / 32px |
| Body | Space Grotesk | Regular 400 / 16px / 26px line-height |
| Mono label | IBM Plex Mono | SemiBold 600 / 11px / `0.12em` / UPPERCASE |

Honeychrome is used in caps only (display), with **open** tracking (`0.02em`) — never negative. Don't mix Space Grotesk with another humanist sans — the system breaks.

## Buttons (`15D-0`)

**Stated principle:** *"Primary, ink, ghost, and the mono pill — every CTA in one place."* 4px radius, 48px standard height, 32px compact.

| Variant | Ground | Text | Use |
|---|---|---|---|
| Primary | `#3C42FB` indigo | linen | "Get started" — main CTA |
| Ink | `#1D1D1F` near black | linen | Secondary action ("Read the brief") |
| Ghost | transparent on cream, near-black border | near black | Tertiary on cream ("View work") |
| Subscribe | `#1D1D1F` near black | lime mono caps | Newsletter signup CTA — uppercase mono treatment |

## Cards (`15E-0`)

**Stated principle:** *"Cards are bordered, never floating on shadow."* Visible 1px border, no drop shadows. Three documented variants:

| Variant | Ground | Recipe |
|---|---|---|
| Default | white over cream | Stone (`#E5E3DD`) border, lime monogram chip, FRAMEWORK mono eyebrow, Space Grotesk H2 title, body, "Read More →" link |
| Code | `#181715` near-black | Three traffic-light dots + filename in mono, inset code well at `#1F1E1B`, Plex Mono with indigo keywords + lime strings, mono "COR AD COR" + lime "Copy →" footer |
| Lime feature | `#C1FF72` lime | "NOW WRITING" mono eyebrow, Space Grotesk H2 in ink, ink body, ink-filled "Read the essay →" button — used for highlight / now-writing moments |

## Nav (`15G-0`)

**Contained card**, not page-width. Rounded white card with a hairline border sitting on the linen ground. Inside:

- Left: lime EM monogram chip + Space Grotesk "Edmund Mitchell" wordmark
- Center: nav links in mono uppercase — `WRITING` · `FRAMEWORKS` · `PODCAST` · `ABOUT`
- Right: `SEARCH` mono label + indigo Subscribe button

> **Posture note:** earlier drafts of this doc described nav as "page-width with a tertiary border-bottom." That's wrong. The live system sits on a contained card. The Sanity system uses page-width borders; EM does not.

## Badges & status (`15F-0`)

**Stated principle:** *"Live indicators, version chips, and inline tags. Mono labels at 10px / 0.08em uppercase. 28px height, 4px radius."* Four documented patterns:

| Pattern | Recipe |
|---|---|
| Live pill | Light cream ground, lime dot + `LIVE` mono caps in ink |
| New pill | Lime fill, `NEW` mono caps in ink |
| Version chip | Ink fill, `v0.1.0` mono caps in lime |
| Inline tag | Light cream ground, mono caps `CORDIAL` in ink + `COMMUNICATION FRAMEWORK` muted — for inline categorization |

## Brand-rule reminders (printed in the artboards)

- "Editorial restraint over UI flourish"
- "Heart speaks to heart" / "Cor ad cor narratio" — the brand mantra; appears in footers and attribution
- "Cordial communication, applied to the work of building."

## React Flow component system (`162-0` — bottom section)

The **EM · Diagrams** artboard (`162-0`) contains a **React Flow Component Spec** section (added 2026-04-30) with all node/edge/handle variants mapped directly to EM tokens. Use this as the implementation spec when building any `@xyflow/react` diagram in the EM web app.

### Node variants

| Variant | Background | Border | Text color |
|---|---|---|---|
| Default | `#253238` (deep teal) | `1px #3a4448` | `#F1EFE9` linen |
| Active / selected | `#3C42FB` (indigo) | `1px #3C42FB` | `#F1EFE9` linen |
| Output / live | `#1a2820` (dark green) | `1px #2d4a38` | `#C1FF72` lime |
| Blocked | `#1D1D1F` (near black) | `1px #4a3030` | `#9a9a9e` muted |

Node anatomy: `10px IBM Plex Mono 600 / 0.08em UPPERCASE` eyebrow + `15px Space Grotesk 600` label. `4px` border-radius.

### Edge variants

| Variant | Color | Width | Dash |
|---|---|---|---|
| Default | `#3a4448` | 1.5px | `4 3` (dashed) |
| Active | `#3C42FB` indigo | 2px | solid |
| Live | `#C1FF72` lime | 1.5px | `2 2` (dashed) |

### Handle (connection point)

- Color: `#C1FF72` (lime) — all states, all variants
- Size: `10×10px`, `border-radius: 50%`, no border

### Canvas background

`#181715` — slightly warmer than near-black, gives the React Flow canvas its own surface distinct from the surrounding page.

### React Flow implementation notes

- **Do not** use React Flow inside Paper — it requires React + JSX + a build step. Paper is for designing the visual spec only.
- Install: `npm install @xyflow/react`
- Override React Flow's default styles via `nodeTypes` (custom node components) + a global CSS file targeting `.react-flow__edge-path`, `.react-flow__handle`, etc.
- Import `@xyflow/react/dist/style.css` **after** any Tailwind import to preserve style order.
- Canvas background set via `.react-flow__background` or the wrapper `div` background.

## Pre-design checklist

Before writing any HTML for an EM artifact:

- [ ] Screenshot the relevant component artboard (Buttons `15D-0`, Cards `15E-0`, Badges `15F-0`, Nav `15G-0`, Tiles `15H-0`) and check posture, not just tokens
- [ ] Decide which accent is the *primary moment* (indigo) and which is the *highlight* (lime). Don't use both loudly. Peach is a warm tertiary, not a hero
- [ ] If it's a newsletter / subscribe artifact, use the **ink-ground + lime mono caps** SUBSCRIBE button — not indigo
- [ ] Display headline is Honeychrome Black caps with **positive** `0.02em` tracking. Sentence-case Space Grotesk is a refinement, not a substitute
- [ ] Cards get a `#E5E3DD` (stone) border. Never a shadow
- [ ] Nav is a **contained rounded card**, not a page-width border-bottom
- [ ] Mantra in mono caps belongs in the footer or attribution row
- [ ] If building a diagram/flow view → reference the **React Flow Component Spec** section of `162-0` for exact node/edge/handle tokens before writing any CSS
