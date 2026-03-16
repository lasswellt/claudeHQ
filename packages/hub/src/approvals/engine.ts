import type Database from 'better-sqlite3';
import type { ApprovalPolicyRule } from '@chq/shared';

// Prepared statement cache keyed by Database instance — compiled once per db
const listRulesStmtCache = new WeakMap<Database.Database, Database.Statement>();
const countRulesStmtCache = new WeakMap<Database.Database, Database.Statement>();

function getListRulesStmt(db: Database.Database): Database.Statement {
  const cached = listRulesStmtCache.get(db);
  if (cached) return cached;
  const stmt = db.prepare('SELECT * FROM approval_policy_rules WHERE enabled = 1 ORDER BY priority ASC');
  listRulesStmtCache.set(db, stmt);
  return stmt;
}

function getCountRulesStmt(db: Database.Database): Database.Statement {
  const cached = countRulesStmtCache.get(db);
  if (cached) return cached;
  const stmt = db.prepare('SELECT COUNT(*) as c FROM approval_policy_rules');
  countRulesStmtCache.set(db, stmt);
  return stmt;
}

export interface PolicyResult {
  action: 'auto_approve' | 'auto_deny' | 'require_approval';
  ruleId: string | null;
  timeoutOverride: number | null;
}

export function evaluatePolicy(
  db: Database.Database,
  request: {
    requestType: string;
    toolName?: string;
    toolInput?: string;
    riskLevel: string;
    sessionTags?: string[];
  },
): PolicyResult {
  const rules = getListRulesStmt(db).all() as Record<string, unknown>[];

  for (const row of rules) {
    if (matchesRule(row, request)) {
      return {
        action: row.action as 'auto_approve' | 'auto_deny' | 'require_approval',
        ruleId: row.id as string,
        timeoutOverride: (row.timeout_override_seconds as number) ?? null,
      };
    }
  }

  return { action: 'require_approval', ruleId: null, timeoutOverride: null };
}

function matchesRule(
  rule: Record<string, unknown>,
  request: {
    requestType: string;
    toolName?: string;
    toolInput?: string;
    riskLevel: string;
    sessionTags?: string[];
  },
): boolean {
  // Match request type
  if (rule.match_request_type) {
    const types = JSON.parse(rule.match_request_type as string) as string[];
    if (!types.includes(request.requestType)) return false;
  }

  // Match tool name
  if (rule.match_tool_name) {
    const names = JSON.parse(rule.match_tool_name as string) as string[];
    if (!request.toolName || !names.includes(request.toolName)) return false;
  }

  // Match bash command pattern
  if (rule.match_bash_command_pattern && request.toolInput) {
    try {
      const regex = new RegExp(rule.match_bash_command_pattern as string);
      if (!regex.test(request.toolInput)) return false;
    } catch {
      return false;
    }
  } else if (rule.match_bash_command_pattern && !request.toolInput) {
    return false;
  }

  // Match risk level
  if (rule.match_risk_level) {
    const levels = JSON.parse(rule.match_risk_level as string) as string[];
    if (!levels.includes(request.riskLevel)) return false;
  }

  // Match session tags
  if (rule.match_session_tags) {
    const requiredTags = JSON.parse(rule.match_session_tags as string) as string[];
    const hasTags = request.sessionTags ?? [];
    if (!requiredTags.every((t) => hasTags.includes(t))) return false;
  }

  return true;
}

// Default rules to seed on first run
export const DEFAULT_RULES: Omit<ApprovalPolicyRule, 'created_at'>[] = [
  {
    id: 'default-read-approve',
    name: 'Auto-approve read-only tools',
    priority: 10,
    enabled: true,
    match_tool_name: ['Read', 'Glob', 'Grep', 'LS', 'View'],
    action: 'auto_approve',
  },
  {
    id: 'default-dangerous-deny',
    name: 'Auto-deny dangerous bash patterns',
    priority: 20,
    enabled: true,
    match_tool_name: ['Bash'],
    match_bash_command_pattern:
      'rm\\s+-rf\\s+/|sudo\\s+|curl\\s+.*\\|\\s*(ba)?sh|wget\\s+.*\\|\\s*(ba)?sh|chmod\\s+777|mkfs|dd\\s+if=|shutdown|reboot',
    action: 'auto_deny',
  },
  {
    id: 'default-safe-bash-approve',
    name: 'Auto-approve safe bash patterns',
    priority: 30,
    enabled: true,
    match_tool_name: ['Bash'],
    match_bash_command_pattern:
      '^(ls|cat|head|tail|wc|find|grep|rg|git\\s+(status|log|diff|branch|show)|npm\\s+test|pnpm\\s+test|node\\s|tsc|eslint|prettier|jest|vitest)',
    action: 'auto_approve',
  },
  {
    id: 'default-code-edit-approve',
    name: 'Auto-approve code file edits',
    priority: 40,
    enabled: true,
    match_tool_name: ['Write', 'Edit'],
    action: 'auto_approve',
  },
  {
    id: 'default-bash-require',
    name: 'Require approval for other bash',
    priority: 50,
    enabled: true,
    match_tool_name: ['Bash'],
    action: 'require_approval',
  },
  {
    id: 'default-catchall',
    name: 'Default: require approval',
    priority: 1000,
    enabled: true,
    action: 'require_approval',
  },
];

export function seedDefaultRules(db: Database.Database): void {
  const count = getCountRulesStmt(db).get() as { c: number };
  if (count.c > 0) return; // Already seeded

  const stmt = db.prepare(`
    INSERT INTO approval_policy_rules
    (id, name, description, enabled, priority, match_request_type, match_tool_name,
     match_bash_command_pattern, match_file_path_pattern, match_session_tags, match_risk_level,
     action, timeout_override_seconds)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const seed = db.transaction(() => {
    for (const rule of DEFAULT_RULES) {
      stmt.run(
        rule.id,
        rule.name,
        rule.description ?? null,
        rule.enabled ? 1 : 0,
        rule.priority,
        rule.match_request_type ? JSON.stringify(rule.match_request_type) : null,
        rule.match_tool_name ? JSON.stringify(rule.match_tool_name) : null,
        rule.match_bash_command_pattern ?? null,
        rule.match_file_path_pattern ?? null,
        rule.match_session_tags ? JSON.stringify(rule.match_session_tags) : null,
        rule.match_risk_level ? JSON.stringify(rule.match_risk_level) : null,
        rule.action,
        rule.timeout_override_seconds ?? null,
      );
    }
  });
  seed();
}
