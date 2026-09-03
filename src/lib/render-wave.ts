export type ChannelData = Array<Float32Array | number[]>;

const REF_PERCENTILE = 0.95;
const FLOOR_H = 0.03;

let authoredPeaks: number[] | null = null;
let authoredCssWidth = 0;
let barGap = 0;

export function setAuthoredPeaks(peaks: number[] | null | undefined): void {
	authoredPeaks = peaks ?? null;
}

// Gap (in CSS pixels) between waveform bars. Bars are 1 CSS px wide. The
// renderer lays bars out in CSS space and converts to physical pixels at draw
// time, so the waveform looks identical regardless of the device's
// devicePixelRatio. 0 = dense/touching.
export function setWaveformGap(gap: number): void {
	barGap = Math.max(0, Math.floor(gap));
}

// The waveform container's CSS width (its content box). Passed in by the
// component from a reliable clientWidth measurement so the renderer never has
// to guess the devicePixelRatio (which is unreliable on iOS Safari).
export function setAuthoredWidth(cssWidth: number): void {
	authoredCssWidth = cssWidth > 0 ? cssWidth : 0;
}

export function mixChannels(channelData: ChannelData): number[] {
	const ch0 = channelData[0];
	if (channelData.length === 1) return Array.from(ch0);
	const out = new Array<number>(ch0.length).fill(0);
	for (const ch of channelData) {
		for (let i = 0; i < out.length && i < ch.length; i++) out[i] += ch[i];
	}
	for (let i = 0; i < out.length; i++) out[i] /= channelData.length;
	return out;
}

export function renderProfessionalWave(
	channelData: ChannelData,
	ctx: CanvasRenderingContext2D
): void {
	const W = ctx.canvas.width;
	const H = ctx.canvas.height;
	const pr = authoredCssWidth > 0 ? W / authoredCssWidth : Math.max(1, window.devicePixelRatio || 1);
	const minBar = 1 * pr;

	if (authoredPeaks && authoredPeaks.length > 0) {
		const peaks = authoredPeaks;
		const n = peaks.length;
		// Layout happens in CSS space so the waveform looks identical regardless
		// of devicePixelRatio. Bar is 1 CSS px wide plus a configured gap; bar
		// count derives from the CSS width, then each bar is drawn at its
		// physical-pixel position for crisp rendering on any DPR. Each bar
		// aggregates its time slice to a percentile that adapts to how many
		// peaks fall in the slice: dense bars (~1-2 peaks) use the max (full
		// detail); wider gaps push toward ~70th percentile so louder slices
		// stay taller and quieter ones shorter, keeping detail instead of
		// flattening to all-max bars.
		const cssW = authoredCssWidth > 0 ? authoredCssWidth : W / pr;
		const barCss = 1;
		const slotCss = barCss + barGap;
		const N = Math.max(1, Math.floor(cssW / slotCss));
		if (n < 1) {
			ctx.fillRect(0, 0, W, H);
			return;
		}
		const barPhys = Math.max(1, Math.round(barCss * pr));
		const perBar = n / N;
		const pct = Math.max(0.7, Math.min(1, 2.5 / perBar));
		const mid = H / 2;
		const buf: number[] = [];
		const vals = new Float64Array(N);
		for (let j = 0; j < N; j++) {
			const s0 = Math.floor((j * n) / N);
			const s1 = Math.max(s0 + 1, Math.floor(((j + 1) * n) / N));
			buf.length = 0;
			for (let k = s0; k < s1; k++) {
				const pv = peaks[k] ?? 0;
				buf.push(pv);
			}
			buf.sort((a, b) => a - b);
			const idx = Math.min(buf.length - 1, Math.floor((buf.length - 1) * pct));
			vals[j] = buf.length > 0 ? buf[idx] : 0;
		}
		// Normalize per-track so the loudest bar nearly reaches the top/bottom
		// edges regardless of how loud the track is. The tallest aggregated bar
		// sets the scale (not the raw 0-100 peak values).
		let ref = 0;
		for (let j = 0; j < N; j++) if (vals[j] > ref) ref = vals[j];
		if (ref <= 0) {
			ctx.fillRect(0, 0, W, H);
			return;
		}
		const AMP = .99;
		ctx.beginPath();
		for (let j = 0; j < N; j++) {
			const h = Math.max(minBar, (vals[j] / ref) * H * AMP);
			const x = Math.round(j * slotCss * pr);
			const y = mid - h / 2;
			const r = Math.min(barPhys / 2, h / 2);
			if (ctx.roundRect) ctx.roundRect(x, y, barPhys, h, r);
			else ctx.rect(x, y, barPhys, h);
		}
		ctx.fill();
		return;
	}

	const cssW = authoredCssWidth > 0 ? authoredCssWidth : W / pr;
	const barPhys = Math.max(1, Math.round(1 * pr));
	const stepPhys = Math.round((1 + barGap) * pr);
	const nBars = Math.max(1, Math.floor(cssW / (1 + barGap)));
	const mono = mixChannels(channelData);
	const len = mono.length;
	if (len < 1) {
		ctx.fillRect(0, 0, W, H);
		return;
	}
	const raw = new Float64Array(nBars);
	for (let b = 0; b < nBars; b++) {
		const s0 = Math.floor((b * len) / nBars);
		const s1 = Math.max(s0 + 1, Math.floor(((b + 1) * len) / nBars));
		let peak = 0;
		for (let i = s0; i < s1; i++) {
			const v = mono[i];
			if (v < 0) {
				if (-v > peak) peak = -v;
			} else if (v > peak) {
				peak = v;
			}
		}
		raw[b] = peak;
	}
	const smooth = new Float64Array(nBars);
	for (let b = 0; b < nBars; b++) {
		const lo = Math.max(0, b - 1);
		const hi = Math.min(nBars - 1, b + 1);
		let s = 0;
		let c = 0;
		for (let k = lo; k <= hi; k++) {
			s += raw[k];
			c++;
		}
		smooth[b] = s / c;
	}
	const pw = smooth;
	const sorted = Array.from(pw).sort((a, b) => a - b);
	const ref = sorted[Math.floor(sorted.length * REF_PERCENTILE)] || Infinity;
	if (!isFinite(ref) || ref <= 0) {
		ctx.fillRect(0, 0, W, H);
		return;
	}
	const mid = H / 2;
	ctx.beginPath();
	for (let b = 0; b < nBars; b++) {
		const h = Math.max(FLOOR_H * H, Math.min(1, pw[b] / ref) * H);
		const x = b * stepPhys;
		const y = mid - h / 2;
		const r = Math.min(barPhys / 2, h / 2);
		if (ctx.roundRect) ctx.roundRect(x, y, barPhys, h, r);
		else ctx.rect(x, y, barPhys, h);
	}
	ctx.fill();
}
