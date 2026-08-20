import { Octokit } from '@octokit/rest';
import type { ReviewFinding, ReviewResult } from '../reviewer/parser.js';

export class GitHubClient {
  private octokit: Octokit;

  constructor(token: string) {
    this.octokit = new Octokit({ auth: token });
  }

  /**
   * Post an initial standby comment indicating review is currently in progress.
   */
  async postStandbyComment(params: {
    owner: string;
    repo: string;
    pullNumber: number;
  }): Promise<number | null> {
    try {
      const { owner, repo, pullNumber } = params;
      const res = await this.octokit.rest.issues.createComment({
        owner,
        repo,
        issue_number: pullNumber,
        body: `> ⏳ **AI Code Reviewer** is currently analyzing your code changes...\n> *Estimated completion time: ~30–60 seconds.*`,
      });
      return res.data.id;
    } catch (err: any) {
      console.warn(`[GitHubClient] Failed to post standby comment: ${err.message}`);
      return null;
    }
  }

  /**
   * Update an existing issue comment.
   */
  async updateComment(params: {
    owner: string;
    repo: string;
    commentId: number;
    body: string;
  }): Promise<void> {
    try {
      const { owner, repo, commentId, body } = params;
      await this.octokit.rest.issues.updateComment({
        owner,
        repo,
        comment_id: commentId,
        body,
      });
    } catch (err: any) {
      console.warn(`[GitHubClient] Failed to update comment ${params.commentId}: ${err.message}`);
    }
  }

  /**
   * Delete an existing issue comment.
   */
  async deleteComment(params: {
    owner: string;
    repo: string;
    commentId: number;
  }): Promise<void> {
    try {
      const { owner, repo, commentId } = params;
      await this.octokit.rest.issues.deleteComment({
        owner,
        repo,
        comment_id: commentId,
      });
    } catch (err: any) {
      console.warn(`[GitHubClient] Failed to delete comment ${params.commentId}: ${err.message}`);
    }
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
    standbyCommentId?: number | null;
  }): Promise<void> {
    const { owner, repo, pullNumber, commitId, reviewResult, standbyCommentId } = params;

    const eventMap: Record<string, 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT'> = {
      APPROVE: 'APPROVE',
      REQUEST_CHANGES: 'REQUEST_CHANGES',
      COMMENT: 'COMMENT',
    };

    const reviewEvent = eventMap[reviewResult.verdict] || 'COMMENT';

    // Format individual inline comments with GitHub alert syntax
    const inlineComments = reviewResult.findings
      .filter((f) => f.file_path && typeof f.line_number === 'number')
      .map((f) => {
        const alertType =
          f.severity === 'CRITICAL'
            ? '[!CAUTION]'
            : f.severity === 'WARNING'
            ? '[!WARNING]'
            : '[!NOTE]';

        return {
          path: f.file_path,
          line: f.line_number,
          body: `> ${alertType}\n> **${f.severity}**: ${f.comment}`,
        };
      });

    // Build the top-level summary body
    const findingsCount = reviewResult.findings.length;
    let summaryBody = `## 🤖 AI Code Review Summary\n\n`;
    
    if (reviewEvent === 'APPROVE') {
      summaryBody += `**Verdict**: ✅ \`APPROVE\`\n\n`;
    } else if (reviewEvent === 'REQUEST_CHANGES') {
      summaryBody += `**Verdict**: ❌ \`REQUEST_CHANGES\`\n\n`;
    } else {
      summaryBody += `**Verdict**: 💬 \`COMMENT\`\n\n`;
    }

    summaryBody += `### 📝 Summary\n${reviewResult.summary}\n\n`;

    if (findingsCount > 0) {
      summaryBody += `**Total Findings**: 🔍 ${findingsCount} actionable issue(s) identified.\n`;
    } else {
      summaryBody += `**Total Findings**: ✨ No actionable issues identified. Code looks good!\n`;
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

      // Clean up standby comment after successful review
      if (standbyCommentId) {
        await this.deleteComment({ owner, repo, commentId: standbyCommentId });
      }
    } catch (err: any) {
      console.warn(
        `[GitHubClient] Direct review with inline comments failed (likely lines outside diff): ${err.message}. Falling back to consolidated review body.`
      );

      // Fallback: consolidate all findings into top-level body comment
      let fallbackBody = summaryBody;
      if (reviewResult.findings.length > 0) {
        fallbackBody += `\n---\n### 🔍 Detailed Findings\n\n`;
        for (const f of reviewResult.findings) {
          const alertType =
            f.severity === 'CRITICAL'
              ? '[!CAUTION]'
              : f.severity === 'WARNING'
              ? '[!WARNING]'
              : '[!NOTE]';

          fallbackBody += `#### 📄 \`${f.file_path}\` (Line ${f.line_number})\n`;
          fallbackBody += `> ${alertType}\n> **${f.severity}**: ${f.comment}\n\n`;
        }
      }

      await this.octokit.rest.pulls.createReview({
        owner,
        repo,
        pull_number: pullNumber,
        event: reviewEvent,
        body: fallbackBody,
      });

      // Clean up standby comment after fallback review
      if (standbyCommentId) {
        await this.deleteComment({ owner, repo, commentId: standbyCommentId });
      }
    }
  }
}
