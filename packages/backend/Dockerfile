FROM node:26-alpine

WORKDIR /app

# Copy workspace files
COPY package.json .
COPY pnpm-lock.yaml .
COPY pnpm-workspace.yaml .
COPY patches ./patches
COPY scripts/rewrite-backend-paths.mjs ./scripts/rewrite-backend-paths.mjs

# Copy packages
COPY packages/shared /app/packages/shared
COPY packages/backend /app/packages/backend

# Install dependencies at workspace level
RUN npm install --global corepack@0.35.0
RUN corepack enable pnpm
RUN corepack install --global pnpm@11.23.0
RUN pnpm install --frozen-lockfile

# Build shared package first
RUN pnpm --filter @pomi/shared build

# Build backend
RUN pnpm --filter @pomi/backend build

# Create a startup script that will run migrations and then start the app
COPY packages/backend/docker-entrypoint.sh /app/packages/backend/docker-entrypoint.sh
RUN chmod +x /app/packages/backend/docker-entrypoint.sh
RUN chown -R node:node /app

ARG SENTRY_RELEASE
ENV SENTRY_RELEASE=${SENTRY_RELEASE}

EXPOSE 3000

USER node

ENTRYPOINT ["/app/packages/backend/docker-entrypoint.sh"]
