import crypto from 'node:crypto';

export interface WebhookPRPayload {
  action: string;
  number: number;
  pull_request: {
    number: number;
    head: {
      sha: string;
      ref: string;
    };
    base: {
      ref: string;
    };
    draft?: boolean;
    title: string;
    body: string | null;
  };
  repository: {
    id: number;
    name: string;
    full_name: string;
    clone_url: string;
    private: boolean;
  };
  installation?: {
    id: number;
  };
}

export async function verifyWebhookSignature(
  secret: string,
  payload: string | Buffer,
  signatureHeader?: string
): Promise<boolean> {
  if (!signatureHeader || !secret) {
    return false;
  }

  if (!signatureHeader.startsWith('sha256=')) {
    return false;
  }

  try {
    const payloadBuffer =
      typeof payload === 'string' ? Buffer.from(payload, 'utf8') : payload;

    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(payloadBuffer);
    const expectedSignature = `sha256=${hmac.digest('hex')}`;

    const sigBuffer = Buffer.from(signatureHeader, 'utf8');
    const expectedBuffer = Buffer.from(expectedSignature, 'utf8');

    if (sigBuffer.length !== expectedBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(sigBuffer, expectedBuffer);
  } catch {
    return false;
  }
}

export function shouldProcessPRAction(action: string, isDraft?: boolean): boolean {
  if (isDraft) {
    return false;
  }

  const reviewableActions = ['opened', 'synchronize', 'reopened', 'ready_for_review'];
  return reviewableActions.includes(action);
}
