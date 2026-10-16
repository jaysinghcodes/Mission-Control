#!/bin/sh
# Postgres 16 for the native installer. Ubuntu uses the distro package, or
# the Postgres apt repo when that package is absent. macOS uses Homebrew.
set -eu

wait_ready() {
  i=0
  while [ "$i" -lt 30 ]; do
    if pg_isready -h 127.0.0.1 -p 5432 >/dev/null 2>&1; then
      return 0
    fi
    i=$((i + 1))
    sleep 1
  done
  echo "Postgres did not accept connections on 127.0.0.1:5432." >&2
  return 1
}

if [ "$(uname -s)" = "Darwin" ]; then
  export HOMEBREW_NO_AUTO_UPDATE=1
  export HOMEBREW_NO_ENV_HINTS=1
  brew install postgresql@16
  prefix="$(brew --prefix postgresql@16)"
  if [ -n "${GITHUB_PATH:-}" ]; then
    echo "$prefix/bin" >> "$GITHUB_PATH"
  fi
  export PATH="$prefix/bin:$PATH"
  data="$(brew --prefix)/var/postgresql@16"
  if [ ! -d "$data" ]; then
    initdb --locale=C -E UTF-8 "$data"
  fi
  if ! pg_isready -h 127.0.0.1 -p 5432 >/dev/null 2>&1; then
    pg_ctl -D "$data" -l /tmp/postgres16.log start
  fi
else
  sudo apt-get update
  if ! apt-cache show postgresql-16 >/dev/null 2>&1; then
    sudo apt-get install -y curl ca-certificates
    sudo install -d /usr/share/postgresql-common/pgdg
    sudo curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc
    . /etc/os-release
    echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt ${VERSION_CODENAME}-pgdg main" | sudo tee /etc/apt/sources.list.d/pgdg.list >/dev/null
    sudo apt-get update
  fi
  sudo apt-get install -y postgresql-16 postgresql-client-16
  sudo pg_ctlcluster 16 main start || true
fi

wait_ready

if [ "$(uname -s)" = "Darwin" ]; then
  createuser -s postgres 2>/dev/null || true
  psql -d postgres -c "ALTER USER postgres WITH PASSWORD 'postgres';"
  if ! psql -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = 'mission_control'" | grep -q 1; then
    createdb -O postgres mission_control
  fi
else
  sudo -u postgres psql -c "ALTER USER postgres WITH PASSWORD 'postgres';"
  if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname = 'mission_control'" | grep -q 1; then
    sudo -u postgres createdb -O postgres mission_control
  fi
fi

ver="$(psql "postgresql://postgres:postgres@127.0.0.1:5432/mission_control" -tAc "SHOW server_version")"
echo "Postgres ${ver}"
case "$ver" in
  16*) ;;
  *)
    echo "Native install needs Postgres 16. This machine has ${ver}." >&2
    exit 1
    ;;
esac
