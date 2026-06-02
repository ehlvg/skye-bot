FROM node:22-alpine

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

RUN apk add --no-cache python3 py3-pip build-base && \
    pip install --break-system-packages uv

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY web/package.json web/
RUN pnpm install --frozen-lockfile

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY mcp.json ./
COPY web ./web

ENV NODE_ENV=production

RUN pnpm --filter skye-panel build
RUN pnpm build

RUN apk del build-base

CMD ["node", "dist/index.js"]
