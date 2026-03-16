# WebSocket Protocol Reference

All messages are JSON with a `type` field. Agent and dashboard connections use
separate WebSocket paths on the Hub (`/ws/agent` and `/ws/dashboard`).

Zod schemas live in `packages/shared/src/protocol.ts`. TypeScript types are
inferred from schemas. All message handlers MUST validate with `.parse()`.

---

## Agent → Hub Messages

### agent:register (on connect)
```typescript
{ type: "agent:register", machineId: string, version: string, maxSessions: number, os: string }
```

### agent:heartbeat (every 30s)
```typescript
{ type: "agent:heartbeat", machineId: string, activeSessions: number, cpuPercent: number, memPercent: number }
```

### agent:session:started
```typescript
{ type: "agent:session:started", sessionId: string, machineId: string, prompt: string, cwd: string, pid: number }
```

### agent:session:output (batched chunks)
```typescript
{ type: "agent:session:output", sessionId: string, chunks: Array<{ ts: number, data: string }> }
```

### agent:session:ended
```typescript
{ type: "agent:session:ended", sessionId: string, exitCode: number, claudeSessionId: string | null }
```

### agent:recording:upload (batched)
```typescript
{ type: "agent:recording:upload", sessionId: string, chunks: Array<{ ts: number, data: string }>, final: boolean }
```

### agent:queue:updated
```typescript
{ type: "agent:queue:updated", machineId: string, queue: Array<QueueTask> }
```

---

## Hub → Agent Messages

### hub:session:start
```typescript
{ type: "hub:session:start", sessionId: string, prompt: string, cwd: string, flags: string[] }
```

### hub:session:resume
```typescript
{ type: "hub:session:resume", sessionId: string, prompt: string, claudeSessionId: string, cwd: string }
```

### hub:session:kill
```typescript
{ type: "hub:session:kill", sessionId: string }
```

### hub:session:input
```typescript
{ type: "hub:session:input", sessionId: string, input: string }
```

### hub:queue:add
```typescript
{ type: "hub:queue:add", task: QueueTask }
```

### hub:queue:remove
```typescript
{ type: "hub:queue:remove", taskId: string }
```

### hub:queue:reorder
```typescript
{ type: "hub:queue:reorder", order: string[] }
```

---

## Hub → Dashboard Messages

### session:output (real-time, per subscription)
```typescript
{ type: "session:output", sessionId: string, chunks: Array<{ ts: number, data: string }> }
```

### session:updated
```typescript
{ type: "session:updated", session: SessionRecord }
```

### machine:updated
```typescript
{ type: "machine:updated", machine: MachineRecord }
```

### queue:updated
```typescript
{ type: "queue:updated", machineId: string, queue: Array<QueueTask> }
```

### notification
```typescript
{ type: "notification", notification: NotificationRecord }
```

---

## Shared Types

```typescript
interface QueueTask {
  id: string;
  machineId: string;
  prompt: string;
  cwd: string;
  flags?: string[];
  priority: number;
  position: number;
  createdAt: number;
}

interface SessionRecord {
  id: string;
  machineId: string;
  prompt: string;
  cwd: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  pid?: number;
  exitCode?: number;
  claudeSessionId?: string;
  parentSessionId?: string;
  startedAt?: number;
  endedAt?: number;
}

interface MachineRecord {
  id: string;
  displayName: string;
  status: 'online' | 'offline';
  lastSeen: number;
  maxSessions: number;
  activeSessions: number;
  meta?: { version: string; os: string };
}

interface NotificationRecord {
  id: string;
  sessionId?: string;
  type: 'session_completed' | 'session_failed' | 'session_stalled' | 'queue_empty' | 'agent_offline' | 'input_needed';
  payload: Record<string, unknown>;
  sentAt: number;
}
```
