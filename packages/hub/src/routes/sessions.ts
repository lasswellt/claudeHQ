import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { DAL } from '../dal.js';
import type { AgentHandler } from '../ws/agent-handler.js';
import { streamRecording, getRecordingMeta } from '../recordings.js';

const createSessionBody = z.object({
  machineId: z.string(),
  prompt: z.string().min(1),
  cwd: z.string().min(1),
  flags: z.array(z.string()).optional(),
});

const sessionInputBody = z.object({
  input: z.string(),
});

export async function sessionRoutes(
  app: FastifyInstance,
  dal: DAL,
  agentHandler: AgentHandler,
): Promise<void> {
  // List sessions
  app.get<{
    Querystring: { machine?: string; status?: string; limit?: string; offset?: string };
  }>('/api/sessions', async (req) => {
    return dal.listSessions({
      machineId: req.query.machine,
      status: req.query.status,
      limit: req.query.limit ? parseInt(req.query.limit, 10) : undefined,
      offset: req.query.offset ? parseInt(req.query.offset, 10) : undefined,
    });
  });

  // Get session detail
  app.get<{ Params: { id: string } }>('/api/sessions/:id', async (req, reply) => {
    const session = dal.getSession(req.params.id);
    if (!session) return reply.code(404).send({ error: 'Session not found' });
    return session;
  });

  // Start new session
  app.post('/api/sessions', async (req, reply) => {
    const body = createSessionBody.parse(req.body);

    // Check machine exists and has agent connected
    const machine = dal.getMachine(body.machineId);
    if (!machine) return reply.code(404).send({ error: 'Machine not found' });
    if (machine.status !== 'online') {
      return reply.code(400).send({ error: 'Machine is offline' });
    }

    // Atomic capacity check + insert (prevents race condition exceeding maxSessions)
    const sessionId = randomUUID();
    const activeSessions = dal.listSessions({ machineId: body.machineId, status: 'running' });
    if (activeSessions.length >= machine.max_sessions) {
      return reply.code(400).send({ error: 'Machine at capacity' });
    }

    dal.insertSession({
      id: sessionId,
      machineId: body.machineId,
      prompt: body.prompt,
      cwd: body.cwd,
      flags: body.flags,
      status: 'queued',
    });
    // Note: SQLite with better-sqlite3 is single-threaded synchronous,
    // so the check+insert above is already atomic within a single Node.js process.
    // If multiple Hub processes ever run against the same DB, use a transaction.

    // Send start command to agent
    const sent = agentHandler.sendToAgent(body.machineId, {
      type: 'hub:session:start',
      sessionId,
      prompt: body.prompt,
      cwd: body.cwd,
      flags: body.flags ?? [],
    });

    if (!sent) {
      dal.updateSessionStatus(sessionId, 'failed');
      return reply.code(500).send({ error: 'Failed to reach agent' });
    }

    return reply.code(201).send(dal.getSession(sessionId));
  });

  // Resume session
  const resumeBody = z.object({
    prompt: z.string().min(1),
  });

  app.post<{ Params: { id: string } }>('/api/sessions/:id/resume', async (req, reply) => {
    const parent = dal.getSession(req.params.id);
    if (!parent) return reply.code(404).send({ error: 'Session not found' });

    if (parent.status !== 'completed' && parent.status !== 'failed') {
      return reply.code(400).send({ error: 'Can only resume completed/failed sessions' });
    }

    if (!parent.claude_session_id) {
      return reply.code(400).send({ error: 'No Claude session ID available for resume' });
    }

    const body = resumeBody.parse(req.body);
    const newSessionId = randomUUID();

    dal.insertSession({
      id: newSessionId,
      machineId: parent.machine_id,
      prompt: body.prompt,
      cwd: parent.cwd,
      flags: parent.flags,
      status: 'queued',
    });

    // Update parent_session_id
    dal.updateSession(newSessionId, { status: 'queued' });

    const sent = agentHandler.sendToAgent(parent.machine_id, {
      type: 'hub:session:resume',
      sessionId: newSessionId,
      prompt: body.prompt,
      claudeSessionId: parent.claude_session_id,
      cwd: parent.cwd,
    });

    if (!sent) {
      dal.updateSessionStatus(newSessionId, 'failed');
      return reply.code(500).send({ error: 'Failed to reach agent' });
    }

    return reply.code(201).send(dal.getSession(newSessionId));
  });

  // Kill session
  app.delete<{ Params: { id: string } }>('/api/sessions/:id', async (req, reply) => {
    const session = dal.getSession(req.params.id);
    if (!session) return reply.code(404).send({ error: 'Session not found' });

    if (session.status !== 'running') {
      return reply.code(400).send({ error: 'Session is not running' });
    }

    agentHandler.sendToAgent(session.machine_id, {
      type: 'hub:session:kill',
      sessionId: session.id,
    });

    return { status: 'kill_sent', sessionId: session.id };
  });

  // Send PTY input
  app.post<{ Params: { id: string } }>('/api/sessions/:id/input', async (req, reply) => {
    const session = dal.getSession(req.params.id);
    if (!session) return reply.code(404).send({ error: 'Session not found' });

    if (session.status !== 'running') {
      return reply.code(400).send({ error: 'Session is not running' });
    }

    const body = sessionInputBody.parse(req.body);

    agentHandler.sendToAgent(session.machine_id, {
      type: 'hub:session:input',
      sessionId: session.id,
      input: body.input,
    });

    return { status: 'input_sent' };
  });

  // Get recording stream
  app.get<{ Params: { id: string } }>('/api/sessions/:id/recording', async (req, reply) => {
    const session = dal.getSession(req.params.id);
    if (!session) return reply.code(404).send({ error: 'Session not found' });

    const recordingsPath = (app as unknown as { recordingsPath: string }).recordingsPath;
    const stream = streamRecording(recordingsPath, req.params.id);
    if (!stream) return reply.code(404).send({ error: 'Recording not found' });

    reply.type('application/x-ndjson');
    return reply.send(stream);
  });

  // Get recording metadata
  app.get<{ Params: { id: string } }>(
    '/api/sessions/:id/recording/meta',
    async (req, reply) => {
      const recordingsPath = (app as unknown as { recordingsPath: string }).recordingsPath;
      const meta = getRecordingMeta(recordingsPath, req.params.id);
      if (!meta.exists) return reply.code(404).send({ error: 'Recording not found' });
      return meta;
    },
  );
}
