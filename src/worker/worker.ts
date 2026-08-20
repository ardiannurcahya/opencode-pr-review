import { AppConfig } from '../config.js';
import { JobQueue, ReviewJob } from '../queue/queue.js';
import { GitHubAuth } from '../github/auth.js';
import { GitHubClient } from '../github/client.js';
import { WorkspaceManager } from '../workspace/git.js';
import { OpenCodeReviewer } from '../reviewer/opencode.js';

export class ReviewWorker {
  private config: AppConfig;
  private githubAuth: GitHubAuth;
  private workspaceManager: WorkspaceManager;
  private reviewer: OpenCodeReviewer;
  private isRunning: boolean = false;
  private timer: NodeJS.Timeout | null = null;
  private isProcessing: boolean = false;

  constructor(config: AppConfig) {
    this.config = config;
    this.githubAuth = new GitHubAuth(
      config.github.app_id,
      config.github.private_key_path
    );
    this.workspaceManager = new WorkspaceManager(config.workspace.base_dir);
    this.reviewer = new OpenCodeReviewer(config);
  }

  start(pollIntervalMs = 3000): void {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log('[Worker] Review worker loop started.');

    const loop = async () => {
      if (!this.isRunning) return;

      if (!this.isProcessing) {
        try {
          await this.processNextJob();
        } catch (err: any) {
          console.error('[Worker] Unhandled error during job processing:', err);
        }
      }

      if (this.isRunning) {
        this.timer = setTimeout(loop, pollIntervalMs);
      }
    };

    loop();
  }

  stop(): void {
    this.isRunning = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    console.log('[Worker] Review worker stopped.');
  }

  private async processNextJob(): Promise<void> {
    const job = JobQueue.dequeueNext();
    if (!job) {
      return;
    }

    this.isProcessing = true;
    console.log(
      `\n[Worker] Picked up Job #${job.id} for ${job.repository}#${job.pr_number} (SHA: ${job.head_sha.substring(0, 7)})`
    );

    try {
      // 1. Check if superseded by a newer push on the same PR
      if (JobQueue.isSuperseded(job.id, job.repository, job.pr_number)) {
        console.log(
          `[Worker] Job #${job.id} (${job.repository}#${job.pr_number}) was superseded by a newer commit. Skipping.`
        );
        JobQueue.updateStatus(job.id, 'superseded');
        this.isProcessing = false;
        return;
      }

      // 2. Check repo config
      const repoConfig = this.config.repos[job.repository];
      if (repoConfig && repoConfig.enabled === false) {
        console.log(
          `[Worker] Repository ${job.repository} is disabled in config. Marking job #${job.id} as completed (skipped).`
        );
        JobQueue.updateStatus(job.id, 'completed', 'Repository disabled in config');
        this.isProcessing = false;
        return;
      }

      // 3. Acquire short-lived GitHub App installation token
      console.log(`[Worker] Generating GitHub Installation token for App installation ${job.installation_id}...`);
      const token = await this.githubAuth.getInstallationToken(job.installation_id);
      const [owner, repo] = job.repository.split('/');
      const githubClient = new GitHubClient(token);

      // 3.5 Post initial standby comment to inform user review is in progress
      console.log(`[Worker] Posting initial standby comment to ${job.repository}#${job.pr_number}...`);
      let standbyCommentId: number | null = null;
      try {
        standbyCommentId = await githubClient.postStandbyComment({
          owner,
          repo,
          pullNumber: job.pr_number,
        });
      } catch (err: any) {
        console.warn(`[Worker] Could not post initial standby comment: ${err.message}`);
      }

      try {
        // 4. Prepare isolated workspace (git clone/fetch)
        console.log(`[Worker] Preparing workspace for ${job.repository} PR #${job.pr_number}...`);
        const workspacePath = await this.workspaceManager.prepareWorkspace({
          repository: job.repository,
          prNumber: job.pr_number,
          headSha: job.head_sha,
          token,
        });

        // 5. Run OpenCode review engine
        console.log(`[Worker] Executing OpenCode review engine...`);
        const reviewResult = await this.reviewer.review({
          workspaceDir: workspacePath,
          repository: job.repository,
          prNumber: job.pr_number,
          headSha: job.head_sha,
          repoConfig,
        });

        console.log(
          `[Worker] OpenCode review finished with verdict: ${reviewResult.verdict} (${reviewResult.findings.length} findings)`
        );

        // 6. Post review to GitHub Pull Request
        console.log(`[Worker] Posting review comments to GitHub PR #${job.pr_number}...`);
        await githubClient.postReview({
          owner,
          repo,
          pullNumber: job.pr_number,
          commitId: job.head_sha,
          reviewResult,
          standbyCommentId,
        });

        // 7. Cleanup workspace if configured
        if (this.config.workspace.clean_after_review) {
          await this.workspaceManager.cleanupWorkspace(job.repository, job.pr_number);
        }

        // 8. Mark job as completed
        JobQueue.updateStatus(job.id, 'completed');
        console.log(`[Worker] Job #${job.id} successfully completed.`);
      } catch (innerErr: any) {
        if (standbyCommentId) {
          const sanitizedReason = String(innerErr?.message || innerErr)
            .slice(0, 300)
            .replace(/[\r\n]+/g, ' ');
          await githubClient.updateComment({
            owner,
            repo,
            commentId: standbyCommentId,
            body: `> ⚠️ **AI Code Reviewer** encountered an issue while analyzing this PR.\n> *Details*: \`${sanitizedReason}\`\n> *Please check the reviewer service logs for further diagnosis.*`,
          });
        }
        throw innerErr;
      }
    } catch (err: any) {
      console.error(`[Worker] Job #${job.id} failed:`, err);
      JobQueue.updateStatus(job.id, 'failed', err.message || String(err));
    } finally {
      this.isProcessing = false;
    }
  }
}
