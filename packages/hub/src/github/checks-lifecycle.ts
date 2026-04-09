/**
 * CAP-062 / story 016-007: GitHub Checks API lifecycle wrapper.
 *
 * Pure orchestration layer around the Octokit `checks.create` and
 * `checks.update` calls. Splits the lifecycle into two phases so
 * the hub can:
 *
 *   1. Start a check as `in_progress` the moment the agent pushes
 *      its first commit to the feature branch.
 *   2. Finish the check as `completed` with conclusion/output/
 *      annotations once the job has ended.
 *
 * The wrapper is pure — it owns no state beyond the caller-provided
 * `CheckRunClient` interface, which can be a real Octokit instance
 * in prod or a mock in tests. This is deliberately NOT imported
 * into `GitHubClient`; the route caller composes the wrapper from
 * an existing octokit instance.
 */

export type CheckConclusion =
  | 'success'
  | 'failure'
  | 'neutral'
  | 'cancelled'
  | 'timed_out'
  | 'action_required';

export interface CheckAnnotation {
  path: string;
  startLine: number;
  endLine: number;
  annotationLevel: 'notice' | 'warning' | 'failure';
  message: string;
  title?: string;
}

export interface StartCheckInput {
  owner: string;
  repo: string;
  headSha: string;
  /** Check name shown in the GitHub UI. Defaults to "Claude HQ Agent". */
  name?: string;
  detailsUrl?: string;
  externalId?: string;
}

export interface FinishCheckInput {
  checkRunId: number;
  owner: string;
  repo: string;
  conclusion: CheckConclusion;
  summary: string;
  title?: string;
  /** Full markdown body shown under the summary. */
  text?: string;
  annotations?: CheckAnnotation[];
}

export interface CheckRunClient {
  createCheckRun(req: {
    owner: string;
    repo: string;
    head_sha: string;
    name: string;
    status: 'in_progress';
    started_at: string;
    details_url?: string;
    external_id?: string;
  }): Promise<{ id: number }>;

  updateCheckRun(req: {
    owner: string;
    repo: string;
    check_run_id: number;
    status: 'completed';
    conclusion: CheckConclusion;
    completed_at: string;
    output: {
      title: string;
      summary: string;
      text?: string;
      annotations?: Array<{
        path: string;
        start_line: number;
        end_line: number;
        annotation_level: 'notice' | 'warning' | 'failure';
        message: string;
        title?: string;
      }>;
    };
  }): Promise<void>;
}

export interface ChecksLifecycle {
  start(input: StartCheckInput): Promise<{ checkRunId: number }>;
  finish(input: FinishCheckInput): Promise<void>;
}

const DEFAULT_CHECK_NAME = 'Claude HQ Agent';
/** GitHub rejects payloads with >50 annotations per call. */
const MAX_ANNOTATIONS_PER_CALL = 50;

export function createChecksLifecycle(client: CheckRunClient): ChecksLifecycle {
  return {
    async start(input: StartCheckInput): Promise<{ checkRunId: number }> {
      const { id } = await client.createCheckRun({
        owner: input.owner,
        repo: input.repo,
        head_sha: input.headSha,
        name: input.name ?? DEFAULT_CHECK_NAME,
        status: 'in_progress',
        started_at: new Date().toISOString(),
        details_url: input.detailsUrl,
        external_id: input.externalId,
      });
      return { checkRunId: id };
    },

    async finish(input: FinishCheckInput): Promise<void> {
      const annotationsPayload = (input.annotations ?? [])
        .slice(0, MAX_ANNOTATIONS_PER_CALL)
        .map((a) => ({
          path: a.path,
          start_line: a.startLine,
          end_line: a.endLine,
          annotation_level: a.annotationLevel,
          message: a.message,
          title: a.title,
        }));

      await client.updateCheckRun({
        owner: input.owner,
        repo: input.repo,
        check_run_id: input.checkRunId,
        status: 'completed',
        conclusion: input.conclusion,
        completed_at: new Date().toISOString(),
        output: {
          title: input.title ?? `Claude HQ job ${input.conclusion}`,
          summary: input.summary,
          text: input.text,
          annotations: annotationsPayload.length > 0 ? annotationsPayload : undefined,
        },
      });
    },
  };
}

/**
 * Convenience: map a hub job status to a check conclusion. Kept
 * separate so the caller can override on a per-job basis when
 * partial failures need different semantics.
 */
export function jobStatusToConclusion(
  status: string,
): CheckConclusion {
  switch (status) {
    case 'completed':
      return 'success';
    case 'failed':
      return 'failure';
    case 'cancelled':
      return 'cancelled';
    case 'timed_out':
      return 'timed_out';
    default:
      return 'neutral';
  }
}
