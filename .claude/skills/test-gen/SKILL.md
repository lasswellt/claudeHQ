---
name: test-gen
description: |
  Test generation for claudeHQ packages. Analyzes code, identifies patterns,
  generates Vitest tests following existing conventions.
  Use when: "generate tests for", "add tests", "improve coverage", "test X"
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, Task, WebSearch, WebFetch, ToolSearch
model: opus
argument-hint: "<file-or-module-path>"
---

# Test Generation Skill

Generates comprehensive Vitest tests for claudeHQ packages. Follows existing test patterns, handles package-specific testing conventions, and verifies generated tests pass.

---

## Phase 0: CONTEXT

Load project context before generating tests.

1. **Read project state files** (skip any that don't exist):
   - `.claude/shared/codebase-inventory.json` — file map, module boundaries
   - `.claude/shared/test-patterns.md` — mock examples and testing conventions (if it exists)
   - `.claude/shared/registry.json` — cross-skill state

2. **Identify test framework configuration:**
   - Read `vitest.config.ts` or `vite.config.ts` at the workspace root and in each package
   - Note: test runner is Vitest, assertion library is Vitest's built-in `expect`

3. **Test file location conventions:**
   - Agent: `packages/agent/src/__tests__/*.test.ts`
   - Hub: `packages/hub/src/__tests__/*.test.ts`
   - Dashboard: `packages/dashboard/tests/*.test.ts` (or `packages/dashboard/tests/components/`, `tests/composables/`, etc.)
   - Shared: `packages/shared/src/__tests__/*.test.ts`
   - Protocol: `packages/shared/src/__tests__/protocol.test.ts` (or similar)

4. **Test categories per package:**

   | Package | Test Categories |
   |---------|----------------|
   | Agent | PTY session lifecycle, queue management (enqueue/dequeue/priority/auto-advance), recording (JSONL write/chunk/upload), WS client (connect/reconnect/message handling), CLI argument parsing, config validation, health reporting |
   | Hub | Fastify route handlers (using `app.inject()`), SQLite queries (using in-memory DB), WS relay logic, notification dispatch, recording file I/O, session state machine |
   | Dashboard | Nuxt components (with `@nuxt/test-utils` or `@vue/test-utils`), Pinia store actions/getters, composables (useWebSocket, useTerminal, useReplay, useNotifications), utility functions |
   | Shared | Zod schema validation (valid/invalid inputs, edge cases, error messages), protocol type guards, utility function correctness |

---

## Step 1: ANALYZE TARGET

Understand the code that needs tests.

1. **Identify the target:** Parse the user's request to determine:
   - Specific file(s) to test
   - Module or package to test
   - Or "everything that's untested" (broad coverage mode)

2. **Read the target code thoroughly.** For each file:
   - List all exported functions, classes, types
   - Identify public API vs internal helpers
   - Note dependencies (imports) — these will need mocking
   - Identify side effects (file I/O, network, process spawning, DB queries)
   - Note error handling paths
   - Identify edge cases from type signatures and validation logic

3. **Check existing tests:** Look for existing test files for the target. If they exist:
   - Read them to understand current coverage
   - Identify gaps (untested branches, error paths, edge cases)
   - Match the existing style and patterns

4. **Determine test type:**
   - **Unit tests:** Isolated function/class testing with mocked dependencies
   - **Integration tests:** Testing module interactions (e.g., Fastify route with real DB)
   - **Component tests:** Vue component rendering and interaction

---

## Step 2: FIND PATTERNS

Study existing tests in the same package to match conventions.

1. **Find existing test files** in the target package:
   ```
   Glob: packages/<pkg>/src/__tests__/*.test.ts
   Glob: packages/<pkg>/tests/**/*.test.ts
   ```

2. **Extract patterns from existing tests:**
   - Import style (named imports vs namespace imports)
   - `describe`/`it`/`test` nesting structure
   - Setup/teardown patterns (`beforeEach`, `afterEach`, `beforeAll`, `afterAll`)
   - Mock patterns (`vi.mock()`, `vi.fn()`, `vi.spyOn()`)
   - Assertion style (`expect().toBe()`, `expect().toEqual()`, `expect().toMatchObject()`)
   - Async test patterns (`async/await`, `.resolves`, `.rejects`)
   - Test data factory patterns (if any)

3. **Package-specific mock patterns:**

   **Agent mocks:**
   ```typescript
   // node-pty mock
   vi.mock('node-pty', () => ({
     spawn: vi.fn(() => ({
       onData: vi.fn(),
       onExit: vi.fn(),
       write: vi.fn(),
       kill: vi.fn(),
       pid: 12345,
     })),
   }));

   // ws WebSocket mock
   vi.mock('ws', () => ({
     default: vi.fn(() => ({
       on: vi.fn(),
       send: vi.fn(),
       close: vi.fn(),
       readyState: 1,
     })),
   }));
   ```

   **Hub mocks:**
   ```typescript
   // Fastify app.inject() for route testing (no mock needed, use real Fastify)
   import Fastify from 'fastify';
   const app = Fastify();
   // Register routes...
   const response = await app.inject({
     method: 'GET',
     url: '/api/sessions',
   });
   expect(response.statusCode).toBe(200);

   // In-memory SQLite for DB tests
   import Database from 'better-sqlite3';
   const db = new Database(':memory:');
   // Run migrations...
   ```

   **Dashboard mocks:**
   ```typescript
   // Vue component mount
   import { mount } from '@vue/test-utils';
   import { createTestingPinia } from '@pinia/testing';

   const wrapper = mount(Component, {
     global: {
       plugins: [createTestingPinia()],
     },
   });

   // WebSocket composable mock
   vi.mock('~/composables/useWebSocket', () => ({
     useWebSocket: () => ({
       send: vi.fn(),
       status: ref('connected'),
       data: ref(null),
     }),
   }));

   // xterm.js mock
   vi.mock('xterm', () => ({
     Terminal: vi.fn(() => ({
       open: vi.fn(),
       write: vi.fn(),
       dispose: vi.fn(),
       onData: vi.fn(),
       loadAddon: vi.fn(),
     })),
   }));
   ```

   **Shared mocks:**
   ```typescript
   // Zod schema testing (no mocks needed, test validation directly)
   import { sessionSchema } from '../types';

   expect(() => sessionSchema.parse(validData)).not.toThrow();
   expect(() => sessionSchema.parse(invalidData)).toThrow();
   ```

---

## Step 3: GENERATE TESTS

Write the test files.

1. **Structure each test file:**
   ```typescript
   import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
   // ... imports of code under test and mocks

   describe('<ModuleName>', () => {
     // Setup
     beforeEach(() => { ... });
     afterEach(() => { vi.restoreAllMocks(); });

     describe('<functionName>', () => {
       it('should <expected behavior> when <condition>', () => {
         // Arrange
         // Act
         // Assert
       });

       it('should throw <error> when <invalid condition>', () => {
         // ...
       });

       it('should handle <edge case>', () => {
         // ...
       });
     });
   });
   ```

2. **Test coverage priorities (in order):**
   1. **Happy path:** Normal successful execution with valid inputs
   2. **Error handling:** Invalid inputs, missing dependencies, network failures, DB errors
   3. **Edge cases:** Empty arrays, null/undefined, boundary values, concurrent operations
   4. **State transitions:** For stateful code (session lifecycle, queue state machine, WS connection states)
   5. **Integration points:** How modules interact (message flow, event propagation)

3. **Naming convention:** Test descriptions should read as sentences:
   - `it('should start a PTY session with the given prompt and cwd')`
   - `it('should reject sessions when max concurrent limit is reached')`
   - `it('should reconnect WebSocket with exponential backoff after disconnect')`

4. **Test data:** Use realistic but deterministic test data:
   - Session IDs: `'test-session-001'`
   - Machine IDs: `'test-machine'`
   - Timestamps: fixed values, not `Date.now()`
   - Use Zod schemas to generate valid test data where possible

5. **Assertion specificity:**
   - Prefer `toEqual` over `toBe` for objects
   - Use `toMatchObject` for partial matching
   - Use `toHaveBeenCalledWith` for mock verification
   - Assert on specific error messages/types, not just "throws"

---

## Step 4: RUN TESTS

Verify generated tests pass.

1. **Run the new tests:**
   ```bash
   npx vitest run <test-file-path>
   ```

2. **If tests fail:**
   - **Test logic error:** Fix the test (wrong assertion, incorrect mock setup)
   - **Missing mock:** Add the required mock
   - **Actual bug discovered:** Note it as a finding but fix the test to match current behavior, then report the bug separately
   - **Import/path error:** Fix the import path

3. **Run the full test suite** to ensure new tests don't interfere with existing ones:
   ```bash
   pnpm --filter @chq/<pkg> test
   ```

4. **Check for flakiness:** If any test uses timers, randomness, or async operations, verify it passes consistently. Use `vi.useFakeTimers()` for timer-dependent tests.

---

## Step 5: REPORT

Present results to the user.

1. **Tests generated:**
   - File path (absolute)
   - Number of test suites (`describe` blocks)
   - Number of test cases (`it` blocks)
   - Coverage areas: what was tested

2. **Coverage gaps identified** (if any):
   - Code paths that are difficult to test (require integration test infrastructure not yet available)
   - External dependency interactions that need more sophisticated mocking

3. **Bugs discovered** (if any):
   - Code that doesn't match its documented/expected behavior
   - Error handling paths that don't work correctly

4. **Recommendations:**
   - Additional test types needed (integration, e2e)
   - Test infrastructure improvements (shared test utilities, fixtures)

---

## Follow-up Skills

After generating tests:

1. **dashboard-qa** — if tests were generated for Dashboard components:
   > "Run `/dashboard-qa` to visually verify the components tested."

---

## Phase Final: REGISTER

Update tracking files after test generation.

1. **Log execution** in `.claude/shared/registry.json`:
   - Update `lastExecution`: `{ "skill": "test-gen", "target": "<description>", "date": "<YYYY-MM-DD>", "testsGenerated": <count>, "status": "complete" }`

2. **Register partial coverage as incomplete** if some code paths couldn't be tested:
   - Add to `.claude/shared/incompletes.json`:
     ```json
     {
       "type": "test-coverage-gap",
       "target": "<file-path>",
       "reason": "<why it couldn't be tested>",
       "suggestion": "<what's needed to test it>",
       "date": "<YYYY-MM-DD>"
     }
     ```

3. **Update codebase inventory** if new test files were created:
   - Add test file paths to `.claude/shared/codebase-inventory.json` under the appropriate package.
