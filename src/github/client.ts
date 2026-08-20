import { Octokit } from '@octokit/rest';
import type { ReviewFinding, ReviewResult } from '../reviewer/parser.js';

const STANDBY_MARKER = '<!-- opencode-pr-reviewer-standby -->';

export class GitHubClient {
  private octokit: Octokit;

  constructor(token: string) {
    this.octokit = new Octokit({ auth: token });
  }

  /**
   * Post an initial standby comment indicating review is currently in progress.
   * Auto-cleans up any previous orphaned standby comments from crashed/interrupted runs.
   */
  async postStandbyComment(params: {
    owner: string;
    repo: string;
    pullNumber: number;
  }): Promise<number | null> {
    const { owner, repo, pullNumber } = params;

    // 1. Cleanup any previous orphaned standby comments
    try {
      const existing = await this.octokit.rest.issues.listComments({
        owner,
        repo,
        issue_number: pullNumber,
        per_page: 50,
      });

      for (const comment of existing.data) {
        if (comment.body?.includes(STANDBY_MARKER)) {
          await this.octokit.rest.issues.deleteComment({
            owner,
            repo,
            comment_id: comment.id,
          }).catch(() => {});
        }
      }
    } catch {}

    // 2. Post fresh standby comment
    try {
      const res = await this.octokit.rest.issues.createComment({
        owner,
        repo,
        issue_number: pullNumber,
        body: `${STANDBY_MARKER}\n> ⏳ **AI Code Reviewer** is currently analyzing your code changes...\n> *Estimated completion time: ~30–60 seconds.*`,
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

    // Separate postable inline findings vs unpostable/file-level findings
    const inlineFindingsMap = new Map<string, { path: string; line: number; severity: string; comments: string[] }>();
    const generalFindings: ReviewFinding[] = [];

    for (const f of reviewResult.findings) {
      if (
        f.file_path &&
        typeof f.line_number === 'number' &&
        (f.severity === 'CRITICAL' || f.severity === 'WARNING')
      ) {
        const key = `${f.file_path}:${f.line_number}`;
        const existing = inlineFindingsMap.get(key);
        if (existing) {
          existing.comments.push(f.comment);
          if (f.severity === 'CRITICAL') existing.severity = 'CRITICAL';
        } else {
          inlineFindingsMap.set(key, {
            path: f.file_path,
            line: f.line_number,
            severity: f.severity,
            comments: [f.comment],
          });
        }
      } else {
        generalFindings.push(f);
      }
    }

    // Format individual inline comments with GitHub alert syntax
    const inlineComments = Array.from(inlineFindingsMap.values()).map((item) => {
      const alertType =
        item.severity === 'CRITICAL'
          ? '[!CAUTION]'
          : '[!WARNING]';

      const combinedComment = item.comments.join('\n\n---\n\n');
      return {
        path: item.path,
        line: item.line,
        body: `> ${alertType}\n> **${item.severity}**: ${combinedComment}`,
      };
    });

    // Build the top-level summary body
    const totalFindingsCount = reviewResult.findings.length;
    let summaryBody = `## 🤖 AI Code Review Summary\n\n`;
    
    if (reviewEvent === 'APPROVE') {
      summaryBody += `**Verdict**: ✅ \`APPROVE\`\n\n`;
    } else if (reviewEvent === 'REQUEST_CHANGES') {
      summaryBody += `**Verdict**: ❌ \`REQUEST_CHANGES\`\n\n`;
    } else {
      summaryBody += `**Verdict**: 💬 \`COMMENT\`\n\n`;
    }

    summaryBody += `### 📝 Summary\n${reviewResult.summary.trim()}\n\n`;

    if (reviewEvent === 'APPROVE') {
      summaryBody += `**Status**: ✨ Clean! Code is approved and ready to merge.\n`;
    } else if (reviewEvent === 'REQUEST_CHANGES') {
      summaryBody += `**Blocking Issues**: 🚨 ${totalFindingsCount} critical issue(s) identified. Must be resolved before merge.\n`;
    } else {
      if (totalFindingsCount > 0) {
        summaryBody += `**Feedback**: 🔍 ${totalFindingsCount} point(s) of feedback provided for discussion.\n`;
      } else {
        summaryBody += `**Status**: 💬 Review notes provided for consideration.\n`;
      }
    }

    // Only post inline comments when there are actual blocking/critical findings
    const shouldPostInline = reviewEvent === 'REQUEST_CHANGES' && inlineComments.length > 0;

    try {
      // Attempt to submit review
      await this.octokit.rest.pulls.createReview({
        owner,
        repo,
        pull_number: pullNumber,
        commit_id: commitId,
        event: reviewEvent,
        body: summaryBody,
        comments: shouldPostInline ? inlineComments : undefined,
      });

      // Clean up standby comment after successful review
      if (standbyCommentId) {
        await this.deleteComment({ owner, repo, commentId: standbyCommentId });
      }
    } catch (err: any) {
      console.warn(
        `[GitHubClient] Direct review with inline comments failed (likely lines outside diff): ${err.message}. Falling back to consolidated review body.`
      );

      // Fallback: consolidate all unincluded findings into top-level body comment
      let fallbackBody = summaryBody;
      const alreadyIncluded = new Set(
        generalFindings.map((f) => `${f.file_path || ''}:${f.line_number ?? ''}`)
      );

      const unincludedFindings = reviewResult.findings.filter(
        (f) => !alreadyIncluded.has(`${f.file_path || ''}:${f.line_number ?? ''}`)
      );

      if (unincludedFindings.length > 0) {
        fallbackBody += `\n---\n### 🔍 Detailed Findings\n\n`;
        for (const f of unincludedFindings) {
          const alertType =
            f.severity === 'CRITICAL'
              ? '[!CAUTION]'
              : f.severity === 'WARNING'
              ? '[!WARNING]'
              : '[!NOTE]';

          const lineStr = f.line_number ? ` (Line ${f.line_number})` : '';
          fallbackBody += `#### 📄 \`${f.file_path || 'General'}\`${lineStr}\n`;
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
