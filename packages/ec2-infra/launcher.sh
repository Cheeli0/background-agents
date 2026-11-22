#!/usr/bin/env bash
# Started by openinspect-sandbox.service on every boot; see README.md.
set -Eeuo pipefail

OI_ETC=/etc/openinspect
OI_BOOTSTRAP_FILE=$OI_ETC/bootstrap
OI_ROUTE_FILE=$OI_ETC/control-plane-route
OI_HOSTS_MARKER='# openinspect-control-plane'
OI_SESSION_ENV_FILE=$OI_ETC/session.json
OI_RUNTIME_USER=user
OI_STATE_DIR=/home/$OI_RUNTIME_USER/.openinspect
OI_BOOT_COMPLETE_MARKER=$OI_STATE_DIR/boot-complete
OI_PYTHON=/opt/openinspect/python/bin/python
OI_EXEC_RUNTIME=/opt/openinspect/ec2/exec-runtime.py
# Matches SANDBOX_BOOTSTRAP_TOKEN_TTL_MS (control-plane src/sandbox/bootstrap.ts).
OI_BOOTSTRAP_WAIT_SECONDS=900
OI_BOOTSTRAP_RETRY_SECONDS=5
OI_BOOTSTRAP_REQUEST_TIMEOUT_SECONDS=30
OI_LIFETIME_GRACE_SECONDS=900

log() { printf 'openinspect-launcher: %s\n' "$*" >&2; }

power_off() {
  log "$1; powering off"
  systemctl poweroff
  exit 1
}

is_refusal_status() {
  case "$1" in
    401 | 403 | 404 | 410) return 0 ;;
    *) return 1 ;;
  esac
}

read_value() {
  local file="$1" key="$2" line
  while IFS= read -r line; do
    if [[ "$line" == "$key="* ]]; then
      printf '%s' "${line#*=}"
      return 0
    fi
  done <"$file"
  return 1
}

# Every boot: the address follows the control plane's Elastic IP to a replacement instance.
refresh_control_plane_route() {
  local host private_host address deadline
  host="$(read_value "$OI_ROUTE_FILE" OPENINSPECT_CONTROL_PLANE_HOST)" ||
    power_off "control-plane route file has no host"
  private_host="$(read_value "$OI_ROUTE_FILE" OPENINSPECT_CONTROL_PLANE_PRIVATE_HOST)" ||
    power_off "control-plane route file has no private host"
  deadline=$((SECONDS + OI_BOOTSTRAP_WAIT_SECONDS))
  until address="$(getent ahostsv4 "$private_host" | awk 'NR == 1 { print $1 }')" && [[ -n "$address" ]]; do
    if ((SECONDS >= deadline)); then
      power_off "could not resolve $private_host for ${OI_BOOTSTRAP_WAIT_SECONDS}s"
    fi
    sleep "$OI_BOOTSTRAP_RETRY_SECONDS"
  done
  sed -i "/$OI_HOSTS_MARKER\$/d" /etc/hosts
  printf '%s %s %s\n' "$address" "$host" "$OI_HOSTS_MARKER" >>/etc/hosts
  log "control plane $host routed to $address"
}

redeem_bootstrap() {
  local url token headers body status deadline
  url="$(read_value "$OI_BOOTSTRAP_FILE" OPENINSPECT_BOOTSTRAP_URL)" || power_off "bootstrap file has no URL"
  token="$(read_value "$OI_BOOTSTRAP_FILE" OPENINSPECT_BOOTSTRAP_TOKEN)" || power_off "bootstrap file has no token"
  # A header file keeps the token out of the process list.
  headers="$(mktemp "$OI_ETC/.headers.XXXXXX")"
  body="$(mktemp "$OI_ETC/.session.XXXXXX")"
  printf 'Authorization: Bearer %s\n' "$token" >"$headers"
  deadline=$((SECONDS + OI_BOOTSTRAP_WAIT_SECONDS))
  while :; do
    status="$(curl --silent --show-error --output "$body" --write-out '%{http_code}' \
      --max-time "$OI_BOOTSTRAP_REQUEST_TIMEOUT_SECONDS" --request POST \
      --header "@$headers" "$url" || true)"
    if [[ "$status" == 200 ]]; then
      break
    fi
    if is_refusal_status "$status"; then
      rm -f "$headers" "$body"
      power_off "bootstrap refused (HTTP $status)"
    fi
    if ((SECONDS >= deadline)); then
      rm -f "$headers" "$body"
      power_off "control plane unreachable for ${OI_BOOTSTRAP_WAIT_SECONDS}s (last HTTP ${status:-none})"
    fi
    log "bootstrap attempt failed (HTTP ${status:-none}); retrying"
    sleep "$OI_BOOTSTRAP_RETRY_SECONDS"
  done
  rm -f "$headers"
  if ! "$OI_PYTHON" "$OI_EXEC_RUNTIME" --check "$body"; then
    rm -f "$body"
    power_off "bootstrap response is not a session environment"
  fi
  mv -f "$body" "$OI_SESSION_ENV_FILE"
  rm -f "$OI_BOOTSTRAP_FILE"
  log "session environment received"
}

arm_lifetime_backstop() {
  local lifetime
  lifetime="$("$OI_PYTHON" "$OI_EXEC_RUNTIME" --lifetime-seconds "$OI_SESSION_ENV_FILE")" ||
    power_off "kept session environment is unreadable"
  systemd-run --unit=openinspect-lifetime --collect \
    --on-active="$((lifetime + OI_LIFETIME_GRACE_SECONDS))" \
    /bin/systemctl poweroff >/dev/null
  log "lifetime backstop armed at $((lifetime + OI_LIFETIME_GRACE_SECONDS))s"
}

main() {
  install -d -m 0700 "$OI_ETC"
  if [[ ! -f "$OI_SESSION_ENV_FILE" && ! -f "$OI_BOOTSTRAP_FILE" ]]; then
    log "not a session instance; nothing to start"
    exit 0
  fi
  # Until the environment is kept, nothing on this instance is worth preserving, and no backstop is armed.
  if [[ ! -f "$OI_SESSION_ENV_FILE" ]]; then
    trap 'power_off "launcher failed before the session started (line $LINENO)"' ERR
  fi
  if [[ -f "$OI_ROUTE_FILE" ]]; then
    refresh_control_plane_route
  fi
  if [[ ! -f "$OI_SESSION_ENV_FILE" ]]; then
    redeem_bootstrap
  fi
  arm_lifetime_backstop
  trap - ERR

  local is_restored=false
  if [[ -e "$OI_BOOT_COMPLETE_MARKER" ]]; then
    is_restored=true
  fi
  log "starting the runtime (restored: $is_restored)"
  exec "$OI_PYTHON" "$OI_EXEC_RUNTIME" --run "$OI_SESSION_ENV_FILE" --restored "$is_restored"
}

main "$@"
