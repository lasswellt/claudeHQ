# Test Patterns for claudeHQ

## Framework

Vitest for all packages. @nuxt/test-utils for dashboard component tests.

## Test File Location

| Package | Test Location |
|---------|--------------|
| `packages/agent/` | `packages/agent/src/__tests__/*.test.ts` |
| `packages/hub/` | `packages/hub/src/__tests__/*.test.ts` |
| `packages/dashboard/` | `packages/dashboard/tests/*.test.ts` |
| `packages/shared/` | `packages/shared/src/__tests__/*.test.ts` |

## Mock Patterns

### node-pty (Agent tests)

```typescript
vi.mock('node-pty', () => ({
  spawn: vi.fn(() => ({
    onData: vi.fn(),
    onExit: vi.fn(),
    write: vi.fn(),
    kill: vi.fn(),
    pid: 12345,
  })),
}));
```

### WebSocket (Agent + Hub tests)

```typescript
vi.mock('ws', () => ({
  WebSocket: vi.fn().mockImplementation(() => ({
    on: vi.fn(),
    send: vi.fn(),
    close: vi.fn(),
    readyState: 1,
  })),
  WebSocketServer: vi.fn().mockImplementation(() => ({
    on: vi.fn(),
    clients: new Set(),
  })),
}));
```

### better-sqlite3 (Hub tests)

```typescript
vi.mock('better-sqlite3', () => ({
  default: vi.fn(() => ({
    prepare: vi.fn(() => ({
      run: vi.fn(),
      get: vi.fn(),
      all: vi.fn(),
    })),
    exec: vi.fn(),
    close: vi.fn(),
  })),
}));
```

### xterm.js (Dashboard tests)

```typescript
vi.mock('xterm', () => ({
  Terminal: vi.fn().mockImplementation(() => ({
    write: vi.fn(),
    open: vi.fn(),
    dispose: vi.fn(),
    onData: vi.fn(),
    loadAddon: vi.fn(),
  })),
}));
```

## Naming Convention

Use "should X when Y" format:

```typescript
it('should start PTY session when slot available', () => {});
it('should queue task when all slots occupied', () => {});
it('should reconnect WebSocket when connection drops', () => {});
```

## AAA Pattern

Every test follows Arrange, Act, Assert:

```typescript
it('should relay output to subscribed dashboards', () => {
  // Arrange
  const hub = createTestHub();
  const dashboardWs = createMockWebSocket();
  hub.subscribeDashboard('session-1', dashboardWs);

  // Act
  hub.handleAgentOutput({ sessionId: 'session-1', chunks: [{ ts: 0, data: 'hello' }] });

  // Assert
  expect(dashboardWs.send).toHaveBeenCalledWith(
    expect.stringContaining('"type":"session:output"')
  );
});
```
