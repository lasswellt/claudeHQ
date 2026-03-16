import type { FastifyInstance } from 'fastify';
import type { DAL } from '../dal.js';

export async function hookRoutes(app: FastifyInstance, dal: DAL): Promise<void> {
  // Claude Code HTTP hooks POST JSON payloads to these endpoints

  app.post('/hooks/stop', async (req) => {
    const payload = req.body as Record<string, unknown>;
    const sessionId = payload.session_id as string | undefined;

    if (sessionId) {
      dal.insertSessionEvent(sessionId, 'stop', JSON.stringify(payload));
      app.log.info({ sessionId }, 'Stop hook received');
    }

    return { status: 'ok' };
  });

  app.post('/hooks/pre-tool-use', async (req) => {
    const payload = req.body as Record<string, unknown>;
    const sessionId = payload.session_id as string | undefined;

    if (sessionId) {
      dal.insertSessionEvent(sessionId, 'pre_tool_use', JSON.stringify(payload));
    }

    // For now, always allow — approval system comes in EPIC-016
    return { status: 'ok' };
  });

  app.post('/hooks/post-tool-use', async (req) => {
    const payload = req.body as Record<string, unknown>;
    const sessionId = payload.session_id as string | undefined;

    if (sessionId) {
      dal.insertSessionEvent(sessionId, 'post_tool_use', JSON.stringify(payload));
    }

    return { status: 'ok' };
  });

  app.post('/hooks/subagent-stop', async (req) => {
    const payload = req.body as Record<string, unknown>;
    const sessionId = payload.session_id as string | undefined;

    if (sessionId) {
      dal.insertSessionEvent(sessionId, 'subagent_stop', JSON.stringify(payload));
    }

    return { status: 'ok' };
  });
}
