import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type Database from 'better-sqlite3';
import { classifyRisk } from '../approvals/risk-classifier.js';
import { evaluatePolicy, seedDefaultRules } from '../approvals/engine.js';

export async function approvalRoutes(app: FastifyInstance, db: Database.Database): Promise<void> {
  // Seed default policy rules
  seedDefaultRules(db);

  // ── Approval Request Handling (from hooks) ────────────────

  const insertApprovalStmt = db.prepare(`
    INSERT INTO approval_requests
    (id, session_id, machine_id, request_type, source, tool_name, tool_input,
     prompt_text, terminal_context, risk_level, status, timeout_seconds, timeout_action, timeout_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const getApprovalStmt = db.prepare('SELECT * FROM approval_requests WHERE id = ?');

  const resolveApprovalStmt = db.prepare(`
    UPDATE approval_requests
    SET status = ?, resolved_by = ?, response_text = ?, policy_rule_id = ?, resolved_at = unixepoch()
    WHERE id = ? AND status = 'pending'
  `);

  const getSessionMachineStmt = db.prepare('SELECT machine_id FROM sessions WHERE id = ?');
  const listPolicyRulesStmt = db.prepare('SELECT * FROM approval_policy_rules ORDER BY priority ASC');
  const insertPolicyRuleStmt = db.prepare(`
    INSERT INTO approval_policy_rules
    (id, name, description, enabled, priority, match_tool_name, match_bash_command_pattern,
     match_risk_level, action)
    VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?)
  `);
  const insertRememberRuleStmt = db.prepare(`
    INSERT INTO approval_policy_rules
    (id, name, enabled, priority, match_tool_name, action, created_from_approval_id)
    VALUES (?, ?, 1, 45, ?, 'auto_approve', ?)
  `);
  const deletePolicyRuleStmt = db.prepare('DELETE FROM approval_policy_rules WHERE id = ?');

  // POST /hooks/permission-request — receives PermissionRequest hook
  const hookPayloadSchema = z.object({
    session_id: z.string(),
    tool_name: z.string().optional(),
    tool_input: z.unknown().optional(),
    hook_event_name: z.string().optional(),
    permission_mode: z.string().optional(),
    cwd: z.string().optional(),
  });

  app.post('/hooks/permission-request', async (req, reply) => {
    const parsed = hookPayloadSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid hook payload', details: parsed.error.issues });
    }

    const { session_id: sessionId, tool_name: toolName } = parsed.data;
    const toolInput = parsed.data.tool_input ? JSON.stringify(parsed.data.tool_input) : undefined;

    // Look up session to get machine_id
    const session = getSessionMachineStmt.get(sessionId) as
      | { machine_id: string }
      | undefined;
    if (!session) return reply.code(404).send({ error: 'Session not found' });

    const riskLevel = classifyRisk('permission', toolName, toolInput);

    // Evaluate policy
    const policyResult = evaluatePolicy(db, {
      requestType: 'permission',
      toolName,
      toolInput,
      riskLevel,
    });

    // Auto-resolve if policy says so
    if (policyResult.action === 'auto_approve') {
      return {
        hookSpecificOutput: {
          hookEventName: 'PermissionRequest',
          decision: { behavior: 'allow' },
        },
      };
    }

    if (policyResult.action === 'auto_deny') {
      return {
        hookSpecificOutput: {
          hookEventName: 'PermissionRequest',
          decision: { behavior: 'deny', message: 'Denied by policy rule' },
        },
      };
    }

    // Requires human approval — create record and wait
    const approvalId = randomUUID();
    const timeoutSeconds = policyResult.timeoutOverride ?? 300;
    const now = Math.floor(Date.now() / 1000);

    insertApprovalStmt.run(
      approvalId,
      sessionId,
      session.machine_id,
      'permission',
      'hook',
      toolName ?? null,
      toolInput ?? null,
      null,
      null,
      riskLevel,
      'pending',
      timeoutSeconds,
      'deny',
      now + timeoutSeconds,
    );

    app.log.info({ approvalId, sessionId, toolName, riskLevel }, 'Approval requested — denying pending human review');

    // Default-deny for unresolved approvals. The safe behavior is to deny
    // tool calls that require human approval until the approval system
    // implements long-poll or async decision delivery.
    // Users can configure auto_approve rules for trusted tools via the policy engine.
    return {
      hookSpecificOutput: {
        hookEventName: 'PermissionRequest',
        decision: {
          behavior: 'deny',
          message: `Requires approval (risk: ${riskLevel}). Approve via Claude HQ dashboard.`,
        },
      },
    };
  });

  // ── Approval REST API ─────────────────────────────────────

  // List approvals
  app.get<{ Querystring: { status?: string; sessionId?: string } }>(
    '/api/approvals',
    async (req) => {
      let sql = 'SELECT * FROM approval_requests WHERE 1=1';
      const params: unknown[] = [];

      if (req.query.status) {
        sql += ' AND status = ?';
        params.push(req.query.status);
      }
      if (req.query.sessionId) {
        sql += ' AND session_id = ?';
        params.push(req.query.sessionId);
      }
      sql += ' ORDER BY created_at DESC LIMIT 100';

      return db.prepare(sql).all(...params);
    },
  );

  // Get approval detail
  app.get<{ Params: { id: string } }>('/api/approvals/:id', async (req, reply) => {
    const approval = getApprovalStmt.get(req.params.id);
    if (!approval) return reply.code(404).send({ error: 'Approval not found' });
    return approval;
  });

  // Respond to approval
  const respondBody = z.object({
    decision: z.enum(['approve', 'deny']),
    responseText: z.string().optional(),
    rememberAsRule: z.boolean().optional(),
  });

  app.post<{ Params: { id: string } }>('/api/approvals/:id/respond', async (req, reply) => {
    const body = respondBody.parse(req.body);
    const approval = getApprovalStmt.get(req.params.id) as Record<string, unknown> | undefined;

    if (!approval) return reply.code(404).send({ error: 'Approval not found' });
    if (approval.status !== 'pending') {
      return reply.code(409).send({
        error: 'Approval already resolved',
        status: approval.status,
        resolvedBy: approval.resolved_by,
      });
    }

    const status = body.decision === 'approve' ? 'approved' : 'denied';
    resolveApprovalStmt.run(status, 'user', body.responseText ?? null, null, req.params.id);

    // Create policy rule if "remember" was checked
    if (body.rememberAsRule && body.decision === 'approve' && approval.tool_name) {
      const ruleId = randomUUID();
      insertRememberRuleStmt.run(
        ruleId,
        `Auto-approve ${approval.tool_name} (from approval)`,
        JSON.stringify([approval.tool_name]),
        req.params.id,
      );
    }

    app.log.info({ approvalId: req.params.id, decision: body.decision }, 'Approval resolved');
    return { status, approvalId: req.params.id };
  });

  // Bulk respond
  const bulkBody = z.object({
    approvalIds: z.array(z.string()),
    decision: z.enum(['approve', 'deny']),
  });

  app.post('/api/approvals/bulk/respond', async (req) => {
    const body = bulkBody.parse(req.body);
    const status = body.decision === 'approve' ? 'approved' : 'denied';
    let resolved = 0;

    for (const id of body.approvalIds) {
      const result = resolveApprovalStmt.run(status, 'user', null, null, id);
      if (result.changes > 0) resolved++;
    }

    return { resolved, total: body.approvalIds.length };
  });

  // ── Policy Rules API ──────────────────────────────────────

  app.get('/api/approval-policies', async () => {
    return listPolicyRulesStmt.all();
  });

  const createRuleBody = z.object({
    name: z.string(),
    description: z.string().optional(),
    priority: z.number().default(100),
    match_tool_name: z.array(z.string()).optional(),
    match_bash_command_pattern: z.string().optional(),
    match_risk_level: z.array(z.string()).optional(),
    action: z.enum(['auto_approve', 'auto_deny', 'require_approval']),
  });

  app.post('/api/approval-policies', async (req) => {
    const body = createRuleBody.parse(req.body);
    const id = randomUUID();

    insertPolicyRuleStmt.run(
      id,
      body.name,
      body.description ?? null,
      body.priority,
      body.match_tool_name ? JSON.stringify(body.match_tool_name) : null,
      body.match_bash_command_pattern ?? null,
      body.match_risk_level ? JSON.stringify(body.match_risk_level) : null,
      body.action,
    );

    return { id, ...body };
  });

  app.delete<{ Params: { id: string } }>('/api/approval-policies/:id', async (req, reply) => {
    const result = deletePolicyRuleStmt.run(req.params.id);
    if (result.changes === 0) return reply.code(404).send({ error: 'Rule not found' });
    return { deleted: true };
  });
}
