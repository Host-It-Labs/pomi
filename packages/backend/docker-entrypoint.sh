#!/bin/sh
set -e

echo "Waiting for database to be ready..."
# Wait for the database to be ready
cd /app/packages/backend && pnpm exec wait-on tcp:${DB_HOST:-db}:${DB_PORT:-5432} -t 60000

echo "Running database migrations..."
cd /app/packages/backend && pnpm migration:run

echo "Starting application..."
node dist/src/main.js
