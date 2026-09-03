# findingfocus.music

Waveform music player built with SvelteKit 5 (static adapter) and wavesurfer.js.
Audio is streamed straight from Cloudflare R2 (bucket `findingfocus-music`).

## Local dev

```sh
npm install
npm run dev
```

## Checks & build

```sh
npm run check    # svelte-check
npm run build    # builds static site into /build (adapter-static)
npm run preview  # serve the production build locally
```

## Local testing with Docker

```sh
docker compose up --build   # -> http://localhost:3000 (container: ffmusic)
docker compose down
```

## Recording in SuperCollider

```
// REC TOGGLE — run once to start, again to stop
(
var numChans = 2;
var dir, path;
s.waitForBoot {
  if (s.isRecording) {
    s.stopRecording;
    "STOP -> % (exact take)".format(~recPath).postln;
    ~recPath = nil;
  } {
    dir = PathName(thisProcess.platform.userHomeDir) +/+ "recordings";
    path = (dir +/+ (Date.getDate.stamp ++ ".wav")).fullPath;
    s.recHeaderFormat = "wav";
    s.recSampleFormat = "int16";
    s.recChannels = numChans;
    s.record(path: path, numChannels: numChans);
    ~recPath = path;
    "REC ON -> %".format(path).postln;
  };
};
)
```

## Publishing a track

Drop a take in `$RECORDINGS_DIR` (default `~/recordings`), then run the publish
script. It picks the newest `.wav`, renders peak data, encodes the MP3, uploads
it to R2, and writes the resulting track straight into the live `tracks.json` —
no code edits or deploy needed.

```sh
bin/publish-nightly.sh                # publish the newest .wav in ~/recordings
bin/publish-nightly.sh --wav ~/take.wav
```

Options:

| Flag | Description |
| --- | --- |
| `--wav FILE` | WAV to publish (default: newest `.wav` in `$RECORDINGS_DIR`) |
| `--code FILE` | Tidal code to attach (default: `<date>.tidal` in `$FF_TIDAL_DIR`, else pulled from `findingfocus.io/findingfocus/tidal`) |
| `--title NAME` | Override the track title (with `--replace`: renames the existing track) |
| `--fade N` | Loop crossfade width in seconds (default 0 = raw take; >0 wraps) |
| `--edge-fade N` | Fade in/out at file edges (default 0.05; use 0 to disable) |
| `--replace SLUG` | Re-encode and overwrite an existing track in place, e.g. `2026-08-29_1` |
| `--dry-run` | Build everything and print what would upload; upload nothing |

The bucket must allow cross-origin GET requests (CORS `GET`, origin `*`) so the
browser can fetch and decode audio for the waveform.

## Deploy (Kamal)

Config in `config/deploy.yml`.

```sh
kamal setup    # first time (install/configure the web server)
kamal deploy
```
