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

  // If no text event found, filter out step/tool JSON lines
  const cleanLines = lines.filter((line) => {
    try {
      const parsed = JSON.parse(line);
      return !parsed.type || !['step_start', 'step_finish', 'tool_use', 'session'].includes(parsed.type);
    } catch {
      return true;
    }
  });

  return cleanLines.join('\n').trim() || raw;
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

  // 1. Try extracting from markdown code block ```json ... ``` or ``` ... ``` FIRST
  const codeBlockMatch = cleanedText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (codeBlockMatch && codeBlockMatch[1]) {
    try {
      const parsed = JSON.parse(codeBlockMatch[1].trim());
      if (isValidReviewResult(parsed)) {
        return normalizeReviewResult(parsed);
      }
    } catch {}
  }

  // 2. Try direct JSON parsing
  try {
    const direct = JSON.parse(cleanedText);
    if (isValidReviewResult(direct)) {
      return normalizeReviewResult(direct);
    }
  } catch {}

  // 3. Try finding largest JSON object substring with curly braces { ... }
  const firstBrace = cleanedText.indexOf('{');
  const lastBrace = cleanedText.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try {
      const substring = cleanedText.substring(firstBrace, lastBrace + 1);
      const parsed = JSON.parse(substring);
      if (isValidReviewResult(parsed)) {
        return normalizeReviewResult(parsed);
      }
    } catch {}
  }

  // 4. Fallback: return cleaned output as summary comment
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
      typeof obj.result === 'string')
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
    const lineNum = Number(f.line_number || f.line);
    const validLine = Number.isInteger(lineNum) && lineNum > 0 ? lineNum : 1;

    return {
      file_path: String(f.file_path || f.path || f.file || ''),
      line_number: validLine,
      severity: ['CRITICAL', 'WARNING', 'INFO'].includes(String(f.severity).toUpperCase())
        ? (String(f.severity).toUpperCase() as ReviewSeverity)
        : 'WARNING',
      comment: String(f.comment || f.description || f.message || ''),
    };
  });

  const summary = String(obj.summary || obj.result || 'Code review completed.');

  return {
    summary,
    verdict,
    findings,
  };
}
