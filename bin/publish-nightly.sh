#!/usr/bin/env bash
set -euo pipefail

REMOTE="${FF_RCLONE_REMOTE:-ffmedia}"
BUCKET="${FF_R2_BUCKET:-findingfocus-music}"
R2_TRACKS="tracks.json"
R2_DIR="nightly"
R2_BASE="${FF_R2_BASE:-https://media.findingfocus.music}"
REPO_CODE_URL="https://findingfocus.io/findingfocus/tidal/raw/branch/main"
RECORDINGS_DIR="${FF_RECORDINGS_DIR:-$HOME/recordings}"
LOCAL_TIDAL_DIRS="${FF_TIDAL_DIR:-$HOME/git/tidal $HOME/tidal}"

TITLE_OVERRIDE=""
CODE_FILE=""
WAV=""
DRY_RUN="${FF_DRY_RUN:-0}"

usage() {
  cat <<'EOF'
Publish tonight's set to findingfocus.music.

USAGE
  publish-nightly.sh [--wav FILE] [--code FILE] [--title "NAME"] [--dry-run]

  --wav FILE    WAV to publish (default: newest .wav in $RECORDINGS_DIR)
  --code FILE   Tidal code to attach (default: $LOCAL_TIDAL_DIR/<date>.tidal,
                else pulled from findingfocus.io/findingfocus/tidal)
  --title NAME  override the generated name from the names table
  --dry-run     build everything, print what would upload, upload nothing
EOF
  exit 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --wav) WAV="$2"; shift 2 ;;
    --code) CODE_FILE="$2"; shift 2 ;;
    --title) TITLE_OVERRIDE="$2"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h | --help) usage ;;
    *) echo "unknown arg: $1"; usage ;;
  esac
done

DATE=$(date +%F)
DATE_ID=$(date +%Y%m%d)
BIN="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

if [[ -z "$WAV" ]]; then
  WAV=$(ls -t "$RECORDINGS_DIR"/*.wav 2>/dev/null | head -1 || true)
fi
[[ -n "$WAV" && -f "$WAV" ]] || { echo "no wav found: pass --wav or drop a file in $RECORDINGS_DIR"; exit 1; }

# --- next index: counter lives in tracks.json, no day-tracking ---
if curl -sf --max-time 10 "$R2_BASE/$R2_TRACKS" -o "$TMP/remote.json"; then
  NEXT=$(python3 -c "import json;print(max((t.get('index',0) for t in json.load(open('$TMP/remote.json'))),default=0)+1)")
else
  NEXT=1
fi

if [[ -n "$TITLE_OVERRIDE" ]]; then
  TITLE="$TITLE_OVERRIDE"
else
  TITLE=$(python3 "$BIN/names.py" "$NEXT")
fi

ID="${DATE_ID}_${NEXT}"
SLUG="$(date +%Y-%m-%d)_${NEXT}"
MP3_KEY="$R2_DIR/${SLUG}.mp3"
PEAKS_KEY="$R2_DIR/${SLUG}.peaks.json"
MP3_URL="$R2_BASE/$MP3_KEY"

echo "index : $NEXT"
echo "title : $TITLE"
echo "id    : $ID"
echo "from  : $WAV"

# --- encode ---
ffmpeg -y -v error -i "$WAV" -vn -ac 2 -codec:a libmp3lame -b:a 192k "$TMP/out.mp3"
DURATION=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$TMP/out.mp3" | cut -c1-9)

# --- peaks ---
python3 "$BIN/peaks.py" "$TMP/out.mp3" "$TMP/peaks.json"

# --- code import ---
CODE_SOURCE=""
SOURCE_URL=""
LOCAL_TIDAL_FILE=""
for d in $LOCAL_TIDAL_DIRS; do
  if [[ -f "$d/$DATE.tidal" ]]; then
    LOCAL_TIDAL_FILE="$d/$DATE.tidal"
    break
  fi
done
if [[ -n "$CODE_FILE" && -f "$CODE_FILE" ]]; then
  CODE_SOURCE=$(cat "$CODE_FILE")
elif [[ -n "$LOCAL_TIDAL_FILE" ]]; then
  CODE_SOURCE=$(cat "$LOCAL_TIDAL_FILE")
  SOURCE_URL="$REPO_CODE_URL/$DATE.tidal"
elif curl -sf --max-time 10 "$REPO_CODE_URL/$DATE.tidal" -o "$TMP/code.tidal" 2>/dev/null; then
  CODE_SOURCE=$(cat "$TMP/code.tidal")
  SOURCE_URL="$REPO_CODE_URL/$DATE.tidal"
fi
SUB_LINES=$(printf '%s\n' "$CODE_SOURCE" | sed '/^\s*--/d;/^\s*$/d' | tail -n 8 || true)
if [[ -z "$SUB_LINES" ]]; then
  SUB_LINES='d1 $ sound "bd sn"'
  CODE_SOURCE=""
fi
has_code="no"; [[ -n "$CODE_SOURCE" ]] && has_code="yes"
echo "code  : $has_code"

# --- build entry + merge ---
python3 - "$TMP/remote.json" "$TMP/merged.json" "$ID" "$TITLE" "$DATE" "$NEXT" "$MP3_URL" "$DURATION" "$TMP/peaks.json" "$SUB_LINES" "$CODE_SOURCE" "$SOURCE_URL" <<'PY'
import json, sys
remote_path, out_path, id_, title, date, index, mp3_url, duration, peaks_path, sub_lines, code_source, source_url = sys.argv[1:]
peaks = json.load(open(peaks_path))["peaks"]
entry = {
    "id": id_, "index": int(index), "title": title, "date": date,
    "sub": sub_lines.splitlines(), "source": code_source,
    "sourceUrl": source_url, "url": mp3_url,
    "peaks": peaks, "duration": float(duration),
}
try:
    items = json.load(open(remote_path))
except Exception:
    items = []
if any(t.get("id") == id_ for t in items):
    print("ALREADY_PUBLISHED")
    raise SystemExit(2)
items.insert(0, entry)
json.dump(items, open(out_path, "w"), separators=(",", ":"))
PY

if [[ "$DRY_RUN" == "1" ]]; then
  echo "--- dry run: would upload ---"
  echo "  $REMOTE:$BUCKET/$MP3_KEY"
  echo "  $REMOTE:$BUCKET/$PEAKS_KEY"
  echo "  $REMOTE:$BUCKET/$R2_TRACKS"
  python3 -c "import json;d=json.load(open('$TMP/merged.json'));print('merged tracks.json entries:',len(d));print('newest:',d[0]['id'],d[0]['title'])"
  echo "ok (nothing uploaded)"
  exit 0
fi

rclone copyto "$TMP/out.mp3" "$REMOTE:$BUCKET/$MP3_KEY" --s3-no-check-bucket
rclone copyto "$TMP/peaks.json" "$REMOTE:$BUCKET/$PEAKS_KEY" --s3-no-check-bucket
rclone copyto "$TMP/merged.json" "$REMOTE:$BUCKET/$R2_TRACKS" --s3-no-check-bucket --header-upload "Cache-Control: no-cache" || rclone copyto "$TMP/merged.json" "$REMOTE:$BUCKET/$R2_TRACKS" --s3-no-check-bucket

echo
echo "published: $TITLE ($ID)"
echo "$MP3_URL"
echo "check: $R2_BASE/$R2_TRACKS"