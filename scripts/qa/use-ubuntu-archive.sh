#!/usr/bin/env bash
set -eu

# Hosted Ubuntu jobs have stalled or failed DNS while downloading from the
# runner's Azure mirror. Use the signed Canonical archive already in its list.
mirror_list=/etc/apt/apt-mirrors.txt
if [[ -f "$mirror_list" ]] && grep -q 'azure\.archive\.ubuntu\.com' "$mirror_list"; then
  printf '%s\n' 'https://archive.ubuntu.com/ubuntu' | sudo tee "$mirror_list" >/dev/null
fi
