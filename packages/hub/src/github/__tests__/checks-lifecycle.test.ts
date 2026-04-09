import { describe, it, expect, vi } from 'vitest';
import {
  createChecksLifecycle,
  jobStatusToConclusion,
  type CheckRunClient,
} from '../checks-lifecycle.js';

// CAP-062 / story 016-007: GitHub Checks lifecycle wrapper.

function makeMockClient(): { client: CheckRunClient; create: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> } {
  const create = vi.fn().mockResolvedValue({ id: 42 });
  const update = vi.fn().mockResolvedValue(undefined);
  return {
    client: { createCheckRun: create, updateCheckRun: update },
    create,
    update,
  };
}

describe('createChecksLifecycle.start', () => {
  it('creates an in_progress check with the default name', async () => {
    const { client, create } = makeMockClient();
    const lifecycle = createChecksLifecycle(client);

    const result = await lifecycle.start({
      owner: 'acme',
      repo: 'widgets',
      headSha: 'abc123',
    });

    expect(result.checkRunId).toBe(42);
    expect(create).toHaveBeenCalledOnce();
    const req = create.mock.calls[0]?.[0];
    expect(req.name).toBe('Claude HQ Agent');
    expect(req.status).toBe('in_progress');
    expect(req.head_sha).toBe('abc123');
    expect(req.started_at).toMatch(/^\d{4}-\d{2}-\d{2}T/); // ISO timestamp
  });

  it('passes through a custom check name and metadata', async () => {
    const { client, create } = makeMockClient();
    const lifecycle = createChecksLifecycle(client);

    await lifecycle.start({
      owner: 'acme',
      repo: 'widgets',
      headSha: 'abc',
      name: 'Custom Check',
      detailsUrl: 'https://claude.example/jobs/j1',
      externalId: 'job:j1',
    });

    const req = create.mock.calls[0]?.[0];
    expect(req.name).toBe('Custom Check');
    expect(req.details_url).toBe('https://claude.example/jobs/j1');
    expect(req.external_id).toBe('job:j1');
  });
});

describe('createChecksLifecycle.finish', () => {
  it('updates the check to completed with the given conclusion', async () => {
    const { client, update } = makeMockClient();
    const lifecycle = createChecksLifecycle(client);

    await lifecycle.finish({
      checkRunId: 42,
      owner: 'acme',
      repo: 'widgets',
      conclusion: 'success',
      summary: 'All tests passed',
    });

    expect(update).toHaveBeenCalledOnce();
    const req = update.mock.calls[0]?.[0];
    expect(req.check_run_id).toBe(42);
    expect(req.status).toBe('completed');
    expect(req.conclusion).toBe('success');
    expect(req.output.summary).toBe('All tests passed');
    expect(req.output.title).toBe('Claude HQ job success');
  });

  it('honors an explicit title', async () => {
    const { client, update } = makeMockClient();
    const lifecycle = createChecksLifecycle(client);

    await lifecycle.finish({
      checkRunId: 1,
      owner: 'o',
      repo: 'r',
      conclusion: 'failure',
      summary: 'x',
      title: 'Build broken',
    });

    expect(update.mock.calls[0]?.[0].output.title).toBe('Build broken');
  });

  it('omits annotations when the list is empty', async () => {
    const { client, update } = makeMockClient();
    const lifecycle = createChecksLifecycle(client);

    await lifecycle.finish({
      checkRunId: 1,
      owner: 'o',
      repo: 'r',
      conclusion: 'success',
      summary: 'ok',
      annotations: [],
    });

    expect(update.mock.calls[0]?.[0].output.annotations).toBeUndefined();
  });

  it('maps annotation camelCase → snake_case for the Octokit shape', async () => {
    const { client, update } = makeMockClient();
    const lifecycle = createChecksLifecycle(client);

    await lifecycle.finish({
      checkRunId: 1,
      owner: 'o',
      repo: 'r',
      conclusion: 'failure',
      summary: 'test failure',
      annotations: [
        {
          path: 'src/index.ts',
          startLine: 10,
          endLine: 12,
          annotationLevel: 'failure',
          message: 'Expected ok, got error',
          title: 'Assertion failed',
        },
      ],
    });

    const annotations = update.mock.calls[0]?.[0].output.annotations;
    expect(annotations).toHaveLength(1);
    expect(annotations[0]).toEqual({
      path: 'src/index.ts',
      start_line: 10,
      end_line: 12,
      annotation_level: 'failure',
      message: 'Expected ok, got error',
      title: 'Assertion failed',
    });
  });

  it('caps annotations at 50 per call', async () => {
    const { client, update } = makeMockClient();
    const lifecycle = createChecksLifecycle(client);

    const annotations = Array.from({ length: 120 }, (_, i) => ({
      path: 'a.ts',
      startLine: i,
      endLine: i,
      annotationLevel: 'warning' as const,
      message: `warn ${i}`,
    }));

    await lifecycle.finish({
      checkRunId: 1,
      owner: 'o',
      repo: 'r',
      conclusion: 'neutral',
      summary: 's',
      annotations,
    });

    expect(update.mock.calls[0]?.[0].output.annotations).toHaveLength(50);
  });
});

describe('jobStatusToConclusion', () => {
  it.each([
    ['completed', 'success'],
    ['failed', 'failure'],
    ['cancelled', 'cancelled'],
    ['timed_out', 'timed_out'],
    ['pending', 'neutral'],
    ['running', 'neutral'],
    ['something_else', 'neutral'],
  ])('%s → %s', (status, expected) => {
    expect(jobStatusToConclusion(status)).toBe(expected);
  });
});
