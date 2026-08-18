#!/usr/bin/env bash
set -euo pipefail

# Point your dictation tool's "external script" / "run a script" paste
# option at this file (for Handy: Settings -> Paste method -> External
# script). It receives the full transcript as $1 and writes it straight
# into Nous's inbox folder - Nous picks it up and enriches it
# automatically from there, no need to open Obsidian first.
#
# Edit the two variables below to match your setup, then make this file
# executable: chmod +x dictation-capture.sh

VAULT="$HOME/Obsidian/YourVaultName"
INBOX_FOLDER="00-Inbox" # must match Nous's "Inbox folder" setting

TEXT="${1:-}"

if [ -z "$TEXT" ]; then
  exit 0
fi

DEST="$VAULT/$INBOX_FOLDER"
STAMP="$(date +%Y-%m-%d\ %H.%M.%S)"

# If VAULT/INBOX_FOLDER is wrong (a moved vault, a renamed folder), do not
# lose the dictation with no trace - save it to the Desktop instead, where
# it is still easy to find, and say clearly why.
if [ ! -d "$DEST" ]; then
  mkdir -p "$HOME/Desktop"
  FALLBACK="$HOME/Desktop/Nous dictation failed - $STAMP.md"
  printf '%s\n' "$TEXT" >"$FALLBACK"
  echo "dictation-capture.sh: '$DEST' does not exist. Saved to '$FALLBACK' instead." >&2
  exit 1
fi

FILE="$DEST/$STAMP.md"
# Two dictations in the same second would otherwise silently overwrite
# each other - add a numeral instead of losing the first one.
N=2
while [ -e "$FILE" ]; do
  FILE="$DEST/$STAMP ($N).md"
  N=$((N + 1))
done

printf '%s\n' "$TEXT" >"$FILE"
