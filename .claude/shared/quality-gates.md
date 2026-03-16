# Quality Gates

Comprehensive checklist for code quality review. Used by sprint-review, review command, and reviewer agent.

## Code Quality

- [ ] No `any` types (use `unknown` with type guards if needed)
- [ ] No `@ts-ignore` or `@ts-expect-error` without explanation
- [ ] No unused imports or variables
- [ ] No console.log in production code (use pino logger)
- [ ] Functions have explicit return types
- [ ] Async functions properly await or return promises
- [ ] Error boundaries around async operations

## Security Review

- [ ] No hardcoded API keys, secrets, or credentials
- [ ] PTY input sanitized — no raw user input passed to pty.write() without validation
- [ ] SQLite queries use prepared statements (NEVER string interpolation)
- [ ] WebSocket messages validated with Zod schemas before processing
- [ ] No eval(), new Function(), or innerHTML with user content
- [ ] Recording scrub patterns applied before streaming/storing sensitive output
- [ ] Tailscale ACL verified for network boundary
- [ ] No PII in log output

## Architecture Patterns

- [ ] Zod schemas in `packages/shared/src/` (single source of truth)
- [ ] TypeScript types inferred from Zod schemas (not duplicated)
- [ ] Fastify routes use schema validation
- [ ] Nuxt pages use `definePageMeta`
- [ ] Pinia stores use setup syntax: `defineStore('name', () => {...})`
- [ ] Vue components use `<script setup lang="ts">`
- [ ] Composables return `{ data, loading, error }` shape
- [ ] WebSocket messages use shared protocol types (never inline definitions)
- [ ] Import boundaries: packages/* → shared only (no cross-package imports)

## Testing

- [ ] New functions have corresponding tests
- [ ] Tests follow AAA pattern (Arrange, Act, Assert)
- [ ] Tests use `describe`/`it` with "should X when Y" naming
- [ ] Mocks are properly typed
- [ ] Edge cases covered (empty input, null, boundaries)
- [ ] WebSocket message handlers tested with valid and invalid payloads
