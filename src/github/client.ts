import { Octokit } from '@octokit/rest';
import type { ReviewFinding, ReviewResult } from '../reviewer/parser.js';

export class GitHubClient {
  private octokit: Octokit;

  constructor(token: string) {
    this.octokit = new Octokit({ auth: token });
  }

  /**
   * Post a comprehensive Pull Request review with inline comments.
   * If inline comments fail (e.g. line number is outside changed diff),
   * it gracefully appends unpostable comments to the main review body.
   */
  async postReview(params: {
    owner: string;
    repo: string;
    pullNumber: number;
    commitId: string;
    reviewResult: ReviewResult;
  }): Promise<void> {
    const { owner, repo, pullNumber, commitId, reviewResult } = params;

    const eventMap: Record<string, 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT'> = {
      APPROVE: 'APPROVE',
      REQUEST_CHANGES: 'REQUEST_CHANGES',
      COMMENT: 'COMMENT',
    };

    const reviewEvent = eventMap[reviewResult.verdict] || 'COMMENT';

    // Format individual inline comments
    const inlineComments = reviewResult.findings
      .filter((f) => f.file_path && typeof f.line_number === 'number')
      .map((f) => {
        const severityBadge =
          f.severity === 'CRITICAL'
            ? '**[CRITICAL]**'
            : f.severity === 'WARNING'
            ? '**[WARNING]**'
            : '**[INFO]**';

        return {
          path: f.file_path,
          line: f.line_number,
          body: `${severityBadge}\n\n${f.comment}`,
        };
      });

    // Build the top-level summary body
    const findingsCount = reviewResult.findings.length;
    let summaryBody = `### Code Review Summary\n\n`;
    summaryBody += `**Verdict**: \`${reviewEvent}\`\n\n`;
    summaryBody += `${reviewResult.summary}\n\n`;

    if (findingsCount > 0) {
      summaryBody += `**Findings**: ${findingsCount} issue(s) identified.\n`;
    } else {
      summaryBody += `**Findings**: No actionable issues identified.\n`;
    }

    try {
      // Attempt to submit review with inline comments
      await this.octokit.rest.pulls.createReview({
        owner,
        repo,
        pull_number: pullNumber,
        commit_id: commitId,
        event: reviewEvent,
        body: summaryBody,
        comments: inlineComments.length > 0 ? inlineComments : undefined,
      });
    } catch (err: any) {
      console.warn(
        `[GitHubClient] Direct review with inline comments failed (likely lines outside diff): ${err.message}. Falling back to consolidated review body.`
      );

      // Fallback: consolidate all findings into top-level body comment
      let fallbackBody = `${summaryBody}\n\n---\n### Detailed Findings\n\n`;
      for (const f of reviewResult.findings) {
        fallbackBody += `#### \`${f.file_path}\` (Line ${f.line_number})\n`;
        fallbackBody += `**Severity**: ${f.severity}\n\n${f.comment}\n\n`;
      }

      await this.octokit.rest.pulls.createReview({
        owner,
        repo,
        pull_number: pullNumber,
        commit_id: commitId,
        event: reviewEvent,
        body: fallbackBody,
      });
    }
  }
}
