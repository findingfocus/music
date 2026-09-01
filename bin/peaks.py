#!/usr/bin/env python3
import json
import math
import struct
import subprocess
import sys

RATE = 8000
TARGET_SAMPLES_PER_SECOND = 8
MIN_SAMPLES = 160
MAX_SAMPLES = 4800


def read_mono_float(path):
    proc = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", path, "-ac", "1", "-ar", str(RATE), "-f", "f32le", "-"],
        capture_output=True,
        check=True,
    )
    data = proc.stdout
    n = len(data) // 4
    return struct.unpack("<%df" % n, data[: n * 4])


def compute(path):
    samples = read_mono_float(path)
    if len(samples) == 0:
        return [0] * MIN_SAMPLES
    sample_count = max(
        MIN_SAMPLES,
        min(MAX_SAMPLES, round(len(samples) / RATE * TARGET_SAMPLES_PER_SECOND)),
    )
    bars = []
    for b in range(sample_count):
        lo = (b * len(samples)) // sample_count
        hi = max(lo + 1, ((b + 1) * len(samples)) // sample_count)
        acc = 0.0
        for i in range(lo, hi):
            acc += samples[i] * samples[i]
        bars.append(math.sqrt(acc / (hi - lo)))
    ref = sorted(bars)[int(len(bars) * 0.95)] or 1.0
    out = [min(100.0, round(v / ref * 100)) for v in bars]
    return out


if __name__ == "__main__":
    path, out_path = sys.argv[1], sys.argv[2]
    peaks = compute(path)
    with open(out_path, "w") as f:
        json.dump({"peaks": peaks}, f)
    print("peaks:", len(peaks), "bars")
