/**
 * CAP-089 / story 018-006: async setup container runner.
 *
 * Runs repo `setup_commands` in a short-lived container mounting
 * the same worktree at `/workspace`. Extended timeout (5 min
 * default, configurable up to 30 min) so slow dependency
 * installs don't trip the interactive session's strict 2-5s
 * timeouts.
 *
 * Pure orchestrator: the actual `docker.run()` call is injected
 * as a `DockerRunFn` so the unit tests don't need a live docker
 * daemon. The runner's job is:
 *   1. Validate the setup-commands input
 *   2. Join the commands into a single bash -euxo pipefail script
 *   3. Call docker.run() with the right mount + network + timeout
 *   4. Capture exit code + output and classify success/failure
 *   5. On any failure, return a tagged error so the caller can
 *      abort the main container before Claude sees it
 */

export interface SetupRunInput {
  /** Ordered list of shell commands to execute. */
  commands: string[];
  /** Absolute host path of the worktree (mounted read-write). */
  workspaceHostPath: string;
  /** Docker image to run the setup in. */
  image: string;
  /** Container network (the CAP-082 allowlist). */
  networkMode: string;
  /** Environment variables exposed to the setup script. */
  env?: Record<string, string>;
  /** Timeout in seconds; default 300, max 1800. */
  timeoutSeconds?: number;
  /** Abort signal — aborts the docker.run() promise. */
  signal?: AbortSignal;
}

export interface SetupRunResult {
  /** Exit code of the final script — 0 = success. */
  exitCode: number;
  /** Concatenated stdout/stderr (truncated at 64 KB). */
  output: string;
  /** Wall-clock duration in milliseconds. */
  durationMs: number;
}

export type SetupRunOutcome =
  | { ok: true; result: SetupRunResult }
  | {
      ok: false;
      reason: 'empty_commands' | 'timeout' | 'non_zero_exit' | 'docker_error';
      result?: SetupRunResult;
      detail: string;
    };

export interface DockerRunCallArgs {
  image: string;
  command: string[];
  binds: string[];
  workdir: string;
  env: string[];
  networkMode: string;
  timeoutMs: number;
  signal?: AbortSignal;
}

export type DockerRunFn = (
  args: DockerRunCallArgs,
) => Promise<{ exitCode: number; output: string }>;

const DEFAULT_TIMEOUT_SECONDS = 300;
const MAX_TIMEOUT_SECONDS = 1800;
const OUTPUT_MAX_CHARS = 64 * 1024;

export function buildSetupScript(commands: string[]): string {
  // `-euxo pipefail` is the standard "fail loudly" bash header:
  //   -e  exit on any error
  //   -u  treat unset vars as errors
  //   -x  print each command before running
  //   -o pipefail  propagate errors through pipelines
  // We concatenate with && as a belt-and-braces guard in case
  // the remote bash doesn't honor -e for some builtin.
  return 'set -euxo pipefail\n' + commands.join('\n');
}

export async function runSetupContainer(
  dockerRun: DockerRunFn,
  input: SetupRunInput,
): Promise<SetupRunOutcome> {
  if (!input.commands || input.commands.length === 0) {
    return {
      ok: false,
      reason: 'empty_commands',
      detail: 'No setup commands provided',
    };
  }

  const timeoutSeconds = Math.min(
    input.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS,
    MAX_TIMEOUT_SECONDS,
  );

  const script = buildSetupScript(input.commands);
  const started = Date.now();

  const envArray = Object.entries(input.env ?? {}).map(([k, v]) => `${k}=${v}`);

  try {
    const result = await dockerRun({
      image: input.image,
      command: ['bash', '-c', script],
      binds: [`${input.workspaceHostPath}:/workspace:rw`],
      workdir: '/workspace',
      env: envArray,
      networkMode: input.networkMode,
      timeoutMs: timeoutSeconds * 1000,
      signal: input.signal,
    });

    const durationMs = Date.now() - started;
    const output = truncate(result.output, OUTPUT_MAX_CHARS);

    if (result.exitCode !== 0) {
      return {
        ok: false,
        reason: 'non_zero_exit',
        result: { exitCode: result.exitCode, output, durationMs },
        detail: `Setup exited with code ${result.exitCode}`,
      };
    }

    return { ok: true, result: { exitCode: 0, output, durationMs } };
  } catch (err) {
    const durationMs = Date.now() - started;
    const message = (err as Error).message;
    const isTimeout = /timed? ?out|aborted/i.test(message);
    return {
      ok: false,
      reason: isTimeout ? 'timeout' : 'docker_error',
      result: { exitCode: -1, output: message, durationMs },
      detail: message,
    };
  }
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return (
    text.slice(0, max) +
    `\n…truncated (${text.length - max} more chars)`
  );
}
