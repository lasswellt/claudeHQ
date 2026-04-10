import { describe, it, expect } from 'vitest';
import { sessionTemplateSchema, templateVariableSchema } from '../templates.js';

// ── templateVariableSchema ───────────────────────────────────

describe('templateVariableSchema', () => {
  it('should parse a minimal valid variable with defaults', () => {
    const result = templateVariableSchema.parse({
      name: 'repo_url',
      label: 'Repository URL',
    });
    expect(result.name).toBe('repo_url');
    expect(result.type).toBe('text');
    expect(result.description).toBeUndefined();
    expect(result.default).toBeUndefined();
  });

  it('should parse a fully specified variable', () => {
    const result = templateVariableSchema.parse({
      name: 'environment',
      label: 'Target Environment',
      description: 'Which environment to deploy to',
      default: 'staging',
      type: 'select',
      options: ['staging', 'production'],
    });
    expect(result.type).toBe('select');
    expect(result.options).toEqual(['staging', 'production']);
    expect(result.default).toBe('staging');
  });

  it('should accept all valid variable types', () => {
    const validTypes = ['text', 'number', 'select'];
    for (const type of validTypes) {
      const result = templateVariableSchema.safeParse({ name: 'x', label: 'X', type });
      expect(result.success).toBe(true);
    }
  });

  it('should reject an invalid variable type', () => {
    const result = templateVariableSchema.safeParse({
      name: 'x',
      label: 'X',
      type: 'checkbox',
    });
    expect(result.success).toBe(false);
  });

  it('should reject when name is missing', () => {
    const result = templateVariableSchema.safeParse({ label: 'My Var' });
    expect(result.success).toBe(false);
  });

  it('should reject when label is missing', () => {
    const result = templateVariableSchema.safeParse({ name: 'my_var' });
    expect(result.success).toBe(false);
  });
});

// ── sessionTemplateSchema ────────────────────────────────────

describe('sessionTemplateSchema', () => {
  const minimalValid = {
    id: 'tmpl-1',
    name: 'Fix a Bug',
    prompt: 'Look at the failing tests and fix the underlying bug.',
    created_at: 1710000000,
  };

  it('should parse a minimal valid template', () => {
    const result = sessionTemplateSchema.parse(minimalValid);
    expect(result.id).toBe('tmpl-1');
    expect(result.name).toBe('Fix a Bug');
    expect(result.description).toBeUndefined();
    expect(result.variables).toBeUndefined();
    expect(result.tags).toBeUndefined();
  });

  it('should parse a fully specified template', () => {
    const result = sessionTemplateSchema.parse({
      ...minimalValid,
      description: 'Diagnose and fix failing tests',
      icon: 'bug',
      cwd: '/home/user/project',
      flags: ['--dangerously-skip-permissions'],
      machine_id: 'studio-pc',
      timeout_seconds: 3600,
      max_cost_usd: 5.0,
      variables: [
        { name: 'test_suite', label: 'Test Suite', type: 'text' },
      ],
      tags: ['debugging', 'testing'],
    });
    expect(result.timeout_seconds).toBe(3600);
    expect(result.max_cost_usd).toBe(5.0);
    expect(result.variables).toHaveLength(1);
    expect(result.tags).toEqual(['debugging', 'testing']);
    expect(result.flags).toEqual(['--dangerously-skip-permissions']);
  });

  it('should parse with optional fields absent', () => {
    const result = sessionTemplateSchema.parse(minimalValid);
    expect(result.cwd).toBeUndefined();
    expect(result.machine_id).toBeUndefined();
    expect(result.timeout_seconds).toBeUndefined();
    expect(result.max_cost_usd).toBeUndefined();
    expect(result.icon).toBeUndefined();
  });

  it('should parse with an empty prompt string', () => {
    const result = sessionTemplateSchema.safeParse({ ...minimalValid, prompt: '' });
    expect(result.success).toBe(true);
  });

  it('should parse with a very long prompt', () => {
    const longPrompt = 'Describe the task in detail. '.repeat(200);
    const result = sessionTemplateSchema.safeParse({ ...minimalValid, prompt: longPrompt });
    expect(result.success).toBe(true);
  });

  it('should reject when id is missing', () => {
    const { id: _id, ...withoutId } = minimalValid;
    const result = sessionTemplateSchema.safeParse(withoutId);
    expect(result.success).toBe(false);
  });

  it('should reject when name is missing', () => {
    const { name: _name, ...withoutName } = minimalValid;
    const result = sessionTemplateSchema.safeParse(withoutName);
    expect(result.success).toBe(false);
  });

  it('should reject when prompt is missing', () => {
    const { prompt: _prompt, ...withoutPrompt } = minimalValid;
    const result = sessionTemplateSchema.safeParse(withoutPrompt);
    expect(result.success).toBe(false);
  });

  it('should reject when created_at is missing', () => {
    const { created_at: _ts, ...withoutTs } = minimalValid;
    const result = sessionTemplateSchema.safeParse(withoutTs);
    expect(result.success).toBe(false);
  });

  it('should reject when a variable in the variables array is invalid', () => {
    const result = sessionTemplateSchema.safeParse({
      ...minimalValid,
      variables: [{ name: 'bad_var' }],
    });
    expect(result.success).toBe(false);
  });

  it('should parse with an empty variables array', () => {
    const result = sessionTemplateSchema.safeParse({ ...minimalValid, variables: [] });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.variables).toEqual([]);
    }
  });

  it('should parse with an empty flags array', () => {
    const result = sessionTemplateSchema.safeParse({ ...minimalValid, flags: [] });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.flags).toEqual([]);
    }
  });

  it('should parse with an empty tags array', () => {
    const result = sessionTemplateSchema.safeParse({ ...minimalValid, tags: [] });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tags).toEqual([]);
    }
  });

  it('should reject when timeout_seconds is not a number', () => {
    const result = sessionTemplateSchema.safeParse({
      ...minimalValid,
      timeout_seconds: 'one hour',
    });
    expect(result.success).toBe(false);
  });

  it('should reject when max_cost_usd is not a number', () => {
    const result = sessionTemplateSchema.safeParse({
      ...minimalValid,
      max_cost_usd: 'five dollars',
    });
    expect(result.success).toBe(false);
  });
});
