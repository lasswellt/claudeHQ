import { Octokit } from 'octokit';
import { createAppAuth } from '@octokit/auth-app';
import type Database from 'better-sqlite3';
import type { FastifyBaseLogger } from 'fastify';

export interface GitHubConfig {
  authMethod: 'github_app' | 'pat' | 'none';
  appId?: string;
  privateKey?: string;
  installationId?: string;
  patToken?: string;
  webhookSecret?: string;
}

export class GitHubClient {
  private octokit: Octokit | null = null;
  private readonly db: Database.Database;
  private readonly logger: FastifyBaseLogger;
  // Prepared statements compiled once at construction time
  private readonly getConfigStmt: Database.Statement;
  private readonly upsertConfigStmt: Database.Statement;

  constructor(db: Database.Database, logger: FastifyBaseLogger) {
    this.db = db;
    this.logger = logger;
    this.getConfigStmt = db.prepare("SELECT * FROM github_config WHERE id = 'default'");
    this.upsertConfigStmt = db.prepare(`
      INSERT INTO github_config (id, app_id, private_key, client_id, client_secret, webhook_secret, installation_id, slug, auth_method, pat_token, updated_at)
      VALUES ('default', ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
      ON CONFLICT(id) DO UPDATE SET
        app_id = excluded.app_id, private_key = excluded.private_key,
        client_id = excluded.client_id, client_secret = excluded.client_secret,
        webhook_secret = excluded.webhook_secret, installation_id = excluded.installation_id,
        slug = excluded.slug, auth_method = excluded.auth_method, pat_token = excluded.pat_token,
        updated_at = unixepoch()
    `);
  }

  async initialize(): Promise<boolean> {
    const config = this.getConfig();
    if (!config || config.authMethod === 'none') return false;

    try {
      if (config.authMethod === 'github_app' && config.appId && config.privateKey && config.installationId) {
        this.octokit = new Octokit({
          authStrategy: createAppAuth,
          auth: {
            appId: config.appId,
            privateKey: config.privateKey,
            installationId: parseInt(config.installationId, 10),
          },
        });
      } else if (config.authMethod === 'pat' && config.patToken) {
        this.octokit = new Octokit({ auth: config.patToken });
      }

      if (this.octokit) {
        await this.octokit.rest.meta.root();
        this.logger.info('GitHub client initialized');
        return true;
      }
    } catch (err) {
      this.logger.error({ err }, 'Failed to initialize GitHub client');
    }
    return false;
  }

  get isConfigured(): boolean {
    return this.octokit !== null;
  }

  getConfig(): GitHubConfig | null {
    const row = this.getConfigStmt.get() as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      authMethod: (row.auth_method as string) as GitHubConfig['authMethod'],
      appId: row.app_id as string | undefined,
      privateKey: row.private_key as string | undefined,
      installationId: row.installation_id as string | undefined,
      patToken: row.pat_token as string | undefined,
    };
  }

  saveConfig(config: GitHubConfig & { slug?: string; clientId?: string; clientSecret?: string; webhookSecret?: string }): void {
    this.upsertConfigStmt.run(
      config.appId ?? null, config.privateKey ?? null,
      config.clientId ?? null, config.clientSecret ?? null,
      config.webhookSecret ?? null, config.installationId ?? null,
      config.slug ?? null, config.authMethod, config.patToken ?? null,
    );
  }

  async createPullRequest(params: {
    owner: string;
    repo: string;
    head: string;
    base: string;
    title: string;
    body: string;
    labels?: string[];
  }): Promise<{ number: number; url: string; additions: number; deletions: number; changedFiles: number } | null> {
    if (!this.octokit) return null;

    try {
      const { data: pr } = await this.octokit.rest.pulls.create({
        owner: params.owner,
        repo: params.repo,
        head: params.head,
        base: params.base,
        title: params.title,
        body: params.body,
      });

      if (params.labels?.length) {
        await this.octokit.rest.issues.addLabels({
          owner: params.owner,
          repo: params.repo,
          issue_number: pr.number,
          labels: params.labels,
        });
      }

      return {
        number: pr.number,
        url: pr.html_url,
        additions: pr.additions,
        deletions: pr.deletions,
        changedFiles: pr.changed_files,
      };
    } catch (err) {
      this.logger.error({ err, params }, 'Failed to create PR');
      return null;
    }
  }

  async createCheckRun(params: {
    owner: string;
    repo: string;
    headSha: string;
    name: string;
    status: 'queued' | 'in_progress' | 'completed';
    conclusion?: 'success' | 'failure' | 'neutral';
    title: string;
    summary: string;
  }): Promise<number | null> {
    if (!this.octokit) return null;

    try {
      const { data } = await this.octokit.rest.checks.create({
        owner: params.owner,
        repo: params.repo,
        head_sha: params.headSha,
        name: params.name,
        status: params.status,
        conclusion: params.conclusion,
        output: { title: params.title, summary: params.summary },
      });
      return data.id;
    } catch (err) {
      this.logger.error({ err }, 'Failed to create check run');
      return null;
    }
  }

  async commentOnIssue(owner: string, repo: string, issueNumber: number, body: string): Promise<void> {
    if (!this.octokit) return;
    try {
      await this.octokit.rest.issues.createComment({ owner, repo, issue_number: issueNumber, body });
    } catch (err) {
      this.logger.error({ err }, 'Failed to comment on issue');
    }
  }
}
