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
  region=auto
```

**Important: do NOT set a `bucket =` line in the remote.** On this box that makes rclone drop the object key on every write (`Key must not be empty`). Instead the bucket goes in the **path**: `ffmedia:findingfocus-music/...`.

Also confirm the remote has no leftover `bucket = findingfocus-music` line; if it does, remove it:

```bash
sed -i '/^bucket = /d' ~/.config/rclone/rclone.conf
```

Where the values come from (Cloudflare dashboard):

1. **Account ID** (`<R2_ACCOUNT_ID>`) — dashboard URL `dash.cloudflare.com/<account-id>`, or R2 → Overview.
2. **Access Key ID / Secret Access Key** — **R2 → Manage R2 API tokens → Create API token**. This is the *S3-type* token, not the global "API Tokens" screen. Choose **Object Read & Write**. The secret is shown **once**; save it immediately. If you lost it, delete and recreate.
3. **Bucket** — the public bucket behind `media.findingfocus.music` is named `findingfocus-music`.
4. Endpoint = `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`.

Verify:

```bash
rclone lsl ffmedia:findingfocus-music   # lists bucket contents
~/bin/names.py 1                        # → Wheeler Drift
```

### 5. Test recording from SuperCollider

Paste into sclang while SuperDirt is running (any d-pattern works). Two blocks, run by cursor + **Ctrl+Enter** (Linux): **REC START** allocates a write buffer and starts writing the SC output mix, **REC STOP** writes the finished mix to `~/recordings/<stamp>.wav` using a manual `DiskOut` synth (placed at the root tail so it reads the finished mix — no `Server.record`/`Recorder` machinery).

Start exactly on a downbeat; stop a touch early, just before the next downbeat after a whole number of cycles (being late clips the next downbeat transient).

```supercollider
// REC START — Ctrl+Enter a moment before (or exactly on) a downbeat
(
var numChans = 2;
var maxLen = 600;   // <-- max take length, seconds
s.waitForBoot {
  var dir, buf, recNode;
  if (~recBuf.notNil) {
    "recorder already running — STOP first".postln;
  } {
    dir = PathName(thisProcess.platform.userHomeDir) +/+ "recordings";
    buf = Buffer.alloc(s, (s.sampleRate * maxLen).asInteger, numChans);
    s.sync;
    SynthDef(\ffdiskrec, { |buffer|
      DiskOut.ar(buffer, In.ar(0, numChans))
    }).add;
    s.sync;
    recNode = Synth.tail(s, \ffdiskrec, [\buffer, buf]);
    ~recBuf = buf;
    ~recNode = recNode;
    "REC ON (max %s s)".format(maxLen).postln;
  };
};
)
```

```supercollider
// REC STOP — Ctrl+Enter just before the next downbeat (whole number of cycles elapsed)
(
var dir, path;
if (~recBuf.isNil) {
  "no recorder running".postln;
} {
  dir = PathName(thisProcess.platform.userHomeDir) +/+ "recordings";
  path = (dir +/+ (Date.getDate.stamp ++ ".wav")).fullPath;
  ~recNode.free;
  s.sync;
  ~recBuf.write(path, "WAVE", "int16");
  ~recBuf.free;
  ~recBuf = nil;
  ~recNode = nil;
  "STOP -> %".format(path).postln;
};
)
```

Run it: cursor inside the block, **Ctrl+Enter** (Linux). Verify the file is loud, not silent:

```bash
ffmpeg -i ~/recordings/*.wav -af volumedetect -f null - 2>&1 | grep -E "mean_volume|max_volume"
```

`max_volume` should be something like `-1.0 dB`, not `-91 dB`. To capture a whole set: REC START on a downbeat, REC STOP just before the next downbeat after a whole number of cycles.

Notes from the sessions that worked:

- `Buffer.alloc(server, n, channels)` takes **frames**, not samples — don't multiply by `numChans` or the file comes out twice as long with its second half silent.
- If you reboot the server while Tidal patterns are still playing, the new server comes up without SuperDirt's synthdefs and you'll see a storm of `SynthDef not found` errors. Easiest recovery: `hush` in Tidal, then quit and reopen the SCIDE (its startup file boots the server + SuperDirt cleanly), then restart the Tidal session.

### 6. Test the pipeline without uploading

```bash
~/bin/publish-nightly.sh --dry-run
```

Runs everything real (encode, peaks, index lookup, code import, merge) but only prints what it would upload. Expect `index : 1`, `title : Wheeler Drift`. Fix any error here before a real upload.

### 7. Publish for real

```bash
~/bin/publish-nightly.sh
```

- Encodes → `tracks/<date>_<n>.mp3` (192k stereo mp3).
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
2. **Record**: REC START on a downbeat, REC STOP just before the next downbeat after a whole number of cycles (stop early — being late clips the next transient).
3. **Publish**:
   ```bash
   ~/bin/publish-nightly.sh   # auto-name from the table
   ~/bin/publish-nightly.sh --title "aurora veins"   # or name it yourself
   ```

**Seamless loops**

With the start-on-a-downbeat / stop-before-the-next-downbeat ritual the raw take already wraps cleanly, so **no fade is applied by default** (`FF_FADE=0`). If a take gets cut mid-cycle, re-enable an explicit crossfade wrap with `--fade N` (seconds) or `FF_FADE=2.0` — the first and last ~N seconds are crossfaded together (`[tail][head]acrossfade`) and the file is rebuilt as `blend + middle + blend`, so the end→start wrap never clicks.

**Replacing an existing track** (e.g. re-bake tonight's track with a better blend take):

```bash
~/bin/publish-nightly.sh --replace 2026-08-29_1 --dry-run   # preview what overwrites
~/bin/publish-nightly.sh --replace 2026-08-29_1             # re-encode + overwrite in place
```

The slug is the date-and-index as it appears on the mp3 (`tracks/2026-08-29_1.mp3`). A replace
re-encodes the newest wav through the same blend pipeline, overwrites the exact same mp3/peaks
keys (with `Cache-Control: no-cache`), and edits only that entry in `tracks.json` — id, date,
position and the index counter are untouched. Each replace bumps a `?v=N` onto the track's `url`,
so the CDN and browsers always fetch the fresh file (never a stale cache, no purging needed). If
no code is found for the track's date, the existing `sub`/`source` are kept. `--title "..."`
renames on replace.

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
rclone delete ffmedia:findingfocus-music/track1.mp3
rclone delete ffmedia:findingfocus-music/track2.mp3
```