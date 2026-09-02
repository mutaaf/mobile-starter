#!/usr/bin/env bash
#
# Copies the screenshots from the newest `.maestro/capture.yaml` run into
# docs/screens/, resized to the width the README and the landing page use.
#
# Maestro insists on writing under ~/.maestro/tests/<timestamp>/, so this is the
# other half of `npm run capture` rather than something the flow could do itself.
#
#   npm run capture     # runs the flow, then this
#
# macOS only: it uses `sips`. On Linux, swap the resize line for ImageMagick.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WIDTH=560

SRC="$(ls -dt "$HOME"/.maestro/tests/*/capture/takeScreenshot/shots 2>/dev/null | head -1 || true)"
if [ -z "$SRC" ]; then
  echo "no capture run found under ~/.maestro/tests — run 'npm run capture' first" >&2
  exit 1
fi

echo "collecting from $SRC"
mkdir -p "$ROOT/docs/screens"

shopt -s nullglob
found=0
for file in "$SRC"/*.png; do
  base="$(basename "$file" .png)"
  # 01-orbit.png -> orbit.png: the numeric prefix only exists to order the run.
  sips --resampleWidth "$WIDTH" "$file" --out "$ROOT/docs/screens/${base#*-}.png" >/dev/null
  found=$((found + 1))
done

if [ "$found" -eq 0 ]; then
  echo "the capture run produced no screenshots — did the flow fail partway?" >&2
  exit 1
fi

echo "wrote $found screenshots to docs/screens/ at ${WIDTH}px wide"
