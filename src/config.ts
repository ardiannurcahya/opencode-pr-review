import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import dotenv from 'dotenv';

dotenv.config();

export interface RepoConfig {
  enabled: boolean;
  type?: 'opensource' | 'internal' | 'general';
  prompt_file?: string;
  base_branch?: string;
  model?: string;
  agent?: string;
  max_findings?: number;
  custom_prompt?: string;
}

export interface AppConfig {
  server: {
    port: number;
    webhook_secret: string;
  };
  github: {
    app_id: number;
    private_key_path: string;
  };
  opencode: {
    server_url?: string;
    server_password?: string;
    default_model: string;
    agent?: string;
    timeout_seconds: number;
  };
  workspace: {
    base_dir: string;
    clean_after_review: boolean;
  };
  repos: Record<string, RepoConfig>;
}

function expandEnv(str: string): string {
  return str.replace(/\$\{([^}]+)\}/g, (_, key) => {
    return process.env[key] || '';
  });
}

export function loadConfig(customPath?: string): AppConfig {
  const configPath =
    customPath ||
    process.env.CONFIG_PATH ||
    path.resolve(process.cwd(), 'config.yaml');

  if (!fs.existsSync(configPath)) {
    throw new Error(
      `Configuration file not found at: ${configPath}. Please create config.yaml (see config.example.yaml).`
    );
  }

  const rawContent = fs.readFileSync(configPath, 'utf8');
  const expandedContent = expandEnv(rawContent);
  const parsed = YAML.parse(expandedContent) as Partial<AppConfig>;

  const config: AppConfig = {
    server: {
      port: parsed.server?.port || Number(process.env.PORT) || 8080,
      webhook_secret:
        parsed.server?.webhook_secret || process.env.WEBHOOK_SECRET || '',
    },
    github: {
      app_id: parsed.github?.app_id || Number(process.env.GITHUB_APP_ID) || 0,
      private_key_path:
        parsed.github?.private_key_path ||
        process.env.GITHUB_PRIVATE_KEY_PATH ||
        './github-app.private-key.pem',
    },
    opencode: {
      server_url:
        parsed.opencode?.server_url || process.env.OPENCODE_SERVER_URL || '',
      server_password:
        parsed.opencode?.server_password ||
        process.env.OPENCODE_SERVER_PASSWORD ||
        '',
      default_model:
        parsed.opencode?.default_model ||
        process.env.OPENCODE_DEFAULT_MODEL ||
        'anthropic/claude-sonnet-4-5',
      agent:
        parsed.opencode?.agent ||
        process.env.OPENCODE_AGENT ||
        undefined,
      timeout_seconds: parsed.opencode?.timeout_seconds || 300,
    },
    workspace: {
      base_dir:
        parsed.workspace?.base_dir ||
        path.resolve(process.cwd(), 'workspaces'),
      clean_after_review: parsed.workspace?.clean_after_review ?? false,
    },
    repos: (parsed as any).repositories || parsed.repos || {},
  };

  return config;
}
