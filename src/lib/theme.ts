export interface Theme {
	accent: string;
	cursor: string;
	waveBase: string;
	root: Record<string, string>;
}

export const THEME: Theme = {
	accent: '#8E7093',
	cursor: 'rgba(232,220,196,0.5)',
	waveBase: '#2A241C',
	root: {
		'--bg': '#0E0C0B',
		'--panel': '#17140F',
		'--panel-line': '#2A241C',
		'--mist-far': '#3A4148',
		'--mist-mid': '#262A2E',
		'--mist-near': '#14131299',
		'--text': '#E8DCC4',
		'--text-dim': '#8C8172',
		'--sage': '#7C9585',
		'--plum': '#8E7093',
		'--statusbar': '#D8C9A0'
	}
};

function rgba(hex: string, alpha: number): string {
	const n = parseInt(hex.slice(1), 16);
	return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

export function applyTheme(theme: Theme = THEME): void {
	if (typeof document === 'undefined') return;
	const style = document.documentElement.style;
	for (const [key, value] of Object.entries(theme.root)) style.setProperty(key, value);
	style.setProperty('--amber', theme.accent);
	style.setProperty('--amber-04', rgba(theme.accent, 0.04));
	style.setProperty('--amber-06', rgba(theme.accent, 0.06));
	style.setProperty('--amber-08', rgba(theme.accent, 0.08));
}