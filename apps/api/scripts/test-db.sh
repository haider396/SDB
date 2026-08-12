#!/usr/bin/env bash
# test-db.sh — local scratch Postgres 15 cluster for the integration suite.
#
# Docker is not available on every dev machine; CI uses @testcontainers/postgresql
# instead (see tests/integration/global-setup.ts, which prefers TEST_DATABASE_URL
# when set). This script provisions a throwaway cluster with initdb, serves it on
# TCP 127.0.0.1:54330 (the scratch dir is too deep for a unix socket path), and
# prints the TEST_DATABASE_URL export line.
#
# Usage:
#   bash scripts/test-db.sh            # start (initdb on first run) + print URL
#   bash scripts/test-db.sh stop      # stop the cluster
#   bash scripts/test-db.sh status    # pg_ctl status
#   bash scripts/test-db.sh destroy   # stop + delete the data directory
set -euo pipefail

PGBIN="${PGBIN:-/opt/homebrew/opt/postgresql@15/bin}"
if [[ ! -x "$PGBIN/initdb" ]]; then
  # Fall back to whatever is on PATH (e.g. Linux dev boxes).
  if command -v initdb >/dev/null 2>&1; then
    PGBIN="$(dirname "$(command -v initdb)")"
  else
    echo "error: Postgres binaries not found at $PGBIN and initdb is not on PATH." >&2
    echo "Install postgresql@15 or set PGBIN=/path/to/postgres/bin." >&2
    exit 1
  fi
fi

BASE_DIR="${SDB_PGTEST_DIR:-/private/tmp/claude-501/-Users-haiderjutt-Documents-Projects-Staffing-Done-Better-Portal/fa80047e-909e-4ccf-97f9-33224b1a5eaa/scratchpad/pgtest-it}"
DATA_DIR="$BASE_DIR/data"
LOG_FILE="$BASE_DIR/postgres.log"
PORT="${SDB_PGTEST_PORT:-54330}"
PGUSER_NAME="sdb_it"
URL="postgres://$PGUSER_NAME@127.0.0.1:$PORT/postgres"

# TCP only: the scratchpad path exceeds the unix-socket path limit, so sockets
# go to /tmp purely to keep pg_ctl happy; clients must connect via 127.0.0.1.
SERVER_OPTS="-p $PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=/tmp -c fsync=off -c synchronous_commit=off -c full_page_writes=off"

cmd="${1:-start}"

case "$cmd" in
  start)
    mkdir -p "$BASE_DIR"
    if [[ ! -f "$DATA_DIR/PG_VERSION" ]]; then
      echo "initdb: creating scratch cluster at $DATA_DIR" >&2
      "$PGBIN/initdb" -D "$DATA_DIR" -U "$PGUSER_NAME" --auth=trust --no-locale -E UTF8 >/dev/null
    fi
    if ! "$PGBIN/pg_ctl" -D "$DATA_DIR" status >/dev/null 2>&1; then
      "$PGBIN/pg_ctl" -D "$DATA_DIR" -l "$LOG_FILE" -o "$SERVER_OPTS" -w start >/dev/null
    fi
    "$PGBIN/pg_isready" -h 127.0.0.1 -p "$PORT" -U "$PGUSER_NAME" >/dev/null
    echo "Scratch Postgres 15 running on 127.0.0.1:$PORT (data: $DATA_DIR)" >&2
    echo "export TEST_DATABASE_URL=$URL"
    ;;
  stop)
    if "$PGBIN/pg_ctl" -D "$DATA_DIR" status >/dev/null 2>&1; then
      "$PGBIN/pg_ctl" -D "$DATA_DIR" -m fast -w stop >/dev/null
      echo "stopped" >&2
    else
      echo "not running" >&2
    fi
    ;;
  status)
    "$PGBIN/pg_ctl" -D "$DATA_DIR" status
    ;;
  destroy)
    "$PGBIN/pg_ctl" -D "$DATA_DIR" -m immediate -w stop >/dev/null 2>&1 || true
    rm -rf "$DATA_DIR"
    echo "destroyed $DATA_DIR" >&2
    ;;
  *)
    echo "usage: $0 [start|stop|status|destroy]" >&2
    exit 2
    ;;
esac
