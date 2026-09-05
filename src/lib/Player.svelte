<script lang="ts">
	import { onDestroy, onMount, createEventDispatcher } from 'svelte';
	import type WSType from 'wavesurfer.js';
	import { renderProfessionalWave, setAuthoredPeaks, setAuthoredWidth, setWaveformGap } from './render-wave';
	import { loadTracks, type Track } from './tracks';
	import { THEME } from './theme';

	const dispatch = createEventDispatcher();

	let waveformEl!: HTMLDivElement;
	let visualizerEl!: HTMLCanvasElement;
	let playBtn!: HTMLButtonElement;
	let prevBtn!: HTMLButtonElement;
	let nextBtn!: HTMLButtonElement;

	let ws: WSType | null = null;
	let pendingPlay = false;
	let disposed = false;
	let cleanupSeekAudio: (() => void) | null = null;
	let waveformResizeObserver: ResizeObserver | null = null;
	let renderedWaveformWidth = 0;
	let waveformSettleTimer: number | undefined;
	let onWaveformReflow: (() => void) | null = null;

	let current = $state(0);
	let loopMode = $state<'all' | 'one'>('one');
	let playing = $state(false);
	let curTime = $state('0:00');
	let durTime = $state('0:00');
	let statusHtml = $state('paused');
	let overlayOpen = $state(false);
	let infoOverlayOpen = $state(false);
	let codeCopied = $state(false);
	let volume = $state(1);
	$effect(() => {
		applyVolume(volume);
	});
	let tracks = $state<Track[]>([]);
	let mobileDevice = $state(false);
	let audioContext: AudioContext | null = null;
	let analyser: AnalyserNode | null = null;
	let volumeGain: GainNode | null = null;
	let visualizerFrame = 0;
	let smoothWave: Float32Array | null = null;
	let wavePeak = 0;
	const visualizerOn = true;

	// Gap (in CSS px) between waveform bars. Bars are 1 CSS px wide. Rendering
	// is done in CSS space and converted to physical pixels, so the waveform
	// looks identical regardless of the device's devicePixelRatio. 0 = dense.
	const WAVEFORM_GAP = 1.9;

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
		navigator.mediaSession.setActionHandler('play', () => {
			void playMedia();
		});
		navigator.mediaSession.setActionHandler('pause', () => ws?.pause());
		navigator.mediaSession.setActionHandler('previoustrack', () => prevBtn.click());
		navigator.mediaSession.setActionHandler('nexttrack', () => nextBtn.click());
	}

	function configurePlaybackAudioSession() {
		const audioSession = (navigator as Navigator & {
			audioSession?: { type: string };
		}).audioSession;
		if (audioSession) audioSession.type = 'playback';
	}

	function isMobileDevice() {
		return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ||
			(navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
	}

	async function resumeAudio() {
		configurePlaybackAudioSession();
		if (audioContext && audioContext.state !== 'running') await audioContext.resume();
	}

	async function playMedia() {
		await resumeAudio();
		await ws?.play();
	}

	function sourcePageUrl(url: string) {
		return url.replace('/raw/branch/', '/src/branch/');
	}

	// Preview teaser: the first code line (so multi-pattern sets point at their
	// start rather than a tail fragment), with a dimmed " . . ." marker when more
	// source lines follow. Falls back to the sub snippet when no full source is
	// attached.
	function firstCodeLine(t: Track | undefined): string {
		if (!t) return '';
		const lines = (t.source ?? t.sub?.join('\n') ?? '').split('\n');
		for (const line of lines) {
			const trimmed = line.trim();
			if (trimmed && !trimmed.startsWith('--')) return trimmed;
		}
		return '';
	}

	function hasMoreCode(t: Track | undefined): boolean {
		if (!t) return false;
		const lines = (t.source ?? t.sub?.join('\n') ?? '').split('\n');
		let seen = false;
		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith('--')) continue;
			if (seen) return true;
			seen = true;
		}
		return false;
	}

	function applyVolume(value: number) {
		const nextVolume = Math.min(1, Math.max(0, value));
		if (volumeGain && audioContext) {
			ws?.setVolume(1);
			volumeGain.gain.setValueAtTime(nextVolume, audioContext.currentTime);
		} else {
			ws?.setVolume(nextVolume);
		}
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

	async function togglePlay() {
		await resumeAudio();
		ws?.playPause();
	}

	function drawVisualizer() {
		const canvas = visualizerEl;
		if (canvas && visualizerOn) {
			const rect = canvas.getBoundingClientRect();
			const ratio = window.devicePixelRatio || 1;
			if (canvas.width !== Math.round(rect.width * ratio) || canvas.height !== Math.round(rect.height * ratio)) {
				canvas.width = Math.round(rect.width * ratio);
				canvas.height = Math.round(rect.height * ratio);
			}
			const ctx = canvas.getContext('2d');
			if (ctx) {
				ctx.clearRect(0, 0, canvas.width, canvas.height);
				const w = canvas.width;
				const h = canvas.height;
				const mid = h / 2;
				const bars = Math.max(12, Math.min(48, Math.round(w / (8 * ratio))));
				const half = bars / 2;
				if (!smoothWave || smoothWave.length !== bars) {
					smoothWave = new Float32Array(bars).fill(0);
					wavePeak = 0;
				}
				const slot = w / bars;
				const barWidth = Math.max(1 * ratio, slot * 0.4);
				const targets = new Array(bars);
				if (analyser) {
					const tdata = new Uint8Array(analyser.frequencyBinCount * 2);
					analyser.getByteTimeDomainData(tdata);
					const step = tdata.length / bars;
					for (let i = 0; i < bars; i++) {
						const from = Math.floor(i * step);
						const to = Math.min(tdata.length, Math.floor((i + 1) * step));
						let s = 0;
						for (let j = from; j < to; j++) s += tdata[j];
						const raw = Math.abs((s / (to - from) - 128) / 128);
						const centerDist = Math.abs(i + 0.5 - half) / (half - 0.5);
						const taper = 0.5 + 0.5 * Math.cos(centerDist * (Math.PI / 2));
						targets[i] = playing ? Math.pow(raw, 0.8) * taper : 0;
					}
				} else {
					const peaks = track?.peaks ?? [];
					const duration = track?.duration || 1;
					const progress = Math.min(1, Math.max(0, (ws?.getCurrentTime() ?? 0) / duration));
					const cursor = progress * Math.max(0, peaks.length - 1);
					const samplePeak = (sample: number) => {
						if (peaks.length === 0) return 0;
						const lower = Math.max(0, Math.min(peaks.length - 1, Math.floor(sample)));
						const upper = Math.min(peaks.length - 1, lower + 1);
						const blend = Math.max(0, Math.min(1, sample - lower));
						return (peaks[lower] ?? 0) * (1 - blend) + (peaks[upper] ?? 0) * blend;
					};
					const sampleRadius = Math.max(1, Math.round(peaks.length / 1200));
					const currentPeak = samplePeak(cursor);
					const nearbyPeak = Math.max(samplePeak(cursor - sampleRadius), samplePeak(cursor + sampleRadius));
					const responsivePeak = currentPeak * 0.75 + nearbyPeak * 0.25;
					const relativePeak = Math.pow(Math.max(0, responsivePeak / 100), 1.15);
					for (let i = 0; i < bars; i++) {
						const centerDist = Math.abs(i + 0.5 - half) / half;
						const taper = 0.5 + 0.5 * Math.cos(centerDist * (Math.PI / 2));
						const profile = 0.88 + 0.12 * Math.cos(i * 1.7);
						const rolloff = Math.min(1, Math.max(0, (0.85 - centerDist) / 0.45));
						const smoothRolloff = rolloff * rolloff * (3 - 2 * rolloff);
						const movement = 0.45 + 0.55 * smoothRolloff;
						targets[i] = playing ? relativePeak * taper * profile * movement : 0;
					}
				}
				const loud = Math.max(...targets);
				if (loud > wavePeak) wavePeak = wavePeak + (loud - wavePeak) * 0.4;
				else wavePeak = wavePeak * 0.995;
				const normalization = mobileDevice ? 1.25 : 1.05;
				const scale = analyser && wavePeak > 0.02 ? normalization / wavePeak : 1;
				for (let i = 0; i < bars; i++) {
					const pv = targets[Math.max(0, i - 1)];
					const nx = targets[Math.min(bars - 1, i + 1)];
					const sp = (pv + targets[i] * 2 + nx) / 4;
					const response = analyser ? 0.08 : sp > smoothWave[i] ? 0.62 : 0.36;
					smoothWave[i] = smoothWave[i] + (sp - smoothWave[i]) * response;
				}
				const idle = 0.04 * h;
				const mobileGain = analyser ? 1 : 0.65;
				for (let i = 0; i < bars; i++) {
					const barH = Math.max(idle, smoothWave[i] * scale * h * 0.7 * mobileGain);
					const x = i * slot + (slot - barWidth) / 2;
					ctx.fillStyle = 'rgba(142,112,147,0.55)';
					const r = Math.min(barWidth / 2, barH / 2);
					ctx.beginPath();
					ctx.roundRect(x, mid - barH / 2, barWidth, barH, r);
					ctx.fill();
				}
			}
		}
		if (!disposed) visualizerFrame = requestAnimationFrame(drawVisualizer);
	}

	function openOverlay() {
		overlayOpen = true;
	}

	function closeOverlay() {
		overlayOpen = false;
		codeCopied = false;
	}

	function openInfoOverlay() {
		infoOverlayOpen = true;
	}

	function closeInfoOverlay() {
		infoOverlayOpen = false;
	}

	async function copyCode(e: MouseEvent) {
		e.stopPropagation();
		const text = track?.source ?? track?.sub?.join('\n');
		if (!text) return;
		try {
			await navigator.clipboard.writeText(text);
			codeCopied = true;
			setTimeout(() => {
				codeCopied = false;
			}, 1200);
		} catch {
			// clipboard unavailable
		}
	}

	const onKeydown = (e: KeyboardEvent) => {
		if (e.code === 'Escape') {
			closeOverlay();
			closeInfoOverlay();
			return;
		}
		if (e.code === 'Space' && e.target instanceof HTMLElement && e.target.tagName !== 'INPUT') {
			e.preventDefault();
			playBtn.click();
		}
	};

	const onVisibilityChange = () => {
		if (document.visibilityState === 'visible' && playing) void resumeAudio();
	};

	onMount(() => {
		mobileDevice = isMobileDevice();
		document.addEventListener('visibilitychange', onVisibilityChange);
		loadTracks().then((next) => {
			if (disposed) return;
			tracks = next;
			if (ws && next.length > 0) loadTrack(Math.min(current, next.length - 1), ws.isPlaying());
			dispatch('ready');
		});
		(async () => {
			try {
				const WSU = await import('wavesurfer.js');
				if (disposed) return;
				const WaveSurfer = WSU.default;
				ws = WaveSurfer.create({
					container: waveformEl,
					fillParent: true,
					minPxPerSec: 0,
					width: '100%',
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
				setWaveformGap(WAVEFORM_GAP);
				const measureWaveform = () => {
					const styles = getComputedStyle(waveformEl);
					const width = Math.max(
						0,
						waveformEl.clientWidth - parseFloat(styles.paddingLeft) - parseFloat(styles.paddingRight)
					);
					setAuthoredWidth(width);
					if (width > 0 && width !== renderedWaveformWidth) {
						renderedWaveformWidth = width;
						ws?.setOptions({ width });
					}
				};
				if (typeof ResizeObserver !== 'undefined') {
					waveformResizeObserver = new ResizeObserver(() => {
						measureWaveform();
					});
					waveformResizeObserver.observe(waveformEl);
				}
				const reflowWaveform = () => measureWaveform();
				if (window.visualViewport) {
					window.visualViewport.addEventListener('resize', reflowWaveform);
				}
				window.addEventListener('orientationchange', reflowWaveform);
				onWaveformReflow = () => {
					window.visualViewport?.removeEventListener('resize', reflowWaveform);
					window.removeEventListener('orientationchange', reflowWaveform);
				};
				measureWaveform();
				waveformSettleTimer = window.setTimeout(measureWaveform, 350);
				const media = ws.getMediaElement();
				media.crossOrigin = 'anonymous';
				media.preload = 'metadata';
				media.setAttribute('playsinline', '');
				media.setAttribute('webkit-playsinline', '');
				if (!mobileDevice) {
					try {
						audioContext = new AudioContext();
						const source = audioContext.createMediaElementSource(media);
						volumeGain = audioContext.createGain();
						try {
							analyser = audioContext.createAnalyser();
							analyser.fftSize = 1024;
							analyser.smoothingTimeConstant = 0.84;
							source.connect(analyser);
							analyser.connect(volumeGain);
						} catch (error) {
							console.warn('visualizer unavailable:', error);
							analyser = null;
							source.connect(volumeGain);
						}
						volumeGain.connect(audioContext.destination);
						applyVolume(volume);
						if (analyser) drawVisualizer();
					} catch (error) {
						console.warn('audio effects unavailable:', error);
						audioContext = null;
						analyser = null;
						volumeGain = null;
					}
				}
				let seekMuted = false;
				let seekRampId = 0;
				const muteForSeek = () => {
					if (ws?.isPlaying()) {
						seekRampId++;
						seekMuted = true;
						if (volumeGain && audioContext) {
							volumeGain.gain.setValueAtTime(0, audioContext.currentTime);
						} else {
							media.volume = 0;
						}
					}
				};
				const restoreAfterSeek = () => {
					if (!seekMuted) return;
					seekMuted = false;
					const rampId = ++seekRampId;
					const started = performance.now();
					const ramp = (now: number) => {
						if (rampId !== seekRampId) return;
						const progress = Math.min(1, (now - started) / 800);
						const nextVolume = volume * progress;
						if (volumeGain && audioContext) {
							volumeGain.gain.setValueAtTime(nextVolume, audioContext.currentTime);
						} else {
							media.volume = nextVolume;
						}
						if (progress < 1) requestAnimationFrame(ramp);
					};
					requestAnimationFrame(ramp);
				};
				const updateSeekTime = () => {
					curTime = formatTime(media.currentTime);
				};
				ws.on('interaction', (time) => {
					curTime = formatTime(time);
					muteForSeek();
				});
				media.addEventListener('seeking', muteForSeek);
				media.addEventListener('seeking', updateSeekTime);
				media.addEventListener('seeked', restoreAfterSeek);
				cleanupSeekAudio = () => {
					seekRampId++;
					media.removeEventListener('seeking', muteForSeek);
					media.removeEventListener('seeking', updateSeekTime);
					media.removeEventListener('seeked', restoreAfterSeek);
				};
				ws.on('ready', () => {
					durTime = formatTime(ws?.getDuration() ?? 0);
					applyLoopAttr();
					measureWaveform();
					if (pendingPlay) {
						pendingPlay = false;
						ws?.play();
					}
				});
				ws.on('timeupdate', (t) => {
					curTime = formatTime(t);
				});
				ws.on('play', () => {
					configurePlaybackAudioSession();
					void audioContext?.resume();
					const currentTrack = tracks[current];
					if (currentTrack) updateMediaSession(currentTrack);
					if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
					if (!visualizerFrame) drawVisualizer();
					playing = true;
					statusHtml =
						'playing <span class="state-track">&gt; ' +
						(tracks[current]?.title ?? '').replace(/\s+/g, '_') +
						'.mp3</span>';
				});
				ws.on('pause', () => {
					if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
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
				document.removeEventListener('visibilitychange', onVisibilityChange);
				cleanupSeekAudio?.();
				cleanupSeekAudio = null;
				waveformResizeObserver?.disconnect();
				waveformResizeObserver = null;
				renderedWaveformWidth = 0;
				if (waveformSettleTimer) clearTimeout(waveformSettleTimer);
				waveformSettleTimer = undefined;
				onWaveformReflow?.();
				onWaveformReflow = null;
				ws?.destroy();
		}
		if (typeof window !== 'undefined') {
			cancelAnimationFrame(visualizerFrame);
			void audioContext?.close();
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
		<div class="kw title">{track?.title ?? 'no tracks yet'}</div>
		{#if track?.date}
			<span class="date">{track.date}</span>
		{/if}
	</div>
	<button type="button" class="code-line" onclick={openOverlay}><span class="code-line-text">{firstCodeLine(track)}</span>{#if hasMoreCode(track)}<span class="code-line-more">...</span>{/if}</button>

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
			<pre class="code-body"><code>{track?.source ?? track?.sub?.join('\n') ?? ''}</code></pre>
		</div>
	</div>

	<div class="code-overlay info-overlay" class:show={infoOverlayOpen}>
		<button type="button" class="code-overlay-close" aria-label="Close TidalCycles information" onclick={closeInfoOverlay}></button>
		<div class="code-overlay-box info-overlay-box">
			<button type="button" class="copy-btn" aria-label="Close TidalCycles information" title="Close" onclick={closeInfoOverlay}>
				<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M3 3l10 10M13 3 3 13" stroke-linecap="round"/></svg>
			</button>
			<h2>Made with Tidal Cycles</h2>
			<p>
				<a class="info-link" href="https://tidalcycles.org/" target="_blank" rel="noopener">Tidal Cycles</a> is a free and open source live coding environment for programming algorithmic musical patterns. Tidal uses the <a class="info-link" href="https://supercollider.github.io/" target="_blank" rel="noopener">SuperCollider</a> synthesis engine and the <a class="info-link" href="https://github.com/musikinformatik/SuperDirt" target="_blank" rel="noopener">SuperDirt</a> framework under the hood to generate and process sounds.
			</p>
			<p>
				The tracks on this site were recorded with SuperCollider, specifically from a <a class="info-link" href="https://youtube.com/findingfocus" target="_blank" rel="noopener">coding live stream</a> where I program my new video game, <a class="info-link" href="https://steam.tashio.dev" target="_blank" rel="noopener">Tashio Tempo</a>.
			</p>
			<h3>Try it yourself</h3>
			<a class="info-link" href="https://tidalcycles.org/" target="_blank" rel="noopener">visit tidalcycles.org</a>
		</div>
	</div>

	<div class="waveform" bind:this={waveformEl}></div>

	<div class="time-row">
		<span>{curTime}</span>
		<span>{durTime}</span>
	</div>

	<div class="volume-row">
		{#if !mobileDevice}
		<div class="volume-control">
		<svg viewBox="0 0 24 24" fill="currentColor" width="12" height="12" aria-hidden="true">
			<path d="M3 9v6h4l5 5V4L7 9H3z"/>
			{#if volume > 0}
				<path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="M15 9a4 4 0 0 1 0 6"/>
			{/if}
			{#if volume > 0.33}
				<path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="M17.5 6.5a8 8 0 0 1 0 11"/>
			{/if}
			{#if volume > 0.66}
				<path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="M20 4a12 12 0 0 1 0 16"/>
			{/if}
		</svg>
		<input
			type="range"
			min="0"
			max="1"
			step="0.01"
			bind:value={volume}
			style={`--volume: ${volume}`}
		/>
		</div>
		{/if}
		{#if track?.url}
			<a class="download-link" href={track.url} download aria-label="Download current track" title="Download current track">
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="14" height="14" aria-hidden="true"><path d="M12 3v12m0 0 4-4m-4 4-4-4M4 20h16" stroke-linecap="round" stroke-linejoin="round"/></svg>
				<span>download mp3</span>
			</a>
		{/if}
	</div>

	<div class="transport-row">
		<div class="transport">
			<button class="tbtn" title="Previous" bind:this={prevBtn} onclick={() => step(-1)}>
				<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>
			</button>
			<button class="tbtn play" title={playing ? 'Pause' : 'Play'} bind:this={playBtn} onclick={togglePlay}>
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
	</div>

	<div class="loop-row">
		<button class="on" onclick={toggleLoop}>{loopMode === 'all' ? 'loop: all tracks' : 'loop: this track'}</button>
	</div>
</div>

	<div class="statusline">
	<div class="viz-strip" aria-hidden="true">
		<canvas bind:this={visualizerEl}></canvas>
	</div>
	<div class="status-left">
		<button type="button" class="mode mode-button" onclick={openInfoOverlay}>TIDAL</button>
		<span class="status-mid">{@html statusHtml}</span>
	</div>
	<div class="status-right">
		<a
			href={track?.sourceUrl ? sourcePageUrl(track.sourceUrl) : 'https://findingfocus.io/findingfocus/tidal'}
			target="_blank"
			rel="noopener"
			class="src-link"
			title={track?.sourceUrl ? `View source code for ${track.title}` : 'View Tidal source repository'}
		>
			<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M16.777 0c1.602 0 2.9 1.299 2.9 2.9 0 1.602-1.298 2.9-2.9 2.9-1.085 0-2.031-.596-2.529-1.479h-1.338c-2.333 0-4.228 1.872-4.265 4.195v2.118a7.076 7.076 0 0 1 4.148-1.42h1.455c.497-.883 1.444-1.479 2.529-1.479 1.602 0 2.9 1.299 2.9 2.9 0 1.602-1.298 2.9-2.9 2.9-1.085 0-2.031-.596-2.529-1.479h-1.338c-2.333 0-4.228 1.872-4.265 4.195v2.319a2.906 2.906 0 0 1 1.479 2.529c0 1.602-1.298 2.9-2.9 2.9-1.602 0-2.9-1.298-2.9-2.9 0-1.085.596-2.032 1.479-2.53v-9.982c0-3.887 3.12-7.045 6.992-7.108h1.455C14.746.596 15.692 0 16.777 0zM7.223 19.905a1.195 1.195 0 0 0 0 2.39 1.195 1.195 0 0 0 0-2.39zm9.554-10.465a1.195 1.195 0 0 0 0 2.39 1.195 1.195 0 0 0 0-2.39zm0-7.734a1.195 1.195 0 0 0 0 2.39 1.195 1.195 0 0 0 0-2.39z"/></svg>
			source code
		</a>
		<span class="site">findingfocus.music</span>
	</div>
</div>
<div class="also-building">also building: <a href="https://tashio.dev" target="_blank" rel="noopener">tashio.dev</a> &middot; <a href="https://findingfocus.gg" target="_blank" rel="noopener">findingfocus.gg</a></div>
