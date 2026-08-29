export interface Track {
	title: string;
	sub: string[];
	url: string;
	peaks: number[];
	duration: number;
}

// Set this to your R2 public bucket URL, e.g. https://pub-<bucketId>.r2.dev
const R2_BASE = 'https://media.findingfocus.music';

const ORBIT_PEAKS = [
	94, 87.36, 76.97, 68.37, 56.53, 55.52, 57.46, 56.66, 73.89, 84.46, 90.49, 89.29, 87.75, 70.55,
	54.39, 45.77, 39.13, 35.72, 59.78, 72.43, 80.55, 86.64, 89.93, 67.72, 49.36, 39.84, 29.02, 22.83,
	50.62, 64.89, 70.32, 76.2, 80.55, 65.5, 56.02, 48.58, 37.67, 34.73, 40.87, 43.64, 45.91, 55,
	58.54, 44.1, 36.52, 36.94, 27.1, 26.82, 39.27, 48.72, 56.97, 64.92, 71.47, 70.93, 68.29, 59.38,
	52.37, 50.55, 49.73, 49.21, 50.45, 48.93, 51.73, 52.1, 52.75, 58.14, 66.22, 68.14, 64.69, 61.72,
	57.84, 49.88, 42.75, 40.13, 37.85, 39.67, 38.46, 21.66, 7.5, 6
];

const GLASS_PEAKS = [
	47.49, 59.79, 39.6, 51.97, 32.79, 60.58, 50.99, 77.74, 64.75, 53.44, 52.28, 42.12, 50.9, 49.56,
	73.34, 46.36, 64.06, 19.78, 43.44, 17.51, 67.23, 53.94, 94, 59.84, 70.31, 32.23, 38.06, 28.76,
	61.58, 66.3, 74.89, 79.32, 48.14, 46.13, 25.3, 43.63, 30.16, 70.44, 43.85, 72.56, 32.09, 60.99,
	37.62, 70.78, 59.97, 85.23, 54.91, 55.81, 37.88, 40.95, 45.88, 63.36, 83.57, 65.56, 69.67, 28.41,
	36.42, 6, 46.92, 36.99, 88.98, 58.78, 83.59, 41.96, 53.3, 32.82, 58.59, 50.86, 77.85, 64.65,
	52.88, 51.94, 41.5, 50.2, 48.78, 73.17, 45.24, 62.49, 42.95, 50.39
];

export const tracks: Track[] = [
	{
		title: 'orbit study',
		sub: ['d1 $ sound "bd sn"'],
		url: `${R2_BASE}/track1.mp3`,
		peaks: ORBIT_PEAKS,
		duration: 14.408
	},
	{
		title: 'glass patterns',
		sub: [
			'd1 $ slow 8 $ jux rev $ off 0.25 (|- n 12) $ off 0.125 (|+ n 7) $ n "<c g> <a ~> d(3,8,2) e" # sound "superpiano" # legato 4 # cutoff 300',
			'd2 $ chunk 4 (hurry 2) $ every 3 (#crush 4) $ sound "kick:8*2 clap:4" # cutoff 600'
		],
		url: `${R2_BASE}/track2.mp3`,
		peaks: GLASS_PEAKS,
		duration: 298.472
	},
	{
		title: 'low tide',
		sub: [
			'd1 $ slow 8 $ jux rev $ off 0.25 (|- n 12) $ n "c e g" # sound "piano" # legato 3',
			'd2 $ chunk 4 (hurry 2) $ every 3 (# crush 4) $ sound "kick:8*2 clap:4" # cutoff 600',
			'd3 $ n "0 2 4 7" # s "arpy" # room 0.4 # size 0.6',
			'd4 $ slow 4 $ n "<0 3 5 7>" # s "pad" # attack 2 # release 4',
			'd5 $ degradeBy 0.3 $ sound "hh*16" # gain 0.6',
			'd6 $ jux (iter 4) $ n (run 8) # s "gtr" # legato 1.5',
			'd7 $ someCyclesBy 0.2 (# speed 2) $ sound "bd*4"',
			'd8 $ off 0.125 (|+ n 12) $ n "0 .. 7" # s "bell"',
			'd9 $ chop 4 $ sound "vinyl" # speed (slow 8 $ sine)',
			'd10 $ striate 8 $ sound "breaks125" # cutoff 1200',
			'd11 $ n "a(3,8) f*2 d(3,8,2) [~ e*2]" # sound "superpiano" # gain 0.7',
			'd12 $ every 4 (rev) $ n "0 1 2 3 4 5 6 7" # s "marimba"',
			'd13 $ ply 2 $ sound "cp*2 ~ cp ~" # room 0.3',
			'd14 $ segment 8 $ range 0 12 sine # s "sine" # n',
			'd15 $ within (0, 0.5) (fast 2) $ sound "arpy*4" # pan sine',
			'd16 $ sometimesBy 0.4 (# vowel "a") $ n "0 3 5 7" # s "voice"',
			'd17 $ swingBy (1/3) 4 $ sound "hh*8" # gain 0.5',
			'd18 $ inv "1 0 1 1" # sound "bd" # n (irand 4)',
			'd19 $ scan 4 # s "arpy" # note "0 .. 3"',
			'd20 $ n (scale "minor" "0 2 4 6 8") # s "flute" # release 0.8'
		],
		url: `${R2_BASE}/track1.mp3`,
		peaks: ORBIT_PEAKS,
		duration: 14.408
	}
];