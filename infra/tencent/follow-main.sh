#!/usr/bin/env bash
set -euo pipefail
umask 077

# Install as an administrator-owned script on the Lighthouse host. The existing
# Compose project, volume names, TLS endpoint and provider settings are local.
tool_dir=$(cd -- "$(dirname -- "$0")" && pwd)
cd /home/ubuntu/xiutu-pilot
repo=hxjyaohaohaode/AI-xiutu
api="https://api.github.com/repos/$repo"
asset=xiutu-linux-amd64.tar.gz
mkdir -p state

github_api() {
  curl --fail --silent --show-error --connect-timeout 12 --max-time 26 \
    -H 'Accept: application/vnd.github+json' -H 'X-GitHub-Api-Version: 2022-11-28' "$api/$1"
}
main_sha() {
  github_api git/ref/heads/main | jq -er '.object.sha | select(test("^[a-f0-9]{40}$"))'
}
compose() {
  docker compose --project-name ai-xiutu-pilot -f compose.yaml -f compose.pilot.yaml "$@"
}
source_sha() {
  sed -n 's/^RELEASE_SHA=\([0-9a-f]\{40\}\)$/\1/p' RELEASE
}
image_ref() {
  local sha=$1
  if [[ -f state/legacy-sha && "$sha" == "$(cat state/legacy-sha)" ]]; then
    printf '%s\n' "${sha:0:7}"
  else
    printf '%s\n' "$sha"
  fi
}

# Curl keeps the original TLS hostname, port and cookie scope while connecting only
# to the local Caddy listener. Try DNS names before literal addresses in APP_ORIGIN.
https_origins() {
  local origin host
  local -a values=() names=() addresses=()
  IFS=',' read -r -a values <<< "$1"
  for origin in "${values[@]}"; do
    origin=${origin#"${origin%%[![:space:]]*}"}
    origin=${origin%"${origin##*[![:space:]]}"}
    [[ $origin =~ ^https://([a-zA-Z0-9][a-zA-Z0-9.-]*|\[[a-fA-F0-9:.]+\])(:[0-9]{1,5})?$ ]] || continue
    host=${BASH_REMATCH[1]}
    if [[ $host =~ ^[0-9.]+$ || $host == \[* ]]; then addresses+=("$origin"); else names+=("$origin"); fi
  done
  for origin in "${names[@]}" "${addresses[@]}"; do printf '%s\n' "$origin"; done
}

probe_origin() {
  local origin=$1 registration_mode=$2 link=$3 code hostname
  local -a probe=(curl -q --silent --show-error --max-time 12 --proto '=https' --globoff
    --noproxy '*' --connect-to '::127.0.0.1:')
  : > "$jar" || return 1
  if [[ -n $link ]]; then
    # Keep the private friend link out of argv and never follow an HTTP redirect.
    code=$(printf 'url = "%s/go/%s"\n' "$origin" "$link" |
      "${probe[@]}" --config - --cookie-jar "$jar" -o /dev/null -w '%{http_code}' 2>/dev/null) || return 1
    [[ $code == 303 ]] || return 1
    [[ $origin =~ ^https://(\[[^]]+\]|[^:]+)(:[0-9]+)?$ ]] || return 1
    hostname=${BASH_REMATCH[1]}
    hostname=${hostname#\[}
    hostname=${hostname%\]}
    # A 303 without a usable cookie would let a public landing page impersonate a gated one.
    awk -F '\t' -v host="$hostname" 'NF == 7 {
      domain = tolower($1); sub(/^#httponly_/, "", domain); sub(/^\./, "", domain)
      h = tolower(host)
      if ((h == domain || ($2 == "TRUE" && length(h) > length(domain) &&
          substr(h,length(h)-length(domain)) == "." domain)) && $3 == "/" &&
          ($5 == 0 || $5 > systime()) && length($6) && length($7)) valid = 1
    } END {exit !valid}' "$jar" || return 1
  fi
  code=$("${probe[@]}" --cookie "$jar" -o /dev/null -w '%{http_code}' "$origin/") || return 1
  [[ "$code" == 200 ]] || return 1
  "${probe[@]}" --fail --cookie "$jar" "$origin/health" | jq -es 'length == 1 and .[0].ok == true' >/dev/null || return 1
  "${probe[@]}" --fail --cookie "$jar" "$origin/v1/public-config" |
    jq -es --arg mode "$registration_mode" \
      'length == 1 and .[0].registrationMode == $mode and .[0].capabilities.smsConfigured == true' >/dev/null || return 1
  "${probe[@]}" --fail --cookie "$jar" "$origin/v1/session" |
    jq -es 'length == 1 and (.[0] | has("user") and .user == null and .spaces == [])' >/dev/null || return 1
  code=$("${probe[@]}" --cookie "$jar" -o /dev/null -w '%{http_code}' "$origin/v1/projects") || return 1
  [[ "$code" == 401 ]]
}

smoke() {
  local ref=$1 service target id expected actual origins origin link= registration_mode
  for service in api worker web; do
    target=server
    [[ "$service" != web ]] || target=web
    id=$(compose ps --quiet "$service") || return 1
    local image
    image=$(compose config --format json | jq -er --arg service "$service" '.services[$service].image') || return 1
    if [[ "$image" != "xiutu-pilot-$target:$ref" && ! ( "$service" == web && "$image" == "xiutu-pilot-web:$ref-icp" ) ]]; then return 1; fi
    expected=$(docker image inspect --format '{{.Id}}' "$image") || return 1
    actual=$(docker inspect --format '{{.State.Running}} {{.Image}}' "$id") || return 1
    [[ "$actual" == "true $expected" ]] || return 1
  done
  origins=$(compose config --format json | jq -er '.services.api.environment.APP_ORIGIN | strings | select(length > 0)') || return 1
  if [[ -f state/friend-link ]]; then
    link=$(cat state/friend-link) || return 1
  fi
  registration_mode=$(compose exec -T db psql -X -v ON_ERROR_STOP=1 -U xiutu -d xiutu -At \
    -c 'SELECT registration_mode FROM app_config WHERE id=true' </dev/null) || return 1
  [[ "$registration_mode" == open || "$registration_mode" == invite ]] || return 1
  while IFS= read -r origin; do
    if probe_origin "$origin" "$registration_mode" ""; then return 0; fi
    if [[ $link =~ ^[a-f0-9]{48}$ ]] && probe_origin "$origin" "$registration_mode" "$link"; then return 0; fi
  done < <(https_origins "$origins")
  echo 'No configured HTTPS origin passed the local TLS and session checks.' >&2
  return 1
}

mode=auto
if (( $# )); then
  [[ $# == 2 && ( $1 == --stage || $1 == --verify ) && $2 =~ ^[0-9a-f]{40}$ ]] || {
    echo 'Usage: follow-main.sh [--stage|--verify EXACT_MAIN_SHA]' >&2; exit 2;
  }
  mode=$1
fi
if [[ $mode == --verify ]]; then
  export XIUTU_IMAGE_REF
  XIUTU_IMAGE_REF=$(image_ref "$2")
  jar=$(mktemp state/cookies.XXXXXXXX)
  trap 'rm -f -- "$jar"' EXIT
  smoke "$XIUTU_IMAGE_REF"
  echo "Verified images, database, HTTPS and session boundaries for $2."
  exit 0
fi
exec 9>state/deploy.lock
if [[ $mode == --stage ]]; then flock -w 30 9 || exit 75; else flock -n 9 || exit 0; fi

if [[ $mode == auto && -f state/upgrade-schema.pending ]]; then
  echo 'A coordinated database upgrade is pending; the timer is leaving services with the migration operator.'
  exit 0
fi
current=$(source_sha)
[[ "$current" =~ ^[a-f0-9]{40}$ ]] || { echo 'Missing current release SHA.' >&2; exit 1; }
export XIUTU_IMAGE_REF
XIUTU_IMAGE_REF=$(image_ref "$current")
head=$(main_sha)
if [[ $mode == --stage && $head != "$2" ]]; then echo 'Expected main has moved.' >&2; exit 75; fi
if [[ $mode == auto && "$head" == "$current" ]]; then
  echo "Main $head is already running."
  exit 0
fi
if [[ $mode == auto && -f state/blocked-sha && "$(cat state/blocked-sha)" == "$head" ]]; then
  echo "Main $head needs operator attention; keeping the previous release."
  exit 0
fi

release_file=$(mktemp state/release.XXXXXXXX)
jar=
deploying=false
committed=false
ensure_rollback() {
  local code=$?
  trap - EXIT
  if [[ "$deploying" == true && "$committed" == false ]]; then
    echo "Deployment did not pass. Restoring application images for $current." >&2
    printf '%s\n' "$head" > state/blocked-sha
    export XIUTU_IMAGE_REF
    XIUTU_IMAGE_REF=$(image_ref "$current")
    if ! compose up -d --no-deps --no-build --pull never --wait --wait-timeout 90 api worker ||
       ! compose up -d --no-deps --no-build --pull never --wait --wait-timeout 45 web ||
       ! smoke "$XIUTU_IMAGE_REF"; then
      echo 'Previous application needs manual recovery. Database and assets were kept.' >&2
    fi
  fi
  rm -f -- "$release_file"
  [[ -z "$jar" ]] || rm -f -- "$jar"
  exit "$code"
}
trap ensure_rollback EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

http=$(curl --silent --show-error --connect-timeout 12 --max-time 26 \
  -o "$release_file" -w '%{http_code}' \
  -H 'Accept: application/vnd.github+json' "$api/releases/tags/cloud-$head")
if [[ "$http" == 404 ]]; then
  echo "Main $head is waiting for a verified release."
  [[ $mode == auto ]] || exit 75
  exit 0
fi
test "$http" = 200
metadata=$(jq -er --arg tag "cloud-$head" --arg asset "$asset" '
  select(.tag_name == $tag and .draft == false and .prerelease == true)
  | [.assets[] | select(.name == $asset and .state == "uploaded" and .size > 0 and .size < 2000000000)]
  | select(length == 1) | .[0]
  | select(.digest | test("^sha256:[a-f0-9]{64}$")) | [.digest, .size] | @tsv
' "$release_file")
read -r digest asset_size <<<"$metadata"
[[ "$asset_size" =~ ^[0-9]{1,10}$ ]] || exit 1
for check in checks.yml frontend-system-redesign.yml assistant-checks.yml account-checks.yml; do
  result=$(github_api "actions/workflows/$check/runs?branch=main&event=push&head_sha=$head&per_page=5" |
    jq -r --arg sha "$head" '[.workflow_runs[] | select(.head_sha == $sha and .head_branch == "main" and .event == "push")][0].conclusion // "pending"')
  if [[ "$result" != success ]]; then
    echo "$check: $result; keeping the previous release."
    [[ $mode == auto ]] || exit 75
    exit 0
  fi
done
compose_hash=$(sed 's/\r$//' compose.yaml | sha256sum | cut -d ' ' -f 1)
images_match() {
  local target labels
  for target in server web; do
    labels=$(docker image inspect --format '{{.Os}}/{{.Architecture}} {{index .Config.Labels "org.opencontainers.image.revision"}} {{index .Config.Labels "io.ai-xiutu.compose-sha256"}}' "xiutu-pilot-$target:$head" 2>/dev/null) || return 1
    [[ "$labels" == "linux/amd64 $head $compose_hash" ]] || return 1
  done
}
if ! images_match; then
  mkdir -p state/downloads
  bundle="state/downloads/$head-${digest#sha256:}.part"
  # A standalone download for an older revision may still be active. Leave its
  # stable lock inode in place and reclaim only our recognized, idle partials.
  for item in state/downloads/*.part state/downloads/*.part.resume; do
    old=${item%.resume}
    [[ -e "$item" && "$old" != "$bundle" && "${old##*/}" =~ ^[a-f0-9]{40}-[a-f0-9]{64}\.part$ ]] || continue
    (
      flock -n 8 || exit 0
      rm -f -- "$old" "$old.resume/payload" "$old.resume/ranges.json" "$old.resume/ranges.tmp"
      if [[ -d "$old.resume" ]]; then rmdir -- "$old.resume" || true; fi
    ) 8>>"$old.lock"
  done
  free_kib=$(df -Pk . | awk 'NR==2 {print $4}')
  if (( free_kib < 6291456 )); then
    echo 'At least 6 GiB of free disk space is required to stage images.' >&2
    exit 1
  fi
  touch "$bundle"
  already=$(stat -c '%s' "$bundle")
  if (( already > asset_size )); then
    rm -f -- "$bundle"
    echo 'Cached bundle exceeds the release manifest size.' >&2
    exit 1
  fi
  if (( already < asset_size )); then
    echo "Staging $head from byte $already of $asset_size."
    if [[ -f "$tool_dir/fetch-release.py" ]]; then
      python3 "$tool_dir/fetch-release.py" --url "https://github.com/$repo/releases/download/cloud-$head/$asset" \
        --sha256 "$digest" --size "$asset_size" --output "$bundle"
    else
      curl --fail --silent --show-error --location --continue-at - \
      --connect-timeout 18 --max-time 900 --speed-limit 4096 --speed-time 60 \
      --proto '=https' --proto-redir '=https' \
      --output "$bundle" "https://github.com/$repo/releases/download/cloud-$head/$asset" || {
        echo "Download incomplete; retained $(stat -c '%s' "$bundle") staging bytes for the next attempt."
        [[ $mode == auto ]] || exit 75
        exit 0
      }
    fi
  fi
  if [[ "$(stat -c '%s' "$bundle")" != "$asset_size" ]] ||
     ! printf '%s  %s\n' "${digest#sha256:}" "$bundle" | sha256sum --check --status; then
    rm -f -- "$bundle"
    echo 'GitHub asset size or SHA-256 digest did not match.' >&2
    exit 1
  fi
  docker image load --input "$bundle" --platform linux/amd64
  rm -f -- "$bundle"

  if ! images_match; then
    echo "Staged image metadata or Compose contract did not match $head." >&2
    printf '%s\n' "$head" > state/blocked-sha
    exit 1
  fi
fi

if [[ $mode == --stage ]]; then
  [[ "$(main_sha)" == "$head" ]] || exit 75
  echo "Staged both verified images for $head; serving containers were not changed."
  exit 0
fi

required=$(docker run --rm --network none --memory 160m \
  --entrypoint node "xiutu-pilot-server:$head" --import tsx --input-type=module \
  -e 'import {REQUIRED_SCHEMA_VERSIONS} from "@ai-xiutu/db"; console.log(REQUIRED_SCHEMA_VERSIONS.join(","))')
applied=$(compose exec -T db psql -X -v ON_ERROR_STOP=1 -U xiutu -d xiutu -At \
  -c "SELECT string_agg(version::text, ',' ORDER BY version) FROM schema_migrations")
if [[ ! "$required" =~ ^[0-9]+(,[0-9]+)*$ || "$applied" != "$required" ]]; then
  printf '%s\n' "$head" > state/blocked-sha
  echo "Main $head needs a coordinated database migration; keeping the previous release." >&2
  exit 1
fi


jar=$(mktemp state/cookies.XXXXXXXX)
# Check main again after the slow download and staging, before touching services.
still_main=$(main_sha)
if [[ "$still_main" != "$head" ]]; then
  echo "Main moved to $still_main during staging; no service changed."
  exit 0
fi
XIUTU_IMAGE_REF=$head
compose config --quiet
deploying=true
compose up -d --no-deps --no-build --pull never --wait --wait-timeout 90 api worker
compose up -d --no-deps --no-build --pull never --wait --wait-timeout 45 web
smoke "$head"
prior=$(cat state/previous-sha 2>/dev/null || true)
printf '%s\n' "$current" > state/previous-sha
printf 'RELEASE_SHA=%s\n' "$head" > RELEASE.next
chown --reference=RELEASE RELEASE.next
chmod --reference=RELEASE RELEASE.next
mv -f -- RELEASE.next RELEASE
committed=true
rm -f -- state/blocked-sha
if [[ "$prior" =~ ^[0-9a-f]{40}$ && "$prior" != "$head" && "$prior" != "$current" ]]; then
  # Remove only the obsolete tags for this application. No volume or system prune.
  docker image rm "xiutu-pilot-server:$(image_ref "$prior")" "xiutu-pilot-web:$(image_ref "$prior")" || true
fi
echo "Deployed and verified $head."
