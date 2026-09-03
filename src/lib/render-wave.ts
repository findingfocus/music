export type ChannelData = Array<Float32Array | number[]>;

const REF_PERCENTILE = 0.95;
const FLOOR_H = 0.03;

let authoredPeaks: number[] | null = null;
let authoredCssWidth = 0;
let barGap = 0;

export function setAuthoredPeaks(peaks: number[] | null | undefined): void {
	authoredPeaks = peaks ?? null;
}

// Gap (in physical pixels) between waveform bars. Bars stay 1px wide for
// maximum fidelity; the gap just adds visible separation. 0 = dense.
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
		// One 1px-wide bar per slot (a slot is a bar plus any configured gap).
		// Each bar aggregates its time slice to a percentile that adapts to how
		// many peaks fall in the slice: dense bars (~1-2 peaks) use the max
		// (full detail); wider gaps push toward ~70th percentile so louder
		// slices stay taller and quieter ones shorter, keeping detail instead
		// of flattening to all-max bars. barGap is physical px; 0 = dense.
		const slot = 1 + barGap;
		const N = Math.max(1, Math.floor(W / slot));
		if (n < 1) {
			ctx.fillRect(0, 0, W, H);
			return;
		}
		const perBar = n / N;
		const pct = Math.max(0.7, Math.min(1, 2.5 / perBar));
		const mid = H / 2;
		ctx.beginPath();
		const buf: number[] = [];
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
			const v = buf.length > 0 ? buf[idx] : 0;
			const h = Math.max(minBar, (v / 100) * H);
			const x = j * slot;
			const y = mid - h / 2;
			const r = Math.min(0.5, h / 2);
			if (ctx.roundRect) ctx.roundRect(x, y, 1, h, r);
			else ctx.rect(x, y, 1, h);
		}
		ctx.fill();
		return;
	}

	const nBars = Math.max(1, W);
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
	const barW = 1;
	ctx.beginPath();
	for (let b = 0; b < nBars; b++) {
		const h = Math.max(FLOOR_H * H, Math.min(1, pw[b] / ref) * H);
		const x = b;
		const y = mid - h / 2;
		const r = Math.min(0.5, h / 2);
		if (ctx.roundRect) ctx.roundRect(x, y, barW, h, r);
		else ctx.rect(x, y, barW, h);
	}
	ctx.fill();
}
