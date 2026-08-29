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

## Adding a track

1. Upload the file to R2:
   ```sh
   rclone copy tracks/<slug>.mp3 findingfocus-music:music/<slug>.mp3
   ```
2. Append an entry to `src/lib/tracks.ts` pointing at the R2 public URL.
3. Deploy: `kamal deploy`.

Set `R2_BASE` in `src/lib/tracks.ts` to your bucket's public URL
(e.g. `https://pub-<bucketId>.r2.dev`). The bucket must allow cross-origin
GET requests (CORS `GET`, origin `*`) so the browser can fetch and decode
audio for the waveform.

## Deploy (Kamal)

Uses your standard `findingfocusdev` server + registry. Config in `config/deploy.yml`.

```sh
kamal setup    # first time (install/configure the web server)
kamal deploy
```