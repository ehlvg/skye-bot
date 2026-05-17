FROM oven/bun:alpine

WORKDIR /app

# Install Python and build tools for native modules (better-sqlite3) and uv for MCP servers
RUN apk add --no-cache python3 py3-pip build-base && \
    pip install --break-system-packages uv

# Install deps first (better layer caching)
COPY package.json bun.lock* ./
COPY web/package.json web/
RUN bun install --frozen-lockfile

# Copy source
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY mcp.json ./

# Environment
ENV NODE_ENV=production

# Build output for production
RUN bun run build

# Remove build deps to slim the image
RUN apk del build-base

# Run the bot from compiled output
CMD ["bun", "dist/index.js"]
