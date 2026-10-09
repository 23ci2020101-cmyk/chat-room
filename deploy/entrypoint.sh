#!/bin/sh
# Container entrypoint (Render, Fly, plain Docker, ...).
#  - listens on $PORT (Render sets it; defaults to 8080 elsewhere), on all interfaces
#  - stores data in $DATA_DIR; a mounted persistent disk is usually root-owned, so fix ownership first
#  - then drops root and runs the server as the unprivileged "chat" user (falls back to the current
#    user if the platform does not allow switching users, so the container never dies silently)
set -e
DATA="${DATA_DIR:-/app/data}"
ARGS="-p ${PORT:-8080} -b 0.0.0.0 -d $DATA -w /app/public --secure --trust-proxy"

echo "entrypoint: uid=$(id -u) PORT=${PORT:-unset} DATA=$DATA"
mkdir -p "$DATA" || echo "entrypoint: cannot create $DATA" >&2
chown chat:chat "$DATA" 2>/dev/null || true
chmod 700 "$DATA" 2>/dev/null || true

if [ "$(id -u)" = "0" ] && setpriv --reuid=chat --regid=chat --clear-groups true 2>/dev/null; then
    # shellcheck disable=SC2086
    exec setpriv --reuid=chat --regid=chat --clear-groups /app/chat_server $ARGS
fi
echo "entrypoint: cannot drop privileges, running as current user" >&2
# shellcheck disable=SC2086
exec /app/chat_server $ARGS
