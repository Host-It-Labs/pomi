#!/bin/sh

# Create @pomi directory if it doesn't exist
mkdir -p /app/packages/backend/node_modules/@pomi

# Create symlink to shared package
ln -sfn /app/packages/shared /app/packages/backend/node_modules/@pomi/shared

# Execute the command
exec "$@"
