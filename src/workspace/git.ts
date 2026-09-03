import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export class WorkspaceManager {
  private baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = path.isAbsolute(baseDir)
      ? baseDir
      : path.resolve(process.cwd(), baseDir);

    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
  }

  getWorkspacePath(repository: string, prNumber: number): string {
    return path.join(this.baseDir, repository, `pr-${prNumber}`);
  }

  /**
   * Clone or fetch the PR head commit into an isolated workspace directory
   */
  async prepareWorkspace(params: {
    repository: string;
    prNumber: number;
    headSha: string;
    baseBranch?: string;
    token: string;
  }): Promise<string> {
    const { repository, prNumber, headSha, baseBranch = 'main', token } = params;
    const workspacePath = this.getWorkspacePath(repository, prNumber);

    if (!fs.existsSync(workspacePath)) {
      fs.mkdirSync(workspacePath, { recursive: true });
    }

    const authCloneUrl = `https://x-access-token:${token}@github.com/${repository}.git`;
    const gitDir = path.join(workspacePath, '.git');

    if (!fs.existsSync(gitDir)) {
      // Fresh clone
      await execFileAsync('git', ['clone', authCloneUrl, '.'], {
        cwd: workspacePath,
      });
    } else {
      // Update origin remote url in case token changed
      await execFileAsync(
        'git',
        ['remote', 'set-url', 'origin', authCloneUrl],
        { cwd: workspacePath }
      );
    }

    // Fetch PR head branch
    await execFileAsync(
      'git',
      ['fetch', 'origin', `pull/${prNumber}/head`, '--force'],
      { cwd: workspacePath }
    );

    await execFileAsync(
      'git',
      ['checkout', '-B', `pr-${prNumber}`, 'FETCH_HEAD'],
      { cwd: workspacePath }
    );

    // Ensure target base branch is fetched from origin for diff comparison
    try {
      await execFileAsync('git', ['fetch', 'origin', baseBranch], {
        cwd: workspacePath,
      });
    } catch (err: any) {
      console.warn(
        `[WorkspaceManager] Failed to fetch base branch '${baseBranch}': ${err.message}`
      );
    }

    await execFileAsync('git', ['clean', '-fd'], {
      cwd: workspacePath,
    });

    return workspacePath;
  }

  /**
   * Check if PR branch has merge conflicts against target base branch
   */
  async checkMergeConflict(
    workspacePath: string,
    baseBranch = 'main'
  ): Promise<{ hasConflict: boolean; conflictedFiles: string[] }> {
    try {
      await execFileAsync(
        'git',
        ['merge', '--no-commit', '--no-ff', `origin/${baseBranch}`],
        { cwd: workspacePath }
      );
      try {
        await execFileAsync('git', ['merge', '--abort'], { cwd: workspacePath });
      } catch {}
      return { hasConflict: false, conflictedFiles: [] };
    } catch {
      const conflictedFiles: string[] = [];
      try {
        const { stdout } = await execFileAsync(
          'git',
          ['status', '--porcelain'],
          { cwd: workspacePath }
        );
        for (const line of stdout.split(/\r?\n/)) {
          if (
            line.startsWith('UU ') ||
            line.startsWith('AA ') ||
            line.startsWith('UD ') ||
            line.startsWith('DU ') ||
            line.startsWith('DD ') ||
            line.startsWith('AU ') ||
            line.startsWith('UA ')
          ) {
            conflictedFiles.push(line.slice(3).trim());
          }
        }
      } catch {}

      try {
        await execFileAsync('git', ['merge', '--abort'], { cwd: workspacePath });
      } catch {}

      return { hasConflict: true, conflictedFiles };
    }
  }

  /**
   * Optional cleanup of workspace directory after review
   */
  async cleanupWorkspace(repository: string, prNumber: number): Promise<void> {
    const workspacePath = this.getWorkspacePath(repository, prNumber);
    if (fs.existsSync(workspacePath)) {
      await fs.promises.rm(workspacePath, { recursive: true, force: true });
    }
  }
}
