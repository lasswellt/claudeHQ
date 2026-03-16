import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { DAL } from '../dal.js';

export async function queueRoutes(app: FastifyInstance, dal: DAL): Promise<void> {
  // List all queues across machines
  app.get('/api/queues', async () => {
    const machines = dal.listMachines();
    const result: Record<string, unknown> = {};
    for (const machine of machines) {
      result[machine.id] = dal.listQueueTasks(machine.id);
    }
    return result;
  });

  // List queue for specific machine
  app.get<{ Params: { machineId: string } }>('/api/queues/:machineId', async (req) => {
    return dal.listQueueTasks(req.params.machineId);
  });

  // Add task to queue
  const addBody = z.object({
    prompt: z.string().min(1),
    cwd: z.string().min(1),
    flags: z.array(z.string()).optional(),
    priority: z.number().optional(),
  });

  app.post<{ Params: { machineId: string } }>('/api/queues/:machineId', async (req) => {
    const body = addBody.parse(req.body);
    const id = randomUUID();

    dal.insertQueueTask({
      id,
      machineId: req.params.machineId,
      prompt: body.prompt,
      cwd: body.cwd,
      flags: body.flags,
      priority: body.priority,
    });

    return { id, ...body };
  });

  // Remove task from queue
  app.delete<{ Params: { machineId: string; taskId: string } }>(
    '/api/queues/:machineId/:taskId',
    async (req, _reply) => {
      dal.removeQueueTask(req.params.taskId);
      return { deleted: true };
    },
  );

  // Reorder queue
  const reorderBody = z.object({
    order: z.array(z.string()),
  });

  app.patch<{ Params: { machineId: string } }>('/api/queues/:machineId', async (req) => {
    const body = reorderBody.parse(req.body);
    dal.reorderQueue(req.params.machineId, body.order);
    return { reordered: true };
  });
}
