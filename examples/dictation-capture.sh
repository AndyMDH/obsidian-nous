#!/usr/bin/env bash
set -euo pipefail

# Point your dictation tool's "external script" / "run a script" paste
# option at this file (for Handy: Settings -> Paste method -> External
# script). It receives the full transcript as $1 and writes it straight
# into Cortex's inbox folder - Cortex picks it up and enriches it
# automatically from there, no need to open Obsidian first.
#
# Edit the two variables below to match your setup, then make this file
# executable: chmod +x dictation-capture.sh

VAULT="$HOME/Obsidian/YourVaultName"
INBOX_FOLDER="00-Inbox" # must match Cortex's "Inbox folder" setting

TEXT="${1:-}"

if [ -z "$TEXT" ]; then
  exit 0
fi

FILE="$VAULT/$INBOX_FOLDER/$(date +%Y-%m-%d\ %H.%M.%S).md"
printf '%s\n' "$TEXT" > "$FILE"
