FROM node:22-bookworm-slim

# Install git, curl, ca-certificates, and build tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install OpenCode CLI
RUN npm install -g opencode-ai

WORKDIR /app

# Install npm dependencies
COPY package*.json ./
RUN npm ci

# Copy source and configurations
COPY tsconfig.json ./
COPY src/ ./src/
COPY prompts/ ./prompts/

# Build TypeScript
RUN npm run build

# Create persistent directories
RUN mkdir -p /app/data /app/workspaces

EXPOSE 8080

CMD ["node", "dist/index.js"]
