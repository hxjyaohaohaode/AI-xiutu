#!/usr/bin/env bash
set -euo pipefail
umask 077

# Install as an administrator-owned script on the Lighthouse host. The existing
# Compose project, volume names, TLS endpoint and provider settings are local.
cd /home/ubuntu/xiutu-pilot
repo=hxjyaohaohaode/AI-xiutu
api="https://api.github.com/repos/$repo"
asset=xiutu-linux-amd64.tar.gz
mkdir -p state
exec 9>state/deploy.lock
flock -n 9 || exit 0

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

current=$(source_sha)
[[ "$current" =~ ^[a-f0-9]{40}$ ]] || { echo 'Missing current release SHA.' >&2; exit 1; }
export XIUTU_IMAGE_REF
XIUTU_IMAGE_REF=$(image_ref "$current")
head=$(main_sha)
if [[ "$head" == "$current" ]]; then
  echo "Main $head is already running."
  exit 0
fi
if [[ -f state/blocked-sha && "$(cat state/blocked-sha)" == "$head" ]]; then
  echo "Main $head needs operator attention; keeping the previous release."
  exit 0
fi

release_file=$(mktemp state/release.XXXXXXXX)
bundle=
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
    if ! compose up -d --no-deps --no-build --pull never --wait --wait-timeout 90 api worker web ||
       ! smoke "$XIUTU_IMAGE_REF"; then
      echo 'Previous application needs manual recovery. Database and assets were kept.' >&2
    fi
  fi
  rm -f -- "$release_file"
  [[ -z "$bundle" ]] || rm -f -- "$bundle"
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
  exit 0
fi
test "$http" = 200
digest=$(jq -er --arg tag "cloud-$head" --arg asset "$asset" '
  select(.tag_name == $tag and .draft == false and .prerelease == true)
  | [.assets[] | select(.name == $asset and .state == "uploaded" and .size > 0 and .size < 2000000000)]
  | select(length == 1) | .[0].digest | select(test("^sha256:[a-f0-9]{64}$"))
' "$release_file")
for check in checks.yml frontend-system-redesign.yml; do
  result=$(github_api "actions/workflows/$check/runs?branch=main&event=push&head_sha=$head&per_page=5" |
    jq -r --arg sha "$head" '[.workflow_runs[] | select(.head_sha == $sha and .head_branch == "main" and .event == "push")][0].conclusion // "pending"')
  if [[ "$result" != success ]]; then
    echo "$check: $result; keeping the previous release."
    exit 0
  fi
done
free_kib=$(df -Pk . | awk 'NR==2 {print $4}')
if (( free_kib < 6291456 )); then
  echo 'At least 6 GiB of free disk space is required to stage images.' >&2
  exit 1
fi

bundle=$(mktemp state/bundle.XXXXXXXX)
curl --fail --silent --show-error --location --retry 2 --retry-delay 3 --retry-max-time 900 \
  --connect-timeout 18 --max-time 900 --max-filesize 2000000000 \
  --proto '=https' --proto-redir '=https' \
  --output "$bundle" "https://github.com/$repo/releases/download/cloud-$head/$asset"
printf '%s  %s\n' "${digest#sha256:}" "$bundle" | sha256sum --check --status
docker image load --input "$bundle" --platform linux/amd64
rm -f -- "$bundle"
bundle=

compose_hash=$(sed 's/\r$//' compose.yaml | sha256sum | cut -d ' ' -f 1)
for target in server web; do
  metadata=$(docker image inspect --format '{{.Os}}/{{.Architecture}} {{index .Config.Labels "org.opencontainers.image.revision"}} {{index .Config.Labels "io.ai-xiutu.compose-sha256"}}' "xiutu-pilot-$target:$head")
  if [[ "$metadata" != "linux/amd64 $head $compose_hash" ]]; then
    echo "Main $head changes the Compose contract or has invalid image metadata; keeping the previous release." >&2
    printf '%s\n' "$head" > state/blocked-sha
    exit 1
  fi
done

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

smoke() {
  local ref=$1 service target id expected actual origin hostname code
  local -a probe
  for service in api worker web; do
    target=server
    [[ "$service" != web ]] || target=web
    id=$(compose ps --quiet "$service") || return 1
    expected=$(docker image inspect --format '{{.Id}}' "xiutu-pilot-$target:$ref") || return 1
    actual=$(docker inspect --format '{{.State.Running}} {{.Image}}' "$id") || return 1
    [[ "$actual" == "true $expected" ]] || return 1
  done
  origin=$(sed -n 's/^APP_ORIGIN=\(https:\/\/[A-Za-z0-9.-]*\)\r*$/\1/p' .env)
  [[ -n "$origin" ]] || return 1
  hostname=${origin#https://}
  probe=(curl --silent --show-error --max-time 12 --resolve "$hostname:443:127.0.0.1")
  if [[ -f state/friend-link ]]; then
    [[ "$(cat state/friend-link)" =~ ^[a-f0-9]{48}$ ]] || return 1
    code=$("${probe[@]}" --cookie-jar "$jar" -o /dev/null -w '%{http_code}' "$origin/go/$(cat state/friend-link)") || return 1
    [[ "$code" == 303 ]] || return 1
  fi
  code=$("${probe[@]}" --cookie "$jar" -o /dev/null -w '%{http_code}' "$origin/") || return 1
  [[ "$code" == 200 ]] || return 1
  "${probe[@]}" --fail --cookie "$jar" "$origin/health" | jq -e '.ok == true' >/dev/null || return 1
  "${probe[@]}" --fail --cookie "$jar" "$origin/v1/public-config" |
    jq -e '.registrationMode == "open" and .capabilities.smsConfigured == true' >/dev/null || return 1
  "${probe[@]}" --fail --cookie "$jar" "$origin/v1/session" |
    jq -e '.user == null and .spaces == []' >/dev/null || return 1
  code=$("${probe[@]}" --cookie "$jar" -o /dev/null -w '%{http_code}' "$origin/v1/projects") || return 1
  [[ "$code" == 401 ]]
}

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
compose up -d --no-deps --no-build --pull never --wait --wait-timeout 90 api worker web
smoke "$head"
prior=$(cat state/previous-sha 2>/dev/null || true)
printf '%s\n' "$current" > state/previous-sha
printf 'RELEASE_SHA=%s\n' "$head" > RELEASE.next
mv -f -- RELEASE.next RELEASE
committed=true
rm -f -- state/blocked-sha
if [[ "$prior" =~ ^[0-9a-f]{40}$ && "$prior" != "$head" && "$prior" != "$current" ]]; then
  # Remove only the obsolete tags for this application. No volume or system prune.
  docker image rm "xiutu-pilot-server:$(image_ref "$prior")" "xiutu-pilot-web:$(image_ref "$prior")" || true
fi
echo "Deployed and verified $head."
