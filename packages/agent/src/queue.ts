import { EventEmitter } from 'node:events';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { z } from 'zod';
import pino from 'pino';

const log = pino({ name: 'task-queue' });

export interface QueuedTask {
  id: string;
  prompt: string;
  cwd: string;
  flags?: string[];
  priority: number;
  createdAt: number;
}

const queuedTaskSchema = z.object({
  id: z.string(),
  prompt: z.string(),
  cwd: z.string(),
  flags: z.array(z.string()).optional(),
  priority: z.number(),
  createdAt: z.number(),
});

const queuedTaskArraySchema = z.array(queuedTaskSchema);

export class TaskQueue extends EventEmitter {
  private tasks: QueuedTask[] = [];
  private readonly persistPath: string | null;

  constructor(persistPath?: string) {
    super();
    this.persistPath = persistPath ?? null;
    this.load();
  }

  get length(): number {
    return this.tasks.length;
  }

  get isEmpty(): boolean {
    return this.tasks.length === 0;
  }

  add(task: QueuedTask): void {
    this.tasks.push(task);
    this.tasks.sort((a, b) => a.priority - b.priority);
    this.persist();
    this.emit('updated', this.list());
  }

  remove(taskId: string): boolean {
    const idx = this.tasks.findIndex((t) => t.id === taskId);
    if (idx < 0) return false;
    this.tasks.splice(idx, 1);
    this.persist();
    this.emit('updated', this.list());
    return true;
  }

  pop(): QueuedTask | undefined {
    const task = this.tasks.shift();
    if (task) {
      this.persist();
      this.emit('updated', this.list());
    }
    return task;
  }

  peek(): QueuedTask | undefined {
    return this.tasks[0];
  }

  reorder(order: string[]): void {
    const taskMap = new Map(this.tasks.map((t) => [t.id, t]));
    this.tasks = order
      .map((id) => taskMap.get(id))
      .filter((t): t is QueuedTask => t !== undefined);
    this.persist();
    this.emit('updated', this.list());
  }

  list(): QueuedTask[] {
    return [...this.tasks];
  }

  private persist(): void {
    if (!this.persistPath) return;
    try {
      writeFileSync(this.persistPath, JSON.stringify(this.tasks, null, 2));
    } catch {
      // Best effort persistence
    }
  }

  private load(): void {
    if (!this.persistPath || !existsSync(this.persistPath)) return;
    try {
      const data = readFileSync(this.persistPath, 'utf-8');
      const parsed = queuedTaskArraySchema.safeParse(JSON.parse(data));
      if (parsed.success) {
        this.tasks = parsed.data;
      } else {
        log.warn({ errors: parsed.error.issues }, 'Queue persist file failed validation — starting with empty queue');
        this.tasks = [];
      }
    } catch {
      this.tasks = [];
    }
  }
}
