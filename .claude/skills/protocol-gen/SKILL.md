---
name: protocol-gen
description: |
  WebSocket protocol generation and validation. Creates Zod schemas, TypeScript
  types, and handler type maps for all message types across agent/hub/dashboard.
  Use when: "generate protocol", "WebSocket types", "message schemas"
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
model: opus
---

# Protocol Gen: WebSocket Protocol Layer Generation

Generate and validate the complete WebSocket protocol layer for claudeHQ.
Produces Zod schemas, inferred TypeScript types, event unions, and handler
type maps covering all message types between agent, hub, and dashboard.

## Phase 0: CONTEXT

1. Read `docs/_context/codebase-inventory.json` — understand current state of shared package.
2. Read `docs/_context/registry.json` — check for existing protocol work, active sprint.
3. Check if `packages/shared/src/` exists and what files are already there.
4. Read `packages/shared/package.json` if it exists — verify Zod is a dependency.

## Phase 1: ANALYZE

Extract the complete WebSocket protocol specification from architecture docs.

1. Read `docs/claude-hq-architecture.md` — focus on the WebSocket Protocol section.
2. Read `docs/claude-hq-validation-report.md` — protocol validation requirements.

3. Extract ALL message types and classify by direction:

   **Agent -> Hub (agent:* prefix):**
   | Message Type | Purpose | Key Fields |
   |---|---|---|
   | `agent:register` | Agent announces itself to hub | machineId, hostname, capabilities, version |
   | `agent:heartbeat` | Periodic health check | machineId, timestamp, load, activeSessions |
   | `agent:session:started` | Confirms session creation | sessionId, machineId, pid, startedAt |
   | `agent:session:output` | Terminal output chunk | sessionId, data (base64 or utf8), sequence |
   | `agent:session:ended` | Session terminated | sessionId, exitCode, endedAt, reason |
   | `agent:recording:upload` | Session recording data | sessionId, recording (binary), format |
   | `agent:queue:updated` | Local queue state change | machineId, queue[] |

   **Hub -> Agent (hub:* prefix):**
   | Message Type | Purpose | Key Fields |
   |---|---|---|
   | `hub:session:start` | Command to start a session | sessionId, command, env, cols, rows |
   | `hub:session:resume` | Reconnect to existing session | sessionId |
   | `hub:session:kill` | Terminate a session | sessionId, signal, force |
   | `hub:session:input` | Terminal input from dashboard | sessionId, data |
   | `hub:queue:add` | Add task to agent's queue | taskId, command, priority, position |
   | `hub:queue:remove` | Remove task from queue | taskId |
   | `hub:queue:reorder` | Reorder queue | taskIds[] (new order) |

   **Hub -> Dashboard (broadcast/targeted):**
   | Message Type | Purpose | Key Fields |
   |---|---|---|
   | `session:output` | Relayed terminal output | sessionId, data, sequence |
   | `session:updated` | Session state change | sessionId, status, metadata |
   | `machine:updated` | Machine state change | machineId, status, load, sessions |
   | `queue:updated` | Queue state change | machineId, queue[] |
   | `notification` | Alert/notification | level, title, message, source, timestamp |

   **Dashboard -> Hub:**
   | Message Type | Purpose | Key Fields |
   |---|---|---|
   | `dashboard:session:start` | Request new session | machineId, command, env |
   | `dashboard:session:input` | Send terminal input | sessionId, data |
   | `dashboard:session:kill` | Request session termination | sessionId |
   | `dashboard:session:subscribe` | Subscribe to session output | sessionId |
   | `dashboard:session:unsubscribe` | Unsubscribe from session | sessionId |
   | `dashboard:replay:request` | Request session recording | sessionId, fromTimestamp |
   | `dashboard:queue:add` | Add task to queue | machineId, command, priority |
   | `dashboard:queue:remove` | Remove task from queue | taskId |
   | `dashboard:queue:reorder` | Reorder queue | machineId, taskIds[] |

4. Identify request/response pairs:
   - `dashboard:session:start` -> `session:updated` (status: starting) -> `agent:session:started` -> `session:updated` (status: running)
   - `hub:session:start` <-> `agent:session:started`
   - `hub:session:kill` <-> `agent:session:ended`
   - `dashboard:replay:request` -> chunked `session:output` replay

5. Map which component sends and receives each message type.

## Phase 2: GENERATE

Create/update three files in `packages/shared/src/`:

### File 1: `packages/shared/src/protocol.ts`

```typescript
import { z } from 'zod';

// ============================================================
// Base schemas
// ============================================================

const MessageBase = z.object({
  id: z.string().uuid(),
  timestamp: z.string().datetime(),
});

// ============================================================
// Agent -> Hub messages
// ============================================================

export const AgentRegisterSchema = MessageBase.extend({
  type: z.literal('agent:register'),
  payload: z.object({
    machineId: z.string(),
    hostname: z.string(),
    capabilities: z.array(z.string()),
    version: z.string(),
    maxSessions: z.number().int().positive(),
    platform: z.enum(['linux', 'darwin', 'win32']),
  }),
});

// ... (generate ALL message schemas following this pattern)
```

**Requirements for every schema:**
- Extend `MessageBase` with `id` (UUID) and `timestamp` (ISO 8601)
- Use `z.literal()` for the `type` field discriminator
- Use `z.object()` for the `payload` with all fields fully typed
- Add `.describe()` to complex fields for documentation
- Use `z.enum()` for known value sets (status, signal, level, etc.)
- Use `z.union()` with discriminated unions where message types share structure
- Binary data fields use `z.string()` with a comment noting base64 encoding

**Generate schemas for ALL message types listed in Phase 1.**

Create a discriminated union for all messages:

```typescript
export const MessageSchema = z.discriminatedUnion('type', [
  AgentRegisterSchema,
  AgentHeartbeatSchema,
  // ... all schemas
]);

// Direction-specific unions
export const AgentToHubSchema = z.discriminatedUnion('type', [
  AgentRegisterSchema,
  AgentHeartbeatSchema,
  AgentSessionStartedSchema,
  AgentSessionOutputSchema,
  AgentSessionEndedSchema,
  AgentRecordingUploadSchema,
  AgentQueueUpdatedSchema,
]);

export const HubToAgentSchema = z.discriminatedUnion('type', [
  HubSessionStartSchema,
  HubSessionResumeSchema,
  HubSessionKillSchema,
  HubSessionInputSchema,
  HubQueueAddSchema,
  HubQueueRemoveSchema,
  HubQueueReorderSchema,
]);

// ... HubToDashboardSchema, DashboardToHubSchema
```

### File 2: `packages/shared/src/types.ts`

```typescript
import { z } from 'zod';
import {
  AgentRegisterSchema,
  AgentHeartbeatSchema,
  // ... all schemas
  MessageSchema,
  AgentToHubSchema,
  HubToAgentSchema,
  HubToDashboardSchema,
  DashboardToHubSchema,
} from './protocol';

// ============================================================
// Inferred types from Zod schemas
// ============================================================

export type AgentRegister = z.infer<typeof AgentRegisterSchema>;
export type AgentHeartbeat = z.infer<typeof AgentHeartbeatSchema>;
// ... all message types

// Union types
export type Message = z.infer<typeof MessageSchema>;
export type AgentToHubMessage = z.infer<typeof AgentToHubSchema>;
export type HubToAgentMessage = z.infer<typeof HubToAgentSchema>;
export type HubToDashboardMessage = z.infer<typeof HubToDashboardSchema>;
export type DashboardToHubMessage = z.infer<typeof DashboardToHubSchema>;

// ============================================================
// Utility types
// ============================================================

/** Extract message type by its `type` discriminator */
export type MessageByType<T extends Message['type']> = Extract<Message, { type: T }>;

/** Extract the payload type from a message type */
export type PayloadOf<T extends Message['type']> = MessageByType<T>['payload'];

/** All known message type strings */
export type MessageType = Message['type'];

// ============================================================
// Domain types (not message-specific)
// ============================================================

export type SessionStatus = 'queued' | 'starting' | 'running' | 'paused' | 'stopping' | 'stopped' | 'failed';
export type MachineStatus = 'online' | 'offline' | 'degraded';
export type NotificationLevel = 'info' | 'warning' | 'error' | 'critical';
export type QueueTaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface Session {
  id: string;
  machineId: string;
  status: SessionStatus;
  command: string;
  pid?: number;
  startedAt?: string;
  endedAt?: string;
  exitCode?: number;
}

export interface Machine {
  id: string;
  hostname: string;
  status: MachineStatus;
  capabilities: string[];
  version: string;
  maxSessions: number;
  activeSessions: number;
  load: number;
  lastHeartbeat: string;
}

export interface QueueTask {
  id: string;
  machineId: string;
  command: string;
  priority: number;
  position: number;
  status: QueueTaskStatus;
  createdAt: string;
}
```

### File 3: `packages/shared/src/events.ts`

```typescript
import type {
  AgentToHubMessage,
  HubToAgentMessage,
  HubToDashboardMessage,
  DashboardToHubMessage,
  Message,
  MessageByType,
} from './types';

// ============================================================
// Event type constants
// ============================================================

export const AGENT_EVENTS = [
  'agent:register',
  'agent:heartbeat',
  'agent:session:started',
  'agent:session:output',
  'agent:session:ended',
  'agent:recording:upload',
  'agent:queue:updated',
] as const;

export const HUB_TO_AGENT_EVENTS = [
  'hub:session:start',
  'hub:session:resume',
  'hub:session:kill',
  'hub:session:input',
  'hub:queue:add',
  'hub:queue:remove',
  'hub:queue:reorder',
] as const;

export const HUB_TO_DASHBOARD_EVENTS = [
  'session:output',
  'session:updated',
  'machine:updated',
  'queue:updated',
  'notification',
] as const;

export const DASHBOARD_EVENTS = [
  'dashboard:session:start',
  'dashboard:session:input',
  'dashboard:session:kill',
  'dashboard:session:subscribe',
  'dashboard:session:unsubscribe',
  'dashboard:replay:request',
  'dashboard:queue:add',
  'dashboard:queue:remove',
  'dashboard:queue:reorder',
] as const;

// ============================================================
// Handler type maps
// ============================================================

/**
 * Type-safe handler map for a component.
 * Maps each message type to a handler function receiving the typed message.
 *
 * Usage:
 *   const handlers: HandlerMap<AgentToHubMessage> = {
 *     'agent:register': (msg) => { /* msg is fully typed */ },
 *     'agent:heartbeat': (msg) => { ... },
 *     ...
 *   };
 */
export type HandlerMap<M extends Message> = {
  [T in M['type']]: (message: MessageByType<T>) => void | Promise<void>;
};

/** Partial handler map — not all events need handlers */
export type PartialHandlerMap<M extends Message> = Partial<HandlerMap<M>>;

/** Hub handlers for agent messages */
export type AgentMessageHandlers = HandlerMap<AgentToHubMessage>;

/** Agent handlers for hub commands */
export type HubCommandHandlers = HandlerMap<HubToAgentMessage>;

/** Dashboard handlers for hub broadcasts */
export type DashboardEventHandlers = HandlerMap<HubToDashboardMessage>;

/** Hub handlers for dashboard requests */
export type DashboardRequestHandlers = HandlerMap<DashboardToHubMessage>;

// ============================================================
// Message dispatcher utility type
// ============================================================

/**
 * Type-safe message dispatcher.
 * Parses a raw message and routes it to the correct handler.
 */
export interface MessageDispatcher<M extends Message> {
  on<T extends M['type']>(type: T, handler: (message: MessageByType<T>) => void | Promise<void>): void;
  off<T extends M['type']>(type: T): void;
  dispatch(message: M): Promise<void>;
}

// ============================================================
// Message factory helpers (type signatures)
// ============================================================

/**
 * Creates a new message with auto-generated id and timestamp.
 * Implementation should use crypto.randomUUID() and new Date().toISOString().
 */
export type CreateMessage<T extends Message['type']> = (
  type: T,
  payload: MessageByType<T>['payload']
) => MessageByType<T>;
```

## Phase 3: VALIDATE

Cross-reference generated protocol with existing source code.

1. **Scan agent package** (`packages/agent/src/`):
   - Check if WebSocket client code exists
   - Verify it imports from shared protocol
   - List which message types it sends (should match `AgentToHub`)
   - List which message types it handles (should match `HubToAgent`)
   - Report any message types not handled

2. **Scan hub package** (`packages/hub/src/`):
   - Check WebSocket server code
   - Verify it handles all `AgentToHub` messages
   - Verify it handles all `DashboardToHub` messages
   - Verify it sends all `HubToAgent` and `HubToDashboard` messages
   - Report gaps

3. **Scan dashboard package** (`packages/dashboard/`):
   - Check WebSocket composable/client code
   - Verify it handles all `HubToDashboard` messages
   - Verify it sends all `DashboardToHub` messages
   - Report gaps

4. **Generate gap report:**
   ```
   Protocol Coverage Report
   ========================

   Agent:
     Sends: 5/7 message types implemented
     Handles: 4/7 message types implemented
     Missing sends: agent:recording:upload, agent:queue:updated
     Missing handlers: hub:queue:add, hub:queue:remove, hub:queue:reorder

   Hub:
     ... (similar)

   Dashboard:
     ... (similar)
   ```

   If packages don't exist yet, note "Package not yet created — all handlers pending."

## Phase 4: TEST

Generate comprehensive protocol tests in `packages/shared/src/__tests__/protocol.test.ts`.

```typescript
import { describe, it, expect } from 'vitest';
import { v4 as uuid } from 'uuid';
import {
  MessageSchema,
  AgentRegisterSchema,
  AgentHeartbeatSchema,
  // ... all schemas
  AgentToHubSchema,
  HubToAgentSchema,
  HubToDashboardSchema,
  DashboardToHubSchema,
} from '../protocol';

// ============================================================
// Test helpers
// ============================================================

const now = () => new Date().toISOString();
const msgBase = () => ({ id: uuid(), timestamp: now() });

// ============================================================
// Valid message parsing — every type must parse successfully
// ============================================================

describe('Protocol: Valid Messages', () => {
  it('parses agent:register', () => {
    const msg = {
      ...msgBase(),
      type: 'agent:register' as const,
      payload: {
        machineId: 'machine-1',
        hostname: 'dev-box',
        capabilities: ['pty', 'recording'],
        version: '1.0.0',
        maxSessions: 4,
        platform: 'linux',
      },
    };
    expect(AgentRegisterSchema.parse(msg)).toEqual(msg);
    expect(MessageSchema.parse(msg)).toEqual(msg);
    expect(AgentToHubSchema.parse(msg)).toEqual(msg);
  });

  // ... generate a test for EVERY message type
});

// ============================================================
// Invalid message rejection
// ============================================================

describe('Protocol: Invalid Messages', () => {
  it('rejects message without id', () => {
    const msg = {
      timestamp: now(),
      type: 'agent:register',
      payload: { machineId: 'x', hostname: 'x', capabilities: [], version: '1.0.0', maxSessions: 1, platform: 'linux' },
    };
    expect(() => AgentRegisterSchema.parse(msg)).toThrow();
  });

  it('rejects message without timestamp', () => { /* ... */ });
  it('rejects message with unknown type', () => { /* ... */ });
  it('rejects message with missing payload fields', () => { /* ... */ });
  it('rejects message with wrong payload field types', () => { /* ... */ });
  it('rejects agent message in hub-to-agent union', () => { /* ... */ });
});

// ============================================================
// Round-trip: create -> serialize -> parse -> equals
// ============================================================

describe('Protocol: Round-trip', () => {
  it('round-trips all message types through JSON', () => {
    // For each message type, create a valid message,
    // JSON.stringify it, JSON.parse it, then parse with schema.
    // Result must deeply equal the original.
  });
});

// ============================================================
// Direction-specific unions
// ============================================================

describe('Protocol: Direction Unions', () => {
  it('AgentToHub accepts only agent:* messages', () => { /* ... */ });
  it('HubToAgent accepts only hub:* messages', () => { /* ... */ });
  it('HubToDashboard accepts only broadcast messages', () => { /* ... */ });
  it('DashboardToHub accepts only dashboard:* messages', () => { /* ... */ });
});
```

**Test requirements:**
- Every message type has at least one valid-parse test
- At least 5 invalid-rejection tests covering different failure modes
- Round-trip test covers ALL message types
- Direction union tests verify type discrimination
- All tests must use actual Zod `.parse()` / `.safeParse()` — no type-only checks

## Phase 5: REPORT

Present protocol generation results:

1. **Message Inventory:**
   | Direction | Count | Types |
   |---|---|---|
   | Agent -> Hub | 7 | agent:register, agent:heartbeat, ... |
   | Hub -> Agent | 7 | hub:session:start, ... |
   | Hub -> Dashboard | 5 | session:output, ... |
   | Dashboard -> Hub | 9 | dashboard:session:start, ... |
   | **Total** | **28** | |

2. **Files Generated:**
   - `packages/shared/src/protocol.ts` — N schemas, N lines
   - `packages/shared/src/types.ts` — N types, N lines
   - `packages/shared/src/events.ts` — N constants, handler maps
   - `packages/shared/src/__tests__/protocol.test.ts` — N tests

3. **Coverage Gaps** (from Phase 3 validation)

4. **Next Steps:**
   - Run tests: `cd packages/shared && pnpm test`
   - Generate handlers: implement `MessageDispatcher` in each package
   - Suggested skill: `/sprint-dev` for protocol integration stories

## Phase Final: REGISTER

1. **Update `docs/_context/codebase-inventory.json`:**
   - Add shared package files to inventory
   - Mark protocol generation as complete
   - Record file paths and line counts

2. **Log execution:**
   - Record skill invocation, duration, output summary
   - Note any deviations from architecture doc
   - Record test count and pass/fail status
