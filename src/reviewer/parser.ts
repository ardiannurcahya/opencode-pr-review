export type ReviewSeverity = 'CRITICAL' | 'WARNING' | 'INFO';
export type ReviewVerdict = 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT';

export interface ReviewFinding {
  file_path: string;
  line_number: number;
  severity: ReviewSeverity;
  comment: string;
}

export interface ReviewResult {
  summary: string;
  verdict: ReviewVerdict;
  findings: ReviewFinding[];
}

export function parseReviewResult(rawOutput: string): ReviewResult {
  if (!rawOutput || !rawOutput.trim()) {
    return {
      summary: 'No review output generated.',
      verdict: 'COMMENT',
      findings: [],
    };
  }

  // 1. Try direct JSON parsing
  try {
    const direct = JSON.parse(rawOutput.trim());
    if (isValidReviewResult(direct)) {
      return normalizeReviewResult(direct);
    }
  } catch {}

  // 2. Try extracting from markdown code block ```json ... ``` or ``` ... ```
  const codeBlockMatch = rawOutput.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (codeBlockMatch && codeBlockMatch[1]) {
    try {
      const parsed = JSON.parse(codeBlockMatch[1].trim());
      if (isValidReviewResult(parsed)) {
        return normalizeReviewResult(parsed);
      }
    } catch {}
  }

  // 3. Try finding largest JSON object substring with curly braces { ... }
  const firstBrace = rawOutput.indexOf('{');
  const lastBrace = rawOutput.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try {
      const substring = rawOutput.substring(firstBrace, lastBrace + 1);
      const parsed = JSON.parse(substring);
      if (isValidReviewResult(parsed)) {
        return normalizeReviewResult(parsed);
      }
    } catch {}
  }

  // 4. Fallback: return raw output as summary comment
  return {
    summary: rawOutput.trim(),
    verdict: 'COMMENT',
    findings: [],
  };
}

function isValidReviewResult(obj: any): boolean {
  return (
    obj &&
    typeof obj === 'object' &&
    (typeof obj.summary === 'string' || Array.isArray(obj.findings))
  );
}

function normalizeReviewResult(obj: any): ReviewResult {
  const verdict = ['APPROVE', 'REQUEST_CHANGES', 'COMMENT'].includes(
    String(obj.verdict).toUpperCase()
  )
    ? (String(obj.verdict).toUpperCase() as ReviewVerdict)
    : 'COMMENT';

  const findings: ReviewFinding[] = Array.isArray(obj.findings)
    ? obj.findings.map((f: any) => ({
        file_path: String(f.file_path || ''),
        line_number: Number(f.line_number) || 1,
        severity: ['CRITICAL', 'WARNING', 'INFO'].includes(
          String(f.severity).toUpperCase()
        )
          ? (String(f.severity).toUpperCase() as ReviewSeverity)
          : 'WARNING',
        comment: String(f.comment || ''),
      }))
    : [];

  return {
    summary: String(obj.summary || 'Code review completed.'),
    verdict,
    findings,
  };
}
