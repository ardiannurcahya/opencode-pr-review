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
  private activeJobsCount: number = 0;
  private maxConcurrency: number;
  private runningPrs: Set<string> = new Set<string>();

  constructor(config: AppConfig) {
    this.config = config;
    this.maxConcurrency = Math.max(1, config.worker?.concurrency || 2);
    this.githubAuth = new GitHubAuth(
      config.github.app_id,
      config.github.private_key_path
    );
    this.workspaceManager = new WorkspaceManager(config.workspace.base_dir);
    this.reviewer = new OpenCodeReviewer(config);
  }

  start(pollIntervalMs?: number): void {
    if (this.isRunning) return;
    this.isRunning = true;
    const interval = pollIntervalMs || this.config.worker?.poll_interval_ms || 3000;
    console.log(
      `[Worker] Review worker loop started (Concurrency: ${this.maxConcurrency}, Interval: ${interval}ms).`
    );

    const loop = async () => {
      if (!this.isRunning) return;

      try {
        await this.dispatchAvailableJobs();
      } catch (err: any) {
        console.error('[Worker] Unhandled error during job dispatching:', err);
      }

      if (this.isRunning) {
        this.timer = setTimeout(loop, interval);
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

  private async dispatchAvailableJobs(): Promise<void> {
    while (this.activeJobsCount < this.maxConcurrency && this.isRunning) {
      const job = JobQueue.dequeueNext();
      if (!job) {
        break;
      }

      const prKey = `${job.repository}#${job.pr_number}`;
      if (this.runningPrs.has(prKey)) {
        // A job for this specific PR is already currently running.
        // Check if this queued job is already superseded
        if (JobQueue.isSuperseded(job.id, job.repository, job.pr_number)) {
          console.log(
            `[Worker] Job #${job.id} (${prKey}) was superseded by a newer commit. Skipping.`
          );
          JobQueue.updateStatus(job.id, 'superseded');
          continue;
        }

        // Re-queue the job so it can be picked up after current PR review finishes
        JobQueue.updateStatus(job.id, 'queued');
        break;
      }

      this.activeJobsCount++;
      this.runningPrs.add(prKey);

      // Run async job in background
      this.processJob(job)
        .catch((err) => {
          console.error(`[Worker] Unexpected error in job #${job.id}:`, err);
        })
        .finally(() => {
          this.activeJobsCount--;
          this.runningPrs.delete(prKey);
        });
    }
  }

  private async processJob(job: ReviewJob): Promise<void> {
    console.log(
      `\n[Worker] Picked up Job #${job.id} for ${job.repository}#${job.pr_number} (SHA: ${job.head_sha.substring(0, 7)}) [Active: ${this.activeJobsCount}/${this.maxConcurrency}]`
    );

    try {
      // 1. Check if superseded by a newer push on the same PR
      if (JobQueue.isSuperseded(job.id, job.repository, job.pr_number)) {
        console.log(
          `[Worker] Job #${job.id} (${job.repository}#${job.pr_number}) was superseded by a newer commit. Skipping.`
        );
        JobQueue.updateStatus(job.id, 'superseded');
        return;
      }

      // 2. Check repo config
      const repoConfig = this.config.repos[job.repository];
      if (repoConfig && repoConfig.enabled === false) {
        console.log(
          `[Worker] Repository ${job.repository} is disabled in config. Marking job #${job.id} as completed (skipped).`
        );
        JobQueue.updateStatus(job.id, 'completed', 'Repository disabled in config');
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

      const targetBaseBranch = repoConfig?.base_branch || job.base_branch || 'main';

      try {
        // 4. Prepare isolated workspace (git clone/fetch)
        console.log(`[Worker] Preparing workspace for ${job.repository} PR #${job.pr_number} (Base: ${targetBaseBranch})...`);
        const workspacePath = await this.workspaceManager.prepareWorkspace({
          repository: job.repository,
          prNumber: job.pr_number,
          headSha: job.head_sha,
          baseBranch: targetBaseBranch,
          token,
        });

        // 5. Run OpenCode review engine
        console.log(`[Worker] Executing OpenCode review engine...`);
        const reviewResult = await this.reviewer.review({
          workspaceDir: workspacePath,
          repository: job.repository,
          prNumber: job.pr_number,
          headSha: job.head_sha,
          baseBranch: targetBaseBranch,
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
          await githubClient.updateComment({
            owner,
            repo,
            commentId: standbyCommentId,
            body: `> ⚠️ **AI Code Reviewer** encountered an unexpected error while analyzing this Pull Request. The error details have been logged for internal investigation.`,
          });
        }
        throw innerErr;
      }
    } catch (err: any) {
      console.error(`[Worker] Job #${job.id} failed:`, err);
      JobQueue.updateStatus(job.id, 'failed', err.message || String(err));
    }
  }
}
