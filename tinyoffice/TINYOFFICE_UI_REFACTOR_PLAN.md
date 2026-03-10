# TinyOffice UI Refactor Plan

## Old UI Problems

1. **Monolithic office page** — ~500 lines in one file mixing data, events, layout, and rendering
2. **Retro demo feel** — Full-screen pixel scene as the entire experience, no product shell
3. **No hierarchy** — Office was the whole page; no top header, no right panel for details
4. **Visual clutter** — Dense floor tiles, oversized speech bubbles, decorative plants
5. **Overloaded responsibilities** — Event handling, position math, and UI in one place

## New Component Structure

```
tinyoffice/src/
├── components/
│   ├── app-header.tsx      # Top header with page title
│   ├── app-shell.tsx       # Shell wrapper (header + context)
│   ├── sidebar.tsx         # Left nav (updated with Agents, Teams)
│   └── office/
│       ├── office-scene.tsx   # Floor, desks, agents, user avatar
│       ├── agent-avatar.tsx   # Single agent with bubble, tooltip, click
│       ├── agent-bubble.tsx   # Speech bubble component
│       ├── activity-rail.tsx  # Status bar for chain events
│       └── office-sidebar.tsx # Right panel: agent details when selected
├── lib/
│   ├── office-layout.ts    # (existing) desk positions, roles
│   ├── office-state.ts     # (existing) activity states
│   ├── office-events.ts    # (existing) event → state mapping
│   ├── office-utils.ts     # (new) parseMessage, extractTargets, getAvatarForRole, getAgentTooltip
│   ├── use-office-events.ts # (new) SSE subscription, bubbles, states, handoff
│   └── header-context.tsx  # (new) per-page header right slot
└── app/
    └── office/
        └── page.tsx        # Thin orchestrator: hook + components
```

## New Product Shell Layout

- **Top header** — Page title (from pathname), optional right slot (badges, connection status)
- **Left nav** — Dashboard, Office, Tasks, Agents, Teams, Logs, New Chat
- **Main content** — Page-specific (office: scene + activity rail)
- **Right panel** — Agent details when an agent is selected (Office page only)

## Visual Design Direction

- **Dark neutral base** — `#0f0f0f` background, `#171717` cards
- **Restrained accent** — `#22c55e` primary (emerald) instead of bright lime
- **Cleaner spacing** — Reduced padding, smaller labels
- **Card-based panels** — Office scene in a rounded card with border
- **Compact labels** — 8–10px for agent names, smaller avatars (32px)
- **Reduced floor density** — 32px tiles, 40% opacity
- **Smaller desks** — 56×32px instead of 72×40px

## What Was Intentionally Preserved

- **Backend event subscription** — Same SSE, same event types
- **Agent visual states** — idle, thinking, working, handoff
- **Handoff movement** — CSS transition to target desk, 2s return home
- **Meeting bubbles** — Agents move to midpoint when messaging
- **Event → state mapping** — `eventToAgentState` unchanged
- **Role-based layout** — Same desk positions, `inferRoleFromAgentId`
- **Speech bubbles** — Same parseMessage, extractTargets logic

## Next Possible Polish Steps

1. Add "retro mode" toggle to restore original pixel-heavy styling
2. Improve agent detail panel with linked PR/issue when available
3. Add keyboard shortcuts for agent selection
4. Persist selected agent in URL query
5. Add loading skeleton for office scene
6. Improve activity rail with filters (by agent, by type)
