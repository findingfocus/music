# findingfocus nightly publisher — Omarchy setup & usage

Publishes each night's Tidal/Cycles set to findingfocus.music. One command per night; new tracks appear on the site instantly (no deploys).

**No repo clone needed.** The scripts are single files fetched from the Forgejo raw URL, so they always match the repo. Re-run the fetch loop to update them.

---

## One-time setup

### 1. Install tools

```bash
sudo pacman -S --noconfirm rclone python3 ffmpeg
```

- `rclone` — uploads to the R2 bucket (S3 protocol).
- `ffmpeg` / `ffprobe` — encode WAV → mp3, measure duration; `peaks.py` also uses ffmpeg.
- `python3` — runs `names.py` (title lookup) and `peaks.py` (waveform). Pure stdlib, no pip.

### 2. Make working directories

```bash
mkdir -p ~/bin ~/recordings ~/tidal
```

- `~/bin` — where the scripts live.
- `~/recordings` — SuperCollider recorder writes WAVs here; the publish script defaults to the newest `.wav` in this folder.
- `~/git/tidal` — your existing local checkout of the `findingfocus/tidal` repo (the publish script checks `<date>.tidal` here first, then `~/tidal`; override with `FF_TIDAL_DIR`).

### 3. Fetch the scripts

```bash
BASE=https://findingfocus.io/findingfocus/music/raw/branch/main/bin
for f in names.json names.py peaks.py publish-nightly.sh; do
  curl -fsSL "$BASE/$f" -o "$HOME/bin/$f" && chmod +x "$HOME/bin/$f"
done
```

- `names.json` — pre-generated table of all 2,275 names (91 landmarks x 25 processes). Generated once, never recomputed.
- `names.py <index>` — prints the name for a publish index (e.g. `names.py 1` → `Wheeler Drift`).
- `peaks.py` — ffmpeg → mono 8 kHz → 160 RMS bars = the waveform the site renders.
- `publish-nightly.sh` — encode → peaks → code import → index/name → merge → upload.

### 4. Point rclone at your R2 bucket

```bash
rclone config create ffmedia s3 provider Cloudflare \
  access_key_id=<R2_ACCESS_KEY_ID> secret_access_key=<R2_SECRET_ACCESS_KEY> \
  endpoint=https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com \
  region=auto bucket=<BUCKET_NAME>
```

Where the values come from (Cloudflare dashboard):

1. **Account ID** (`<R2_ACCOUNT_ID>`) — dashboard URL `dash.cloudflare.com/<account-id>`, or R2 → Overview.
2. **Access Key ID / Secret Access Key** — **R2 → Manage R2 API tokens → Create API token**. This is the *S3-type* token, not the global "API Tokens" screen. Choose **Object Read & Write**. The secret is shown **once**; save it immediately. If you lost it, delete and recreate.
3. **Bucket** (`<BUCKET_NAME>`) — the public bucket behind `media.findingfocus.music`.
4. Endpoint = `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`.

Verify:

```bash
rclone lsl ffmedia          # lists bucket contents
~/bin/names.py 1            # → Wheeler Drift
```

### 5. Test recording from SuperCollider

Paste into sclang while SuperDirt is running (any d-pattern works). Uses `s.record`, which taps scsynth's actual output stream — exactly what goes to your speakers, immune to group-ordering issues:

```supercollider
// === findingfocus recorder ===
// records SC output for DUR seconds → ~/recordings/<stamp>.wav
(
var dur = 20.0;   // <-- record length, seconds
s.waitForBoot {
  var dir = PathName(thisProcess.platform.userHomeDir) +/+ "recordings";
  dir.createDirAll;
  var path = (dir +/+ (Date.getDate.stamp ++ ".wav")).fullPath;
  "recording %s s -> %".format(dur, path).postln;
  s.record(path, 0); // bus 0; numChannels defaults to all server outputs
  dur.wait;
  s.stopRecording;
  "done: %".format(path).postln;
};
)
```

Run it: cursor inside the block, **Ctrl+Enter** (Linux). If the resulting WAV is silent, check where your audio lives first:

```supercollider
s.options.numOutputBusChannels.postln;   // how many output channels the server has
s.scope;                                  // watch which scope channels move as music plays
```

The recorder captures the full output width (`s.record(path, 0)` uses all output channels by default), so whatever bus the music is on gets recorded; the publish script downmixes to stereo. Check the volume:

```bash
ffmpeg -i ~/recordings/*.wav -af volumedetect -f null - 2>&1 | grep -E "mean_volume|max_volume"
```

`max_volume` should be something like `-1.0 dB`, not `-91 dB`. If you hit a "Command line parse failed" error, press Cmd-. / Ctrl-., run `s.reboot`, then re-evaluate the block. To capture a whole set, set `dur` to its length and start at the same time as the stream.

### 6. Test the pipeline without uploading

```bash
~/bin/publish-nightly.sh --dry-run
```

Runs everything real (encode, peaks, index lookup, code import, merge) but only prints what it would upload. Expect `index : 1`, `title : Wheeler Drift`. Fix any error here before a real upload.

### 7. Publish for real

```bash
~/bin/publish-nightly.sh
```

- Encodes → `nightly/<date>_<n>.mp3` (192k stereo mp3).
- Uploads mp3 + `.peaks.json`.
- Rewrites `tracks.json` with today's entry prepended and `Cache-Control: no-cache`.

Verify:

```bash
curl -s https://media.findingfocus.music/tracks.json | head -c 400
```

…then open `https://findingfocus.music` in a fresh window — a new tab appears. No deploy happened; the site fetches `tracks.json` at runtime. The site stays empty until the first publish, then fills newest-first.

---

## Every night

1. **Make the code**: save/commit the set's Tidal code in your tidal repo at `~/git/tidal/<date>.tidal` (e.g. `~/git/tidal/2026-08-29.tidal`). The script checks that file first (then `~/tidal/`, then fetches `<date>.tidal` from the `findingfocus/tidal` repo). The last 8 lines get attached to the track for the code overlay + copy button. No code found → a placeholder line is used and no source is attached.
2. **Record**: snapshot the audio with the SC recorder (set `dur` to the set length).
3. **Publish**:
   ```bash
   ~/bin/publish-nightly.sh   # auto-name from the table
   ~/bin/publish-nightly.sh --title "aurora veins"   # or name it yourself
   ```

**Naming & tracking notes**

- Titles come from a pre-generated table indexed by a publish counter stored in `tracks.json` itself (`max(index)+1`). No day-tracking on your part; skipped nights don't matter. Index 1 = `Wheeler Drift`. The full table cycles at 2,275 names (~6 years).
- Titles use the box's local date (`YYYY-MM-DD`). A stream crossing midnight gets the new day's stamp — harmless, since the id is `<YYYYMMDD>_<index>`.
- Re-publishing the same night is idempotent: same id → "ALREADY_PUBLISHED", nothing uploaded.

**Updating the scripts**

```bash
BASE=https://findingfocus.io/findingfocus/music/raw/branch/main/bin
for f in names.json names.py peaks.py publish-nightly.sh; do
  curl -fsSL "$BASE/$f" -o "$HOME/bin/$f" && chmod +x "$HOME/bin/$f"
done
```

**Deleting old legacy files** (`track1.mp3`, `track2.mp3` — no longer referenced by the site):

```bash
rclone delete ffmedia:track1.mp3
rclone delete ffmedia:track2.mp3
```