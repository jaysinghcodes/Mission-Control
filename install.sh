#!/usr/bin/env bash
# Mission Control installer.
# One command writes random tokens, starts the stack, runs doctor, and prints the URL.
# Docker is the default. If the docker command is missing, this uses Node.js 22 and Postgres 16.
# When the openclaw command is on PATH, this installs a bridge schedule.
# Linux uses a systemd user timer, or cron when that timer is not available.
# macOS uses launchd. The schedule PATH includes the openclaw directory and the python3 directory.
# Remove it with: bash install.sh --uninstall-schedule. That also removes the sync timestamp.
# A plain second run leaves .env unchanged when the dashboard hash and session secret are already set.
# A new shell MC_DB_PORT updates a stock DATABASE_URL and that port line.
# A custom DATABASE_URL is left as is.
# A missing dashboard password hash or session secret is filled. Other keys stay.
# The ingest token is not printed. A new dashboard password is printed once.
# Before Compose starts, the host docs directory is created as this user.

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

remote_port() {
  resolved_port MC_REMOTE_PORT "3011"
}

# Native listen port. Shell PORT, then shell MC_API_PORT, then .env PORT,
# then .env MC_API_PORT, then 3000. When both names are set, PORT wins.
# MC_API_PORT stays the Compose host port. The container still listens on 3000.
native_api_port() {
  local chosen
  chosen="${PORT-}"
  if [[ -z "$chosen" ]]; then
    chosen="${MC_API_PORT-}"
  fi
  if [[ -z "$chosen" ]]; then
    chosen="$(env_value PORT)"
  fi
  if [[ -z "$chosen" ]]; then
    chosen="$(env_value MC_API_PORT)"
  fi
  port_or "$chosen" "3000"
}

api_port() {
  native_api_port
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
  for key in MC_DB_PORT MC_API_PORT MC_WEB_PORT MC_REMOTE_PORT; do
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

# The port already stored in the file, or 5432 when that line is missing.
stored_db_port() {
  local file value
  file="$1"
  value="$(file_env_value "$file" MC_DB_PORT)"
  port_or "$value" "5432"
}

# A valid MC_DB_PORT from the shell, or empty when the shell did not set one.
shell_db_port() {
  local value
  value="${MC_DB_PORT-}"
  if [[ "$value" =~ ^[0-9]+$ ]] && [[ "$value" -ge 1 ]] && [[ "$value" -le 65535 ]]; then
    printf '%s' "$value"
  fi
}

# Stock means localhost or 127.0.0.1 with an explicit port equal to the previous port.
# A URL with no port is not stock.
database_url_is_stock() {
  local url previous
  url="$1"
  previous="$2"
  [[ "$url" =~ ^postgres(ql)?://([^@/]+@)?(localhost|127\.0\.0\.1):([0-9]+)([/?].*)?$ ]] || return 1
  [[ "${BASH_REMATCH[4]}" == "$previous" ]]
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

# A rerun rewrites DATABASE_URL only when a new shell MC_DB_PORT differs from
# the stored port and the URL is the stock host and port. Otherwise a custom
# URL is left as is. A plain rerun changes no line.
rerun_env_ports() {
  local file previous shell_port current next
  file="$1"
  previous="$(stored_db_port "$file")"
  shell_port="$(shell_db_port)"
  current="$(file_env_value "$file" DATABASE_URL)"
  MC_DB_PORT_UPDATED=0
  MC_DATABASE_URL_UPDATED=0
  if [[ -n "$shell_port" && "$shell_port" != "$previous" ]] && database_url_is_stock "$current" "$previous"; then
    persist_shell_db_port "$file"
    next="$(database_url_with_port "$current" "$shell_port")"
    if [[ "$next" != "$current" ]]; then
      write_env_key "$file" DATABASE_URL "$next"
      MC_DATABASE_URL_UPDATED=1
      echo "Set DATABASE_URL to port ${shell_port}."
    fi
    return 0
  fi
  if [[ -n "$current" ]] && ! database_url_is_stock "$current" "$previous"; then
    echo "DATABASE_URL is custom, so it was left as is. Update its port by hand if needed."
  fi
}

# Point DATABASE_URL at the resolved port when creating .env. A missing key is
# added only when allow_create is 1. Tokens and other secrets are not touched.
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

# Shell PORT, or shell MC_API_PORT when PORT was not set, on a new .env only.
apply_shell_listen_port() {
  local file value
  file="$1"
  value="${PORT-}"
  if [[ ! "$value" =~ ^[0-9]+$ ]] || [[ "$value" -lt 1 ]] || [[ "$value" -gt 65535 ]]; then
    value="${MC_API_PORT-}"
  fi
  if [[ ! "$value" =~ ^[0-9]+$ ]] || [[ "$value" -lt 1 ]] || [[ "$value" -gt 65535 ]]; then
    return 0
  fi
  write_env_key "$file" PORT "$value"
  echo "Wrote the API listen port from the environment into .env."
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

dashboard_secrets_from_node() {
  node -e 'const crypto = require("crypto"); const password = crypto.randomBytes(18).toString("base64url"); const salt = crypto.randomBytes(16); const key = crypto.scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1 }); const hash = ["scrypt", "16384", "8", "1", salt.toString("hex"), key.toString("hex")].join(":"); const secret = crypto.randomBytes(32).toString("hex"); process.stdout.write(password + "\n" + hash + "\n" + secret + "\n");'
}

dashboard_secrets_from_python() {
  python3 -c 'import hashlib, secrets
password = secrets.token_urlsafe(18)
salt = secrets.token_bytes(16)
key = hashlib.scrypt(password.encode(), salt=salt, n=16384, r=8, p=1, dklen=32)
print(password)
print("scrypt:16384:8:1:%s:%s" % (salt.hex(), key.hex()))
print(secrets.token_hex(32))'
}

accept_dashboard_secrets() {
  local raw password hash secret
  raw="$1"
  password="$(printf '%s\n' "$raw" | sed -n '1p')"
  hash="$(printf '%s\n' "$raw" | sed -n '2p')"
  secret="$(printf '%s\n' "$raw" | sed -n '3p')"
  if [[ ! "$hash" =~ ^scrypt:16384:8:1:[0-9a-f]{32}:[0-9a-f]{64}$ ]]; then
    return 1
  fi
  if [[ ! "$secret" =~ ^[0-9a-f]{64}$ ]]; then
    return 1
  fi
  if [[ -z "$password" || "$password" == *$'\n'* ]]; then
    return 1
  fi
  MC_NEW_PASSWORD="$password"
  MC_NEW_HASH="$hash"
  MC_NEW_SECRET="$secret"
}

generate_dashboard_secrets() {
  local raw
  raw=""
  if command -v node >/dev/null 2>&1; then
    raw="$(dashboard_secrets_from_node 2>/dev/null || true)"
    if accept_dashboard_secrets "$raw"; then
      return 0
    fi
  fi
  if command -v python3 >/dev/null 2>&1; then
    raw="$(dashboard_secrets_from_python 2>/dev/null || true)"
    if accept_dashboard_secrets "$raw"; then
      return 0
    fi
  fi
  echo "Could not generate a dashboard password. Install Node.js or Python 3, then run bash install.sh again." >&2
  return 1
}

write_env_assignments() {
  local src dest ingest hash secret saw_ingest saw_hash saw_secret line
  src="$1"
  dest="$2"
  ingest="$3"
  hash="$4"
  secret="$5"
  saw_ingest=0
  saw_hash=0
  saw_secret=0
  while IFS= read -r line || [[ -n "$line" ]]; do
    case "$line" in
      INGEST_TOKEN=*|export\ INGEST_TOKEN=*)
        if [[ -n "$ingest" ]]; then
          printf 'INGEST_TOKEN=%s\n' "$ingest"
          saw_ingest=1
        else
          printf '%s\n' "$line"
          saw_ingest=1
        fi
        ;;
      DASHBOARD_PASSWORD_HASH=*|export\ DASHBOARD_PASSWORD_HASH=*)
        printf 'DASHBOARD_PASSWORD_HASH=%s\n' "$hash"
        saw_hash=1
        ;;
      SESSION_SECRET=*|export\ SESSION_SECRET=*)
        printf 'SESSION_SECRET=%s\n' "$secret"
        saw_secret=1
        ;;
      *)
        printf '%s\n' "$line"
        ;;
    esac
  done < "$src" > "$dest"
  if [[ -n "$ingest" && "$saw_ingest" -eq 0 ]]; then
    printf 'INGEST_TOKEN=%s\n' "$ingest" >> "$dest"
  fi
  if [[ "$saw_hash" -eq 0 ]]; then
    printf 'DASHBOARD_PASSWORD_HASH=%s\n' "$hash" >> "$dest"
  fi
  if [[ "$saw_secret" -eq 0 ]]; then
    printf 'SESSION_SECRET=%s\n' "$secret" >> "$dest"
  fi
}

ensure_env() {
  local ingest tmp old_umask got_ingest got_hash got_secret mode
  if [[ -f .env ]]; then
    mode="$(env_file_mode .env)"
    rerun_env_ports .env
    got_hash="$(env_value DASHBOARD_PASSWORD_HASH)"
    got_secret="$(env_value SESSION_SECRET)"
    if [[ -z "$got_hash" || -z "$got_secret" ]]; then
      generate_dashboard_secrets || exit 1
      if [[ -n "$got_hash" ]]; then
        MC_NEW_HASH="$got_hash"
        MC_NEW_PASSWORD=""
      fi
      if [[ -n "$got_secret" ]]; then
        MC_NEW_SECRET="$got_secret"
      fi
      old_umask="$(umask)"
      umask 077
      tmp="$(mktemp "${TMPDIR:-/tmp}/mc-env.XXXXXX")"
      write_env_assignments .env "$tmp" "" "$MC_NEW_HASH" "$MC_NEW_SECRET"
      chmod "$mode" "$tmp" 2>/dev/null || chmod 600 "$tmp"
      mv "$tmp" .env
      umask "$old_umask"
      echo "Added the missing dashboard login values to .env."
      if [[ -n "$MC_NEW_PASSWORD" ]]; then
        echo "Dashboard password, shown once: ${MC_NEW_PASSWORD}"
      fi
      return 0
    fi
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
  generate_dashboard_secrets || exit 1
  old_umask="$(umask)"
  umask 077
  tmp="$(mktemp "${TMPDIR:-/tmp}/mc-env.XXXXXX")"
  write_env_assignments .env.example "$tmp" "$ingest" "$MC_NEW_HASH" "$MC_NEW_SECRET"
  apply_shell_ports "$tmp"
  apply_shell_listen_port "$tmp"
  apply_shell_schedule "$tmp"
  sync_database_url "$tmp" "$(resolved_port_file MC_DB_PORT 5432 "$tmp")" 1
  chmod 600 "$tmp"
  mv "$tmp" .env
  umask "$old_umask"
  got_ingest="$(env_value INGEST_TOKEN)"
  got_hash="$(env_value DASHBOARD_PASSWORD_HASH)"
  got_secret="$(env_value SESSION_SECRET)"
  if [[ ! "$got_ingest" =~ ^[0-9a-f]{48}$ || "$got_hash" != "$MC_NEW_HASH" || "$got_secret" != "$MC_NEW_SECRET" ]]; then
    rm -f .env
    echo "Refusing to start because the new .env secrets were not written." >&2
    exit 1
  fi
  if grep -E '^INGEST_TOKEN=change-me$' .env >/dev/null 2>&1; then
    rm -f .env
    echo "Refusing to start because the new .env still has a placeholder token." >&2
    exit 1
  fi
  echo "Wrote INGEST_TOKEN to .env."
  echo "Dashboard password, shown once: ${MC_NEW_PASSWORD}"
}

have_docker() {
  command -v docker >/dev/null 2>&1 || return 1
  docker compose version >/dev/null 2>&1
}

# Compose ${VAR:-default}: a set shell value wins, and an empty shell value
# uses the default. An unset shell value uses .env, then the default.
compose_host_path() {
  local key default shell_set value
  key="$1"
  default="$2"
  shell_set=0
  value=""
  if [[ "$key" == "DOCS_ROOT" ]]; then
    if [[ -n "${DOCS_ROOT+x}" ]]; then
      shell_set=1
      value="${DOCS_ROOT}"
    fi
  elif [[ "$key" == "OPENCLAW_LOG_DIR" ]]; then
    if [[ -n "${OPENCLAW_LOG_DIR+x}" ]]; then
      shell_set=1
      value="${OPENCLAW_LOG_DIR}"
    fi
  else
    echo "Unknown Compose bind ${key}." >&2
    exit 1
  fi
  if [[ "$shell_set" -eq 0 && -f .env ]]; then
    value="$(env_value "$key")"
  fi
  if [[ -z "$value" ]]; then
    value="$default"
  fi
  printf '%s' "$value"
}

dir_uid() {
  if stat -c '%u' "$1" >/dev/null 2>&1; then
    stat -c '%u' "$1"
    return
  fi
  stat -f '%u' "$1"
}

# Docker creates a missing bind-mount directory as root. A folder inside this
# checkout would then stay owned by root, and the operator could not delete it.
# Create repo-local binds as this user before `docker compose up`.
ensure_repo_bind() {
  local key default dir root uid
  key="$1"
  default="$2"
  dir="$(compose_host_path "$key" "$default")"
  root="$(pwd)"
  case "$dir" in
    /*) ;;
    *) dir="${root}/${dir#./}" ;;
  esac
  case "$dir" in
    "$root"/*) ;;
    *) return 0 ;;
  esac
  if [[ -d "$dir" ]]; then
    uid="$(dir_uid "$dir")"
    if [[ "$uid" != "$(id -u)" && "$(id -u)" != "0" ]]; then
      echo "Directory ${dir} is owned by uid ${uid}. Remove it as that user, then run bash install.sh again." >&2
    fi
    return 0
  fi
  if [[ -e "$dir" ]]; then
    echo "Path ${dir} exists and is not a directory." >&2
    exit 1
  fi
  if ! mkdir -p "$dir"; then
    echo "Could not create ${dir}. Create that directory as your user, then run bash install.sh again." >&2
    exit 1
  fi
  if [[ "$key" == "DOCS_ROOT" ]]; then
    echo "Created ${dir} for the Compose docs bind."
  fi
}

start_docker() {
  echo "Starting the stack with Docker Compose."
  ensure_repo_bind DOCS_ROOT "data/docs"
  ensure_repo_bind OPENCLAW_LOG_DIR "/tmp/openclaw"
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

# MC_INSTALL_HEALTH_PORT is a test seam. The probe connects there.
# Wait text, doctor text, and the printed URL still use the resolved port.
health_connect_port() {
  local logical override
  logical="$1"
  override="${MC_INSTALL_HEALTH_PORT:-}"
  if [[ "$override" =~ ^[0-9]+$ ]] && [[ "$override" -ge 1 ]] && [[ "$override" -le 65535 ]]; then
    printf '%s' "$override"
    return 0
  fi
  printf '%s' "$logical"
}

health_probe_host() {
  local port
  port="$(health_connect_port "$1")"
  # 0 is a healthy Mission Control body. 2 is HTTP 401. Anything else is 1.
  node -e 'fetch("http://127.0.0.1:" + process.argv[1] + "/health").then(async (res) => { if (res.status === 401) process.exit(2); if (!res.ok) process.exit(1); const body = await res.json(); const ok = body && body.service === "mission-control" && body.status === "ok" && body.database === "connected"; process.exit(ok ? 0 : 1); }).catch(() => process.exit(1))' "$port" >/dev/null 2>&1
}

health_ok_port() {
  local port code
  port="$1"
  code=0
  health_probe_host "$port" || code=$?
  if [[ "$code" -eq 0 ]]; then
    return 0
  fi
  # Compose publishes the API through the Docker bridge, so the host request
  # is not loopback and /health is 401. Probe 127.0.0.1 inside the container.
  if [[ "$code" -eq 2 && "${USE_DOCKER:-0}" == "1" ]]; then
    if docker compose exec -T api node -e 'fetch("http://127.0.0.1:3000/health").then(async (res) => { if (!res.ok) process.exit(1); const body = await res.json(); const ok = body && body.service === "mission-control" && body.status === "ok" && body.database === "connected"; process.exit(ok ? 0 : 1); }).catch(() => process.exit(1))' >/dev/null 2>&1; then
      return 0
    fi
    return 1
  fi
  return 1
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
  local shell_port shell_web shell_api
  echo "Docker was not found. Using the native path. This needs Node.js 22 and Postgres 16."
  require_node_22
  require_postgres_16
  echo "Installing dependencies and starting the API and the web app."
  npm ci
  # Resolve before sourcing .env. A file PORT=3000 must not hide a shell port.
  shell_port="${PORT-}"
  shell_web="${MC_WEB_PORT-}"
  shell_api="${MC_API_PORT-}"
  shell_port="$(native_api_port)"
  shell_web="$(web_port)"
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
  PORT="$shell_port"
  export PORT
  MC_WEB_PORT="$shell_web"
  export MC_WEB_PORT
  if [[ -n "$shell_api" ]]; then
    MC_API_PORT="$shell_api"
    export MC_API_PORT
  fi
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
  echo "Tunnel port $(remote_port). Cloudflare Tunnel and Tailscale Serve use that port. SSH uses the local port in the URL above."
  echo "INGEST_TOKEN is in .env. The dashboard password is printed once when it is created."
  if [[ "${USE_DOCKER:-0}" == "1" ]]; then
    echo "OpenClaw is optional. This install does not start the OpenClaw gateway. When the openclaw command is on PATH, the bridge schedule is installed. npm run seed:demo fills sample data without OpenClaw. Run npm ci in the checkout before npm run seed:demo or npm run seed:clear. Without that install, prisma is not found and the seed command fails."
  else
    echo "OpenClaw is optional. This install does not start the OpenClaw gateway. When the openclaw command is on PATH, the bridge schedule is installed. npm run seed:demo fills sample data without OpenClaw."
  fi
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
