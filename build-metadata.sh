#!/usr/bin/env bash
# Generates apps-metadata.json from spec and session files.
# Run during CI build before deploying to GitHub Pages.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# Discover apps: directories that have a spec/functionality.md
APPS=$(find . -maxdepth 3 -path '*/spec/functionality.md' -printf '%h\n' | sed 's|^\./||;s|/spec$||' | sort)

echo "["
first=true
for app in $APPS; do
    [ -d "$app" ] || continue

    # Description: first non-empty, non-heading line after ## Purpose
    desc=""
    spec_file="$app/spec/functionality.md"
    if [ -f "$spec_file" ]; then
        desc=$(awk '/^## Purpose/{found=1; next} found && /^#/{exit} found && NF{print; exit}' "$spec_file")
    fi

    # Session files
    sessions="[]"
    if [ -d "$app/sessions" ]; then
        files=$(find "$app/sessions" -name '*.md' -printf '%f\n' 2>/dev/null | sort)
        if [ -n "$files" ]; then
            sessions=$(echo "$files" | jq -R . | jq -s .)
        fi
    fi

    if [ "$first" = true ]; then
        first=false
    else
        echo ","
    fi

    jq -n \
        --arg name "$app" \
        --arg desc "$desc" \
        --argjson sessions "$sessions" \
        '{name: $name, description: $desc, sessions: $sessions}'
done
echo ""
echo "]"
