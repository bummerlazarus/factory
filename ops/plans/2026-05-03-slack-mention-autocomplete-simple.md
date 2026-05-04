# Slack composer @-mention autocomplete (simple)

**Repo:** `dashboard/`
**File:** `components/slack/slack-panel.tsx`
**Date:** 2026-05-03

## Scope

Trigger only when input value matches `/@([a-z0-9_-]*)$/i` (literal end of string — not cursor-aware mid-message). Follow-up plan will handle mid-message detection.

## Behavior

- On trigger: show popover anchored above the `<Input>` showing up to 6 agents, prefix-filtered (case-insensitive) on `name`.
- Each row: emoji, name, role.
- Keyboard (only when popover open):
  - ArrowDown / ArrowUp: move selection
  - Enter or Tab: replace `@partial` with `@<DisplayName> ` (trailing space), close popover
  - Escape: close, no insert
- Mouse: click row to insert.
- Outside click: close.
- When popover closed: Enter still sends, Tab is not hijacked.

## Data

- Fetch `GET /api/agents` once on mount → store in `useState<Agent[]>([])`.
- Agent shape: `{ id, name, role, emoji, ... }`.

## Implementation

Inside `SlackPanel`:

1. Add state: `agents`, `mentionOpen`, `mentionQuery`, `mentionIndex`.
2. Effect: fetch agents on mount.
3. `useEffect` on `input` change: parse with regex; if match, set query & open; else close.
4. Filter: `agents.filter(a => a.name.toLowerCase().startsWith(query.toLowerCase())).slice(0, 6)` (when query empty, show all up to 6).
5. Render popover as `absolute bottom-full mb-1 left-0 right-0` div inside input wrapper (which is already `relative`-able).
6. `onKeyDown` extends existing handler:
   - If `mentionOpen && filtered.length`:
     - ArrowDown/Up: preventDefault, move index (with wrap)
     - Enter/Tab: preventDefault, insert
     - Escape: preventDefault, close
   - Else: existing Enter→send behavior.
7. Insert helper: replace trailing `@\w*` with `@<name> ` and close popover.
8. Outside click: small effect with `mousedown` listener checking `containerRef`.

## Files touched

- `components/slack/slack-panel.tsx` (only)

## Done criteria

- `@` opens popover with all agents
- `@to` narrows to Tokamak
- Enter inserts `@Tokamak ` and closes popover
- Esc closes without inserting
- Send-on-Enter still works when popover closed
- Tab still cycles dashboard surfaces when popover closed

## Risk

- Tab hijack: only intercept when `mentionOpen && filtered.length > 0`.
- Focus: keep focus in `<Input>`; popover items are not focusable buttons that steal focus — use `onMouseDown` (preventDefault) so input retains focus.
- A11y: this is a minimal first pass; full ARIA combobox semantics are out of scope.
