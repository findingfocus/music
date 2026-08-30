export interface Track {
	id: string;
	title: string;
	sub: string[];
	url: string;
	peaks: number[];
	duration: number;
	date?: string;
	index?: number;
	sourceUrl?: string;
	source?: string;
}

// Set this to your R2 public bucket URL, e.g. https://pub-<bucketId>.r2.dev
const R2_BASE = 'https://media.findingfocus.music';
const TRACKS_JSON = `${R2_BASE}/tracks.json`;

// Fetched at runtime so a nightly publish needs zero deploys. The site starts
// empty by design: content exists only once nights are actually published.
export async function loadTracks(): Promise<Track[]> {
	try {
		const ctrl = new AbortController();
		const timer = setTimeout(() => ctrl.abort(), 6000);
		try {
			const res = await fetch(TRACKS_JSON, { signal: ctrl.signal, cache: 'no-store' });
			clearTimeout(timer);
			if (!res.ok) throw new Error(`tracks.json ${res.status}`);
			const remote: unknown = await res.json();
			if (!Array.isArray(remote)) throw new Error('tracks.json is not an array');
			return remote as Track[];
		} finally {
			clearTimeout(timer);
		}
	} catch (e) {
		console.warn('loadTracks:', e);
		return [];
	}
}