export type ReviewSeverity = 'CRITICAL' | 'WARNING' | 'INFO';
export type ReviewVerdict = 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT';

export interface ReviewFinding {
  file_path: string;
  line_number?: number;
  severity: ReviewSeverity;
  comment: string;
}

export interface ReviewResult {
  summary: string;
  verdict: ReviewVerdict;
  findings: ReviewFinding[];
}

/**
 * Extract actual AI text content from OpenCode event-stream output (NDJSON).
 */
function extractOpenCodeOutput(raw: string): string {
  if (!raw || !raw.includes('{"type":')) {
    return raw;
  }

  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
  let aggregatedText = '';
  let foundTextEvent = false;

  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const obj = JSON.parse(lines[i]);
      if (obj.type === 'text' && obj.part && typeof obj.part.text === 'string') {
        aggregatedText = obj.part.text + aggregatedText;
        foundTextEvent = true;
      }
    } catch {}
  }

  if (foundTextEvent && aggregatedText.trim()) {
    return aggregatedText.trim();
  }

  return raw;
}

/**
 * Robustly find and parse the outermost JSON object within a string,
 * correctly handling nested markdown blocks, string literals, and escaped characters.
 */
function findBalancedJsonObject(str: string): any | null {
  let startIndex = -1;
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = 0; i < str.length; i++) {
    const char = str[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (char === '\\') {
      escape = true;
      continue;
    }

    if (char === '"' && !escape) {
      inString = !inString;
      continue;
    }

    if (!inString) {
      if (char === '{') {
        if (depth === 0) startIndex = i;
        depth++;
      } else if (char === '}') {
        depth--;
        if (depth === 0 && startIndex !== -1) {
          const candidate = str.substring(startIndex, i + 1);
          try {
            const parsed = JSON.parse(candidate);
            if (isValidReviewResult(parsed)) {
              return parsed;
            }
          } catch {}
          // Reset startIndex if this balanced chunk wasn't a valid review object
          startIndex = -1;
        }
      }
    }
  }

  return null;
}

export function parseReviewResult(rawOutput: string): ReviewResult {
  if (!rawOutput || !rawOutput.trim()) {
    return {
      summary: 'No review output generated.',
      verdict: 'COMMENT',
      findings: [],
    };
  }

  // 0. Extract text from OpenCode NDJSON stream if present
  const cleanedText = extractOpenCodeOutput(rawOutput.trim());

  // 1. Direct JSON parse
  try {
    const direct = JSON.parse(cleanedText);
    if (isValidReviewResult(direct)) {
      return normalizeReviewResult(direct);
    }
  } catch {}

  // 2. Balanced curly brace extraction (handles markdown blocks, nested code fences, conversational lead-in)
  const balanced = findBalancedJsonObject(cleanedText);
  if (balanced) {
    return normalizeReviewResult(balanced);
  }

  // 3. Fallback: return cleaned output as summary comment
  return {
    summary: cleanedText,
    verdict: 'COMMENT',
    findings: [],
  };
}

function isValidReviewResult(obj: any): boolean {
  return (
    obj &&
    typeof obj === 'object' &&
    (typeof obj.summary === 'string' ||
      Array.isArray(obj.findings) ||
      Array.isArray(obj.issues) ||
      typeof obj.result === 'string' ||
      typeof obj.verdict === 'string' ||
      typeof obj.status === 'string')
  );
}

function normalizeReviewResult(obj: any): ReviewResult {
  let rawVerdict = String(obj.verdict || obj.status || 'COMMENT').toUpperCase();
  let verdict: ReviewVerdict = 'COMMENT';

  if (rawVerdict === 'APPROVE' || rawVerdict === 'PASS') {
    verdict = 'APPROVE';
  } else if (rawVerdict === 'REQUEST_CHANGES' || rawVerdict === 'FAIL' || rawVerdict === 'NEEDS_REVISION') {
    verdict = 'REQUEST_CHANGES';
  }

  const rawFindings = Array.isArray(obj.findings)
    ? obj.findings
    : Array.isArray(obj.issues)
    ? obj.issues
    : [];

  const findings: ReviewFinding[] = rawFindings.map((f: any) => {
    const rawLine = f.line_number ?? f.line;
    const lineNum = Number(rawLine);
    const validLine = Number.isInteger(lineNum) && lineNum > 0 ? lineNum : undefined;

    return {
      file_path: String(f.file_path || f.path || f.file || '').trim(),
      line_number: validLine,
      severity: ['CRITICAL', 'WARNING', 'INFO'].includes(String(f.severity).toUpperCase())
        ? (String(f.severity).toUpperCase() as ReviewSeverity)
        : 'WARNING',
      comment: String(f.comment || f.description || f.message || '').trim(),
    };
  });

  let rawSummary = String(obj.summary || obj.result || '').trim();
  if (!rawSummary || ['PASS', 'FAIL', 'APPROVE', 'REQUEST_CHANGES', 'NEEDS_REVISION'].includes(rawSummary.toUpperCase())) {
    rawSummary = verdict === 'APPROVE'
      ? 'All automated code quality and security checks passed successfully without actionable issues.'
      : 'Code review completed with actionable findings that require attention.';
  }

  return {
    summary: rawSummary,
    verdict,
    findings,
  };
}
