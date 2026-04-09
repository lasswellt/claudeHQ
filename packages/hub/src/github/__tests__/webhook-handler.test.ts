import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { initDatabase } from '../../db.js';
import { parseWebhookEvent, applyWebhookEvent } from '../webhook-handler.js';

// CAP-061 / story 017-007: webhook parsing + status sync.

let db: Database.Database;

beforeEach(() => {
  db = initDatabase(':memory:');
  db.prepare(
    `INSERT INTO machines (id, last_seen, status, max_sessions) VALUES ('m1', ?, 'online', 2)`,
  ).run(Math.floor(Date.now() / 1000));
  db.prepare(
    `INSERT INTO repos (id, url, name, default_branch, auth_method) VALUES ('r1', 'git@example:r1.git', 'r1', 'main', 'ssh_key')`,
  ).run();
  db.prepare(
    `INSERT INTO jobs (id, repo_id, title, prompt, branch, status) VALUES ('j1', 'r1', 't', 'p', 'fix/thing', 'completed')`,
  ).run();
  db.prepare(
    `INSERT INTO pull_requests (id, job_id, repo_id, github_pr_number, github_pr_url, head_branch, base_branch, title)
     VALUES ('pr1', 'j1', 'r1', 42, 'https://github.com/x/r1/pull/42', 'fix/thing', 'main', 'Fix thing')`,
  ).run();
});

afterEach(() => {
  db.close();
});

describe('parseWebhookEvent', () => {
  it('ignores a non-object payload', () => {
    expect(parseWebhookEvent('pull_request', null)).toEqual({
      kind: 'ignored',
      reason: 'payload is not an object',
    });
  });

  it('ignores an unknown event name', () => {
    const result = parseWebhookEvent('deployment', {});
    expect(result).toEqual({ kind: 'ignored', reason: 'unknown event "deployment"' });
  });

  describe('pull_request events', () => {
    it('parses an open PR', () => {
      const event = parseWebhookEvent('pull_request', {
        action: 'opened',
        pull_request: { number: 42, merged: false, state: 'open' },
      });
      expect(event).toEqual({
        kind: 'pull_request',
        action: 'opened',
        number: 42,
        merged: false,
        state: 'open',
      });
    });

    it('parses a merged PR', () => {
      const event = parseWebhookEvent('pull_request', {
        action: 'closed',
        pull_request: { number: 42, merged: true, state: 'closed' },
      });
      expect(event).toMatchObject({ kind: 'pull_request', merged: true, state: 'closed' });
    });

    it('ignores when pull_request is missing', () => {
      const event = parseWebhookEvent('pull_request', { action: 'opened' });
      expect(event.kind).toBe('ignored');
    });
  });

  describe('pull_request_review events', () => {
    it('parses approved state', () => {
      const event = parseWebhookEvent('pull_request_review', {
        pull_request: { number: 42 },
        review: { state: 'approved' },
      });
      expect(event).toEqual({
        kind: 'pull_request_review',
        number: 42,
        state: 'approved',
      });
    });

    it('normalizes to lowercase', () => {
      const event = parseWebhookEvent('pull_request_review', {
        pull_request: { number: 42 },
        review: { state: 'CHANGES_REQUESTED' },
      });
      if (event.kind === 'pull_request_review') {
        expect(event.state).toBe('changes_requested');
      } else {
        throw new Error('expected pull_request_review');
      }
    });

    it('falls back to commented for unknown review states', () => {
      const event = parseWebhookEvent('pull_request_review', {
        pull_request: { number: 42 },
        review: { state: 'weird' },
      });
      if (event.kind === 'pull_request_review') {
        expect(event.state).toBe('commented');
      }
    });
  });

  describe('check_suite events', () => {
    it('parses a successful suite', () => {
      const event = parseWebhookEvent('check_suite', {
        check_suite: { head_sha: 'abc', status: 'completed', conclusion: 'success' },
      });
      expect(event).toEqual({
        kind: 'check_suite',
        headSha: 'abc',
        conclusion: 'success',
        status: 'completed',
      });
    });

    it('parses an in_progress suite with null conclusion', () => {
      const event = parseWebhookEvent('check_suite', {
        check_suite: { head_sha: 'abc', status: 'in_progress', conclusion: null },
      });
      expect(event).toMatchObject({ status: 'in_progress', conclusion: null });
    });
  });
});

describe('applyWebhookEvent', () => {
  it('marks a PR as merged', () => {
    applyWebhookEvent(db, {
      kind: 'pull_request',
      action: 'closed',
      number: 42,
      merged: true,
      state: 'closed',
    });
    const row = db
      .prepare('SELECT status FROM pull_requests WHERE github_pr_number = ?')
      .get(42) as { status: string };
    expect(row.status).toBe('merged');
  });

  it('marks a PR as closed when not merged', () => {
    applyWebhookEvent(db, {
      kind: 'pull_request',
      action: 'closed',
      number: 42,
      merged: false,
      state: 'closed',
    });
    const row = db
      .prepare('SELECT status FROM pull_requests WHERE github_pr_number = ?')
      .get(42) as { status: string };
    expect(row.status).toBe('closed');
  });

  it('updates review_status from approved review', () => {
    applyWebhookEvent(db, {
      kind: 'pull_request_review',
      number: 42,
      state: 'approved',
    });
    const row = db
      .prepare('SELECT review_status FROM pull_requests WHERE github_pr_number = ?')
      .get(42) as { review_status: string };
    expect(row.review_status).toBe('approved');
  });

  it('updates ci_status when a check_suite completes with success', () => {
    applyWebhookEvent(db, {
      kind: 'check_suite',
      headSha: 'abc',
      conclusion: 'success',
      status: 'completed',
    });
    const row = db
      .prepare('SELECT ci_status FROM pull_requests WHERE github_pr_number = ?')
      .get(42) as { ci_status: string };
    expect(row.ci_status).toBe('success');
  });

  it('maps in_progress check_suite to pending', () => {
    applyWebhookEvent(db, {
      kind: 'check_suite',
      headSha: 'abc',
      conclusion: null,
      status: 'in_progress',
    });
    const row = db
      .prepare('SELECT ci_status FROM pull_requests WHERE github_pr_number = ?')
      .get(42) as { ci_status: string };
    expect(row.ci_status).toBe('pending');
  });

  it('maps timed_out check_suite to failure', () => {
    applyWebhookEvent(db, {
      kind: 'check_suite',
      headSha: 'abc',
      conclusion: 'timed_out',
      status: 'completed',
    });
    const row = db
      .prepare('SELECT ci_status FROM pull_requests WHERE github_pr_number = ?')
      .get(42) as { ci_status: string };
    expect(row.ci_status).toBe('failure');
  });

  it('does not error when no matching PR exists', () => {
    const result = applyWebhookEvent(db, {
      kind: 'pull_request',
      action: 'closed',
      number: 9999,
      merged: true,
      state: 'closed',
    });
    expect(result.updated).toBe(0);
  });

  it('ignored events produce no updates', () => {
    const result = applyWebhookEvent(db, { kind: 'ignored', reason: 'test' });
    expect(result.updated).toBe(0);
  });
});
