import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ContainerOrchestrator } from '../container-orchestrator.js';

const spawnBodySchema = z.object({
  repoUrl: z.string().url(),
  repoId: z.string().optional(),
  branch: z.string().optional(),
  displayName: z.string().optional(),
});

export async function agentRoutes(
  app: FastifyInstance,
  orchestrator: ContainerOrchestrator,
): Promise<void> {
  // POST /api/agents/spawn — create and start a new agent container
  app.post('/api/agents/spawn', async (request, reply) => {
    const body = spawnBodySchema.parse(request.body);

    try {
      const agent = await orchestrator.spawn({
        repoUrl: body.repoUrl,
        repoId: body.repoId,
        branch: body.branch,
        displayName: body.displayName,
      });

      return reply.code(201).send(agent);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('container limit reached')) {
        return reply.code(429).send({ error: message });
      }
      app.log.error({ err }, 'Failed to spawn agent');
      return reply.code(500).send({ error: 'Failed to spawn agent' });
    }
  });

  // GET /api/agents — list all spawned agents, optionally filtered by status
  app.get('/api/agents', async (request) => {
    const { status } = request.query as { status?: string };
    return orchestrator.list(status);
  });

  // GET /api/agents/:id — single spawned agent
  app.get('/api/agents/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const agent = orchestrator.get(id);
    if (!agent) {
      return reply.code(404).send({ error: 'Agent not found' });
    }
    return agent;
  });

  // POST /api/agents/:id/stop — stop agent container
  app.post('/api/agents/:id/stop', async (request, reply) => {
    const { id } = request.params as { id: string };
    const agent = orchestrator.get(id);
    if (!agent) {
      return reply.code(404).send({ error: 'Agent not found' });
    }

    try {
      await orchestrator.stop(id);
      return reply.code(200).send({ ok: true });
    } catch (err) {
      app.log.error({ id, err }, 'Failed to stop agent');
      return reply.code(500).send({ error: 'Failed to stop agent' });
    }
  });

  // DELETE /api/agents/:id — stop, remove container, clean up worktree
  app.delete('/api/agents/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const agent = orchestrator.get(id);
    if (!agent) {
      return reply.code(404).send({ error: 'Agent not found' });
    }

    try {
      await orchestrator.remove(id);
      return reply.code(200).send({ ok: true });
    } catch (err) {
      app.log.error({ id, err }, 'Failed to remove agent');
      return reply.code(500).send({ error: 'Failed to remove agent' });
    }
  });
}
