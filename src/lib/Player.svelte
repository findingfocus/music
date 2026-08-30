<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import type WSType from 'wavesurfer.js';
	import { renderProfessionalWave, setAuthoredPeaks } from './render-wave';
	import { loadTracks, type Track } from './tracks';
	import { THEME } from './theme';

	let waveformEl!: HTMLDivElement;
	let playBtn!: HTMLButtonElement;
	let prevBtn!: HTMLButtonElement;
	let nextBtn!: HTMLButtonElement;

	let ws: WSType | null = null;
	let pendingPlay = false;
	let disposed = false;
	let cleanupSeekAudio: (() => void) | null = null;

	let current = $state(0);
	let loopMode = $state<'all' | 'one'>('all');
	let playing = $state(false);
	let curTime = $state('0:00');
	let durTime = $state('0:00');
	let statusHtml = $state('paused');
	let overlayOpen = $state(false);
	let codeCopied = $state(false);
	let volume = $state(1);
	let tracks = $state<Track[]>([]);

	const track = $derived(tracks[current]);
	const trackCountLabel = $derived(`[${current + 1}/${tracks.length}]`);

	function formatTime(sec: number): string {
		if (!isFinite(sec)) return '0:00';
		const m = Math.floor(sec / 60);
		const s = Math.floor(sec % 60)
			.toString()
			.padStart(2, '0');
		return `${m}:${s}`;
	}

	function updateMediaSession(t: (typeof tracks)[number]) {
		if (!('mediaSession' in navigator)) return;
		navigator.mediaSession.metadata = new MediaMetadata({
			title: t.title,
			artist: 'findingfocus',
			album: 'findingfocus.music',
			artwork: [
				{ src: '/ff-96.png', sizes: '96x96', type: 'image/png' },
				{ src: '/ff-256.png', sizes: '256x256', type: 'image/png' },
				{ src: '/ff-512.png', sizes: '512x512', type: 'image/png' }
			]
		});
		navigator.mediaSession.setActionHandler('play', () => ws?.play());
		navigator.mediaSession.setActionHandler('pause', () => ws?.pause());
		navigator.mediaSession.setActionHandler('previoustrack', () => prevBtn.click());
		navigator.mediaSession.setActionHandler('nexttrack', () => nextBtn.click());
	}

	function loadTrack(i: number, autoplay: boolean) {
		if (tracks.length === 0) return;
		current = i;
		pendingPlay = autoplay;
		const t = tracks[current];
		if (!t) return;
		setAuthoredPeaks(t.peaks);
		updateMediaSession(t);
		ws?.load(t.url, [t.peaks.map((p) => p / 100)], t.duration);
		applyLoopAttr();
	}

	function applyLoopAttr() {
		const el = ws?.getMediaElement();
		if (el) el.loop = loopMode === 'one';
	}

	function step(delta: number) {
		if (tracks.length === 0) return;
		loadTrack((current + delta + tracks.length) % tracks.length, ws?.isPlaying() ?? false);
	}

	function toggleLoop() {
		loopMode = loopMode === 'all' ? 'one' : 'all';
		applyLoopAttr();
	}

	function openOverlay() {
		overlayOpen = true;
	}

	function closeOverlay() {
		overlayOpen = false;
		codeCopied = false;
	}

	async function copyCode(e: MouseEvent) {
		e.stopPropagation();
		if (!track?.sub?.length) return;
		try {
			await navigator.clipboard.writeText(track.sub.join('\n\n'));
			codeCopied = true;
			setTimeout(() => {
				codeCopied = false;
			}, 1200);
		} catch {
			// clipboard unavailable
		}
	}

	const onKeydown = (e: KeyboardEvent) => {
		if (e.code === 'Space' && e.target instanceof HTMLElement && e.target.tagName !== 'INPUT') {
			e.preventDefault();
			playBtn.click();
		}
	};

	onMount(() => {
		loadTracks().then((next) => {
			if (disposed) return;
			tracks = next;
			if (ws && next.length > 0) loadTrack(Math.min(current, next.length - 1), ws.isPlaying());
		});
		(async () => {
			try {
				const WSU = await import('wavesurfer.js');
				if (disposed) return;
				const WaveSurfer = WSU.default;
				ws = WaveSurfer.create({
					container: waveformEl,
					waveColor: THEME.waveBase,
					progressColor: THEME.accent,
					cursorColor: THEME.cursor,
					cursorWidth: 1,
					barWidth: 2,
					barGap: 1,
					barRadius: 2,
					height: 84,
					dragToSeek: true,
					renderFunction: renderProfessionalWave
				});
				const media = ws.getMediaElement();
				let seekMuted = false;
				let seekRampId = 0;
				const muteForSeek = () => {
					if (ws?.isPlaying()) {
						seekRampId++;
						seekMuted = true;
						media.volume = 0;
					}
				};
				const restoreAfterSeek = () => {
					if (!seekMuted) return;
					seekMuted = false;
					const rampId = ++seekRampId;
					const started = performance.now();
					const ramp = (now: number) => {
						if (rampId !== seekRampId) return;
						const progress = Math.min(1, (now - started) / 300);
						media.volume = volume * progress;
						if (progress < 1) requestAnimationFrame(ramp);
					};
					requestAnimationFrame(ramp);
				};
				ws.on('interaction', muteForSeek);
				media.addEventListener('seeking', muteForSeek);
				media.addEventListener('seeked', restoreAfterSeek);
				cleanupSeekAudio = () => {
					seekRampId++;
					media.removeEventListener('seeking', muteForSeek);
					media.removeEventListener('seeked', restoreAfterSeek);
				};
				ws.on('ready', () => {
					durTime = formatTime(ws?.getDuration() ?? 0);
					applyLoopAttr();
					if (pendingPlay) {
						pendingPlay = false;
						ws?.play();
					}
				});
				ws.on('timeupdate', (t) => {
					curTime = formatTime(t);
				});
				ws.on('play', () => {
					playing = true;
					statusHtml =
						'playing <span class="state-track">&gt; ' +
						(tracks[current]?.title ?? '').replace(/\s+/g, '_') +
						'.mp3</span>';
				});
				ws.on('pause', () => {
					playing = false;
					statusHtml = 'paused';
				});
				ws.on('finish', () => {
					if (loopMode !== 'one') {
						loadTrack((current + 1) % tracks.length, true);
					}
				});
				ws.on('error', (err) => {
					console.error('waveform failed:', err);
					statusHtml =
						typeof location !== 'undefined' && location.protocol === 'file:'
							? 'waveform blocked on file:// \u2014 run a local server'
							: 'error loading track \u2014 audio file missing?';
				});
				document.addEventListener('keydown', onKeydown);
				loadTrack(0, false);
			} catch (err) {
				console.error('wavesurfer failed to init:', err);
				statusHtml = 'waveform failed to initialize';
			}
		})();
	});

	onDestroy(() => {
		disposed = true;
		if (typeof document !== 'undefined') {
			document.removeEventListener('keydown', onKeydown);
			cleanupSeekAudio?.();
			cleanupSeekAudio = null;
			ws?.destroy();
		}
		ws = null;
	});
</script>

<div class="tabs">
	{#each tracks as t, i (t.id)}
		<button
			type="button"
			class="tab"
			class:active={i === current}
			onclick={() => loadTrack(i, ws?.isPlaying() ?? false)}
		>
			<span class="dot"></span>{t.title.replace(/\s+/g, '_')}.mp3
		</button>
	{/each}
</div>

<div class="body-pad">
	<div class="comment">findingfocus.music <span>{trackCountLabel}</span></div>
	<div class="now-playing">
		<span class="kw">{track?.title ?? 'no tracks yet'}</span>
		{#if track?.date}
			<span class="date">{track.date}</span>
		{/if}
	</div>
	<button type="button" class="code-line" onclick={openOverlay}>{track?.sub?.[0] ?? ''}</button>

	<div class="code-overlay" class:show={overlayOpen}>
		<button type="button" class="code-overlay-close" aria-label="Close track code" onclick={closeOverlay}></button>
		<div class="code-overlay-box">
			<button class="copy-btn" title="Copy to clipboard" onclick={copyCode}>
				{#if codeCopied}
					<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z"/></svg>
				{:else}
					<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 010 1.5h-1.5a.25.25 0 00-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 00.25-.25v-1.5a.75.75 0 011.5 0v1.5A1.75 1.75 0 019.25 16h-7.5A1.75 1.75 0 010 14.25v-7.5z"/><path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0114.25 11h-7.5A1.75 1.75 0 015 9.25v-7.5zM6.75 1.5a.25.25 0 00-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 00.25-.25v-7.5a.25.25 0 00-.25-.25h-7.5z"/></svg>
				{/if}
			</button>
			<div>{track?.sub.join('\n\n') ?? ''}</div>
		</div>
	</div>

	<div class="waveform" bind:this={waveformEl}></div>

	<div class="time-row">
		<span>{curTime}</span>
		<span>{durTime}</span>
	</div>

	<div class="volume-row">
		<svg viewBox="0 0 24 24" fill="currentColor" width="12" height="12"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1-3.29-2.5-4.03v8.05c1.5-.73 2.5-2.25 2.5-4.02z"/></svg>
		<input
			type="range"
			min="0"
			max="1"
			step="0.01"
			value={volume}
			oninput={(e) => {
				volume = Number((e.currentTarget as HTMLInputElement).value);
				ws?.setVolume(volume);
			}}
		/>
	</div>

	<div class="transport">
		<button class="tbtn" title="Previous" bind:this={prevBtn} onclick={() => step(-1)}>
			<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>
		</button>
		<button class="tbtn play" title={playing ? 'Pause' : 'Play'} bind:this={playBtn} onclick={() => ws?.playPause()}>
			{#if playing}
				<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg>
			{:else}
				<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
			{/if}
		</button>
		<button class="tbtn" title="Next" bind:this={nextBtn} onclick={() => step(1)}>
			<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 6h2v12h-2zM6 6v12l8.5-6z"/></svg>
		</button>
	</div>

	<div class="loop-row">
		<button class="on" onclick={toggleLoop}>{loopMode === 'all' ? 'loop: all tracks' : 'loop: this track'}</button>
	</div>
</div>

<div class="statusline">
	<div class="status-left">
		<a href="https://tidalcycles.org" style="text-decoration: none;"><span class="mode">TIDAL</span></a>
		<span class="status-mid">{@html statusHtml}</span>
	</div>
	<div class="status-right">
		<a href="https://findingfocus.io/findingfocus/tidal" target="_blank" rel="noopener" class="src-link" title="View Source Code">
			<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M16.777 0c1.602 0 2.9 1.299 2.9 2.9 0 1.602-1.298 2.9-2.9 2.9-1.085 0-2.031-.596-2.529-1.479h-1.338c-2.333 0-4.228 1.872-4.265 4.195v2.118a7.076 7.076 0 0 1 4.148-1.42h1.455c.497-.883 1.444-1.479 2.529-1.479 1.602 0 2.9 1.299 2.9 2.9 0 1.602-1.298 2.9-2.9 2.9-1.085 0-2.031-.596-2.529-1.479h-1.338c-2.333 0-4.228 1.872-4.265 4.195v2.319a2.906 2.906 0 0 1 1.479 2.529c0 1.602-1.298 2.9-2.9 2.9-1.602 0-2.9-1.298-2.9-2.9 0-1.085.596-2.032 1.479-2.53v-9.982c0-3.887 3.12-7.045 6.992-7.108h1.455C14.746.596 15.692 0 16.777 0zM7.223 19.905a1.195 1.195 0 0 0 0 2.39 1.195 1.195 0 0 0 0-2.39zm9.554-10.465a1.195 1.195 0 0 0 0 2.39 1.195 1.195 0 0 0 0-2.39zm0-7.734a1.195 1.195 0 0 0 0 2.39 1.195 1.195 0 0 0 0-2.39z"/></svg>
			source code
		</a>
		<span class="site">findingfocus.music</span>
	</div>
</div>
<div class="also-building">also building: <a href="https://tashio.dev" target="_blank" rel="noopener">tashio.dev</a> &middot; <a href="https://findingfocus.gg" target="_blank" rel="noopener">findingfocus.gg</a></div>
