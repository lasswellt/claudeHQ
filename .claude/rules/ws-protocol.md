---
globs: "packages/shared/src/protocol.*,packages/*/src/**/*handler*,packages/*/src/**/*ws*"
---
# WebSocket Protocol Rules

- All WebSocket messages MUST use types from `packages/shared/src/protocol.ts`
- No inline message type definitions — import from `@chq/shared`
- Every message MUST have a `type` field as a string literal
- Use Zod `.parse()` on all received messages before processing
- Message handlers must be exhaustive — handle every message type or throw on unknown
- New message types must be added to the protocol file first, then to handlers
- See `.claude/shared/ws-protocol.md` for the full message type reference
