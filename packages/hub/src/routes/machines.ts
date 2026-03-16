import type { FastifyInstance } from 'fastify';
import type { DAL } from '../dal.js';

export async function machineRoutes(app: FastifyInstance, dal: DAL): Promise<void> {
  app.get('/api/machines', async () => {
    return dal.listMachines();
  });

  app.get<{ Params: { id: string } }>('/api/machines/:id', async (req, reply) => {
    const machine = dal.getMachine(req.params.id);
    if (!machine) return reply.code(404).send({ error: 'Machine not found' });

    const sessions = dal.listSessions({ machineId: req.params.id });
    return { ...machine, sessions };
  });
}
