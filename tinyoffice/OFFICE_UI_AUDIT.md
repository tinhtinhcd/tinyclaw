# TinyOffice UI Audit

## 1. Current Office Page Behavior

The office page (`/office`) is a full-screen visualization that:

- **Fetches**: agents, teams via polling
- **Subscribes**: SSE events for bubbles, status, agent states, handoff
- **Renders**: floor tiles, desk clusters, plants, agent avatars with state animations, speech bubbles, user avatar, activity status bar
- **Computes**: role-based positions, handoff targets, meeting midpoints, render positions
- **Handles**: event deduplication, bubble expiry, handoff return timeout

## 2. Overloaded Responsibilities in office/page.tsx

| Responsibility | Lines (approx) | Should be |
|----------------|----------------|-----------|
| Data + SSE wiring | ~120 | Custom hook or context |
| Layout/position logic | ~80 | lib/office-layout, lib/office-events |
| Event → state mapping | ~90 | Already in lib/office-events |
| Scene rendering | ~200 | office-scene, agent-avatar, agent-bubble |
| Status bar | ~30 | activity-rail |
| Utilities (extractTargets, parseMessage, etc.) | ~70 | lib or components |

**Total**: ~500 lines in one file. Scene, data, and UI are tightly coupled.

## 3. Reusable Parts

- **lib/office-layout.ts** — already extracted
- **lib/office-state.ts** — already extracted
- **lib/office-events.ts** — already extracted
- **extractTargets, parseMessage** — move to lib/office-utils or keep in bubble component
- **SpeechBubbleEl** — extract to agent-bubble.tsx
- **statusColor** — move to activity-rail
- **getAgentTooltip, getAvatarForRole** — move to agent-avatar or lib

## 4. Current Styling

- Dark mode by default (`className="dark"` on html)
- Stone/zinc palette (--background #0c0a09, --primary lime #a3e635)
- Pixelated assets (floor_tile, desk, monitor, chair, plant, avatars)
- Agent animations: idle, thinking, working, handoff
- Speech bubbles: max-w-[400px], rounded-sm, shadow
- Status bar: horizontal scroll, small text

## 5. Smallest Safe Path to Professional UI

1. **App shell** — Add top header to layout; office becomes one panel in main. Sidebar already exists.
2. **Extract components** — office-scene, agent-avatar, agent-bubble, activity-rail, office-sidebar (right panel)
3. **Visual shift** — Dark neutral base, restrained accent, cleaner spacing, card-based panels
4. **Preserve** — All SSE logic, event mapping, handoff, agent states stay intact; only move code and restyle
