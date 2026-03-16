import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { DAL } from '../dal.js';

const hookBodySchema = z.object({
  session_id: z.string().uuid(),
}).passthrough();

function checkHookToken(req: { headers: Record<string, string | string[] | undefined> }, reply: { code: (n: number) => { send: (o: unknown) => unknown } }): boolean {
  const expectedToken = process.env.CHQ_HOOK_TOKEN;
  if (!expectedToken) return true; // No token configured — allow (dev mode)

  const provided = req.headers['x-hook-token'];
  if (!provided || provided !== expectedToken) {
    reply.code(401).send({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

export async function hookRoutes(app: FastifyInstance, dal: DAL): Promise<void> {
  // Claude Code HTTP hooks POST JSON payloads to these endpoints

  app.post('/hooks/stop', async (req, reply) => {
    if (!checkHookToken(req, reply)) return;
    const payload = hookBodySchema.parse(req.body);
    const { session_id: sessionId } = payload;

    dal.insertSessionEvent(sessionId, 'stop', JSON.stringify(payload));
    app.log.info({ sessionId }, 'Stop hook received');

    return { status: 'ok' };
  });

  app.post('/hooks/pre-tool-use', async (req, reply) => {
    if (!checkHookToken(req, reply)) return;
    const payload = hookBodySchema.parse(req.body);
    const { session_id: sessionId } = payload;

    dal.insertSessionEvent(sessionId, 'pre_tool_use', JSON.stringify(payload));

    // For now, always allow — approval system comes in EPIC-016
    return { status: 'ok' };
  });

  app.post('/hooks/post-tool-use', async (req, reply) => {
    if (!checkHookToken(req, reply)) return;
    const payload = hookBodySchema.parse(req.body);
    const { session_id: sessionId } = payload;

    dal.insertSessionEvent(sessionId, 'post_tool_use', JSON.stringify(payload));

    return { status: 'ok' };
  });

  app.post('/hooks/subagent-stop', async (req, reply) => {
    if (!checkHookToken(req, reply)) return;
    const payload = hookBodySchema.parse(req.body);
    const { session_id: sessionId } = payload;

    dal.insertSessionEvent(sessionId, 'subagent_stop', JSON.stringify(payload));

    return { status: 'ok' };
  });
}
