import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type Database from 'better-sqlite3';
import { classifyRisk } from '../approvals/risk-classifier.js';
import { evaluatePolicy, seedDefaultRules } from '../approvals/engine.js';
import type { AuditLogger } from '../audit-log.js';

export async function approvalRoutes(
  app: FastifyInstance,
  db: Database.Database,
  audit: AuditLogger,
  broadcastToDashboard: (msg: unknown) => void,
): Promise<void> {
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
    // CAP-027 / story 013-003: three-way decision adds "edit" — the
    // approver modifies tool_input before approving. The edited JSON
    // is stored alongside the resolution and sent to the agent so the
    // tool runs with the reviewer's substitution.
    editedInput: z.string().optional(),
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

    // CAP-027: validate editedInput is syntactically valid JSON (the
    // tool-specific schema check happens in the UI, but we double-check
    // at the boundary so malformed payloads never reach the agent).
    if (body.editedInput !== undefined) {
      try {
        JSON.parse(body.editedInput);
      } catch (e) {
        return reply.code(400).send({
          error: 'editedInput is not valid JSON',
          detail: (e as Error).message,
        });
      }
    }

    // Persist the edited input (if provided) into response_text so the
    // existing column carries the reviewer's substitution. A dedicated
    // column would be cleaner but touches the migration chain — revisit
    // when the approvals schema next evolves.
    const persistedResponseText =
      body.editedInput ?? body.responseText ?? null;
    const status = body.decision === 'approve' ? 'approved' : 'denied';
    resolveApprovalStmt.run(status, 'user', persistedResponseText, null, req.params.id);

    // CAP-027 / story 013-004: feedback-to-session injection. When a
    // reviewer denies with a responseText, broadcast it as a synthetic
    // session:output chunk so the session viewer sees the rejection
    // reason in-stream. ANSI color makes it visually distinct.
    if (body.decision === 'deny' && body.responseText && approval.session_id) {
      const now = Date.now();
      const bracketed = `\x1b[31m[rejected by reviewer]\x1b[0m ${body.responseText}\n`;
      broadcastToDashboard({
        type: 'session:output',
        sessionId: approval.session_id as string,
        chunks: [{ ts: now, data: bracketed }],
      });
    }

    // Create policy rule if "remember" was checked
    if (body.rememberAsRule && body.decision === 'approve' && approval.tool_name) {
      const ruleId = randomUUID();
      insertRememberRuleStmt.run(
        ruleId,
        `Auto-approve ${approval.tool_name} (from approval)`,
        JSON.stringify([approval.tool_name]),
        req.params.id,
      );
      audit.append({
        action: 'approval.policy_rule_create',
        entityType: 'approval_policy_rule',
        entityId: ruleId,
        actor: 'user',
        details: { sourceApprovalId: req.params.id, toolName: approval.tool_name },
      });
    }

    audit.append({
      action: 'approval.resolve',
      entityType: 'approval',
      entityId: req.params.id,
      actor: 'user',
      details: {
        decision: body.decision,
        toolName: approval.tool_name ?? null,
        riskLevel: approval.risk_level ?? null,
      },
    });

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

    const bulkResolve = db.transaction(() => {
      let resolved = 0;
      for (const id of body.approvalIds) {
        const result = resolveApprovalStmt.run(status, 'user', null, null, id);
        if (result.changes > 0) {
          resolved++;
          audit.append({
            action: 'approval.resolve',
            entityType: 'approval',
            entityId: id,
            actor: 'user',
            details: { decision: body.decision, bulk: true },
          });
        }
      }
      return resolved;
    });

    const resolved = bulkResolve();
    return { resolved, total: body.approvalIds.length };
  });

  // ── SDK canUseTool long-poll bridge ───────────────────────
  // CAP-025 / stories 013-001 + 013-002: headless SDK sessions post
  // here when the agent's canUseTool callback fires. The hub creates
  // (or reuses, via toolUseID idempotency) an approval_requests row
  // and long-polls until a decision lands or the timeout expires.

  const getApprovalByToolUseStmt = db.prepare(
    'SELECT * FROM approval_requests WHERE session_id = ? AND tool_use_id = ? LIMIT 1',
  );
  const insertSdkApprovalStmt = db.prepare(`
    INSERT INTO approval_requests
    (id, session_id, machine_id, request_type, source, tool_name, tool_input,
     risk_level, status, timeout_seconds, timeout_action, timeout_at, tool_use_id)
    VALUES (?, ?, ?, 'permission', 'sdk_callback', ?, ?, ?, 'pending', ?, 'deny', ?, ?)
  `);

  const sdkRequestBody = z.object({
    sessionId: z.string(),
    toolUseId: z.string().min(1),
    toolName: z.string().min(1),
    toolInput: z.unknown().optional(),
    /** Optional client-requested timeout in seconds, clamped to [30, 600]. */
    timeoutSeconds: z.number().optional(),
  });

  const SDK_MIN_TIMEOUT = 30;
  const SDK_MAX_TIMEOUT = 600; // 10 min
  const SDK_POLL_INTERVAL_MS = 500;

  app.post('/api/approvals/sdk/request', async (req, reply) => {
    const parseResult = sdkRequestBody.safeParse(req.body);
    if (!parseResult.success) {
      return reply.code(400).send({ error: 'Invalid SDK approval request', details: parseResult.error.issues });
    }
    const body = parseResult.data;

    // Look up session → machine
    const session = getSessionMachineStmt.get(body.sessionId) as
      | { machine_id: string }
      | undefined;
    if (!session) return reply.code(404).send({ error: 'Session not found' });

    const timeoutSeconds = Math.max(
      SDK_MIN_TIMEOUT,
      Math.min(SDK_MAX_TIMEOUT, body.timeoutSeconds ?? 300),
    );

    // Idempotency: if a row for (sessionId, toolUseId) already
    // exists, reuse it. This is what makes agent reconnects safe —
    // the same canUseTool invocation maps to the same row.
    let approvalRow = getApprovalByToolUseStmt.get(
      body.sessionId,
      body.toolUseId,
    ) as Record<string, unknown> | undefined;

    let approvalId: string;
    if (approvalRow) {
      approvalId = approvalRow.id as string;
    } else {
      approvalId = randomUUID();
      const toolInputStr = body.toolInput !== undefined
        ? JSON.stringify(body.toolInput)
        : null;
      const riskLevel = classifyRisk('permission', body.toolName, toolInputStr ?? undefined);

      // Evaluate auto-policy first so we can short-circuit the long
      // poll entirely when a matching rule exists.
      const policyResult = evaluatePolicy(db, {
        requestType: 'permission',
        toolName: body.toolName,
        toolInput: toolInputStr ?? undefined,
        riskLevel,
      });

      if (policyResult.action === 'auto_approve') {
        // Insert as already-resolved for audit trail, return immediately.
        insertSdkApprovalStmt.run(
          approvalId,
          body.sessionId,
          session.machine_id,
          body.toolName,
          toolInputStr,
          riskLevel,
          timeoutSeconds,
          Math.floor(Date.now() / 1000) + timeoutSeconds,
          body.toolUseId,
        );
        resolveApprovalStmt.run('approved', 'policy', null, policyResult.ruleId ?? null, approvalId);
        audit.append({
          action: 'approval.auto_approve',
          entityType: 'approval',
          entityId: approvalId,
          actor: 'system',
          details: { source: 'sdk_callback', toolName: body.toolName, ruleId: policyResult.ruleId ?? null },
        });
        return { decision: 'approve', approvalId };
      }
      if (policyResult.action === 'auto_deny') {
        insertSdkApprovalStmt.run(
          approvalId,
          body.sessionId,
          session.machine_id,
          body.toolName,
          toolInputStr,
          riskLevel,
          timeoutSeconds,
          Math.floor(Date.now() / 1000) + timeoutSeconds,
          body.toolUseId,
        );
        resolveApprovalStmt.run('denied', 'policy', 'Denied by policy rule', policyResult.ruleId ?? null, approvalId);
        audit.append({
          action: 'approval.auto_deny',
          entityType: 'approval',
          entityId: approvalId,
          actor: 'system',
          details: { source: 'sdk_callback', toolName: body.toolName, ruleId: policyResult.ruleId ?? null },
        });
        return { decision: 'deny', approvalId, reason: 'Denied by policy rule' };
      }

      // Otherwise create a pending row and fan out to dashboards.
      insertSdkApprovalStmt.run(
        approvalId,
        body.sessionId,
        session.machine_id,
        body.toolName,
        toolInputStr,
        riskLevel,
        timeoutSeconds,
        Math.floor(Date.now() / 1000) + timeoutSeconds,
        body.toolUseId,
      );
      const fresh = getApprovalStmt.get(approvalId);
      broadcastToDashboard({ type: 'approval:requested', approval: fresh });
      approvalRow = fresh as Record<string, unknown>;
    }

    // Poll for resolution. Single await on a small sleep loop —
    // avoids threading an EventEmitter through the resolution path.
    const deadline = Date.now() + timeoutSeconds * 1000;
    while (Date.now() < deadline) {
      const current = getApprovalStmt.get(approvalId) as Record<string, unknown> | undefined;
      if (current && current.status !== 'pending') {
        const decision = current.status === 'approved' ? 'approve' : 'deny';
        return {
          decision,
          approvalId,
          editedInput: current.response_text ?? null,
          responseText: current.response_text ?? null,
          resolvedBy: current.resolved_by ?? null,
        };
      }
      await new Promise((r) => setTimeout(r, SDK_POLL_INTERVAL_MS));
    }

    // Timed out — apply timeout_action (default deny).
    resolveApprovalStmt.run(
      'timed_out',
      'timeout',
      'No decision within timeout window',
      null,
      approvalId,
    );
    audit.append({
      action: 'approval.timeout',
      entityType: 'approval',
      entityId: approvalId,
      actor: 'system',
      details: { toolName: body.toolName, timeoutSeconds },
    });
    return { decision: 'deny', approvalId, reason: 'Timed out' };
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

    audit.append({
      action: 'approval_policy.create',
      entityType: 'approval_policy_rule',
      entityId: id,
      actor: 'user',
      details: { name: body.name, action: body.action, priority: body.priority },
    });

    return { id, ...body };
  });

  app.delete<{ Params: { id: string } }>('/api/approval-policies/:id', async (req, reply) => {
    const result = deletePolicyRuleStmt.run(req.params.id);
    if (result.changes === 0) return reply.code(404).send({ error: 'Rule not found' });
    audit.append({
      action: 'approval_policy.delete',
      entityType: 'approval_policy_rule',
      entityId: req.params.id,
      actor: 'user',
    });
    return { deleted: true };
  });
}
