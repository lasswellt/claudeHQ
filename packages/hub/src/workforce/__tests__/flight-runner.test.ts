import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { initDatabase } from '../../db.js';
import {
  parseFlightCommands,
  recordFlightStart,
  recordFlightResult,
  evaluatePhaseOutcome,
  listFlightRuns,
} from '../flight-runner.js';

// E005 / stories 016-002 + 016-003: pre/post-flight runner.

let db: Database.Database;

beforeEach(() => {
  db = initDatabase(':memory:');
  db.prepare(
    `INSERT INTO machines (id, last_seen, status, max_sessions) VALUES ('m1', ?, 'online', 2)`,
  ).run(Math.floor(Date.now() / 1000));
  db.prepare(
    `INSERT INTO repos (id, url, name, default_branch, auth_method) VALUES ('r1', 'x', 'r1', 'main', 'ssh_key')`,
  ).run();
  db.prepare(
    `INSERT INTO jobs (id, repo_id, title, prompt, status) VALUES ('j1', 'r1', 't', 'p', 'running')`,
  ).run();
});

afterEach(() => {
  db.close();
});

describe('parseFlightCommands', () => {
  it('returns empty arrays when columns are null', () => {
    const result = parseFlightCommands({
      pre_flight_commands: null,
      post_flight_commands: null,
    });
    expect(result.preFlight).toEqual([]);
    expect(result.postFlight).toEqual([]);
  });

  it('parses valid JSON arrays', () => {
    const result = parseFlightCommands({
      pre_flight_commands: JSON.stringify(['npm install', 'npm run lint']),
      post_flight_commands: JSON.stringify(['npm test']),
    });
    expect(result.preFlight.map((c) => c.command)).toEqual(['npm install', 'npm run lint']);
    expect(result.postFlight.map((c) => c.command)).toEqual(['npm test']);
    expect(result.preFlight[0]?.ordinal).toBe(1);
    expect(result.preFlight[1]?.ordinal).toBe(2);
  });

  it('tolerates malformed JSON', () => {
    const result = parseFlightCommands({
      pre_flight_commands: 'not json',
      post_flight_commands: '',
    });
    expect(result.preFlight).toEqual([]);
    expect(result.postFlight).toEqual([]);
  });

  it('drops non-string entries', () => {
    const result = parseFlightCommands({
      pre_flight_commands: JSON.stringify(['ok', 42, null, 'also-ok']),
      post_flight_commands: null,
    });
    expect(result.preFlight.map((c) => c.command)).toEqual(['ok', 'also-ok']);
  });
});

describe('recordFlightStart + recordFlightResult', () => {
  it('inserts a row and later updates it with the result', () => {
    const id = recordFlightStart(db, {
      jobId: 'j1',
      phase: 'pre_flight',
      command: 'npm install',
      startedAt: 1000,
    });
    expect(id).toBeGreaterThan(0);

    recordFlightResult(db, id, {
      exitCode: 0,
      stdout: 'installed 100 packages',
      stderr: '',
      endedAt: 1030,
    });

    const row = db
      .prepare('SELECT * FROM job_flight_runs WHERE id = ?')
      .get(id) as Record<string, unknown>;
    expect(row.exit_code).toBe(0);
    expect(row.stdout).toBe('installed 100 packages');
    expect(row.ended_at).toBe(1030);
  });

  it('truncates stdout/stderr over 16KB', () => {
    const id = recordFlightStart(db, {
      jobId: 'j1',
      phase: 'pre_flight',
      command: 'noisy',
    });
    const huge = 'x'.repeat(20 * 1024);
    recordFlightResult(db, id, { exitCode: 0, stdout: huge });
    const row = db.prepare('SELECT stdout FROM job_flight_runs WHERE id = ?').get(id) as {
      stdout: string;
    };
    expect(row.stdout.length).toBeLessThan(20 * 1024);
    expect(row.stdout).toContain('truncated');
  });

  it('handles null stdout/stderr', () => {
    const id = recordFlightStart(db, {
      jobId: 'j1',
      phase: 'post_flight',
      command: 'cleanup',
    });
    recordFlightResult(db, id, { exitCode: 0 });
    const row = db
      .prepare('SELECT stdout, stderr FROM job_flight_runs WHERE id = ?')
      .get(id) as { stdout: string | null; stderr: string | null };
    expect(row.stdout).toBeNull();
    expect(row.stderr).toBeNull();
  });
});

describe('evaluatePhaseOutcome', () => {
  it('returns ok when the phase has no runs', () => {
    const result = evaluatePhaseOutcome(db, 'j1', 'pre_flight');
    expect(result.status).toBe('ok');
  });

  it('returns ok when every run exited 0', () => {
    const id1 = recordFlightStart(db, { jobId: 'j1', phase: 'pre_flight', command: 'a' });
    const id2 = recordFlightStart(db, { jobId: 'j1', phase: 'pre_flight', command: 'b' });
    recordFlightResult(db, id1, { exitCode: 0 });
    recordFlightResult(db, id2, { exitCode: 0 });

    expect(evaluatePhaseOutcome(db, 'j1', 'pre_flight').status).toBe('ok');
  });

  it('returns failed as soon as any run exited non-zero', () => {
    const id1 = recordFlightStart(db, { jobId: 'j1', phase: 'pre_flight', command: 'a' });
    const id2 = recordFlightStart(db, { jobId: 'j1', phase: 'pre_flight', command: 'b' });
    recordFlightResult(db, id1, { exitCode: 0 });
    recordFlightResult(db, id2, { exitCode: 2 });

    const result = evaluatePhaseOutcome(db, 'j1', 'pre_flight');
    expect(result.status).toBe('failed');
    expect(result.runs).toHaveLength(2);
  });

  it('returns pending when a run has no exit code yet', () => {
    const id1 = recordFlightStart(db, { jobId: 'j1', phase: 'pre_flight', command: 'a' });
    recordFlightResult(db, id1, { exitCode: 0 });
    recordFlightStart(db, { jobId: 'j1', phase: 'pre_flight', command: 'b' }); // still running

    expect(evaluatePhaseOutcome(db, 'j1', 'pre_flight').status).toBe('pending');
  });

  it('prefers failed over pending when both are present', () => {
    const id1 = recordFlightStart(db, { jobId: 'j1', phase: 'pre_flight', command: 'a' });
    recordFlightResult(db, id1, { exitCode: 1 });
    recordFlightStart(db, { jobId: 'j1', phase: 'pre_flight', command: 'b' });

    expect(evaluatePhaseOutcome(db, 'j1', 'pre_flight').status).toBe('failed');
  });

  it('scopes by phase', () => {
    const id1 = recordFlightStart(db, { jobId: 'j1', phase: 'pre_flight', command: 'a' });
    const id2 = recordFlightStart(db, { jobId: 'j1', phase: 'post_flight', command: 'b' });
    recordFlightResult(db, id1, { exitCode: 0 });
    recordFlightResult(db, id2, { exitCode: 1 });

    expect(evaluatePhaseOutcome(db, 'j1', 'pre_flight').status).toBe('ok');
    expect(evaluatePhaseOutcome(db, 'j1', 'post_flight').status).toBe('failed');
  });
});

describe('listFlightRuns', () => {
  it('groups runs by phase in insertion order', () => {
    const a = recordFlightStart(db, { jobId: 'j1', phase: 'pre_flight', command: 'install', startedAt: 1000 });
    const b = recordFlightStart(db, { jobId: 'j1', phase: 'pre_flight', command: 'lint', startedAt: 1001 });
    const c = recordFlightStart(db, { jobId: 'j1', phase: 'post_flight', command: 'test', startedAt: 2000 });
    recordFlightResult(db, a, { exitCode: 0 });
    recordFlightResult(db, b, { exitCode: 0 });
    recordFlightResult(db, c, { exitCode: 0 });

    const { preFlight, postFlight } = listFlightRuns(db, 'j1');
    expect(preFlight.map((r) => r.command)).toEqual(['install', 'lint']);
    expect(postFlight.map((r) => r.command)).toEqual(['test']);
  });
});
