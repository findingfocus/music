export type ChannelData = Array<Float32Array | number[]>;

const REF_PERCENTILE = 0.95;
const FLOOR_H = 0.03;

let authoredPeaks: number[] | null = null;

export function setAuthoredPeaks(peaks: number[] | null | undefined): void {
	authoredPeaks = peaks ?? null;
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
	const pr = Math.max(1, window.devicePixelRatio || 1);

	if (authoredPeaks && authoredPeaks.length > 0) {
		const peaks = authoredPeaks;
		const n = peaks.length;
		const barCss = 1;
		const gapCss = 2;
		const cssWidth = W / pr;
		const N = Math.max(48, Math.floor(cssWidth / (barCss + gapCss)));
		const slot = (barCss + gapCss) * pr;
		const barW = barCss * pr;
		const gap = gapCss * pr;
		const last = n - 1;
		const mid = H / 2;
		ctx.beginPath();
		for (let j = 0; j < N; j++) {
			const p = ((j + 0.5) * last) / N;
			const i0 = Math.floor(p);
			const i1 = Math.min(i0 + 1, last);
			const frac = p - i0;
			const v = (peaks[i0] ?? 0) + ((peaks[i1] ?? 0) - (peaks[i0] ?? 0)) * frac;
			const h = Math.max(2 * pr, (v / 100) * H);
			const x = j * slot + gap / 2;
			const y = mid - h / 2;
			const r = Math.min(barW / 2, h / 2);
			if (ctx.roundRect) ctx.roundRect(x, y, barW, h, r);
			else ctx.rect(x, y, barW, h);
		}
		ctx.fill();
		return;
	}

	const barW = 2 * pr;
	const gapW = pr;
	const step = barW + gapW;
	const nBars = Math.max(1, Math.floor(W / step));
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
		const x = b * step;
		const y = mid - h / 2;
		const r = Math.min(2 * pr, h / 2);
		if (ctx.roundRect) ctx.roundRect(x, y, barW, h, r);
		else ctx.rect(x, y, barW, h);
	}
	ctx.fill();
}
