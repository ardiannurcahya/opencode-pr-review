import { initDatabase } from './dist/queue/db.js';
import { JobQueue } from './dist/queue/queue.js';
import { parseReviewResult } from './dist/reviewer/parser.js';
import { verifyWebhookSignature, shouldProcessPRAction } from './dist/github/webhook.js';
import crypto from 'node:crypto';

async function runAudit() {
  console.log('--- STARTING AUDIT TEST SUITE ---');

  // 1. Test Database & SQLite
  console.log('\n[Test 1] Initializing in-memory SQLite DB...');
  initDatabase(':memory:');

  // 2. Test Enqueue
  console.log('[Test 2] Testing Queue Enqueue...');
  const jobId1 = JobQueue.enqueue({
    repository: 'test-org/repository-1',
    pr_number: 101,
    head_sha: 'sha111',
    base_branch: 'main',
    clone_url: 'https://github.com/test-org/repository-1.git',
    installation_id: 12345,
  });

  const jobId2 = JobQueue.enqueue({
    repository: 'test-org/repository-1',
    pr_number: 101,
    head_sha: 'sha222',
    base_branch: 'main',
    clone_url: 'https://github.com/test-org/repository-1.git',
    installation_id: 12345,
  });
  console.log(`Enqueued Job 1 (ID: ${jobId1}), Job 2 (ID: ${jobId2})`);

  // 3. Test Deduplication
  console.log('[Test 3] Testing Deduplication Logic...');
  const isJob1Superseded = JobQueue.isSuperseded(jobId1, 'test-org/repository-1', 101);
  const isJob2Superseded = JobQueue.isSuperseded(jobId2, 'test-org/repository-1', 101);
  if (!isJob1Superseded || isJob2Superseded) {
    throw new Error('Deduplication check failed!');
  }
  console.log('Deduplication check passed: Job 1 superseded = true, Job 2 superseded = false');

  // 4. Test Dequeue & Status updates
  console.log('[Test 4] Testing Dequeue and Status Updates...');
  const dequeued = JobQueue.dequeueNext();
  if (!dequeued || dequeued.id !== jobId1 || dequeued.status !== 'running') {
    throw new Error('Dequeue failed!');
  }
  console.log(`Dequeued job #${dequeued.id} with status '${dequeued.status}'`);

  JobQueue.updateStatus(jobId1, 'completed');
  const recentJobs = JobQueue.listRecentJobs(10);
  if (recentJobs.length !== 2 || recentJobs[1].status !== 'completed') {
    throw new Error('Status update / list jobs failed!');
  }
  console.log('Job listing and status update passed.');

  // 5. Test LLM Parser with various formats
  console.log('\n[Test 5] Testing LLM JSON Parser Robustness...');
  
  // Format A: Markdown code block with json
  const jsonInMarkdown = '```json\n{\n  "summary": "Looks good",\n  "verdict": "REQUEST_CHANGES",\n  "findings": [\n    {\n      "file_path": "src/auth.ts",\n      "line_number": 50,\n      "severity": "CRITICAL",\n      "comment": "Potential SQL injection"\n    }\n  ]\n}\n```';
  const parsedA = parseReviewResult(jsonInMarkdown);
  if (parsedA.verdict !== 'REQUEST_CHANGES' || parsedA.findings.length !== 1 || parsedA.findings[0].severity !== 'CRITICAL') {
    throw new Error('Failed to parse JSON inside markdown!');
  }

  // Format B: Raw JSON
  const rawJson = '{"summary": "All clean", "verdict": "APPROVE", "findings": []}';
  const parsedB = parseReviewResult(rawJson);
  if (parsedB.verdict !== 'APPROVE' || parsedB.findings.length !== 0) {
    throw new Error('Failed to parse raw JSON!');
  }

  // Format C: Conversational text with JSON embedded
  const conversational = 'Here is my review analysis:\n{"summary": "Found bugs", "verdict": "COMMENT", "findings": [{"file_path": "a.ts", "line_number": 10, "severity": "WARNING", "comment": "Fix this"}]}\nHope this helps!';
  const parsedC = parseReviewResult(conversational);
  if (parsedC.verdict !== 'COMMENT' || parsedC.findings.length !== 1) {
    throw new Error('Failed to parse conversational JSON embedded output!');
  }

  // Format D: Total fallback (plain text)
  const plainText = 'The PR looks completely fine without issues.';
  const parsedD = parseReviewResult(plainText);
  if (parsedD.summary !== plainText || parsedD.verdict !== 'COMMENT') {
    throw new Error('Fallback parser failed!');
  }
  console.log('LLM Parser successfully handled all 4 formats.');

  // 6. Test Webhook HMAC Signature & Action Filtering
  console.log('\n[Test 6] Testing Webhook Signature Verification & Filtering...');
  const secret = 'super_secret_webhook_key_123';
  const payloadStr = JSON.stringify({ action: 'opened' });
  const hmac = crypto.createHmac('sha256', secret).update(payloadStr).digest('hex');
  const validSignature = `sha256=${hmac}`;

  const isValid = await verifyWebhookSignature(secret, payloadStr, validSignature);
  const isInvalid = await verifyWebhookSignature('wrong_secret', payloadStr, validSignature);
  if (!isValid || isInvalid) {
    throw new Error('Webhook signature verification failed!');
  }

  // Test action filters
  if (!shouldProcessPRAction('opened', false)) throw new Error('Opened PR should be processed');
  if (!shouldProcessPRAction('synchronize', false)) throw new Error('Synchronize PR should be processed');
  if (shouldProcessPRAction('closed', false)) throw new Error('Closed PR should not be processed');
  if (shouldProcessPRAction('opened', true)) throw new Error('Draft PR should not be processed');
  console.log('Webhook verification and PR action filtering passed.');

  console.log('\n========================================');
  console.log('ALL AUDIT TESTS COMPLETED SUCCESSFULLY!');
  console.log('========================================\n');
}

runAudit().catch((err) => {
  console.error('AUDIT ERROR:', err);
  process.exit(1);
});
