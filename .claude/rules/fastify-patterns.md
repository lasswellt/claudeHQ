---
globs: "packages/hub/**/*.ts"
---
# Fastify Patterns

- Register routes as async Fastify plugins: `export async function routes(app: FastifyInstance)`
- Validate request bodies with Zod: `const body = schema.parse(request.body)`
- Return proper HTTP status codes: 200 (ok), 201 (created), 400 (bad request), 404 (not found), 500 (internal)
- Use `@fastify/websocket` for WebSocket support — separate paths for agent (`/ws/agent`) and dashboard (`/ws/dashboard`)
- Structure: `server.ts` (setup), `routes/*.ts` (REST), `ws/*.ts` (WebSocket handlers)
- Use pino logger (built into Fastify) — never console.log
- Error responses: `reply.code(400).send({ error: 'message' })`
