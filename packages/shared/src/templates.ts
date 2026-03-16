import { z } from 'zod';

export const templateVariableSchema = z.object({
  name: z.string(),
  label: z.string(),
  description: z.string().optional(),
  default: z.string().optional(),
  type: z.enum(['text', 'number', 'select']).default('text'),
  options: z.array(z.string()).optional(),
});
export type TemplateVariable = z.infer<typeof templateVariableSchema>;

export const sessionTemplateSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  icon: z.string().optional(),
  prompt: z.string(),
  cwd: z.string().optional(),
  flags: z.array(z.string()).optional(),
  machine_id: z.string().optional(),
  timeout_seconds: z.number().optional(),
  max_cost_usd: z.number().optional(),
  variables: z.array(templateVariableSchema).optional(),
  tags: z.array(z.string()).optional(),
  created_at: z.number(),
});
export type SessionTemplate = z.infer<typeof sessionTemplateSchema>;
