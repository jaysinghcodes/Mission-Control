#!/usr/bin/env bash
# Mission Control installer.
# One command writes random tokens, starts the stack, runs doctor, and prints the URL.
# Docker is the default. If the docker command is missing, this uses Node.js 22 and Postgres 16.
# When the openclaw command is on PATH, this installs a bridge schedule.
# Linux uses a systemd user timer, or cron when that timer is not available.
# macOS uses launchd. The schedule PATH includes the openclaw directory and the python3 directory.
# Remove it with: bash install.sh --uninstall-schedule. That also removes the sync timestamp.
# A second run keeps tokens and secrets already in .env.
# DATABASE_URL uses the resolved MC_DB_PORT. A later run can update that port.
# Token values are not printed.

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

file_env_value() {
  local file key line value
  file="$1"
  key="$2"
  line="$(grep -E "^[[:space:]]*${key}=" "$file" 2>/dev/null | tail -n 1 || true)"
  value="${line#*=}"
  value="${value#\"}"
  value="${value%\"}"
  value="${value#\'}"
  value="${value%\'}"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s' "$value"
}

env_value() {
  file_env_value .env "$1"
}

env_file_mode() {
  local file mode
  file="$1"
  mode="$(stat -c '%a' "$file" 2>/dev/null || stat -f '%OLp' "$file" 2>/dev/null || true)"
  printf '%s' "$mode"
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

# Shell, then .env, then the default. A blank shell value does not hide .env.
resolved_port() {
  local key fallback chosen
  key="$1"
  fallback="$2"
  chosen="${!key-}"
  if [[ -z "$chosen" ]]; then
    chosen="$(env_value "$key")"
  fi
  port_or "$chosen" "$fallback"
}

# Same order as resolved_port, for values that are not port numbers.
resolved_value() {
  local key fallback chosen
  key="$1"
  fallback="$2"
  chosen="${!key-}"
  if [[ -z "$chosen" ]]; then
    chosen="$(env_value "$key")"
  fi
  if [[ -z "$chosen" ]]; then
    printf '%s' "$fallback"
  else
    printf '%s' "$chosen"
  fi
}

positive_int() {
  local value fallback
  value="$1"
  fallback="$2"
  if [[ "$value" =~ ^[0-9]+$ ]] && [[ "$value" -ge 1 ]]; then
    printf '%s' "$value"
  else
    printf '%s' "$fallback"
  fi
}

web_port() {
  resolved_port MC_WEB_PORT "5173"
}

api_port() {
  port_or "$(env_value PORT)" "3000"
}

docker_api_port() {
  resolved_port MC_API_PORT "3000"
}

db_port() {
  resolved_port MC_DB_PORT "5432"
}

# Shell, then the named file, then the default. Used while .env is still a temp file.
resolved_port_file() {
  local key fallback file chosen
  key="$1"
  fallback="$2"
  file="$3"
  chosen="${!key-}"
  if [[ -z "$chosen" ]]; then
    chosen="$(file_env_value "$file" "$key")"
  fi
  port_or "$chosen" "$fallback"
}

# Keep the user, password, host, database, and query. Change only the port.
database_url_with_port() {
  local url port head explicit path
  url="$1"
  port="$2"
  if [[ ! "$url" =~ ^postgres(ql)?:// ]]; then
    printf '%s' "$url"
    return 0
  fi
  if [[ "$url" =~ ^(postgres(ql)?://([^@/]+@)?(\[[^]]+\]|[^:/?#]+)):([0-9]+)([/?].*)?$ ]]; then
    head="${BASH_REMATCH[1]}"
    explicit="${BASH_REMATCH[5]}"
    path="${BASH_REMATCH[6]-}"
    if [[ "$explicit" == "$port" ]]; then
      printf '%s' "$url"
      return 0
    fi
    printf '%s:%s%s' "$head" "$port" "$path"
    return 0
  fi
  if [[ "$url" =~ ^(postgres(ql)?://([^@/]+@)?(\[[^]]+\]|[^:/?#]+))([/?].*)?$ ]]; then
    if [[ "$port" == "5432" ]]; then
      printf '%s' "$url"
      return 0
    fi
    head="${BASH_REMATCH[1]}"
    path="${BASH_REMATCH[5]-}"
    printf '%s:%s%s' "$head" "$port" "$path"
    return 0
  fi
  printf '%s' "$url"
}

apply_shell_ports() {
  local file key value tmp2 line saw wrote
  file="$1"
  wrote=0
  for key in MC_DB_PORT MC_API_PORT MC_WEB_PORT; do
    value="${!key-}"
    if [[ ! "$value" =~ ^[0-9]+$ ]] || [[ "$value" -lt 1 ]] || [[ "$value" -gt 65535 ]]; then
      continue
    fi
    saw=0
    tmp2="$(mktemp "${TMPDIR:-/tmp}/mc-env.XXXXXX")"
    while IFS= read -r line || [[ -n "$line" ]]; do
      case "$line" in
        "${key}="*|export\ "${key}="*|"# ${key}="*|"#${key}="*)
          printf '%s=%s\n' "$key" "$value"
          saw=1
          ;;
        *)
          printf '%s\n' "$line"
          ;;
      esac
    done < "$file" > "$tmp2"
    if [[ "$saw" -eq 0 ]]; then
      printf '%s=%s\n' "$key" "$value" >> "$tmp2"
    fi
    mv "$tmp2" "$file"
    wrote=1
  done
  if [[ "$wrote" -eq 1 ]]; then
    echo "Wrote host port values from the environment into .env."
  fi
}

write_env_key() {
  local file key value tmp2 line saw
  file="$1"
  key="$2"
  value="$3"
  saw=0
  tmp2="$(mktemp "${TMPDIR:-/tmp}/mc-env.XXXXXX")"
  while IFS= read -r line || [[ -n "$line" ]]; do
    case "$line" in
      "${key}="*|export\ "${key}="*|"# ${key}="*|"#${key}="*)
        printf '%s=%s\n' "$key" "$value"
        saw=1
        ;;
      *)
        printf '%s\n' "$line"
        ;;
    esac
  done < "$file" > "$tmp2"
  if [[ "$saw" -eq 0 ]]; then
    printf '%s=%s\n' "$key" "$value" >> "$tmp2"
  fi
  mv "$tmp2" "$file"
}

# A shell MC_DB_PORT replaces the value in an existing file. Other keys stay.
persist_shell_db_port() {
  local file value current
  file="$1"
  MC_DB_PORT_UPDATED=0
  value="${MC_DB_PORT-}"
  if [[ ! "$value" =~ ^[0-9]+$ ]] || [[ "$value" -lt 1 ]] || [[ "$value" -gt 65535 ]]; then
    return 0
  fi
  current="$(file_env_value "$file" MC_DB_PORT)"
  if [[ "$current" == "$value" ]]; then
    return 0
  fi
  write_env_key "$file" MC_DB_PORT "$value"
  MC_DB_PORT_UPDATED=1
}

# Point DATABASE_URL at the resolved port. A missing key is added only when
# allow_create is 1 (a new .env). Tokens and other secrets are not touched.
sync_database_url() {
  local file port allow current next
  file="$1"
  port="$2"
  allow="${3:-0}"
  MC_DATABASE_URL_UPDATED=0
  current="$(file_env_value "$file" DATABASE_URL)"
  if [[ -z "$current" ]]; then
    if [[ "$allow" != "1" ]]; then
      return 0
    fi
    next="postgresql://postgres:postgres@localhost:${port}/mission_control"
  else
    next="$(database_url_with_port "$current" "$port")"
    if [[ "$next" == "$current" ]]; then
      return 0
    fi
  fi
  write_env_key "$file" DATABASE_URL "$next"
  MC_DATABASE_URL_UPDATED=1
  echo "Set DATABASE_URL to port ${port}."
}

# Shell values for a new .env only. An existing .env is never rewritten.
apply_shell_schedule() {
  local file wrote value
  file="$1"
  wrote=0
  value="${MC_BRIDGE_INTERVAL_SECONDS-}"
  if [[ "$value" =~ ^[0-9]+$ ]] && [[ "$value" -ge 1 ]]; then
    write_env_key "$file" MC_BRIDGE_INTERVAL_SECONDS "$value"
    wrote=1
  fi
  value="${MC_BRIDGE_STALE_SECONDS-}"
  if [[ "$value" =~ ^[0-9]+$ ]] && [[ "$value" -ge 1 ]]; then
    write_env_key "$file" MC_BRIDGE_STALE_SECONDS "$value"
    wrote=1
  fi
  value="${MC_BRIDGE_REGISTER-}"
  if [[ "$value" =~ ^(0|1|true|false|yes|no)$ ]]; then
    write_env_key "$file" MC_BRIDGE_REGISTER "$value"
    wrote=1
  fi
  value="${MC_API_URL-}"
  if [[ "$value" =~ ^https?://[^[:space:]]+$ ]]; then
    write_env_key "$file" MC_API_URL "$value"
    wrote=1
  fi
  value="${MC_BRIDGE_SCHEDULER-}"
  if [[ "$value" == "systemd" || "$value" == "launchd" || "$value" == "cron" ]]; then
    write_env_key "$file" MC_BRIDGE_SCHEDULER "$value"
    wrote=1
  fi
  value="${MC_BRIDGE_PATH-}"
  if [[ -n "$value" && "$value" != *$'\n'* && "$value" != *[[:space:]]* ]]; then
    write_env_key "$file" MC_BRIDGE_PATH "$value"
    wrote=1
  fi
  if [[ "$wrote" -eq 1 ]]; then
    echo "Wrote bridge schedule values from the environment into .env."
  fi
  return 0
}

ensure_env() {
  local ingest socket tmp old_umask saw_ingest saw_socket line
  local got_ingest got_socket mode
  if [[ -f .env ]]; then
    mode="$(env_file_mode .env)"
    persist_shell_db_port .env
    sync_database_url .env "$(db_port)" 0
    if [[ "$MC_DB_PORT_UPDATED" -eq 1 || "$MC_DATABASE_URL_UPDATED" -eq 1 ]]; then
      if [[ -n "$mode" ]]; then
        chmod "$mode" .env || true
      fi
      echo "Tokens and secrets were not changed."
    else
      echo "Keeping the existing .env. Tokens and other values were not changed."
    fi
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
  apply_shell_ports "$tmp"
  apply_shell_schedule "$tmp"
  sync_database_url "$tmp" "$(resolved_port_file MC_DB_PORT 5432 "$tmp")" 1
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
  # The API image has no .git. Pass the commit so /health can show it.
  if [[ -z "${GIT_SHA:-}" ]] && command -v git >/dev/null 2>&1 && git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    GIT_SHA="$(git rev-parse HEAD)"
    export GIT_SHA
  fi
  if ! docker compose up -d --build; then
    echo "Docker Compose did not start the stack." >&2
    exit 1
  fi
  echo "Waiting for the API health check on port $(docker_api_port)."
  wait_on_port "$(docker_api_port)"
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

health_ok_port() {
  local port
  port="$1"
  # Any HTTP 200 on this port is not enough. Only the Mission Control health body counts.
  node -e 'fetch("http://127.0.0.1:" + process.argv[1] + "/health").then(async (res) => { if (!res.ok) process.exit(1); const body = await res.json(); const ok = body && body.service === "mission-control" && body.status === "ok" && body.database === "connected"; process.exit(ok ? 0 : 1); }).catch(() => process.exit(1))' "$port" >/dev/null 2>&1
}

health_ok() {
  health_ok_port "$(api_port)"
}

wait_on_port() {
  local port seconds i
  port="$1"
  seconds="${MC_INSTALL_READY_SECONDS:-90}"
  if [[ "$seconds" == "0" ]]; then
    return 0
  fi
  if [[ ! "$seconds" =~ ^[0-9]+$ ]]; then
    seconds=90
  fi
  i=0
  while [[ "$i" -lt "$seconds" ]]; do
    if health_ok_port "$port"; then
      return 0
    fi
    i=$((i + 1))
    sleep 1
  done
  echo "The API did not answer on port ${port} yet. Doctor will report the health check."
}

wait_ready() {
  wait_on_port "$(api_port)"
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

bridge_interval() {
  positive_int "$(resolved_value MC_BRIDGE_INTERVAL_SECONDS "")" "300"
}

bridge_register() {
  local value
  value="$(resolved_value MC_BRIDGE_REGISTER "")"
  if [[ -z "$value" ]]; then
    printf '1'
    return 0
  fi
  printf '%s' "$value"
}

bridge_script() {
  local configured
  configured="$(resolved_value MC_BRIDGE_SCRIPT "")"
  if [[ -n "$configured" ]]; then
    printf '%s' "$configured"
    return 0
  fi
  printf '%s' "$(pwd)/bridge/mc-bridge-sync.py"
}

bridge_python() {
  local configured found
  configured="$(resolved_value MC_BRIDGE_PYTHON "")"
  if [[ -n "$configured" ]]; then
    printf '%s' "$configured"
    return 0
  fi
  found="$(command -v python3 2>/dev/null || true)"
  printf '%s' "$found"
}

bridge_stamp_file() {
  local configured
  configured="$(resolved_value MC_BRIDGE_STAMP_FILE "")"
  if [[ -n "$configured" ]]; then
    printf '%s' "$configured"
    return 0
  fi
  printf '%s' "$(pwd)/bridge/.state/last-sync"
}

bridge_log_file() {
  local configured
  configured="$(resolved_value MC_BRIDGE_LOG "")"
  if [[ -n "$configured" ]]; then
    printf '%s' "$configured"
    return 0
  fi
  printf '%s' "$(pwd)/bridge/.state/sync.log"
}

bridge_api_url() {
  local configured port
  configured="$(resolved_value MC_API_URL "")"
  if [[ -n "$configured" ]]; then
    printf '%s' "$configured"
    return 0
  fi
  if [[ "${USE_DOCKER:-0}" == "1" ]]; then
    port="$(docker_api_port)"
  else
    port="$(api_port)"
  fi
  printf 'http://127.0.0.1:%s' "$port"
}

safe_name() {
  local value fallback
  value="$1"
  fallback="$2"
  if [[ "$value" =~ ^[A-Za-z0-9._-]+$ ]]; then
    printf '%s' "$value"
  else
    printf '%s' "$fallback"
  fi
}

bridge_unit_name() {
  safe_name "$(resolved_value MC_BRIDGE_UNIT_NAME "")" "mission-control-bridge"
}

cron_mark() {
  safe_name "$(resolved_value MC_BRIDGE_CRON_MARK "")" "mission-control-bridge"
}

launchd_label() {
  safe_name "$(resolved_value MC_BRIDGE_LAUNCHD_LABEL "")" "com.missioncontrol.bridge"
}

systemd_user_dir() {
  local configured
  configured="$(resolved_value MC_BRIDGE_SYSTEMD_DIR "")"
  if [[ -n "$configured" ]]; then
    printf '%s' "$configured"
    return 0
  fi
  if [[ -n "${XDG_CONFIG_HOME:-}" ]]; then
    printf '%s' "${XDG_CONFIG_HOME}/systemd/user"
    return 0
  fi
  if [[ -z "${HOME:-}" ]]; then
    printf '%s' ""
    return 0
  fi
  printf '%s' "${HOME}/.config/systemd/user"
}

launchd_dir() {
  local configured
  configured="$(resolved_value MC_BRIDGE_LAUNCHD_DIR "")"
  if [[ -n "$configured" ]]; then
    printf '%s' "$configured"
    return 0
  fi
  if [[ -z "${HOME:-}" ]]; then
    printf '%s' ""
    return 0
  fi
  printf '%s' "${HOME}/Library/LaunchAgents"
}

systemd_user_ready() {
  command -v systemctl >/dev/null 2>&1 || return 1
  systemctl --user show-environment >/dev/null 2>&1
}

choose_scheduler() {
  local forced os
  forced="$(resolved_value MC_BRIDGE_SCHEDULER "")"
  if [[ -n "$forced" ]]; then
    printf '%s' "$forced"
    return 0
  fi
  os="$(uname -s)"
  if [[ "$os" == "Darwin" ]]; then
    printf '%s' "launchd"
    return 0
  fi
  if systemd_user_ready; then
    printf '%s' "systemd"
    return 0
  fi
  printf '%s' "cron"
}

# Add one directory to a colon separated PATH when it is not already listed.
add_schedule_dir() {
  local current dir
  current="$1"
  dir="$2"
  if [[ -z "$dir" || "$dir" == "." ]]; then
    printf '%s' "$current"
    return 0
  fi
  if [[ ":${current}:" == *":${dir}:"* ]]; then
    printf '%s' "$current"
    return 0
  fi
  if [[ -z "$current" ]]; then
    printf '%s' "$dir"
    return 0
  fi
  printf '%s:%s' "$current" "$dir"
}

# Shell MC_BRIDGE_PATH, then .env, then the openclaw directory, the python3 directory, and PATH.
bridge_schedule_path() {
  local configured bin python_bin acc part old_ifs
  local -a parts
  configured="$(resolved_value MC_BRIDGE_PATH "")"
  if [[ -n "$configured" ]]; then
    printf '%s' "$configured"
    return 0
  fi
  acc=""
  bin="$(command -v openclaw 2>/dev/null || true)"
  if [[ -n "$bin" ]]; then
    acc="$(add_schedule_dir "$acc" "$(dirname "$bin")")"
  fi
  python_bin="$(bridge_python)"
  if [[ -n "$python_bin" && "$python_bin" != */* ]]; then
    python_bin="$(command -v "$python_bin" 2>/dev/null || true)"
  fi
  if [[ -n "$python_bin" ]]; then
    acc="$(add_schedule_dir "$acc" "$(dirname "$python_bin")")"
  fi
  if [[ -n "${PATH:-}" ]]; then
    old_ifs="$IFS"
    IFS=':'
    read -r -a parts <<< "${PATH}"
    IFS="$old_ifs"
    for part in "${parts[@]}"; do
      acc="$(add_schedule_dir "$acc" "$part")"
    done
  fi
  printf '%s' "$acc"
}

sh_quote() {
  local value
  value="$1"
  value="${value//\'/\'\\\'\'}"
  printf "'%s'" "$value"
}

xml_escape() {
  local value
  value="$1"
  value="${value//&/&amp;}"
  value="${value//</&lt;}"
  value="${value//>/&gt;}"
  printf '%s' "$value"
}

systemd_quote() {
  local value
  value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  printf '"%s"' "$value"
}

cron_expr() {
  local seconds minutes hours
  seconds="$1"
  if [[ "$seconds" -lt 60 ]]; then
    printf '%s\n' "* * * * *"
    return 0
  fi
  minutes=$(( (seconds + 59) / 60 ))
  if [[ "$minutes" -le 1 ]]; then
    printf '%s\n' "* * * * *"
    return 0
  fi
  if [[ "$minutes" -lt 60 ]]; then
    printf '*/%s * * * *\n' "$minutes"
    return 0
  fi
  hours=$(( (minutes + 59) / 60 ))
  if [[ "$hours" -le 1 ]]; then
    printf '%s\n' "0 * * * *"
    return 0
  fi
  if [[ "$hours" -lt 24 ]]; then
    printf '0 */%s * * *\n' "$hours"
    return 0
  fi
  printf '%s\n' "0 0 * * *"
}

strip_cron_block() {
  local mark begin end
  mark="$(cron_mark)"
  begin="# BEGIN ${mark}"
  end="# END ${mark}"
  awk -v begin="$begin" -v end="$end" '
    $0 == begin { skip = 1; next }
    $0 == end { skip = 0; next }
    skip != 1 { print }
  '
}

cron_command_line() {
  local schedule
  schedule="$(cron_expr "$(bridge_interval)")"
  schedule="${schedule%$'\n'}"
  printf '%s PATH=%s MC_BRIDGE_REGISTER=%s MC_API_URL=%s MC_BRIDGE_STAMP_FILE=%s %s %s >> %s 2>&1\n' \
    "$schedule" \
    "$(sh_quote "$(bridge_schedule_path)")" \
    "$(sh_quote "$(bridge_register)")" \
    "$(sh_quote "$(bridge_api_url)")" \
    "$(sh_quote "$(bridge_stamp_file)")" \
    "$(sh_quote "$(bridge_python)")" \
    "$(sh_quote "$(bridge_script)")" \
    "$(sh_quote "$(bridge_log_file)")"
}

read_crontab() {
  crontab -l 2>/dev/null || true
}

remove_cron_block() {
  local current filtered tmp
  if ! command -v crontab >/dev/null 2>&1; then
    return 0
  fi
  current="$(read_crontab)"
  if [[ -z "$current" ]]; then
    return 0
  fi
  if ! printf '%s\n' "$current" | grep -F "# BEGIN $(cron_mark)" >/dev/null 2>&1; then
    return 0
  fi
  filtered="$(printf '%s\n' "$current" | strip_cron_block)"
  filtered="$(printf '%s\n' "$filtered" | sed -e '${/^$/d;}')"
  if [[ -z "$(printf '%s' "$filtered" | tr -d '[:space:]')" ]]; then
    crontab -r >/dev/null 2>&1 || true
    return 0
  fi
  tmp="$(mktemp "${TMPDIR:-/tmp}/mc-cron.XXXXXX")"
  printf '%s\n' "$filtered" > "$tmp"
  crontab - < "$tmp"
  rm -f "$tmp"
}

install_cron_schedule() {
  local current filtered tmp mark
  if ! command -v crontab >/dev/null 2>&1; then
    echo "crontab was not found, so the bridge schedule was not installed."
    return 0
  fi
  mark="$(cron_mark)"
  current="$(read_crontab)"
  if [[ -n "$current" ]]; then
    filtered="$(printf '%s\n' "$current" | strip_cron_block)"
    filtered="$(printf '%s\n' "$filtered" | sed -e '${/^$/d;}')"
  else
    filtered=""
  fi
  tmp="$(mktemp "${TMPDIR:-/tmp}/mc-cron.XXXXXX")"
  if [[ -n "$(printf '%s' "$filtered" | tr -d '[:space:]')" ]]; then
    printf '%s\n\n' "$filtered" > "$tmp"
  else
    : > "$tmp"
  fi
  {
    printf '%s\n' "# BEGIN ${mark}"
    cron_command_line
    printf '%s\n' "# END ${mark}"
  } >> "$tmp"
  if ! crontab - < "$tmp"; then
    rm -f "$tmp"
    echo "crontab could not be updated, so the bridge schedule was not installed."
    return 0
  fi
  rm -f "$tmp"
  echo "Installed the bridge schedule with cron. It runs every $(bridge_interval) seconds, rounded up to whole minutes by cron. Remove it with: bash install.sh --uninstall-schedule"
}

remove_systemd_units() {
  local dir unit removed
  dir="$(systemd_user_dir)"
  unit="$(bridge_unit_name)"
  if [[ -z "$dir" ]]; then
    return 0
  fi
  removed=0
  if [[ -f "${dir}/${unit}.timer" || -f "${dir}/${unit}.service" ]]; then
    removed=1
    if command -v systemctl >/dev/null 2>&1; then
      systemctl --user disable --now "${unit}.timer" >/dev/null 2>&1 || true
      systemctl --user stop "${unit}.service" >/dev/null 2>&1 || true
    fi
    rm -f "${dir}/${unit}.timer" "${dir}/${unit}.service"
  fi
  if [[ "$removed" -eq 1 ]] && command -v systemctl >/dev/null 2>&1; then
    systemctl --user daemon-reload >/dev/null 2>&1 || true
  fi
}

# systemd treats quotes on WorkingDirectory as part of the path.
systemd_path() {
  local value
  value="$1"
  value="${value//\\/\\\\}"
  value="${value// /\\ }"
  printf '%s' "$value"
}

write_systemd_units() {
  local dir unit py script work api register stamp interval schedule_path service timer
  dir="$(systemd_user_dir)"
  unit="$(bridge_unit_name)"
  py="$(bridge_python)"
  script="$(bridge_script)"
  work="$(pwd)"
  api="$(bridge_api_url)"
  register="$(bridge_register)"
  stamp="$(bridge_stamp_file)"
  interval="$(bridge_interval)"
  schedule_path="$(bridge_schedule_path)"
  mkdir -p "$dir"
  service="${dir}/${unit}.service"
  timer="${dir}/${unit}.timer"
  cat > "$service" <<EOF
[Unit]
Description=Mission Control OpenClaw bridge sync

[Service]
Type=oneshot
WorkingDirectory=$(systemd_path "$work")
Environment="MC_BRIDGE_REGISTER=${register}"
Environment="MC_API_URL=${api}"
Environment="MC_BRIDGE_STAMP_FILE=${stamp}"
Environment=$(systemd_quote "PATH=${schedule_path}")
ExecStart=$(systemd_quote "$py") $(systemd_quote "$script")
EOF
  cat > "$timer" <<EOF
[Unit]
Description=Mission Control OpenClaw bridge schedule

[Timer]
OnBootSec=${interval}s
OnUnitActiveSec=${interval}s
Persistent=true

[Install]
WantedBy=timers.target
EOF
}

install_systemd_schedule() {
  local unit
  if ! command -v systemctl >/dev/null 2>&1; then
    echo "systemctl was not found, so the systemd bridge schedule was not installed."
    return 0
  fi
  unit="$(bridge_unit_name)"
  write_systemd_units
  if ! systemctl --user daemon-reload; then
    echo "systemctl could not reload the user manager. The bridge schedule was not installed."
    return 0
  fi
  if ! systemctl --user enable --now "${unit}.timer"; then
    echo "systemctl could not enable the bridge timer. The bridge schedule was not installed."
    return 0
  fi
  remove_cron_block
  remove_launchd_agent
  echo "Installed the bridge schedule with a systemd user timer. It runs every $(bridge_interval) seconds. Remove it with: bash install.sh --uninstall-schedule"
}

remove_launchd_agent() {
  local dir label plist uid
  dir="$(launchd_dir)"
  label="$(launchd_label)"
  if [[ -z "$dir" ]]; then
    return 0
  fi
  plist="${dir}/${label}.plist"
  if [[ ! -f "$plist" ]]; then
    return 0
  fi
  if command -v launchctl >/dev/null 2>&1; then
    uid="$(id -u)"
    launchctl bootout "gui/${uid}/${label}" >/dev/null 2>&1 || true
    launchctl unload "$plist" >/dev/null 2>&1 || true
  fi
  rm -f "$plist"
}

write_launchd_plist() {
  local dir label plist py script work api register stamp log interval schedule_path
  dir="$(launchd_dir)"
  label="$(launchd_label)"
  py="$(bridge_python)"
  script="$(bridge_script)"
  work="$(pwd)"
  api="$(bridge_api_url)"
  register="$(bridge_register)"
  stamp="$(bridge_stamp_file)"
  log="$(bridge_log_file)"
  interval="$(bridge_interval)"
  schedule_path="$(bridge_schedule_path)"
  mkdir -p "$dir"
  plist="${dir}/${label}.plist"
  cat > "$plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$(xml_escape "$label")</string>
  <key>ProgramArguments</key>
  <array>
    <string>$(xml_escape "$py")</string>
    <string>$(xml_escape "$script")</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$(xml_escape "$work")</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>MC_BRIDGE_REGISTER</key>
    <string>$(xml_escape "$register")</string>
    <key>MC_API_URL</key>
    <string>$(xml_escape "$api")</string>
    <key>MC_BRIDGE_STAMP_FILE</key>
    <string>$(xml_escape "$stamp")</string>
    <key>PATH</key>
    <string>$(xml_escape "$schedule_path")</string>
  </dict>
  <key>StartInterval</key>
  <integer>${interval}</integer>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>$(xml_escape "$log")</string>
  <key>StandardErrorPath</key>
  <string>$(xml_escape "${log}.err")</string>
</dict>
</plist>
EOF
}

install_launchd_schedule() {
  local dir label plist uid domain
  if ! command -v launchctl >/dev/null 2>&1; then
    echo "launchctl was not found, so the bridge schedule was not installed."
    return 0
  fi
  dir="$(launchd_dir)"
  label="$(launchd_label)"
  plist="${dir}/${label}.plist"
  write_launchd_plist
  uid="$(id -u)"
  domain="gui/${uid}"
  launchctl bootout "${domain}/${label}" >/dev/null 2>&1 || true
  if ! launchctl bootstrap "$domain" "$plist"; then
    if ! launchctl load "$plist"; then
      echo "launchctl could not load the bridge schedule."
      return 0
    fi
  fi
  launchctl enable "${domain}/${label}" >/dev/null 2>&1 || true
  remove_cron_block
  remove_systemd_units
  echo "Installed the bridge schedule with launchd. It runs every $(bridge_interval) seconds. Remove it with: bash install.sh --uninstall-schedule"
}

offer_starter() {
  local config
  config="${HOME:-.}/.openclaw/openclaw.json"
  echo "Optional: merge bridge/openclaw.starter.json into ${config}. Do not replace that file. The starter sets maxChildrenPerAgent to 3 and maxConcurrent to 4. This installer does not edit that file."
}

run_bridge_now() {
  local flag py script code
  flag="$(resolved_value MC_BRIDGE_RUN_NOW "")"
  if [[ -z "$flag" ]]; then
    flag="1"
  fi
  if [[ "$flag" == "0" || "$flag" == "false" || "$flag" == "no" ]]; then
    return 0
  fi
  py="$(bridge_python)"
  script="$(bridge_script)"
  if [[ -z "$py" || ! -f "$script" ]]; then
    return 0
  fi
  echo "Running the bridge once so a successful sync can record a timestamp before the next interval."
  set +e
  MC_BRIDGE_REGISTER="$(bridge_register)" \
    MC_API_URL="$(bridge_api_url)" \
    MC_BRIDGE_STAMP_FILE="$(bridge_stamp_file)" \
    "$py" "$script" >> "$(bridge_log_file)" 2>&1
  code=$?
  set -e
  if [[ "$code" -ne 0 ]]; then
    echo "The first bridge run exited ${code}. The schedule is still installed."
  fi
}

install_bridge_schedule() {
  local script py scheduler
  if ! command -v openclaw >/dev/null 2>&1; then
    echo "OpenClaw was not found on PATH. Skipping the bridge schedule. npm run seed:demo still fills sample data."
    return 0
  fi
  script="$(bridge_script)"
  py="$(bridge_python)"
  if [[ ! -f "$script" ]]; then
    echo "The bridge script was not found, so the schedule was not installed. The rest of the install continues."
    offer_starter
    return 0
  fi
  if [[ -z "$py" ]]; then
    echo "Python 3 was not found, so the bridge schedule was not installed. The rest of the install continues."
    offer_starter
    return 0
  fi
  mkdir -p "$(dirname "$(bridge_stamp_file)")" "$(dirname "$(bridge_log_file)")"
  scheduler="$(choose_scheduler)"
  case "$scheduler" in
    systemd)
      install_systemd_schedule
      ;;
    launchd)
      install_launchd_schedule
      ;;
    cron)
      install_cron_schedule
      ;;
    *)
      echo "The bridge scheduler ${scheduler} is not supported. Use systemd, launchd, or cron."
      offer_starter
      return 0
      ;;
  esac
  offer_starter
  run_bridge_now
}

uninstall_schedule() {
  local stamp
  remove_systemd_units
  remove_launchd_agent
  remove_cron_block
  stamp="$(bridge_stamp_file)"
  if [[ -n "$stamp" && -f "$stamp" ]]; then
    rm -f -- "$stamp"
    echo "The bridge schedule is uninstalled. The sync timestamp was removed."
    return 0
  fi
  echo "The bridge schedule is uninstalled."
}

finish() {
  local doctor_code url
  doctor_code=0
  if command -v node >/dev/null 2>&1 && [[ -f scripts/doctor.mjs ]]; then
    set +e
    if [[ "${USE_DOCKER:-0}" == "1" ]]; then
      MC_DOCTOR_DOCKER=1 MC_API_PORT="$(docker_api_port)" node scripts/doctor.mjs
    else
      node scripts/doctor.mjs
    fi
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
  echo "OpenClaw is optional. This install does not start the OpenClaw gateway. When the openclaw command is on PATH, the bridge schedule is installed. npm run seed:demo fills sample data without OpenClaw."
  exit "$doctor_code"
}

main() {
  local action
  action="install"
  if [[ "${1:-}" == "--uninstall-schedule" ]]; then
    action="uninstall"
    shift
  fi
  if [[ $# -gt 0 ]]; then
    echo "Unknown argument. Run bash install.sh to install, or bash install.sh --uninstall-schedule to remove the bridge schedule." >&2
    exit 1
  fi
  if ! enter_repo; then
    if [[ "$action" == "uninstall" ]]; then
      echo "Run bash install.sh --uninstall-schedule from a Mission Control checkout." >&2
      exit 1
    fi
    clone_and_reexec
  fi
  if [[ "$action" == "uninstall" ]]; then
    uninstall_schedule
    exit 0
  fi
  ensure_env
  USE_DOCKER=0
  if have_docker; then
    USE_DOCKER=1
    start_docker
  else
    start_native
  fi
  install_bridge_schedule
  finish
}

main "$@"
