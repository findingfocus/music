#!/usr/bin/env bash
set -euo pipefail

REMOTE="${FF_RCLONE_REMOTE:-ffmedia}"
BUCKET="${FF_R2_BUCKET:-findingfocus-music}"
R2_TRACKS="tracks.json"
R2_DIR="${FF_R2_DIR:-tracks}"
R2_BASE="${FF_R2_BASE:-https://media.findingfocus.music}"
REPO_CODE_URL="https://findingfocus.io/findingfocus/tidal/raw/branch/main"
RECORDINGS_DIR="${FF_RECORDINGS_DIR:-$HOME/recordings}"
LOCAL_TIDAL_DIRS="${FF_TIDAL_DIR:-$HOME/git/tidal $HOME/tidal}"

TITLE_OVERRIDE=""
CODE_FILE=""
WAV=""
REPLACE_SLUG=""
URL_VER=""
FADE="${FF_FADE:-2.0}"
DRY_RUN="${FF_DRY_RUN:-0}"

usage() {
  cat <<'EOF'
Publish (or replace) a set on findingfocus.music.

USAGE
  publish-nightly.sh [--wav FILE] [--code FILE] [--title "NAME"] [--fade N] [--replace SLUG] [--dry-run]

  --wav FILE     WAV to use (default: newest .wav in $RECORDINGS_DIR)
  --code FILE    Tidal code to attach (default: $LOCAL_TIDAL_DIR/<date>.tidal,
                 else pulled from findingfocus.io/findingfocus/tidal)
  --title NAME   override the title (with --replace: renames the existing track)
  --fade N       loop crossfade width in seconds (default 2.0; 0 disables)
  --replace SLUG re-encode + overwrite an existing track in place, e.g. 2026-08-29_1
                 (the slug matches the .mp3 name on the bucket)
  --dry-run      build everything, print what would upload, upload nothing
EOF
  exit 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --wav) WAV="$2"; shift 2 ;;
    --code) CODE_FILE="$2"; shift 2 ;;
    --title) TITLE_OVERRIDE="$2"; shift 2 ;;
    --fade) FADE="$2"; shift 2 ;;
    --replace) REPLACE_SLUG="$2"; shift 2 ;;
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

# --- mode + identity ---
MODE="publish"
if [[ -n "$REPLACE_SLUG" ]]; then
  MODE="replace"
  curl -sf --max-time 10 "$R2_BASE/$R2_TRACKS" -o "$TMP/remote.json" \
    || { echo "replace: could not fetch $R2_BASE/$R2_TRACKS to find '$REPLACE_SLUG'"; exit 1; }
  source <(python3 - "$TMP/remote.json" "$REPLACE_SLUG" <<'PY'
import json, re, sys, shlex
p, slug = sys.argv[1:]
items = json.load(open(p))
for t in items:
    cand = f"{t.get('date','')}_{t.get('index','')}"
    if cand == slug or t.get("id") == slug or str(t.get("index")) == slug:
        print("EXIST_TITLE=" + shlex.quote(t.get("title", "")))
        print("EXIST_DATE=" + shlex.quote(t.get("date", "")))
        print("EXIST_ID=" + shlex.quote(t.get("id", "")))
        print("EXIST_INDEX=" + str(t.get("index", "")))
        print("EXIST_URL=" + shlex.quote(t.get("url", "")))
        m = re.search(r"[?&]v=(\d+)", t.get("url", ""))
        print("EXIST_VER=" + (m.group(1) if m else "0"))
        break
else:
    raise SystemExit(f"replace: no track matching '{slug}' in tracks.json")
PY
)
  if [[ -z "${EXIST_INDEX:-}" ]]; then
    echo "replace: no track matching '$REPLACE_SLUG' in tracks.json"; exit 1
  fi
  NEXT="$EXIST_INDEX"
  ID="$EXIST_ID"
  DATE="${EXIST_DATE:-$DATE}"
  TITLE="$EXIST_TITLE"
  if [[ -n "$TITLE_OVERRIDE" ]]; then TITLE="$TITLE_OVERRIDE"; fi
  SLUG="${DATE}_${NEXT}"
  URL_VER=$((EXIST_VER + 1))
else
  # next index: counter lives in tracks.json, no day-tracking
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
fi

MP3_KEY="$R2_DIR/${SLUG}.mp3"
PEAKS_KEY="$R2_DIR/${SLUG}.peaks.json"
MP3_URL="$R2_BASE/$MP3_KEY"
# replace bumps ?v=N so the URL is a fresh cache slot at the CDN + browsers
if [[ -n "$URL_VER" ]]; then
  MP3_URL="$MP3_URL?v=$URL_VER"
fi

echo "mode  : $MODE"
echo "index : $NEXT"
echo "title : $TITLE"
echo "id    : $ID"
echo "from  : $WAV"
[[ "$MODE" == "replace" ]] && echo "url   : $MP3_URL"

# --- encode (seamless loop: crossfade end<->start, width FADE) ---
ENC_SRC="$WAV"
if python3 -c "import sys; sys.exit(0 if float('$FADE') > 0 else 1)"; then
  SRC_DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$WAV" | cut -c1-9)
  read -r W BODYEND <<<"$(python3 - "$SRC_DUR" "$FADE" <<'PY'
import sys
d, f = float(sys.argv[1]), float(sys.argv[2])
if d <= 2 * f + 1:
    f = d / 3
print(f"{f:.3f} {d - f:.3f}")
PY
)"
  if python3 -c "import sys; sys.exit(0 if float('$W') >= 0.25 else 1)"; then
    echo "blend: ${W}s crossfade wrap"
    ffmpeg -y -v error -i "$WAV" -filter_complex \
      "[0:a]asplit=3[a0][a1][a2]; \
       [a0]atrim=0:${W},asetpts=N/SR/TB[head]; \
       [a1]atrim=${W}:${BODYEND},asetpts=N/SR/TB[body]; \
       [a2]atrim=${BODYEND}:${SRC_DUR},asetpts=N/SR/TB[tail]; \
       [tail][head]acrossfade=d=${W},asetpts=N/SR/TB[blend]; \
       [blend]asplit=2[b1][b2]; \
       [b1][body][b2]concat=n=3:v=0:a=1[out]" \
      -map "[out]" -vn -ac 2 -c:a pcm_s16le "$TMP/seamless.wav"
    ENC_SRC="$TMP/seamless.wav"
  else
    echo "blend: skipped ($W < 0.25s)"
  fi
fi

ffmpeg -y -v error -i "$ENC_SRC" -vn -ac 2 -codec:a libmp3lame -b:a 192k "$TMP/out.mp3"
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
  if [[ "$MODE" == "replace" ]]; then
    # no code found: keep whatever the existing track already displays
    SUB_LINES=""
    CODE_SOURCE=""
  else
    SUB_LINES='d1 $ sound "bd sn"'
    CODE_SOURCE=""
  fi
fi
has_code="no"; [[ -n "$CODE_SOURCE" ]] && has_code="yes"
echo "code  : $has_code"

# --- build entry + merge ---
python3 - "$MODE" "$TMP/remote.json" "$TMP/merged.json" "$ID" "$TITLE" "$DATE" "$NEXT" "$MP3_URL" "$DURATION" "$TMP/peaks.json" "$SUB_LINES" "$CODE_SOURCE" "$SOURCE_URL" "$SLUG" <<'PY'
import json, sys
mode, remote_path, out_path, id_, title, date, index, mp3_url, duration, peaks_path, sub_lines, code_source, source_url, slug = sys.argv[1:]
peaks = json.load(open(peaks_path))["peaks"]
try:
    items = json.load(open(remote_path))
except Exception:
    items = []
if mode == "replace":
    i = next((i for i, t in enumerate(items)
              if t.get("id") == id_ or f"{t.get('date','')}_{t.get('index','')}" == slug), None)
    if i is None:
        raise SystemExit(f"replace: no track matching {id_}/{slug} in tracks.json")
    entry = dict(items[i])
    entry.update(id=id_, title=title, date=date, index=int(index),
                 url=mp3_url, peaks=peaks, duration=float(duration))
    if code_source:
        entry.update(sub=sub_lines.splitlines(), source=code_source, sourceUrl=source_url)
    items[i] = entry
else:
    if any(t.get("id") == id_ for t in items):
        print("ALREADY_PUBLISHED")
        raise SystemExit(2)
    entry = {
        "id": id_, "index": int(index), "title": title, "date": date,
        "sub": sub_lines.splitlines(), "source": code_source,
        "sourceUrl": source_url, "url": mp3_url,
        "peaks": peaks, "duration": float(duration),
    }
    items.insert(0, entry)
json.dump(items, open(out_path, "w"), separators=(",", ":"))
PY

if [[ "$DRY_RUN" == "1" ]]; then
  echo "--- dry run: would upload ---"
  echo "  $REMOTE:$BUCKET/$MP3_KEY"
  echo "  $REMOTE:$BUCKET/$PEAKS_KEY"
  echo "  $REMOTE:$BUCKET/$R2_TRACKS"
  if [[ "$MODE" == "replace" ]]; then
    echo "  (replace: overwriting $MP3_KEY + $PEAKS_KEY + entry in tracks.json; no index bump)"
  fi
  python3 -c "import json;d=json.load(open('$TMP/merged.json'));print('merged tracks.json entries:',len(d));print('newest:',d[0]['id'],d[0]['title'])"
  echo "ok (nothing uploaded)"
  exit 0
fi

if [[ "$MODE" == "replace" ]]; then
  rclone copyto "$TMP/out.mp3" "$REMOTE:$BUCKET/$MP3_KEY" --s3-no-check-bucket --header-upload "Cache-Control: no-cache"
  rclone copyto "$TMP/peaks.json" "$REMOTE:$BUCKET/$PEAKS_KEY" --s3-no-check-bucket --header-upload "Cache-Control: no-cache"
else
  rclone copyto "$TMP/out.mp3" "$REMOTE:$BUCKET/$MP3_KEY" --s3-no-check-bucket
  rclone copyto "$TMP/peaks.json" "$REMOTE:$BUCKET/$PEAKS_KEY" --s3-no-check-bucket
fi
rclone copyto "$TMP/merged.json" "$REMOTE:$BUCKET/$R2_TRACKS" --s3-no-check-bucket --header-upload "Cache-Control: no-cache" || rclone copyto "$TMP/merged.json" "$REMOTE:$BUCKET/$R2_TRACKS" --s3-no-check-bucket

echo
if [[ "$MODE" == "replace" ]]; then
  echo "replaced: $TITLE ($ID) -> $MP3_URL"
else
  echo "published: $TITLE ($ID)"
  echo "$MP3_URL"
fi
echo "check: $R2_BASE/$R2_TRACKS"