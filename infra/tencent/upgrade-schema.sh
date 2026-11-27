#!/usr/bin/env bash
# Coordinated upgrade of the existing, single-writer Lighthouse installation.
set -Eeuo pipefail
umask 077

die() { printf '%s\n' "$*" >&2; return 1; }
compose() { docker compose --project-name "$project" "${compose_files[@]}" "$@"; }
service_id() { compose ps --all --quiet "$1"; }
sql() { compose exec -T db psql -X -qAt -v ON_ERROR_STOP=1 -U xiutu -d "$1" -c "$2" </dev/null; }
admin() { sql postgres "$1"; }

# Internal database names come only from our generated and validated identifiers.
freeze_db() {
  local db=$1
  admin "ALTER DATABASE \"$db\" ALLOW_CONNECTIONS false" >/dev/null || return 1
  admin "SELECT pg_terminate_backend(pid, 10000) FROM pg_stat_activity WHERE datname='$db'" >/dev/null || return 1
  [[ $(admin "SELECT count(*) FROM pg_stat_activity WHERE datname='$db'") == 0 ]]
}
exchange_db() {
  # parked name must be absent, replacement must be present. One transaction
  # either changes both names or leaves both exactly as they were.
  local parked=$1 replacement=$2
  freeze_db xiutu && freeze_db "$replacement" &&
    admin "BEGIN; ALTER DATABASE xiutu RENAME TO \"$parked\";
      ALTER DATABASE \"$replacement\" RENAME TO xiutu;
      ALTER DATABASE xiutu ALLOW_CONNECTIONS true; COMMIT;" >/dev/null
}
oid_for() { admin "SELECT oid FROM pg_database WHERE datname='$1'"; }
versions() { sql "$1" "SELECT string_agg(version::text, ',' ORDER BY version) FROM schema_migrations"; }
inventory() {
  sql "$1" 'SELECT (SELECT count(*) FROM users), (SELECT count(*) FROM projects), (SELECT count(*) FROM assets)'
}
new_main() {
  curl --fail --silent --show-error --connect-timeout 8 --max-time 25 \
    https://api.github.com/repos/hxjyaohaohaode/AI-xiutu/git/ref/heads/main | jq -er '.object.sha'
}
select_images() { export XIUTU_IMAGE_REF="$1" XIUTU_WEB_IMAGE_SUFFIX="$2"; }
up() { compose up -d --no-deps --no-build --pull never --wait --wait-timeout 100 "$1"; }
stop_writers() {
  compose stop -t 90 api && compose stop -t 90 worker || return 1
  local id service
  for service in api worker; do
    id=$(service_id "$service") || return 1
    [[ -z "$id" || $(docker inspect --format '{{.State.Running}}' "$id") == false ]] || return 1
  done
}
configured_image() { compose config --format json | jq -er --arg s "$1" '.services[$s].image'; }
assert_layout() {
  local ref=$1 suffix=$2
  [[ $(configured_image api) == "xiutu-pilot-server:$ref" &&
     $(configured_image worker) == "xiutu-pilot-server:$ref" &&
     $(configured_image migrate) == "xiutu-pilot-server:$ref" &&
     $(configured_image web) == "xiutu-pilot-web:$ref$suffix" ]]
}
find_stack() {
  local db_id labels path configs
  local -a ids=() paths=()
  while read -r db_id; do
    [[ -n "$db_id" ]] || continue
    path=$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$db_id")
    [[ "$path" != "$PWD" ]] || ids+=("$db_id")
  done < <(docker ps --filter label=com.docker.compose.service=db --format '{{.ID}}')
  [[ ${#ids[@]} == 1 ]] || die 'Expected exactly one running Compose database in the installation directory.'
  labels=$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}|{{index .Config.Labels "com.docker.compose.project.config_files"}}' "${ids[0]}")
  IFS='|' read -r project configs <<< "$labels"
  [[ -n "$project" && -n "$configs" ]] || die 'Compose labels are missing.'
  IFS=',' read -ra paths <<< "$configs"
  compose_files=()
  for path in "${paths[@]}"; do
    [[ -f "$path" ]] || die 'A running Compose configuration file is missing.'
    compose_files+=(-f "$path")
  done
}
migrate_copy() {
  local db=$1
  # No credentials in the shell argv, logs or rewritten .env. Only this
  # one-shot process sees the adjusted URL. No worker/API is launched here.
  compose run --rm --no-deps -T --pull never --entrypoint node migrate --import tsx --input-type=module -e '
    const name = process.argv[1];
    const u = new URL(process.env.DATABASE_URL);
    if (u.pathname !== "/xiutu" || !/^xu_(test|new)_[a-z0-9_]+$/.test(name)) process.exit(2);
    u.pathname = "/" + name;
    process.env.DATABASE_URL = u.href;
    await import("./packages/db/src/migrate.ts");' "$db" > "$backup/$db.migrate.log" 2>&1
  [[ $(versions "$db") == "$required" ]]
}
save_dump() {
  compose exec -T db pg_dump -U xiutu -d "$1" -Fc </dev/null > "$backup/$2.partial"
  compose exec -T db pg_restore --list < "$backup/$2.partial" >/dev/null
  mv -- "$backup/$2.partial" "$backup/$2"
}
install_candidate_environment() {
  local tmp
  tmp=$(mktemp .env.schema.XXXXXXXX)
  cp --preserve=mode,ownership -- .env "$tmp"
  sed -E '/^(export[[:space:]]+)?(XIUTU_WEB_IMAGE_SUFFIX|MEDIA_ADVANCED_ENABLED|MEDIA_PYTHON|MEDIA_UHDR_LIBRARY|MEDIA_HEIC_DECODER)[[:space:]]*=/d' .env > "$tmp"
  cat >> "$tmp" <<'ENV'

XIUTU_WEB_IMAGE_SUFFIX=
MEDIA_ADVANCED_ENABLED=true
MEDIA_PYTHON=/opt/media/bin/python
MEDIA_UHDR_LIBRARY=/opt/ultrahdr/lib/libuhdr.so
MEDIA_HEIC_DECODER=/opt/heic/bin/heic-pq
ENV
  mv -f -- "$tmp" .env
}
restore_environment() {
  local tmp
  tmp=$(mktemp .env.schema.XXXXXXXX) || return 1
  cp -p -- .env "$backup/.env.interrupted.$(date +%s%N)" &&
    cp -p -- "$backup/.env.before" "$tmp" && mv -f -- "$tmp" .env
}
write_release() {
  local template=$1 sha=$2 tmp
  tmp=$(mktemp .release.schema.XXXXXXXX) || return 1
  cp --preserve=mode,ownership -- "$template" "$tmp" &&
    sed "s/^RELEASE_SHA=.*/RELEASE_SHA=$sha/" "$template" > "$tmp" &&
    mv -f -- "$tmp" RELEASE
}
web_mounts() {
  docker inspect --format '{{json .Mounts}}' "$1" | jq -cS 'map({Type,Source,Destination,RW}) | sort_by(.Destination)'
}
old_manifest() {
  read -r old_sha old_ref suffix_marker original_oid token < "$backup/recovery" || return 1
  [[ $old_sha =~ ^[a-f0-9]{40}$ && ( $old_ref == "$old_sha" || $old_ref == "${old_sha:0:7}" ) &&
     $suffix_marker =~ ^(_|-[-a-zA-Z0-9_.]+)$ && $original_oid =~ ^[0-9]+$ &&
     $token =~ ^[0-9a-f]{12}_[0-9]+_[0-9]+$ ]] || return 1
  old_suffix=$suffix_marker
  [[ $old_suffix != _ ]] || old_suffix=
  new_db=xu_new_$token
  old_db=xu_old_$token
  failed_db=xu_failed_$token
}
gate_volume() {
  local action=$1 volume
  read -r volume < "$backup/assets-volume" || return 1
  [[ $volume =~ ^[A-Za-z0-9][A-Za-z0-9_.-]*$ ]] || return 1
  docker volume inspect "$volume" >/dev/null || return 1
  docker run --rm --network none --read-only --user 0 --mount "type=volume,source=$volume,target=/guard" \
    --entrypoint node "xiutu-pilot-server:$old_ref" --input-type=module -e '
    import { openSync, readFileSync, writeFileSync, fsyncSync, unlinkSync, closeSync } from "node:fs";
    const [action, sha] = process.argv.slice(1);
    const dir = "/guard", file = dir + "/.xiutu-schema-upgrade";
    if (!/^[a-f0-9]{40}$/.test(sha)) process.exit(2);
    if (action === "hold") {
      const fd = openSync(file, "wx", 0o600);
      try { writeFileSync(fd, sha + "\n"); fsyncSync(fd); } finally { closeSync(fd); }
    } else if (action === "release") {
      let value;
      try { value = readFileSync(file,"utf8"); } catch(e) { if(e.code==="ENOENT") process.exit(0); throw e; }
      if (value !== sha + "\n") throw Error("Unexpected release gate owner");
      unlinkSync(file);
    } else throw Error("Invalid gate action");
    const d = openSync(dir, "r"); try { fsyncSync(d); } finally { closeSync(d); }' "$action" "$target"
}
complete_commit() {
  # This phase is irrevocable: if the marker was already removed users may have
  # committed writes. A restart must only finish this promotion, never revert it.
  [[ $(cat "$backup/committed") == "$target" &&
     $(sed -n 's/^RELEASE_SHA=//p' RELEASE) == "$target" &&
     $(oid_for "$old_db") == "$original_oid" &&
     $(oid_for xiutu) == "$(cat "$backup/candidate-oid")" ]] || return 1
  # Publish history only after the durable decision. Recovery repeats this atomic write.
  printf '%s\n' "$old_sha" > "$backup/previous-sha.next" &&
    mv -f -- "$backup/previous-sha.next" state/previous-sha &&
    gate_volume release && rm -f -- "$pending"
}
recover() {
  local live_oid
  old_manifest || return 1
  select_images "$old_ref" "$old_suffix"
  if [[ -f "$backup/committed" ]]; then complete_commit; return; fi
  printf '%s\n' "$target" > state/blocked-sha || return 1
  # Re-select current desired Compose interpolation even if invoked by a new shell.
  select_images "$old_ref" "$old_suffix"
  assert_layout "$old_ref" "$old_suffix" && stop_writers || return 1
  live_oid=$(oid_for xiutu) || return 1
  if [[ "$live_oid" == "$original_oid" ]]; then
    admin 'ALTER DATABASE xiutu ALLOW_CONNECTIONS true' >/dev/null || return 1
  elif [[ $(oid_for "$old_db") == "$original_oid" && -n "$live_oid" && -z $(oid_for "$failed_db") ]]; then
    exchange_db "$failed_db" "$old_db" || return 1
  else
    die 'Database identity is ambiguous. Writers remain stopped; retained databases and archives require inspection.'
    return 1
  fi
  [[ $(oid_for xiutu) == "$original_oid" ]] && gate_volume release && restore_environment &&
    up api && up web && up worker && "$follow" --verify "$old_sha" &&
    write_release "$backup/RELEASE.before" "$old_sha" && rm -f -- "$pending" || return 1
  printf 'Restored %s. Recovery material: %s\n' "$old_sha" "$backup"
}
finish() {
  local rc=$?
  trap - EXIT INT TERM HUP
  if [[ ${armed:-false} == true ]]; then
    if ! recover; then
      printf 'Automatic recovery incomplete. Keep %s and rerun this script with %s.\n' "$pending" "$target" >&2
    fi
    (( rc != 0 )) || rc=1
  fi
  exit "$rc"
}

# A template clone carries table-level ACLs but omits cluster catalog entries
# attached to the database OID. Compare these before exposing a clone.
db_policy() {
  admin "SELECT jsonb_build_array(pg_get_userbyid(datdba), datacl, datconnlimit, datistemplate,
    datcollversion, datlocprovider, dattablespace, shobj_description(oid,'pg_database'),
    (SELECT jsonb_agg(jsonb_build_array(setrole,setconfig) ORDER BY setrole)
       FROM pg_db_role_setting WHERE setdatabase=pg_database.oid),
    (SELECT jsonb_agg(jsonb_build_array(provider,label) ORDER BY provider)
       FROM pg_shseclabel WHERE classoid='pg_database'::regclass AND objoid=pg_database.oid))
    FROM pg_database WHERE datname='$1'"
}
copy_db_policy() {
  local dest=$1 cmd
  # The single-tenant pilot uses database owner xiutu. Preserve its connection
  # limit, comments, permissions and role-specific database configuration.
  cmd=$(admin "SELECT format('ALTER DATABASE %I CONNECTION LIMIT %s; COMMENT ON DATABASE %I IS %L;',
    '$dest',datconnlimit,'$dest',shobj_description(oid,'pg_database')) FROM pg_database WHERE datname='xiutu'") || return 1
  admin "$cmd" >/dev/null || return 1
  compose exec -T db psql -X -qAt -v ON_ERROR_STOP=1 -v dest="$dest" -U xiutu -d postgres >/dev/null <<'SQL' || return 1
SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC, %I', :'dest',pg_get_userbyid(datdba))
  FROM pg_database WHERE datname='xiutu' AND datacl IS NOT NULL \gexec
SELECT format('GRANT %s ON DATABASE %I TO %s %s GRANTED BY %I', a.privilege_type, :'dest',
  CASE a.grantee WHEN 0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(a.grantee)) END,
  CASE WHEN a.is_grantable THEN 'WITH GRANT OPTION' ELSE '' END, pg_get_userbyid(a.grantor))
  FROM pg_database d CROSS JOIN LATERAL aclexplode(d.datacl) a
  WHERE d.datname='xiutu' ORDER BY a.grantor!=d.datdba, a.is_grantable DESC \gexec
SELECT format('BEGIN; SELECT set_config(%L,%L,true); ALTER %s SET %I FROM CURRENT; COMMIT;',
  split_part(setting,'=',1),substr(setting,strpos(setting,'=')+1),
  CASE setrole WHEN 0 THEN format('DATABASE %I',:'dest')
    ELSE format('ROLE %I IN DATABASE %I',pg_get_userbyid(setrole),:'dest') END, split_part(setting,'=',1))
  FROM pg_db_role_setting CROSS JOIN LATERAL unnest(setconfig) setting
  WHERE setdatabase=(SELECT oid FROM pg_database WHERE datname='xiutu') \gexec
SELECT format('SECURITY LABEL FOR %I ON DATABASE %I IS %L',provider,:'dest',label)
  FROM pg_shseclabel WHERE classoid='pg_database'::regclass
  AND objoid=(SELECT oid FROM pg_database WHERE datname='xiutu') \gexec
SQL
  [[ $(db_policy xiutu) == "$(db_policy "$dest")" ]]
}
main() {
  [[ $# == 1 && $1 =~ ^[0-9a-f]{40}$ ]] || die 'Usage: upgrade-schema.sh EXACT_MAIN_SHA'
  target=$1
  local tool_dir server web actual service id version test_db candidate_oid
  local db_kib assets_kib free_kib
  # EXIT recovery runs after Bash has unwound main's local scope.
  declare -ga compose_files=()
  tool_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
  follow="$tool_dir/follow-main.sh"
  [[ -x "$follow" ]] || follow="$tool_dir/xiutu-follow-main"
  [[ -x "$follow" ]] || die 'Cannot locate the installed follow-main helper.'
  cd /home/ubuntu/xiutu-pilot
  pending=state/upgrade-schema.pending
  if [[ ! -f "$pending" ]]; then "$follow" --stage "$target"; fi
  exec 9>state/deploy.lock
  flock -w 40 9 || die 'Another deployment is running.'
  find_stack
  if [[ -e "$pending" ]]; then
    read -r previous backup < "$pending"
    [[ "$previous" == "$target" && "$backup" =~ ^state/schema-upgrade\.[A-Za-z0-9._-]+$ && -d "$backup" ]] ||
      die 'An interrupted schema upgrade needs its recorded SHA for recovery.'
    recover
    if [[ -f "$backup/committed" ]]; then
      select_images "$target" ""
      "$follow" --verify "$target"
      echo 'Finished opening the previously committed release.'
      return
    fi
    echo 'Interrupted upgrade rolled back. Rerun the same command to deploy.'
    return 75
  fi
  old_sha=$(sed -n 's/^RELEASE_SHA=\([0-9a-f]\{40\}\)$/\1/p' RELEASE)
  [[ $old_sha =~ ^[0-9a-f]{40}$ ]] || die 'Current RELEASE is invalid.'
  if [[ $target == "$old_sha" ]]; then "$follow" --verify "$target"; return; fi
  # Compose needs a value even when just listing existing containers.
  select_images "$old_sha" ""
  api_id=$(service_id api)
  web_id=$(service_id web)
  server=$(docker inspect --format '{{.Config.Image}}' "$api_id")
  web=$(docker inspect --format '{{.Config.Image}}' "$web_id")
  old_ref=${server#xiutu-pilot-server:}
  [[ "$server" == "xiutu-pilot-server:$old_ref" && ( "$old_ref" == "$old_sha" || "$old_ref" == "${old_sha:0:7}" ) &&
     "$web" == "xiutu-pilot-web:$old_ref"* ]] || die 'Live image tags disagree with RELEASE.'
  old_suffix=${web#"xiutu-pilot-web:$old_ref"}
  [[ -z "$old_suffix" || "$old_suffix" =~ ^-[-a-zA-Z0-9_.]+$ ]] || die 'Unexpected live web image suffix.'
  select_images "$old_ref" "$old_suffix"
  assert_layout "$old_ref" "$old_suffix" || die 'The installed Compose files cannot reproduce the current images.'
  "$follow" --verify "$old_sha"
  select_images "$target" ""
  assert_layout "$target" "" || die 'Candidate images were not selected by Compose.'
  for service in server web; do
    actual=$(docker image inspect --format '{{.Os}}/{{.Architecture}} {{index .Config.Labels "org.opencontainers.image.revision"}}' "xiutu-pilot-$service:$target")
    [[ "$actual" == "linux/amd64 $target" ]] || die 'Exact candidate image is missing.'
  done
  required=$(docker run --rm --network none --entrypoint node "xiutu-pilot-server:$target" --import tsx --input-type=module \
    -e 'import {REQUIRED_SCHEMA_VERSIONS} from "@ai-xiutu/db"; console.log(REQUIRED_SCHEMA_VERSIONS.join(","))')
  version=$(versions xiutu)
  [[ $required =~ ^[0-9]+(,[0-9]+)*$ && $version =~ ^[0-9]+(,[0-9]+)*$ &&
     ( "$required" == "$version" || "$required" == "$version,"* ) ]] || die 'The old schema is not a prefix of the required migrations.'
  compose config --format json | jq -e '(.services.api.environment.SITE_ICP_FILING // "") | length > 0' >/dev/null ||
    die 'Candidate API is missing the installed site filing.'
  original_oid=$(oid_for xiutu)
  [[ "$original_oid" =~ ^[0-9]+$ ]] || die 'Cannot identify the current database.'
  token="${target:0:12}_$(date +%s)_$$"
  test_db=xu_test_$token
  new_db=xu_new_$token
  old_db=xu_old_$token
  failed_db=xu_failed_$token
  backup=$(mktemp -d "state/schema-upgrade.$token.XXXXXXXX")
  cp -p -- RELEASE "$backup/RELEASE.before"
  cp -p -- .env "$backup/.env.before"
  for ((id=1;id<${#compose_files[@]};id+=2)); do
    cp -p -- "${compose_files[id]}" "$backup/compose.$id.yaml"
  done
  for service in web api worker; do
    web_mounts "$(service_id "$service")" > "$backup/$service-mounts.json"
  done
  docker inspect --format '{{json .Mounts}}' "$api_id" |
    jq -er '[.[] | select(.Destination == "/app/.data/private" and .Type == "volume" and .RW) | .Name] | select(length == 1) | first' > "$backup/assets-volume"
  docker volume inspect "$(cat "$backup/assets-volume")" >/dev/null
  printf '%s %s %s %s %s\n' "$old_sha" "$old_ref" "${old_suffix:-_}" "$original_oid" "$token" > "$backup/recovery"
  local -a mount_reader=(docker run --rm --network none --read-only --user 0 --volumes-from "$api_id:ro")
  db_kib=$(admin "SELECT pg_database_size('xiutu')/1024+1")
  assets_kib=$("${mount_reader[@]}" --entrypoint du "$server" -sk /app/.data/private /app/.data/ai-dispatch-journal | awk '{s+=$1} END{print s+0}')
  free_kib=$(df -Pk "$backup" | awk 'NR==2 {print $4}')
  (( free_kib > assets_kib + 4*db_kib + 65536 )) || die 'Insufficient space for archives and database clones.'
  save_dump xiutu rehearsal.dump
  admin "CREATE DATABASE \"$test_db\" TEMPLATE template0 OWNER xiutu"
  compose exec -T db pg_restore --exit-on-error --single-transaction -U xiutu -d "$test_db" < "$backup/rehearsal.dump"
  copy_db_policy "$test_db" || die 'Database ACL, settings or storage policy could not be reproduced.'
  migrate_copy "$test_db"
  admin "DROP DATABASE \"$test_db\""
  [[ $(new_main) == "$target" && $(oid_for xiutu) == "$original_oid" ]] || die 'Main or the source database changed during rehearsal.'
  cmp -s -- .env "$backup/.env.before" || die 'The installation environment changed during rehearsal.'
  armed=false
  trap finish EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  trap 'exit 129' HUP
  printf '%s %s\n' "$target" "$backup" > "$backup/pending"
  mv -- "$backup/pending" "$pending"
  sync -f "$pending"
  armed=true
  stop_writers
  gate_volume hold
  freeze_db xiutu
  admin "CREATE DATABASE \"$new_db\" TEMPLATE xiutu OWNER xiutu"
  copy_db_policy "$new_db"
  candidate_oid=$(oid_for "$new_db")
  printf '%s\n' "$candidate_oid" > "$backup/candidate-oid"
  [[ $candidate_oid =~ ^[0-9]+$ && "$candidate_oid" != "$original_oid" ]]
  # This clone and the original now contain the same post-drain snapshot. Dump
  # the clone before migration while the original stays closed to connections.
  save_dump "$new_db" final.dump
  compose logs --no-color --timestamps api worker web > "$backup/services.log"
  "${mount_reader[@]}" --entrypoint tar "$server" --exclude=private/.xiutu-schema-upgrade -C /app/.data -cf - private ai-dispatch-journal > "$backup/assets-journal.tar.partial"
  tar -tf "$backup/assets-journal.tar.partial" >/dev/null
  mv -- "$backup/assets-journal.tar.partial" "$backup/assets-journal.tar"
  (cd "$backup" && sha256sum final.dump assets-journal.tar services.log > SHA256SUMS)
  inventory "$new_db" > "$backup/counts.before"
  migrate_copy "$new_db"
  [[ $(inventory "$new_db") == "$(cat "$backup/counts.before")" ]] || die 'Migration changed user, project or asset counts.'
  exchange_db "$old_db" "$new_db"
  [[ $(oid_for xiutu) == "$candidate_oid" && $(oid_for "$old_db") == "$original_oid" ]]
  install_candidate_environment
  select_images "$target" ""
  up api
  [[ $(web_mounts "$(service_id api)") == "$(cat "$backup/api-mounts.json")" ]]
  compose exec -T api node --input-type=module -e '
    import { accessSync, constants as c } from "node:fs";
    const e=process.env;
    if (!e.SITE_ICP_FILING?.trim() || e.MEDIA_ADVANCED_ENABLED !== "true") process.exit(1);
    accessSync(e.MEDIA_PYTHON,c.X_OK); accessSync(e.MEDIA_HEIC_DECODER,c.X_OK); accessSync(e.MEDIA_UHDR_LIBRARY,c.R_OK);
    const origin="http://127.0.0.1:3001";
    const probe=await fetch(origin+"/v1/session",{method:"POST"});
    if(probe.status!==503 || (await probe.json()).error?.code!=="DEPLOYMENT_IN_PROGRESS") process.exit(1);
    const json = async (path) => {
      const r=await fetch(origin+path,{signal:AbortSignal.timeout(35000)});
      if(!r.ok) throw Error("Capability check failed for "+path+" ("+r.status+")");
      return await r.json();
    };
    const [cfg,media,registry]=await Promise.all([json("/v1/public-config"),json("/v1/media-capabilities"),json("/v1/modules")]);
    if(cfg.siteFiling!==e.SITE_ICP_FILING.trim().slice(0,64) ||
        !(cfg.limits?.maxUploadBytes>=50*1024*1024 && cfg.limits?.maxPixels>=64000000))
      throw Error("Site filing or image limits were not inherited");
    for(const field of ["enabled","available","nativeReady"])
      if(media[field]!==true) throw Error("Media runtime is missing "+field);
    for(const codec of ["ultraHdrJpeg","heicPq","heicHlg"])
      if(media[codec]?.available!==true) throw Error("Native media decoder is missing "+codec);
    const caps=registry.modules.flatMap(m=>m.capabilities);
    for(const name of ["assistant.turns","assistant.voice"])
      if(!caps.some(c=>c.id===name && c.runtime==="available")) throw Error("Agent runtime is missing "+name);'
  up web
  [[ $(web_mounts "$(service_id web)") == "$(cat "$backup/web-mounts.json")" ]] || die 'Web TLS or custom configuration mounts changed.'
  up worker
  [[ $(web_mounts "$(service_id worker)") == "$(cat "$backup/worker-mounts.json")" ]]
  "$follow" --verify "$target"
  # Confirm future automatic deployments select the same tags with only RELEASE/.env.
  unset XIUTU_WEB_IMAGE_SUFFIX
  assert_layout "$target" "" || die 'Persistent Compose image selection is inconsistent.'
  write_release "$backup/RELEASE.before" "$target"
  if [[ -f state/blocked-sha && $(cat state/blocked-sha) == "$target" ]]; then rm -- state/blocked-sha; fi
  sync -f RELEASE
  # Persist the commit decision before allowing any new business write.
  printf '%s\n' "$target" > "$backup/committed.next"
  mv -- "$backup/committed.next" "$backup/committed"
  sync -f "$backup/committed"
  complete_commit
  armed=false
  echo "Verified $target; retained original database $old_db and archives in $backup."
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then main "$@"; fi
