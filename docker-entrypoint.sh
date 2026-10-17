#!/bin/sh
# Apply the schema, then start the app. exec so node is PID 1.
set -eu

./node_modules/.bin/prisma db push --skip-generate

# Railway does not copy Redis variables onto this service unless you reference
# them. Without REDIS_URL (or REDISHOST / REDIS_HOST), run Redis here so the
# process can boot. That queue is local to the container and resets on deploy.
if [ -z "${REDIS_URL:-}" ] && [ -z "${REDISHOST:-}" ] && [ -z "${REDIS_HOST:-}" ]; then
  echo "REDIS_URL is unset; starting Redis in this container. The job queue resets on each deploy. Set REDIS_URL=\${{Redis.REDIS_URL}} to keep jobs across deploys."
  redis-server \
    --bind 127.0.0.1 \
    --port 6379 \
    --protected-mode yes \
    --daemonize yes \
    --save "" \
    --appendonly no \
    --dir /tmp \
    --dbfilename kgb.rdb
fi

exec node dist/main.js
