import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { parseReviewResult, ReviewResult } from './parser.js';
import type { AppConfig, RepoConfig } from '../config.js';

export class OpenCodeReviewer {
  private config: AppConfig;

  constructor(config: AppConfig) {
    this.config = config;
  }

  /**
   * Resolve appropriate prompt template based on repository and configuration
   */
  private resolvePromptTemplate(repository: string, repoConfig?: RepoConfig): string {
    // 1. Explicit custom prompt file in config
    if (repoConfig?.prompt_file) {
      const explicitPath = path.isAbsolute(repoConfig.prompt_file)
        ? repoConfig.prompt_file
        : path.resolve(process.cwd(), repoConfig.prompt_file);

      if (fs.existsSync(explicitPath)) {
        return fs.readFileSync(explicitPath, 'utf8');
      }
    }

    // 2. Direct repository name match in prompts directory (e.g. prompts/my-repo.md)
    const repoName = repository.split('/').pop() || repository;
    const repoPromptPath = path.resolve(process.cwd(), 'prompts', `${repoName}.md`);
    if (fs.existsSync(repoPromptPath)) {
      return fs.readFileSync(repoPromptPath, 'utf8');
    }

    // 3. Default universal review prompt (prompts/review.md)
    const defaultPath = path.resolve(process.cwd(), 'prompts', 'review.md');
    if (fs.existsSync(defaultPath)) {
      return fs.readFileSync(defaultPath, 'utf8');
    }

    // 4. Emergency fallback template with strict JSON schema
    return `You are a senior code reviewer. Review the changes in this PR for bugs, security vulnerabilities, performance regressions, and concurrency issues.
Do not comment on subjective formatting or style.
Return ONLY a valid JSON object matching:
{
  "summary": "Summary of findings",
  "verdict": "APPROVE | REQUEST_CHANGES | COMMENT",
  "findings": [
    {
      "file_path": "path/to/file.ext",
      "line_number": 1,
      "severity": "CRITICAL | WARNING | INFO",
      "comment": "Actionable issue description and recommendation"
    }
  ]
}`;
  }

  /**
   * Run OpenCode review on a workspace
   */
  async review(params: {
    workspaceDir: string;
    repository: string;
    prNumber: number;
    headSha: string;
    repoConfig?: RepoConfig;
  }): Promise<ReviewResult> {
    const { workspaceDir, repository, prNumber, repoConfig } = params;

    const baseBranch = repoConfig?.base_branch || 'main';
    const model = repoConfig?.model || this.config.opencode.default_model;
    const customPrompt = repoConfig?.custom_prompt || '';
    const basePrompt = this.resolvePromptTemplate(repository, repoConfig);

    let prompt = `${basePrompt}\n\n`;
    prompt += `### Target PR Information:\n`;
    prompt += `- Repository: ${repository}\n`;
    prompt += `- PR Number: #${prNumber}\n`;
    prompt += `- Base Branch: origin/${baseBranch}\n\n`;

    if (customPrompt) {
      prompt += `### Additional Repository-Specific Instructions:\n${customPrompt}\n\n`;
    }

    prompt += `Please review the diff against origin/${baseBranch} and output your review findings now.`;

    const agent = repoConfig?.agent || this.config.opencode.agent || 'reviewer';
    const args: string[] = ['run'];

    if (this.config.opencode.server_url) {
      args.push('--attach', this.config.opencode.server_url);
    }

    if (agent) {
      args.push('--agent', agent);
    }

    if (model) {
      args.push('--model', model);
    }

    args.push('--dir', workspaceDir);
    args.push('--format', 'json');
    args.push(prompt);

    const env = {
      ...process.env,
    };

    if (this.config.opencode.server_password) {
      env.OPENCODE_SERVER_PASSWORD = this.config.opencode.server_password;
    }

    const timeoutMs = (this.config.opencode.timeout_seconds || 300) * 1000;

    return new Promise((resolve, reject) => {
      const child = spawn('opencode', args, {
        cwd: workspaceDir,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: process.platform === 'win32',
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (chunk) => {
        stdout += chunk.toString();
      });

      child.stderr?.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      const timer = setTimeout(() => {
        child.kill('SIGTERM');
        reject(
          new Error(
            `OpenCode process timed out after ${this.config.opencode.timeout_seconds} seconds`
          )
        );
      }, timeoutMs);

      child.on('error', (err) => {
        clearTimeout(timer);
        reject(new Error(`Failed to spawn opencode process: ${err.message}`));
      });

      child.on('close', (code) => {
        clearTimeout(timer);

        if (code !== 0 && !stdout.trim()) {
          reject(
            new Error(
              `OpenCode exited with code ${code}. Stderr: ${stderr.trim()}`
            )
          );
          return;
        }

        try {
          const result = parseReviewResult(stdout);
          resolve(result);
        } catch (err: any) {
          reject(
            new Error(`Failed to parse OpenCode review output: ${err.message}`)
          );
        }
      });
    });
  }
}
