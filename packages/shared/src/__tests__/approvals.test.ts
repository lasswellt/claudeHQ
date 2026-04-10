import { describe, it, expect } from 'vitest';
import { ZodError } from 'zod';
import {
  approvalRequestTypeSchema,
  approvalSourceSchema,
  riskLevelSchema,
  approvalStatusSchema,
  timeoutActionSchema,
  approvalRequestSchema,
  approvalResponseSchema,
  approvalPolicyRuleSchema,
  agentApprovalRequestMsg,
  hubApprovalDecisionMsg,
  approvalRequestedMsg,
  approvalResolvedMsg,
  approvalCountMsg,
} from '../approvals.js';

// ── Enum schemas ─────────────────────────────────────────────

describe('approvalRequestTypeSchema', () => {
  it('should accept all valid request types', () => {
    const validTypes = ['permission', 'ask_user', 'plan_approval', 'mcp_elicitation', 'mcp_auth'];
    for (const type of validTypes) {
      expect(approvalRequestTypeSchema.parse(type)).toBe(type);
    }
  });

  it('should reject an unknown request type', () => {
    const result = approvalRequestTypeSchema.safeParse('unknown_type');
    expect(result.success).toBe(false);
  });

  it('should reject an empty string', () => {
    const result = approvalRequestTypeSchema.safeParse('');
    expect(result.success).toBe(false);
  });
});

describe('riskLevelSchema', () => {
  it('should accept all valid risk levels', () => {
    const validLevels = ['low', 'medium', 'high', 'critical'];
    for (const level of validLevels) {
      expect(riskLevelSchema.parse(level)).toBe(level);
    }
  });

  it('should reject an invalid risk level', () => {
    const result = riskLevelSchema.safeParse('severe');
    expect(result.success).toBe(false);
  });

  it('should reject a numeric value', () => {
    const result = riskLevelSchema.safeParse(1);
    expect(result.success).toBe(false);
  });
});

describe('approvalStatusSchema', () => {
  it('should accept all valid statuses', () => {
    const validStatuses = ['pending', 'approved', 'denied', 'timed_out', 'cancelled', 'error'];
    for (const status of validStatuses) {
      expect(approvalStatusSchema.parse(status)).toBe(status);
    }
  });

  it('should reject an invalid status', () => {
    const result = approvalStatusSchema.safeParse('waiting');
    expect(result.success).toBe(false);
  });
});

describe('timeoutActionSchema', () => {
  it('should accept all valid timeout actions', () => {
    const validActions = ['deny', 'approve', 'cancel_session'];
    for (const action of validActions) {
      expect(timeoutActionSchema.parse(action)).toBe(action);
    }
  });

  it('should reject an invalid timeout action', () => {
    const result = timeoutActionSchema.safeParse('ignore');
    expect(result.success).toBe(false);
  });
});

describe('approvalSourceSchema', () => {
  it('should accept all valid sources', () => {
    const validSources = ['hook', 'sdk_callback', 'pty_detected'];
    for (const source of validSources) {
      expect(approvalSourceSchema.parse(source)).toBe(source);
    }
  });

  it('should reject an invalid source', () => {
    const result = approvalSourceSchema.safeParse('manual');
    expect(result.success).toBe(false);
  });
});

// ── approvalRequestSchema ────────────────────────────────────

describe('approvalRequestSchema', () => {
  const minimalValid = {
    id: 'ap-1',
    session_id: 'sess-1',
    machine_id: 'studio-pc',
    request_type: 'permission',
    source: 'hook',
    risk_level: 'medium',
    status: 'pending',
    timeout_at: 1710000300,
    created_at: 1710000000,
  };

  it('should parse a minimal valid approval request with defaults', () => {
    const result = approvalRequestSchema.parse(minimalValid);
    expect(result.id).toBe('ap-1');
    expect(result.timeout_seconds).toBe(300);
    expect(result.timeout_action).toBe('deny');
  });

  it('should parse a fully populated approval request', () => {
    const result = approvalRequestSchema.parse({
      ...minimalValid,
      job_id: 'job-1',
      tool_name: 'Bash',
      tool_input: 'ls -la',
      prompt_text: 'Allow this command?',
      prompt_options: 'yes/no',
      terminal_context: 'some terminal output',
      risk_level: 'high',
      status: 'approved',
      resolved_by: 'user-abc',
      policy_rule_id: 'rule-1',
      response_text: 'Approved by operator',
      timeout_seconds: 120,
      timeout_action: 'approve',
      resolved_at: 1710000100,
    });
    expect(result.tool_name).toBe('Bash');
    expect(result.timeout_action).toBe('approve');
    expect(result.resolved_by).toBe('user-abc');
  });

  it('should reject when required fields are missing', () => {
    const result = approvalRequestSchema.safeParse({ id: 'ap-1' });
    expect(result.success).toBe(false);
  });

  it('should reject an invalid request_type', () => {
    const result = approvalRequestSchema.safeParse({
      ...minimalValid,
      request_type: 'unknown',
    });
    expect(result.success).toBe(false);
  });

  it('should reject an invalid risk_level', () => {
    const result = approvalRequestSchema.safeParse({
      ...minimalValid,
      risk_level: 'extreme',
    });
    expect(result.success).toBe(false);
  });

  it('should reject tool_input exceeding 10,000 characters', () => {
    const result = approvalRequestSchema.safeParse({
      ...minimalValid,
      tool_input: 'x'.repeat(10_001),
    });
    expect(result.success).toBe(false);
  });

  it('should accept tool_input at exactly 10,000 characters', () => {
    const result = approvalRequestSchema.safeParse({
      ...minimalValid,
      tool_input: 'x'.repeat(10_000),
    });
    expect(result.success).toBe(true);
  });
});

// ── approvalResponseSchema ───────────────────────────────────

describe('approvalResponseSchema', () => {
  it('should parse an approve decision', () => {
    const result = approvalResponseSchema.parse({ decision: 'approve' });
    expect(result.decision).toBe('approve');
    expect(result.rememberAsRule).toBeUndefined();
  });

  it('should parse a deny decision', () => {
    const result = approvalResponseSchema.parse({ decision: 'deny' });
    expect(result.decision).toBe('deny');
  });

  it('should parse an approve decision with responseText and rememberAsRule', () => {
    const result = approvalResponseSchema.parse({
      decision: 'approve',
      responseText: 'This is safe.',
      rememberAsRule: true,
    });
    expect(result.responseText).toBe('This is safe.');
    expect(result.rememberAsRule).toBe(true);
  });

  it('should parse a deny decision with rememberAsRule false', () => {
    const result = approvalResponseSchema.parse({
      decision: 'deny',
      responseText: 'Not allowed.',
      rememberAsRule: false,
    });
    expect(result.rememberAsRule).toBe(false);
  });

  it('should reject an invalid decision value', () => {
    const result = approvalResponseSchema.safeParse({ decision: 'abstain' });
    expect(result.success).toBe(false);
  });

  it('should reject a missing decision field', () => {
    const result = approvalResponseSchema.safeParse({ responseText: 'ok' });
    expect(result.success).toBe(false);
  });
});

// ── approvalPolicyRuleSchema ─────────────────────────────────

describe('approvalPolicyRuleSchema', () => {
  const minimalValid = {
    id: 'rule-1',
    name: 'Allow read-only commands',
    action: 'auto_approve',
    created_at: 1710000000,
  };

  it('should parse a minimal valid policy rule with defaults', () => {
    const result = approvalPolicyRuleSchema.parse(minimalValid);
    expect(result.enabled).toBe(true);
    expect(result.priority).toBe(100);
  });

  it('should parse a fully specified policy rule', () => {
    const result = approvalPolicyRuleSchema.parse({
      ...minimalValid,
      description: 'Allows ls and cat commands',
      enabled: false,
      priority: 50,
      match_request_type: ['permission', 'ask_user'],
      match_tool_name: ['Bash', 'Read'],
      match_bash_command_pattern: '^(ls|cat)\\s',
      match_file_path_pattern: '^/home/',
      match_session_tags: ['readonly'],
      match_risk_level: ['low', 'medium'],
      action: 'auto_deny',
      timeout_override_seconds: 60,
    });
    expect(result.enabled).toBe(false);
    expect(result.match_request_type).toEqual(['permission', 'ask_user']);
    expect(result.match_risk_level).toEqual(['low', 'medium']);
  });

  it('should reject an invalid match_request_type value', () => {
    const result = approvalPolicyRuleSchema.safeParse({
      ...minimalValid,
      match_request_type: ['permission', 'not_a_valid_type'],
    });
    expect(result.success).toBe(false);
  });

  it('should reject an invalid match_risk_level value', () => {
    const result = approvalPolicyRuleSchema.safeParse({
      ...minimalValid,
      match_risk_level: ['low', 'extreme'],
    });
    expect(result.success).toBe(false);
  });

  it('should reject an invalid action', () => {
    const result = approvalPolicyRuleSchema.safeParse({
      ...minimalValid,
      action: 'skip',
    });
    expect(result.success).toBe(false);
  });

  it('should accept all valid action values', () => {
    const validActions = ['auto_approve', 'auto_deny', 'require_approval'];
    for (const action of validActions) {
      const result = approvalPolicyRuleSchema.safeParse({ ...minimalValid, action });
      expect(result.success).toBe(true);
    }
  });

  it('should reject when required fields are missing', () => {
    const result = approvalPolicyRuleSchema.safeParse({ name: 'My Rule' });
    expect(result.success).toBe(false);
  });
});

// ── Protocol message schemas ─────────────────────────────────

describe('agentApprovalRequestMsg', () => {
  it('should parse a valid agent approval request message', () => {
    const msg = agentApprovalRequestMsg.parse({
      type: 'agent:approval:request',
      approvalId: 'ap-1',
      sessionId: 'sess-1',
      requestType: 'permission',
      toolName: 'Bash',
      toolInput: 'rm -rf /tmp/test',
      source: 'hook',
    });
    expect(msg.type).toBe('agent:approval:request');
    expect(msg.requestType).toBe('permission');
  });

  it('should parse without optional fields', () => {
    const msg = agentApprovalRequestMsg.parse({
      type: 'agent:approval:request',
      approvalId: 'ap-2',
      sessionId: 'sess-2',
      requestType: 'ask_user',
      source: 'sdk_callback',
    });
    expect(msg.toolName).toBeUndefined();
    expect(msg.promptText).toBeUndefined();
  });

  it('should reject an invalid requestType', () => {
    const result = agentApprovalRequestMsg.safeParse({
      type: 'agent:approval:request',
      approvalId: 'ap-1',
      sessionId: 'sess-1',
      requestType: 'not_valid',
      source: 'hook',
    });
    expect(result.success).toBe(false);
  });

  it('should reject a wrong type literal', () => {
    const result = agentApprovalRequestMsg.safeParse({
      type: 'agent:approval:wrong',
      approvalId: 'ap-1',
      sessionId: 'sess-1',
      requestType: 'permission',
      source: 'hook',
    });
    expect(result.success).toBe(false);
  });

  it('should reject when required fields are missing', () => {
    const result = agentApprovalRequestMsg.safeParse({
      type: 'agent:approval:request',
    });
    expect(result.success).toBe(false);
  });
});

describe('hubApprovalDecisionMsg', () => {
  it('should parse an approve decision message', () => {
    const msg = hubApprovalDecisionMsg.parse({
      type: 'hub:approval:decision',
      approvalId: 'ap-1',
      sessionId: 'sess-1',
      decision: 'approve',
    });
    expect(msg.type).toBe('hub:approval:decision');
    expect(msg.decision).toBe('approve');
    expect(msg.responseText).toBeUndefined();
  });

  it('should parse a deny decision message with responseText', () => {
    const msg = hubApprovalDecisionMsg.parse({
      type: 'hub:approval:decision',
      approvalId: 'ap-1',
      sessionId: 'sess-1',
      decision: 'deny',
      responseText: 'Not permitted',
    });
    expect(msg.decision).toBe('deny');
    expect(msg.responseText).toBe('Not permitted');
  });

  it('should reject an invalid decision value', () => {
    const result = hubApprovalDecisionMsg.safeParse({
      type: 'hub:approval:decision',
      approvalId: 'ap-1',
      sessionId: 'sess-1',
      decision: 'abstain',
    });
    expect(result.success).toBe(false);
  });

  it('should reject when approvalId or sessionId is missing', () => {
    const result = hubApprovalDecisionMsg.safeParse({
      type: 'hub:approval:decision',
      decision: 'approve',
    });
    expect(result.success).toBe(false);
  });
});

describe('approvalRequestedMsg', () => {
  it('should parse a valid approval:requested message', () => {
    const msg = approvalRequestedMsg.parse({
      type: 'approval:requested',
      approval: {
        id: 'ap-1',
        session_id: 'sess-1',
        machine_id: 'studio-pc',
        request_type: 'permission',
        source: 'hook',
        risk_level: 'medium',
        status: 'pending',
        timeout_at: 1710000300,
        created_at: 1710000000,
      },
    });
    expect(msg.type).toBe('approval:requested');
    expect(msg.approval.id).toBe('ap-1');
    expect(msg.approval.timeout_seconds).toBe(300);
  });

  it('should reject when the nested approval is invalid', () => {
    const result = approvalRequestedMsg.safeParse({
      type: 'approval:requested',
      approval: { id: 'ap-1' },
    });
    expect(result.success).toBe(false);
  });

  it('should reject when the approval field is missing', () => {
    const result = approvalRequestedMsg.safeParse({ type: 'approval:requested' });
    expect(result.success).toBe(false);
  });

  it('should reject a wrong type literal', () => {
    const result = approvalRequestedMsg.safeParse({
      type: 'approval:created',
      approval: {
        id: 'ap-1',
        session_id: 'sess-1',
        machine_id: 'studio-pc',
        request_type: 'permission',
        source: 'hook',
        risk_level: 'medium',
        status: 'pending',
        timeout_at: 1710000300,
        created_at: 1710000000,
      },
    });
    expect(result.success).toBe(false);
  });
});

describe('approvalResolvedMsg', () => {
  it('should parse a valid approval:resolved message', () => {
    const msg = approvalResolvedMsg.parse({
      type: 'approval:resolved',
      approvalId: 'ap-1',
      status: 'approved',
    });
    expect(msg.type).toBe('approval:resolved');
    expect(msg.approvalId).toBe('ap-1');
    expect(msg.resolvedBy).toBeUndefined();
  });

  it('should parse with optional resolvedBy', () => {
    const msg = approvalResolvedMsg.parse({
      type: 'approval:resolved',
      approvalId: 'ap-1',
      status: 'denied',
      resolvedBy: 'user-abc',
    });
    expect(msg.resolvedBy).toBe('user-abc');
  });

  it('should accept all valid status values', () => {
    const validStatuses = ['pending', 'approved', 'denied', 'timed_out', 'cancelled', 'error'];
    for (const status of validStatuses) {
      const result = approvalResolvedMsg.safeParse({
        type: 'approval:resolved',
        approvalId: 'ap-1',
        status,
      });
      expect(result.success).toBe(true);
    }
  });

  it('should reject an invalid status', () => {
    const result = approvalResolvedMsg.safeParse({
      type: 'approval:resolved',
      approvalId: 'ap-1',
      status: 'skipped',
    });
    expect(result.success).toBe(false);
  });

  it('should reject when required fields are missing', () => {
    const result = approvalResolvedMsg.safeParse({ type: 'approval:resolved' });
    expect(result.success).toBe(false);
  });
});

describe('approvalCountMsg', () => {
  it('should parse a valid approval:count message', () => {
    const msg = approvalCountMsg.parse({ type: 'approval:count', pending: 5 });
    expect(msg.type).toBe('approval:count');
    expect(msg.pending).toBe(5);
  });

  it('should parse with zero pending', () => {
    const msg = approvalCountMsg.parse({ type: 'approval:count', pending: 0 });
    expect(msg.pending).toBe(0);
  });

  it('should reject when pending is missing', () => {
    const result = approvalCountMsg.safeParse({ type: 'approval:count' });
    expect(result.success).toBe(false);
  });

  it('should reject when pending is not a number', () => {
    const result = approvalCountMsg.safeParse({ type: 'approval:count', pending: 'three' });
    expect(result.success).toBe(false);
  });

  it('should reject a wrong type literal', () => {
    const result = approvalCountMsg.safeParse({ type: 'approval:total', pending: 1 });
    expect(result.success).toBe(false);
  });
});
