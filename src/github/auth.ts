import fs from 'node:fs';
import path from 'node:path';
import { createAppAuth } from '@octokit/auth-app';

interface TokenCacheEntry {
  token: string;
  expiresAt: number;
}

const tokenCache = new Map<number, TokenCacheEntry>();

export class GitHubAuth {
  private appId: number;
  private privateKeyPath: string;
  private privateKey: string | null = null;

  constructor(appId: number, privateKeyPath: string) {
    this.appId = appId;
    this.privateKeyPath = path.isAbsolute(privateKeyPath)
      ? privateKeyPath
      : path.resolve(process.cwd(), privateKeyPath);

    if (fs.existsSync(this.privateKeyPath)) {
      this.privateKey = fs.readFileSync(this.privateKeyPath, 'utf8');
    } else {
      console.warn(
        `[GitHubAuth] Private key not found at: ${this.privateKeyPath}. Note: Reviews will require this file to be present.`
      );
    }
  }

  private loadPrivateKey(): string {
    if (this.privateKey) {
      return this.privateKey;
    }

    if (fs.existsSync(this.privateKeyPath)) {
      this.privateKey = fs.readFileSync(this.privateKeyPath, 'utf8');
      return this.privateKey;
    }

    throw new Error(
      `GitHub App private key not found at: ${this.privateKeyPath}. Please download your .pem file from GitHub App settings.`
    );
  }

  /**
   * Get an installation access token for a given installation ID.
   * Caches token in memory until 5 minutes before expiration.
   */
  async getInstallationToken(installationId: number): Promise<string> {
    const cached = tokenCache.get(installationId);
    const now = Date.now();

    if (cached && cached.expiresAt > now + 5 * 60 * 1000) {
      return cached.token;
    }

    const privateKey = this.loadPrivateKey();

    const auth = createAppAuth({
      appId: this.appId,
      privateKey,
      installationId,
    });

    const authentication = await auth({ type: 'installation' });
    const expiresAt = new Date(authentication.expiresAt).getTime();

    tokenCache.set(installationId, {
      token: authentication.token,
      expiresAt,
    });

    return authentication.token;
  }
}
