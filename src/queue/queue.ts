import { getDatabase } from './db.js';

export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'superseded';

export interface ReviewJob {
  id: number;
  repository: string;
  pr_number: number;
  head_sha: string;
  base_branch: string;
  clone_url: string;
  installation_id: number;
  status: JobStatus;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface EnqueueJobInput {
  repository: string;
  pr_number: number;
  head_sha: string;
  base_branch: string;
  clone_url: string;
  installation_id: number;
}

export class JobQueue {
  /**
   * Enqueue a new review job
   */
  static enqueue(input: EnqueueJobInput): number {
    const db = getDatabase();
    const insertStmt = db.prepare(`
      INSERT INTO review_jobs (
        repository,
        pr_number,
        head_sha,
        base_branch,
        clone_url,
        installation_id,
        status,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'queued', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `);

    const result = insertStmt.run(
      input.repository,
      input.pr_number,
      input.head_sha,
      input.base_branch,
      input.clone_url,
      input.installation_id
    );

    return Number(result.lastInsertRowid);
  }

  /**
   * Fetch the next available queued job and mark it as running
   */
  static dequeueNext(): ReviewJob | null {
    const db = getDatabase();

    const findStmt = db.prepare(`
      SELECT * FROM review_jobs
      WHERE status = 'queued'
      ORDER BY id ASC
      LIMIT 1
    `);

    const job = findStmt.get() as unknown as ReviewJob | undefined;
    if (!job) {
      return null;
    }

    const updateStmt = db.prepare(`
      UPDATE review_jobs
      SET status = 'running', updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'queued'
    `);

    const result = updateStmt.run(job.id);
    if (result.changes === 0) {
      // Race condition with another worker
      return null;
    }

    job.status = 'running';
    return job;
  }

  /**
   * Check if this job has been superseded by a newer commit on the same PR.
   * If a newer job exists in the queue (or has already been queued),
   * this job can be safely skipped to save LLM compute.
   */
  static isSuperseded(jobId: number, repository: string, prNumber: number): boolean {
    const db = getDatabase();
    const checkStmt = db.prepare(`
      SELECT id FROM review_jobs
      WHERE repository = ?
        AND pr_number = ?
        AND id > ?
      LIMIT 1
    `);

    const newerJob = checkStmt.get(repository, prNumber, jobId);
    return !!newerJob;
  }

  /**
   * Update the status of a job
   */
  static updateStatus(id: number, status: JobStatus, errorMessage: string | null = null): void {
    const db = getDatabase();
    const updateStmt = db.prepare(`
      UPDATE review_jobs
      SET status = ?, error_message = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);

    updateStmt.run(status, errorMessage, id);
  }

  /**
   * List recent jobs
   */
  static listRecentJobs(limit = 20): ReviewJob[] {
    const db = getDatabase();
    const listStmt = db.prepare(`
      SELECT * FROM review_jobs
      ORDER BY id DESC
      LIMIT ?
    `);

    return (listStmt.all(limit) as unknown) as ReviewJob[];
  }
}
