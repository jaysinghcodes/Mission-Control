#!/usr/bin/env bash
# Mission Control installer.
# One command writes random tokens, starts the stack, runs doctor, and prints the URL.
# Docker is the default. If the docker command is missing, this uses Node.js 22 and Postgres 16.
# A second run keeps every value already in .env. Token values are not printed.

set -euo pipefail

enter_repo() {
  local src dir
  src=""
  if [[ ${#BASH_SOURCE[@]} -gt 0 ]]; then
    src="${BASH_SOURCE[0]}"
  fi
  if [[ -z "$src" || "$src" == "bash" || "$src" == "-" || ! -f "$src" ]]; then
    return 1
  fi
  dir="$(cd "$(dirname "$src")" && pwd)" || return 1
  if [[ ! -f "$dir/docker-compose.yml" || ! -f "$dir/.env.example" ]]; then
    return 1
  fi
  cd "$dir" || return 1
}

clone_and_reexec() {
  local dest url
  dest="mission-control"
  url="https://github.com/jaysinghcodes/Mission-Control.git"
  if [[ -e "$dest" && ! -d "$dest/.git" ]]; then
    echo "Refusing to clone into ${dest} because that path already exists." >&2
    exit 1
  fi
  if [[ -d "$dest/.git" ]]; then
    echo "Using the existing clone at ${dest}."
  else
    echo "Cloning Mission Control."
    if ! git clone "$url" "$dest"; then
      echo "Could not clone Mission Control." >&2
      exit 1
    fi
  fi
  exec bash "$dest/install.sh"
}

new_token() {
  local token
  token="$(openssl rand -hex 24)" || return 1
  if [[ ! "$token" =~ ^[0-9a-f]{48}$ ]]; then
    echo "Could not generate a random token." >&2
    return 1
  fi
  printf '%s' "$token"
}

env_value() {
  local key line value
  key="$1"
  line="$(grep -E "^[[:space:]]*${key}=" .env 2>/dev/null | tail -n 1 || true)"
  value="${line#*=}"
  value="${value#\"}"
  value="${value%\"}"
  value="${value#\'}"
  value="${value%\'}"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s' "$value"
}

port_or() {
  local value fallback
  value="$1"
  fallback="$2"
  if [[ "$value" =~ ^[0-9]+$ ]] && [[ "$value" -ge 1 ]] && [[ "$value" -le 65535 ]]; then
    printf '%s' "$value"
  else
    printf '%s' "$fallback"
  fi
}

web_port() {
  port_or "$(env_value MC_WEB_PORT)" "5173"
}

api_port() {
  port_or "$(env_value PORT)" "3000"
}

db_port() {
  port_or "$(env_value MC_DB_PORT)" "5432"
}

ensure_env() {
  local ingest socket tmp old_umask saw_ingest saw_socket line
  local got_ingest got_socket
  if [[ -f .env ]]; then
    echo "Keeping the existing .env. Tokens and other values were not changed."
    return 0
  fi
  if [[ ! -f .env.example ]]; then
    echo ".env.example is missing, so .env was not created." >&2
    exit 1
  fi
  ingest="$(new_token)" || exit 1
  socket="$(new_token)" || exit 1
  while [[ "$socket" == "$ingest" ]]; do
    socket="$(new_token)" || exit 1
  done
  old_umask="$(umask)"
  umask 077
  tmp="$(mktemp "${TMPDIR:-/tmp}/mc-env.XXXXXX")"
  saw_ingest=0
  saw_socket=0
  while IFS= read -r line || [[ -n "$line" ]]; do
    case "$line" in
      INGEST_TOKEN=*|export\ INGEST_TOKEN=*)
        printf 'INGEST_TOKEN=%s\n' "$ingest"
        saw_ingest=1
        ;;
      SOCKET_TOKEN=*|export\ SOCKET_TOKEN=*)
        printf 'SOCKET_TOKEN=%s\n' "$socket"
        saw_socket=1
        ;;
      *)
        printf '%s\n' "$line"
        ;;
    esac
  done < .env.example > "$tmp"
  if [[ "$saw_ingest" -eq 0 ]]; then
    printf 'INGEST_TOKEN=%s\n' "$ingest" >> "$tmp"
  fi
  if [[ "$saw_socket" -eq 0 ]]; then
    printf 'SOCKET_TOKEN=%s\n' "$socket" >> "$tmp"
  fi
  chmod 600 "$tmp"
  mv "$tmp" .env
  umask "$old_umask"
  got_ingest="$(env_value INGEST_TOKEN)"
  got_socket="$(env_value SOCKET_TOKEN)"
  if [[ "$got_ingest" == "$got_socket" || ! "$got_ingest" =~ ^[0-9a-f]{48}$ || ! "$got_socket" =~ ^[0-9a-f]{48}$ ]]; then
    rm -f .env
    echo "Refusing to start because the new .env tokens are not two different random values." >&2
    exit 1
  fi
  if grep -E '^INGEST_TOKEN=change-me$' .env >/dev/null 2>&1 || grep -E '^SOCKET_TOKEN=$' .env >/dev/null 2>&1; then
    rm -f .env
    echo "Refusing to start because the new .env still has a placeholder token." >&2
    exit 1
  fi
  echo "Wrote INGEST_TOKEN and SOCKET_TOKEN to .env."
}

have_docker() {
  command -v docker >/dev/null 2>&1 || return 1
  docker compose version >/dev/null 2>&1
}

start_docker() {
  echo "Starting the stack with Docker Compose."
  if ! docker compose up -d --build; then
    echo "Docker Compose did not start the stack." >&2
    exit 1
  fi
}

require_node_22() {
  local ver major minor
  if ! command -v node >/dev/null 2>&1; then
    echo "Node.js 22 was not found. Install Node.js 22.9 or newer, then run bash install.sh again."
    exit 1
  fi
  ver="$(node -v 2>/dev/null || true)"
  major="${ver#v}"
  major="${major%%.*}"
  minor="${ver#v}"
  minor="${minor#*.}"
  minor="${minor%%.*}"
  if [[ ! "$major" =~ ^[0-9]+$ || ! "$minor" =~ ^[0-9]+$ ]]; then
    echo "Node.js ${ver} is not a supported native runtime. Install Node.js 22.9 or newer, then run bash install.sh again."
    exit 1
  fi
  if [[ "$major" -ne 22 || "$minor" -lt 9 ]]; then
    echo "Node.js ${ver} is not a supported native runtime. Install Node.js 22.9 or newer, then run bash install.sh again."
    exit 1
  fi
}

require_postgres_16() {
  local port ver
  port="$(db_port)"
  if ! command -v pg_isready >/dev/null 2>&1; then
    echo "pg_isready is not on PATH. The native path needs Postgres 16. Install the Postgres 16 client tools, then run bash install.sh again."
    exit 1
  fi
  if ! pg_isready -h 127.0.0.1 -p "$port" >/dev/null 2>&1; then
    echo "Postgres is not accepting connections on 127.0.0.1:${port}. The native path needs Postgres 16. Start it, then run bash install.sh again."
    exit 1
  fi
  if ! command -v psql >/dev/null 2>&1; then
    echo "psql is not on PATH, so the Postgres version was not read. Continuing because pg_isready succeeded. This path expects Postgres 16."
    return 0
  fi
  ver="$(psql "postgresql://postgres:postgres@127.0.0.1:${port}/postgres" -tAc "SHOW server_version" -w 2>/dev/null || true)"
  ver="${ver#"${ver%%[![:space:]]*}"}"
  ver="${ver%"${ver##*[![:space:]]}"}"
  case "$ver" in
    16*) ;;
    "")
      echo "Could not read the Postgres version on 127.0.0.1:${port}. The native path needs Postgres 16 with the local default login from .env.example (user postgres, password postgres)."
      exit 1
      ;;
    *)
      echo "Postgres ${ver} is running on 127.0.0.1:${port}. The native path needs Postgres 16."
      exit 1
      ;;
  esac
}

health_ok() {
  local port
  port="$(api_port)"
  # Any HTTP 200 on this port is not enough. Only the Mission Control health body counts.
  node -e 'fetch("http://127.0.0.1:" + process.argv[1] + "/health").then(async (res) => { if (!res.ok) process.exit(1); const body = await res.json(); const ok = body && body.service === "mission-control" && body.status === "ok" && body.database === "connected"; process.exit(ok ? 0 : 1); }).catch(() => process.exit(1))' "$port" >/dev/null 2>&1
}

wait_ready() {
  local seconds i
  seconds="${MC_INSTALL_READY_SECONDS:-90}"
  if [[ "$seconds" == "0" ]]; then
    return 0
  fi
  if [[ ! "$seconds" =~ ^[0-9]+$ ]]; then
    seconds=90
  fi
  i=0
  while [[ "$i" -lt "$seconds" ]]; do
    if health_ok; then
      return 0
    fi
    i=$((i + 1))
    sleep 1
  done
  echo "The API did not answer on port $(api_port) yet. Doctor will report the health check."
}

start_native() {
  echo "Docker was not found. Using the native path. This needs Node.js 22 and Postgres 16."
  require_node_22
  require_postgres_16
  echo "Installing dependencies and starting the API and the web app."
  npm ci
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
  (cd apps/api && npx prisma generate)
  (cd apps/api && npx prisma migrate deploy)
  if health_ok; then
    echo "The API is already up. Leaving that process running."
  else
    nohup npm run dev >> install-dev.log 2>&1 < /dev/null &
    echo "$!" > install-dev.pid
    wait_ready
  fi
}

finish() {
  local doctor_code url
  doctor_code=0
  if command -v node >/dev/null 2>&1 && [[ -f scripts/doctor.mjs ]]; then
    set +e
    node scripts/doctor.mjs
    doctor_code=$?
    set -e
  elif command -v node >/dev/null 2>&1; then
    echo "info doctor: scripts/doctor.mjs is missing, so doctor did not run."
  else
    echo "info node: Node is not on PATH, so doctor did not run. Docker does not need Node on the host. Install Node.js 22 if you want npm run doctor."
  fi
  url="http://localhost:$(web_port)/#/tasks"
  echo "Open ${url}"
  echo "INGEST_TOKEN and SOCKET_TOKEN are in .env"
  echo "OpenClaw is optional. This install does not start it. npm run seed:demo fills sample data without OpenClaw."
  exit "$doctor_code"
}

main() {
  if ! enter_repo; then
    clone_and_reexec
  fi
  ensure_env
  if have_docker; then
    start_docker
  else
    start_native
  fi
  finish
}

main "$@"
