#!/usr/bin/env bash
# aisd_skills installer — copies skills + shared schemas into ~/.claude/skills/
# Usage:
#   ./install.sh                # install all skills (P0 + Phase 2 placeholders)
#   ./install.sh --dry-run      # show what would be installed
#   ./install.sh --uninstall    # remove all aisd-* skills + aisd-shared
#   ./install.sh --skill 05     # install only one skill (matches aisd-05-*)

set -euo pipefail

SKILLS_DIR="${HOME}/.claude/skills"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

SKILLS=(
  "aisd-01-topic"
  "aisd-02-script"
  "aisd-03-assets"
  "aisd-04-storyboard"
  "aisd-05-video"
  "aisd-06-audio"
  "aisd-07-editing"
  "aisd-08-distribution"
  "aisd-09-feedback"
)

DRY_RUN=0
UNINSTALL=0
ONLY_SKILL=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --uninstall) UNINSTALL=1; shift ;;
    --skill) ONLY_SKILL="$2"; shift 2 ;;
    -h|--help)
      head -n 7 "$0" | tail -n 6 | sed 's/^# *//'
      exit 0
      ;;
    *) echo "Unknown arg: $1" >&2; exit 2 ;;
  esac
done

run() {
  if [[ $DRY_RUN -eq 1 ]]; then
    echo "[dry-run] $*"
  else
    eval "$@"
  fi
}

if [[ $UNINSTALL -eq 1 ]]; then
  echo "Uninstalling aisd skills from $SKILLS_DIR"
  for s in "${SKILLS[@]}"; do
    if [[ -d "$SKILLS_DIR/$s" ]]; then
      run "rm -rf '$SKILLS_DIR/$s'"
      echo "  removed $s"
    fi
  done
  if [[ -d "$SKILLS_DIR/aisd-shared" ]]; then
    run "rm -rf '$SKILLS_DIR/aisd-shared'"
    echo "  removed aisd-shared"
  fi
  echo "Done."
  exit 0
fi

mkdir -p "$SKILLS_DIR"

# 1) Install shared schemas + docs as aisd-shared/ — referenced by every skill
echo "Installing shared layer → $SKILLS_DIR/aisd-shared/"
run "rm -rf '$SKILLS_DIR/aisd-shared'"
run "cp -R '$REPO_ROOT/shared' '$SKILLS_DIR/aisd-shared'"

# 2) If installing aisd-03-assets, back up the old 3d-drama-assets first
if [[ -z "$ONLY_SKILL" ]] || [[ "$ONLY_SKILL" == *"03"* ]]; then
  if [[ -d "$SKILLS_DIR/3d-drama-assets" ]] && [[ ! -d "$SKILLS_DIR/3d-drama-assets.bak" ]]; then
    echo "Backing up legacy 3d-drama-assets → 3d-drama-assets.bak"
    run "mv '$SKILLS_DIR/3d-drama-assets' '$SKILLS_DIR/3d-drama-assets.bak'"
  fi
fi

# 3) Install each skill
for s in "${SKILLS[@]}"; do
  if [[ -n "$ONLY_SKILL" ]] && [[ "$s" != *"$ONLY_SKILL"* ]]; then
    continue
  fi
  src="$REPO_ROOT/$s"
  dst="$SKILLS_DIR/$s"
  if [[ ! -d "$src" ]]; then
    echo "  skip $s (not found in repo)"
    continue
  fi
  echo "Installing $s → $dst"
  run "rm -rf '$dst'"
  run "cp -R '$src' '$dst'"
done

if [[ $DRY_RUN -eq 0 ]]; then
  echo ""
  echo "✓ Install complete. Verify with:"
  echo "    ls $SKILLS_DIR | grep aisd-"
  echo ""
  echo "Trigger any skill via slash command, e.g.:"
  echo "    /aisd-01-topic 都市职场反转, douyin, zh-CN"
fi
