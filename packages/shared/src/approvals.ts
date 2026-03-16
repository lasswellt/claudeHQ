import { z } from 'zod';

// ── Enums ────────────────────────────────────────────────────

export const approvalRequestTypeSchema = z.enum([
  'permission',
  'ask_user',
  'plan_approval',
  'mcp_elicitation',
  'mcp_auth',
]);
export type ApprovalRequestType = z.infer<typeof approvalRequestTypeSchema>;

export const approvalSourceSchema = z.enum(['hook', 'sdk_callback', 'pty_detected']);
export type ApprovalSource = z.infer<typeof approvalSourceSchema>;

export const riskLevelSchema = z.enum(['low', 'medium', 'high', 'critical']);
export type RiskLevel = z.infer<typeof riskLevelSchema>;

export const approvalStatusSchema = z.enum([
  'pending',
  'approved',
  'denied',
  'timed_out',
  'cancelled',
  'error',
]);
export type ApprovalStatus = z.infer<typeof approvalStatusSchema>;

export const timeoutActionSchema = z.enum(['deny', 'approve', 'cancel_session']);
export type TimeoutAction = z.infer<typeof timeoutActionSchema>;

// ── Approval Request ─────────────────────────────────────────

export const approvalRequestSchema = z.object({
  id: z.string(),
  session_id: z.string(),
  job_id: z.string().optional(),
  machine_id: z.string(),
  request_type: approvalRequestTypeSchema,
  source: approvalSourceSchema,
  tool_name: z.string().optional(),
  tool_input: z.string().optional(),
  prompt_text: z.string().optional(),
  prompt_options: z.string().optional(),
  terminal_context: z.string().optional(),
  risk_level: riskLevelSchema,
  status: approvalStatusSchema,
  resolved_by: z.string().optional(),
  policy_rule_id: z.string().optional(),
  response_text: z.string().optional(),
  timeout_seconds: z.number().default(300),
  timeout_action: timeoutActionSchema.default('deny'),
  timeout_at: z.number(),
  created_at: z.number(),
  resolved_at: z.number().optional(),
});
export type ApprovalRequest = z.infer<typeof approvalRequestSchema>;

// ── Approval Response ────────────────────────────────────────

export const approvalResponseSchema = z.object({
  decision: z.enum(['approve', 'deny']),
  responseText: z.string().optional(),
  rememberAsRule: z.boolean().optional(),
});
export type ApprovalResponse = z.infer<typeof approvalResponseSchema>;

// ── Policy Rule ──────────────────────────────────────────────

export const policyRuleActionSchema = z.enum([
  'auto_approve',
  'auto_deny',
  'require_approval',
]);

export const approvalPolicyRuleSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  enabled: z.boolean().default(true),
  priority: z.number().default(100),
  match_request_type: z.array(z.string()).optional(),
  match_tool_name: z.array(z.string()).optional(),
  match_bash_command_pattern: z.string().optional(),
  match_file_path_pattern: z.string().optional(),
  match_session_tags: z.array(z.string()).optional(),
  match_risk_level: z.array(z.string()).optional(),
  action: policyRuleActionSchema,
  timeout_override_seconds: z.number().optional(),
  created_at: z.number(),
});
export type ApprovalPolicyRule = z.infer<typeof approvalPolicyRuleSchema>;

// ── Protocol Messages ────────────────────────────────────────

export const agentApprovalRequestMsg = z.object({
  type: z.literal('agent:approval:request'),
  approvalId: z.string(),
  sessionId: z.string(),
  requestType: approvalRequestTypeSchema,
  toolName: z.string().optional(),
  toolInput: z.string().optional(),
  promptText: z.string().optional(),
  terminalContext: z.string().optional(),
  source: approvalSourceSchema,
});

export const hubApprovalDecisionMsg = z.object({
  type: z.literal('hub:approval:decision'),
  approvalId: z.string(),
  sessionId: z.string(),
  decision: z.enum(['approve', 'deny']),
  responseText: z.string().optional(),
});

export const approvalRequestedMsg = z.object({
  type: z.literal('approval:requested'),
  approval: approvalRequestSchema,
});

export const approvalResolvedMsg = z.object({
  type: z.literal('approval:resolved'),
  approvalId: z.string(),
  status: approvalStatusSchema,
  resolvedBy: z.string().optional(),
});

export const approvalCountMsg = z.object({
  type: z.literal('approval:count'),
  pending: z.number(),
});
