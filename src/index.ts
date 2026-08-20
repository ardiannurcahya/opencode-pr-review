#!/usr/bin/env node
import express, { Request, Response } from 'express';
import { loadConfig } from './config.js';
import { initDatabase } from './queue/db.js';
import { JobQueue } from './queue/queue.js';
import {
  verifyWebhookSignature,
  shouldProcessPRAction,
  WebhookPRPayload,
} from './github/webhook.js';
import { ReviewWorker } from './worker/worker.js';

interface RequestWithRawBody extends Request {
  rawBody?: Buffer;
}

async function bootstrap() {
  console.log('[System] Initializing AI PR Code Reviewer...');

  // 1. Load config
  const config = loadConfig();
  console.log(`[Config] Loaded configuration. Server port: ${config.server.port}`);

  // 2. Initialize Database
  initDatabase();
  console.log('[Database] SQLite database initialized.');

  // 3. Setup Express Server
  const app = express();

  // Capture raw body for GitHub signature verification
  app.use(
    express.json({
      verify: (req: RequestWithRawBody, _, buf) => {
        req.rawBody = buf;
      },
    })
  );

  // Health check
  app.get('/health', (_, res: Response) => {
    res.json({
      status: 'ok',
      service: 'opencode-pr-reviewer',
      timestamp: new Date().toISOString(),
    });
  });

  // Recent jobs status endpoint
  app.get('/api/jobs', (_, res: Response) => {
    const jobs = JobQueue.listRecentJobs(30);
    res.json({ jobs });
  });

  // Webhook receiver
  app.post(
    '/webhook/github',
    async (req: RequestWithRawBody, res: Response): Promise<void> => {
      const githubEvent = req.header('x-github-event');
      const signature = req.header('x-hub-signature-256');

      if (!signature) {
        res.status(401).json({ error: 'Missing X-Hub-Signature-256 header' });
        return;
      }

      const rawBody = req.rawBody || Buffer.from(JSON.stringify(req.body));
      const isValid = await verifyWebhookSignature(
        config.server.webhook_secret,
        rawBody,
        signature
      );

      if (!isValid) {
        console.warn('[Webhook] Invalid HMAC signature detected.');
        res.status(401).json({ error: 'Invalid webhook signature' });
        return;
      }

      // Handle ping event
      if (githubEvent === 'ping') {
        console.log('[Webhook] Received GitHub ping event.');
        res.json({ message: 'Pong. Webhook verified successfully.' });
        return;
      }

      if (githubEvent !== 'pull_request') {
        res.json({ message: `Ignored event: ${githubEvent}` });
        return;
      }

      const payload = req.body as WebhookPRPayload;
      const repoFullName = payload.repository?.full_name;
      const prNumber = payload.number || payload.pull_request?.number;

      if (!repoFullName || !prNumber) {
        res.status(400).json({ error: 'Invalid PR webhook payload format' });
        return;
      }

      // Check if PR action should be reviewed (opened, synchronize, reopened, ready_for_review)
      const isDraft = payload.pull_request?.draft ?? false;
      if (!shouldProcessPRAction(payload.action, isDraft)) {
        console.log(
          `[Webhook] Skipping PR #${prNumber} on ${repoFullName} for action: '${payload.action}' (draft: ${isDraft})`
        );
        res.json({
          message: `PR action '${payload.action}' skipped (not actionable or draft).`,
        });
        return;
      }

      // Check repo configuration
      const repoConfig = config.repos[repoFullName];
      if (repoConfig && repoConfig.enabled === false) {
        console.log(`[Webhook] Repository ${repoFullName} is explicitly disabled.`);
        res.json({ message: `Repository ${repoFullName} is disabled in config.` });
        return;
      }

      const installationId = payload.installation?.id;
      if (!installationId) {
        res.status(400).json({
          error:
            'Missing installation ID. Ensure GitHub App is properly installed on the repository.',
        });
        return;
      }

      // Enqueue review job
      const jobId = JobQueue.enqueue({
        repository: repoFullName,
        pr_number: prNumber,
        head_sha: payload.pull_request.head.sha,
        base_branch: payload.pull_request.base.ref,
        clone_url: payload.repository.clone_url,
        installation_id: installationId,
      });

      console.log(
        `[Webhook] Enqueued review job #${jobId} for ${repoFullName}#${prNumber} (Action: ${payload.action}, SHA: ${payload.pull_request.head.sha.substring(0, 7)})`
      );

      res.status(202).json({
        message: 'Review job enqueued',
        jobId,
        repository: repoFullName,
        prNumber,
      });
    }
  );

  // 4. Start HTTP Server
  const server = app.listen(config.server.port, () => {
    console.log(
      `[Server] Running on port ${config.server.port} (Health endpoint: http://localhost:${config.server.port}/health)`
    );
  });

  // 5. Start Worker
  const worker = new ReviewWorker(config);
  worker.start(3000);

  // Graceful shutdown
  const shutdown = () => {
    console.log('\n[System] Shutting down gracefully...');
    worker.stop();
    server.close(() => {
      console.log('[Server] HTTP server closed.');
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

bootstrap().catch((err) => {
  console.error('[System] Fatal initialization error:', err);
  process.exit(1);
});
