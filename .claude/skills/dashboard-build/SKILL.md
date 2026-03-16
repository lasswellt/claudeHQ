---
name: dashboard-build
description: |
  Production-grade dashboard UI generation. Nuxt 3 + Vuetify + xterm.js.
  Researches existing patterns, then builds pages, components, composables.
  Use when: "build a page", "create UI", "add a view", "build dashboard"
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, Task, AskUserQuestion, ToolSearch
model: opus
---

# Dashboard Build: Nuxt 3 + Vuetify + xterm.js UI Generation

Production-grade dashboard UI generation for claudeHQ. Follows a strict
discover-analyze-design-implement-refine pipeline to produce consistent,
accessible, and performant dashboard views.

## Phase 0: CONTEXT

1. Read `docs/_context/codebase-inventory.json` — understand dashboard state.
2. Read `docs/_context/incompletes.json` — check for pending UI work.
3. Read `docs/_context/registry.json` — active sprint, current phase.
4. If arguments were provided, note the target view/component.

## Phase 1: DISCOVER

Survey the existing dashboard codebase to understand patterns and conventions.

### 1.1 Configuration Discovery

Read and analyze:
- `packages/dashboard/nuxt.config.ts` — modules, runtime config, Vuetify integration
- `packages/dashboard/plugins/vuetify.ts` — Vuetify plugin config, theme, defaults
- `packages/dashboard/tsconfig.json` — path aliases, strict mode
- `packages/dashboard/package.json` — dependencies, scripts
- `packages/dashboard/app.vue` — root layout structure
- `packages/dashboard/layouts/` — layout components

### 1.2 Existing Code Inventory

Search for and catalog:
- `packages/dashboard/pages/**/*.vue` — existing pages and routing structure
- `packages/dashboard/components/**/*.vue` — existing components
- `packages/dashboard/composables/**/*.ts` — existing composables
- `packages/dashboard/stores/**/*.ts` — Pinia stores
- `packages/dashboard/plugins/**/*.ts` — Nuxt plugins
- `packages/dashboard/utils/**/*.ts` — utility functions
- `packages/dashboard/assets/**/*` — styles, images, fonts

### 1.3 xterm.js Setup Discovery

Search for xterm.js integration patterns:
- Import patterns for `@xterm/xterm`, `@xterm/addon-fit`, `@xterm/addon-webgl`
- Terminal initialization code
- Resize handling
- WebSocket attachment
- Cleanup/disposal patterns

### 1.4 Visual Baseline (if Playwright MCP available)

Use ToolSearch to check for Playwright MCP tools. If available:
- Navigate to existing dashboard pages
- Take screenshots as visual baseline
- Note current UI state for comparison after changes

### 1.5 Write Discovery Document

Write findings to `.ui-architect/discovery.md`:
```markdown
# Dashboard Discovery Report

## Configuration
- Nuxt version: ...
- Vuetify version: ...
- xterm.js version: ...

## Existing Pages
| Route | File | Description |
|---|---|---|

## Existing Components
| Name | File | Props | Used By |
|---|---|---|---|

## Composables
| Name | File | Purpose |
|---|---|---|

## Stores
| Name | File | State Shape |
|---|---|---|

## Patterns Observed
- Component style: <script setup lang="ts"> with ...
- State management: Pinia with ...
- Styling: Vuetify utility classes + ...
- Error handling: ...
```

## Phase 2: ANALYZE

Build a design profile from the discovery findings.

### 2.1 Vuetify Configuration Profile

Extract:
- Brand colors (primary, secondary, accent, etc.)
- Default component props (dense, outlined, etc.)
- Icon set (material-icons, mdi, etc.)
- Dark mode configuration
- Vuetify theme configuration (colors, dark mode)
- Typography settings

### 2.2 Component Inventory

Catalog all Vuetify components in use:
- Layout: VApp, VAppBar, VNavigationDrawer, VMain, VContainer
- Data display: VDataTable, VList, VCard, VChip, VBadge
- Form: VTextField, VSelect, VSwitch, VBtn
- Feedback: VDialog, VSnackbar, VAlert, VSkeletonLoader, VProgressCircular
- Navigation: VTabs, VBreadcrumbs, VStepper

### 2.3 xterm.js Configuration Profile

Document:
- Theme (background, foreground, cursor, ANSI colors)
- Font family and size
- Addons in use (fit, webgl, search, serialize)
- Custom keybindings
- Scrollback buffer size

### 2.4 Pattern Rules

Establish rules for new code based on existing patterns:
```
PATTERNS:
- Components: <script setup lang="ts">, defineProps with interface, defineEmits
- Styling: Vuetify utility classes preferred, scoped CSS for custom styles
- State: Pinia setup stores (composition API style)
- Composables: use* prefix, return reactive refs and methods
- Error handling: try/catch with VSnackbar for user-facing errors
- TypeScript: strict, no any, import types from shared package
```

## Phase 3: DESIGN

### 3.1 Clarify Requirements

If not specified in arguments, ask the user which view to build:

```
Which dashboard view should I build?

1. **Overview** (/) — Machine cards, session summary, system health
2. **Machine Detail** (/machines/:id) — Sessions, queue, metrics for one machine
3. **Session View** (/sessions/:id) — Live terminal with xterm.js
4. **Session Replay** (/sessions/:id/replay) — Recording playback with timeline
5. **Session Grid** (/sessions/grid) — Multi-session 2x2 or 1x4 layout
6. **Queue Manager** (/queues) — Cross-machine queue management

Or describe a custom view.
```

### 3.2 Create Wireframe

For the target view, create a textual wireframe using Vuetify components:

```
┌─ VApp ─────────────────────────────────────────────────┐
│ ┌─ VAppBar ────────────────────────────────────────┐  │
│ │ Logo | "claudeHQ" | VSpacer | VBtn[dark]         │  │
│ └──────────────────────────────────────────────────┘  │
│ ┌─ VNavigationDrawer ─┐ ┌─ VMain ────────────────┐  │
│ │ VList               │ │ VContainer              │  │
│ │  machines           │ │  ┌─ VCard ───────────┐  │  │
│ │  sessions           │ │  │ Machine: dev-box  │  │  │
│ │  queues             │ │  │ ● online  0.42    │  │  │
│ │                     │ │  │ Sessions: 2/4     │  │  │
│ │                     │ │  └──────────────────┘  │  │
│ │                     │ │  ...                    │  │
│ └─────────────────────┘ └────────────────────────┘  │
└───────────────────────────────────────────────────────┘
```

### 3.3 Present for Approval

Show the wireframe and component plan. Ask for approval before implementing.
If adjustments are requested, iterate the design.

## Phase 4: IMPLEMENT

Build bottom-up in strict order. Every file must be complete and production-ready.

### 4.1 TypeScript Types & Interfaces

Create/update view-specific types in `packages/dashboard/types/`:
```typescript
// types/dashboard.ts
export interface MachineCardProps {
  machine: Machine;
  selected?: boolean;
}

export interface SessionListProps {
  sessions: Session[];
  machineId?: string;
  loading?: boolean;
}
```

### 4.2 Composables

Create composables in `packages/dashboard/composables/`:

**Required composables (create if they don't exist):**

- **`useWebSocket.ts`** — WebSocket connection management
  - Connect/disconnect/reconnect with exponential backoff
  - Message parsing with shared protocol Zod schemas
  - Connection state ref (connecting, connected, disconnected, error)
  - Type-safe send method
  - Auto-reconnect on close

- **`useTerminal.ts`** — xterm.js terminal lifecycle
  - Create terminal instance with theme
  - Attach fit addon, webgl addon (with canvas fallback)
  - Handle resize events (debounced)
  - Write data method
  - Dispose on component unmount
  - Return: terminal ref, containerRef, write(), resize(), dispose()

- **`useReplay.ts`** — Session replay control
  - Load recording data
  - Play/pause/seek
  - Playback speed (0.5x, 1x, 2x, 4x)
  - Timeline position ref
  - Render frames to xterm.js terminal

- **`useNotifications.ts`** — Notification management
  - Subscribe to WebSocket notification events
  - Display with Vuetify VSnackbar
  - Notification history ref
  - Mark as read
  - Filter by level

### 4.3 Pinia Stores

Create stores in `packages/dashboard/stores/`:

- **`sessions.ts`** — Session state
  ```typescript
  export const useSessionsStore = defineStore('sessions', () => {
    const sessions = ref<Map<string, Session>>(new Map());
    const activeSessionId = ref<string | null>(null);
    // Actions: fetchSessions, subscribeToSession, unsubscribe
    // Getters: activeSessions, sessionsByMachine, sessionById
  });
  ```

- **`machines.ts`** — Machine state
  ```typescript
  export const useeMachinesStore = defineStore('machines', () => {
    const machines = ref<Map<string, Machine>>(new Map());
    // Actions: fetchMachines, updateFromWebSocket
    // Getters: onlineMachines, machineById, totalLoad
  });
  ```

- **`queues.ts`** — Queue state
- **`notifications.ts`** — Notification state

### 4.4 Components

Create components in `packages/dashboard/components/`.

**Every component MUST follow these rules:**

1. Use `<script setup lang="ts">`
2. Import types from `@claudehq/shared` or local types
3. Handle three states:
   ```vue
   <!-- Loading state -->
   <VSkeletonLoader v-if="loading" type="rect" />

   <!-- Empty state -->
   <VAlert v-else-if="!items.length" class="bg-grey-3">
     <template #avatar>
       <VIcon name="info" color="primary" />
     </template>
     No items found.
   </VAlert>

   <!-- Error state -->
   <VAlert v-else-if="error" class="bg-negative text-white">
     <template #avatar>
       <VIcon name="error" />
     </template>
     {{ error.message }}
     <template #action>
       <VBtn flat label="Retry" @click="retry" />
     </template>
   </VAlert>

   <!-- Content -->
   <div v-else>
     <!-- actual content -->
   </div>
   ```
4. Use Vuetify components exclusively (no raw HTML for UI elements)
5. Emit typed events with `defineEmits<{...}>()`
6. Props with interface and defaults

**Component catalog (build as needed for target view):**

- `TerminalView.vue` — xterm.js terminal wrapper
  - Props: sessionId, readonly, theme
  - Uses `useTerminal` composable
  - Attaches to WebSocket for live data
  - Disposes terminal in `onUnmounted`
  - Handles resize with ResizeObserver + fit addon

- `SessionCard.vue` — Session summary card
  - Props: session
  - Shows: status badge, command, machine, duration, actions
  - Emits: select, kill, replay

- `MachineCard.vue` — Machine summary card
  - Props: machine
  - Shows: hostname, status, load bar, session count, actions
  - Emits: select, startSession

- `QueueManager.vue` — Drag-and-drop queue management
  - Props: machineId (optional, for cross-machine view)
  - Uses Vuetify QTable with row dragging
  - Actions: add, remove, reorder, priority change

- `SessionGrid.vue` — Multi-terminal grid
  - Props: sessionIds, layout ('2x2' | '1x4')
  - Creates multiple TerminalView instances
  - Synchronized resize handling
  - Click-to-focus behavior

- `ReplayTimeline.vue` — Session replay controls
  - Props: duration, currentTime
  - Shows: play/pause, speed selector, timeline scrubber, timestamps
  - Emits: seek, play, pause, speedChange

- `StatusBadge.vue` — Colored status indicator
  - Props: status, size
  - Maps status to Vuetify colors (online=positive, offline=negative, etc.)

- `NotificationPanel.vue` — Notification list/panel
  - Uses notification store
  - QList with QItem for each notification
  - Level-based icons and colors
  - Mark as read, dismiss

### 4.5 Pages

Create pages in `packages/dashboard/pages/`:

- `index.vue` — Overview dashboard
  ```vue
  <script setup lang="ts">
  definePageMeta({
    layout: 'default',
    title: 'Overview',
  });
  </script>
  ```

- `machines/[id].vue` — Machine detail
- `sessions/[id].vue` — Live session terminal
- `sessions/[id]/replay.vue` — Session replay
- `sessions/grid.vue` — Multi-session grid
- `queues/index.vue` — Queue manager

### 4.6 Routing

Verify Nuxt file-based routing produces correct routes:
```
/                       -> pages/index.vue
/machines/:id           -> pages/machines/[id].vue
/sessions/:id           -> pages/sessions/[id].vue
/sessions/:id/replay    -> pages/sessions/[id]/replay.vue
/sessions/grid          -> pages/sessions/grid.vue
/queues                 -> pages/queues/index.vue
```

Use `definePageMeta` for:
- Page titles
- Layout selection
- Middleware (auth if needed)
- Transition names

## Phase 5: REFINE

### 5.1 Visual Validation

If Playwright MCP tools are available:
- Navigate to each built/modified page
- Take screenshots
- Compare with baseline from Phase 1
- Verify Vuetify components render correctly
- Check dark mode if configured

### 5.2 Accessibility Audit

For every component and page:
- All interactive elements have ARIA labels
- Keyboard navigation works (Tab, Enter, Escape)
- Focus management in dialogs and modals
- Color contrast meets WCAG AA
- Touch targets >= 44x44px for mobile
- Screen reader landmarks (QLayout provides these)

### 5.3 Responsive Behavior

Verify layouts work at:
- Desktop (1920x1080, 1440x900)
- Tablet (768x1024)
- Mobile (375x667) — if applicable

Use Vuetify responsive classes (`col-md-6 col-sm-12`) and breakpoint composables.

### 5.4 xterm.js Rendering Quality

For terminal views:
- Terminal renders content (not blank black box)
- No ANSI escape artifacts in visible text
- Fit addon properly fills container
- WebGL addon renders (falls back to canvas gracefully)
- Cursor blinks and is visible
- Selection works
- Scrollback buffer populated

### 5.5 Performance

- No unnecessary re-renders (use `shallowRef` for large objects)
- Terminal instances disposed in `onUnmounted` (no memory leaks)
- WebSocket messages debounced for high-frequency output
- Pinia stores use `storeToRefs` for reactive access
- Images lazy-loaded (if any)

## Follow-up

After implementation, suggest running `/dashboard-qa` for automated browser testing.

## Phase Final: REGISTER

1. **Update `docs/_context/codebase-inventory.json`:**
   - Add all new files to inventory
   - Record component catalog
   - Note composable and store additions

2. **Register incompletes:**
   - Any TODO comments left in code
   - Features deferred for later
   - Known issues found during implementation

3. **Log execution:**
   - Record skill invocation, target view, files created/modified
   - Note duration and any issues encountered
