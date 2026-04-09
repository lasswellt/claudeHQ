import type { FastifyInstance } from 'fastify';
import type { DAL } from '../dal.js';
import {
  type AgentSdkClient,
  type DiscoveredSession,
  mergeDiscovered,
} from '../services/agent-sdk-client.js';

/**
 * CAP-016 / story 014-006: session discovery endpoint.
 *
 * Combines hub's own `sessions` table with whatever the SDK client
 * advertises. Useful when sessions are started outside the daemon
 * (direct `claude` CLI invocations) — the dashboard can still see
 * their transcripts.
 */

export async function sessionDiscoveryRoutes(
  app: FastifyInstance,
  dal: DAL,
  sdkClient: AgentSdkClient,
): Promise<void> {
  app.get('/api/sessions/discover', async (_req, reply) => {
    // Convert hub DB rows into DiscoveredSession shape.
    const hubSessions: DiscoveredSession[] = dal.listSessions().map((s) => ({
      id: s.id,
      source: 'hub_db' as const,
      summary: s.prompt,
      startedAt: s.started_at ?? s.created_at,
      lastActivityAt: s.last_activity_at ?? s.ended_at ?? s.created_at,
    }));

    let fromSdk: DiscoveredSession[] = [];
    try {
      fromSdk = await sdkClient.listSessions();
    } catch (err) {
      app.log.warn({ err }, 'session discovery: SDK client failed');
      fromSdk = [];
    }

    const merged = mergeDiscovered(hubSessions, fromSdk);
    // Sort newest-first by lastActivityAt.
    merged.sort((a, b) => (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0));
    return reply.send(merged);
  });
}
