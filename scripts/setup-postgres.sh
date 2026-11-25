#!/usr/bin/env bash
# Prepares a LOCAL PostgreSQL (Debian/Ubuntu) with the credentials this project expects:
#   host localhost · port 5432 · database postgres · user postgres · password 123456
# Alternative without a local install:  docker compose up -d postgres
set -euo pipefail

if ! command -v psql >/dev/null 2>&1; then
  echo "Installing PostgreSQL…"
  sudo apt-get update -y && sudo apt-get install -y postgresql postgresql-contrib
fi

# start the server if it is not running (works for the Debian cluster layout and systemd)
if ! pg_isready -h localhost -p 5432 >/dev/null 2>&1; then
  if command -v pg_lsclusters >/dev/null 2>&1; then
    read -r VER NAME _ < <(pg_lsclusters --no-header | head -n1)
    sudo pg_ctlcluster "$VER" "$NAME" start || true
  else
    sudo systemctl start postgresql || true
  fi
  sleep 3
fi

sudo -u postgres psql -v ON_ERROR_STOP=1 -c "ALTER USER postgres WITH PASSWORD '123456';"
PGPASSWORD=123456 psql -h localhost -p 5432 -U postgres -d postgres -c "select 'connected as ' || current_user || ' to ' || current_database() as ok;"
echo "PostgreSQL is ready on localhost:5432 (db=postgres user=postgres password=123456)."
