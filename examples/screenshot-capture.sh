#!/usr/bin/env bash
set -euo pipefail

# Triggered by a launchd WatchPaths job (see the README's "Photos and
# screenshots" section for the matching plist) whenever anything changes in
# your screenshot folder - a coarse signal, so this script does the actual
# filtering down to real screenshots. Moves them into Cortex's inbox -
# Cortex picks them up and enriches them automatically from there.
#
# Edit the three variables below to match your setup, then make this file
# executable: chmod +x screenshot-capture.sh

VAULT="$HOME/Obsidian/YourVaultName"
INBOX_FOLDER="00-Inbox" # must match Cortex's "Inbox folder" setting
SCREENSHOT_DIR="$HOME/Desktop" # macOS's default - check System Settings ->
                                # Screenshots if you've changed it

# Give a just-taken screenshot a moment to finish writing before touching it.
sleep 1

shopt -s nullglob
now="$(date +%s)"
for f in "$SCREENSHOT_DIR"/Screenshot*.png; do
  base="$(basename "$f")"
  # Only macOS's actual screenshot naming convention - not just any PNG that
  # happens to be sitting in that folder.
  if [[ ! "$base" =~ ^Screenshot\ [0-9]{4}-[0-9]{2}-[0-9]{2}\ at ]]; then
    continue
  fi
  # Only a screenshot actually just taken - WatchPaths fires on ANY change to
  # the folder (not just a new screenshot), so without this an old screenshot
  # already sitting here would get swept into the vault the next time
  # anything else in the folder changes (including the very first time you
  # load this watcher, if old screenshots are already in the folder).
  mtime="$(stat -f %m "$f")"
  if (( now - mtime > 60 )); then
    continue
  fi
  dest="$VAULT/$INBOX_FOLDER/$(date +%Y-%m-%d\ %H.%M.%S).png"
  if [ -e "$dest" ]; then
    dest="$VAULT/$INBOX_FOLDER/$(date +%Y-%m-%d\ %H.%M.%S)-$$.png"
  fi
  mv "$f" "$dest"
done
