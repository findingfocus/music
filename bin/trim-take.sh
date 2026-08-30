#!/usr/bin/env bash
set -euo pipefail

REC="${FF_RECORDINGS_DIR:-$HOME/recordings}"

RAW=$(ls -t "$REC"/*.raw.wav 2>/dev/null | head -1 || true)
[[ -n "$RAW" ]] || { echo "no $REC/*.raw.wav found"; exit 1; }

END=$(ffmpeg -nostats -i "$RAW" -af silencedetect=noise=-45dB:d=0.3 -f null - 2>&1 \
  | grep -o "silence_start: [0-9.]*" | awk '{print $2}' | tail -1)

if [[ -z "$END" ]]; then
  echo "no trailing silence detected in $RAW — recording may be silent"; exit 1
fi

OUT="${RAW%.raw.wav}.wav"
ffmpeg -y -v error -i "$RAW" -to "$END" -c copy "$OUT"

echo "trimmed -> $OUT ($(printf '%.1f' "$END") s)"
ffmpeg -i "$OUT" -af volumedetect -f null - 2>&1 | grep -E "mean_volume|max_volume" || true