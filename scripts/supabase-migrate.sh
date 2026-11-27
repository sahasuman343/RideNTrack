#!/usr/bin/env bash
# Applies pending supabase/migrations to one Supabase project.
#
#   scripts/supabase-migrate.sh <dev|live> <plan|apply>
#
# plan  shows what would change and touches nothing.
# apply fixes the migration history once if needed (see below), then runs
#       `supabase db push`.
#
# Needs SUPABASE_ACCESS_TOKEN, SUPABASE_DB_PASSWORD and SUPABASE_PROJECT_REF.
#
# One-time history fixes, detected automatically and skipped once done:
#   dev  ran 037-064 under their old timestamp names. Those versions are
#        swapped for 037-064 so nothing runs twice.
#   live had 001-038 applied by hand and its history holds other names.
#        The stray versions are removed and 001-038 are recorded as applied
#        (checked: live has the objects from 034-038 and none from 039 on).
set -euo pipefail

target="${1:?usage: supabase-migrate.sh <dev|live> <plan|apply>}"
mode="${2:?usage: supabase-migrate.sh <dev|live> <plan|apply>}"
case "$target" in dev|live) ;; *) echo "target must be dev or live" >&2; exit 2 ;; esac
case "$mode" in plan|apply) ;; *) echo "mode must be plan or apply" >&2; exit 2 ;; esac
: "${SUPABASE_PROJECT_REF:?}" "${SUPABASE_ACCESS_TOKEN:?}" "${SUPABASE_DB_PASSWORD:?}"

# The history fixes below assume migrations are named NNN_<name>.sql.
if ls supabase/migrations | grep -qE '^[0-9]{14}_'; then
  echo "::error::This branch still has timestamp-named migrations. Run this from a branch with the renamed 037-064 files (PR 37)." >&2
  exit 1
fi

OLD_RENAMED="20261004062839 20261004141301 20261201000100 20261201000200 20261201000300 20261201000400 20261201000500 20261201000600 20261201000700 20261201000800 20261201000900 20261201001000 20261201001100 20261201001200 20261201001300 20261201001400 20261201001500 20261201001600 20261201001700 20261201001800 20261201001900 20261201002000 20261201002100 20261201002200 20261201002300 20261201002400 20261201002500 20261201002600"
LIVE_STRAY="20261004061657 20261004062839 20261004141549 20261115105021 20261115105032 20261115105222 20261115105314"

supabase link --project-ref "$SUPABASE_PROJECT_REF"
history="$(supabase migration list --linked)"
echo "$history"

revert="" applied="" pending_after=""
if grep -q '20261004062839' <<<"$history"; then
  if [ "$target" = dev ]; then
    revert="$OLD_RENAMED"; applied="$(seq -f '%03g' 37 64 | tr '\n' ' ')"; first_new=65
  else
    revert="$LIVE_STRAY"; applied="$(seq -f '%03g' 1 38 | tr '\n' ' ')"; first_new=39
  fi
  pending_after="$(ls supabase/migrations | awk -F_ -v n="$first_new" '$1+0 >= n')"
fi

if [ "$mode" = plan ]; then
  if [ -n "$revert" ]; then
    echo
    echo "== One-time history fix on $target (runs first on apply)"
    echo "Remove from history: $revert"
    echo "Record as applied:   $applied"
    echo
    echo "== Then these migrations would run:"
    echo "${pending_after:-(none)}"
  else
    supabase db push --dry-run
  fi
  exit 0
fi

if [ -n "$revert" ]; then
  # shellcheck disable=SC2086
  supabase migration repair --linked --status reverted $revert
  # shellcheck disable=SC2086
  supabase migration repair --linked --status applied $applied
fi
supabase db push
supabase migration list --linked
