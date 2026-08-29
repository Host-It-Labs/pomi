#!/bin/sh
set -e

echo "Waiting for database to be ready..."
# Wait for the database to be ready
cd /app/packages/backend && node node_modules/wait-on/bin/wait-on tcp:${DB_HOST:-db}:${DB_PORT:-5432} -t 60000

echo "Running database migrations..."
cd /app/packages/backend && node node_modules/typeorm/cli-ts-node-commonjs.js migration:run -d data-source.ts

echo "Starting application..."
node dist/src/main.js
