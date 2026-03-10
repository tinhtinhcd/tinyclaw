# TinyOffice — Pixel Office Restoration

## What Changed

The TinyOffice virtual office has been restored from a flat SaaS/dashboard style to a **pixel-art 2D mini-game** inspired by Gather / Habbo / retro office simulations. All changes are frontend visual/presentation only — the backend event model (SSE, event→state mapping, API layer) is fully preserved.

## Component Architecture

```
tinyoffice/src/
├── app/office/page.tsx          — Game-style office page layout
├── components/office/
│   ├── office-scene.tsx         — Main pixel office renderer (walls, floor, desks, agents)
│   ├── office-decorations.tsx   — Static scene dressing (plants, rug, zone labels)
│   ├── agent-avatar.tsx         — Pixel sprite with state indicators, retro tooltip
│   ├── agent-bubble.tsx         — Retro dark speech bubble with pixel tail
│   ├── activity-rail.tsx        — Game console-style activity log
│   └── office-sidebar.tsx       — Dark retro info panel with sprite preview
├── lib/
│   ├── office-layout.ts         — U-shaped desk positions in pixel coordinates
│   ├── office-state.ts          — Agent state types + labels (unchanged)
│   ├── office-events.ts         — Backend event → state mapper (unchanged)
│   ├── office-animations.ts     — State → CSS class mapper, lerp, indicators
│   ├── office-utils.ts          — Message parsing, avatars, tooltips (unchanged)
│   ├── use-office-events.ts     — SSE hook (unchanged)
│   └── api.ts                   — Backend API + SSE (unchanged)
└── app/globals.css              — Pixel office theme, Press Start 2P font, animations
```

## Office Layout Zones

```
┌──────────────────────────────────────────────────┐
│   WALL   WALL   WALL   WALL   WALL   WALL   WALL│
│                                                  │
│  📋 BA        📌 Scrum      📐 Architect         │
│  (120,160)    (360,160)    (600,160)             │
│                                                  │
│               🏯 Meeting                         │
│                  Area                            │
│                                                  │
│        💻 Coder     🔍 Reviewer    🧪 Tester     │
│        (240,380)    (520,380)     (760,380)      │
│                                                  │
└──────────────────────────────────────────────────┘
```

960×540 pixel viewport. Positions in pixel coords, CSS percentage positioning.

## Agent Visual States

| State      | Animation Class       | Indicator | Behavior                     |
|------------|----------------------|-----------|------------------------------|
| idle       | `agent-anim-idle`    | —         | Gentle breathing bob         |
| thinking   | `agent-anim-thinking`| 💭        | Pulse with brightness shift  |
| working    | `agent-anim-working` | ⌨️         | Rapid typing bob (stepped)   |
| handoff    | `agent-anim-walking` | 🚶        | Step bounce with X flip      |

## Event → Animation Mapping

Backend events → visual states (preserved from `office-events.ts`):

- `chain_step_start` → **working**
- `chain_step_done` → **idle**
- `chain_handoff` → source: **handoff**, target: **thinking**
- `worker.started` → **working**
- `worker.failed/timeout` → **thinking**
- `review_fetch.*` → **thinking**
- `tester_focus.generated` → **working**
- `linkage.*` → **working**

## Handoff Walking

1. Source agent enters `handoff` state
2. `use-office-events.ts` resolves target desk position via `getHomeForRole(targetRole)`
3. CSS `transition: left 0.8s, top 0.8s` animates movement
4. `agent-anim-walking` adds step-bounce/flip during movement
5. After 2s timeout: both agents return to idle at home positions

## Asset Strategy

All assets are inline SVGs using `shape-rendering="crispEdges"` for pixel-clean rendering:

- **Floor**: Checkerboard carpet in muted green
- **Wall**: Brick pattern in blue-gray with baseboard
- **Desk**: Wooden with surface highlights and legs
- **Monitor**: Retro terminal with green code glow
- **Chair**: Office chair with wheels
- **Plant**: Potted plant with terracotta pot
- **Rug**: Oriental-style meeting area rug
- **Avatars**: 6 distinct role characters + 1 player character
  - BA: Indigo suit, glasses, clipboard
  - Scrum Master: Amber shirt, headset
  - Architect: Purple with beret, pencil
  - Coder: Green hoodie, messy hair, red sneakers
  - Reviewer: Rose formal, bow tie, monocle
  - Tester: Lab coat, goggles, cyan undershirt

## Tests

- `office-events.test.ts` — 10 tests (unchanged, all pass)
- `office-layout.test.ts` — 14 tests (updated for pixel coords, added zone/uniqueness tests)
- `office-animations.test.ts` — 18 tests (new: class mapping, indicators, lerp, midpoint, resolve)

## Limitations / Next Steps

- Avatar sprites are simple SVG pixel art — could be upgraded to sprite sheets with directional frames
- Walking animation uses CSS transition + keyframes — could add actual frame-by-frame walking sprites
- No pathfinding (by design) — agents move in straight lines
- Meeting rug is decorative only — could become a functional meeting point
- Zone labels could become interactive (hover for zone details)
- Sound effects could be added but are out of scope
