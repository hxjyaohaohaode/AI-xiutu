"""Decode bounded ST 2084 HEIC into reference-white relative linear RGB."""

import json
import subprocess
from pathlib import Path

import numpy as np
from color_space import GAMUT_NAMES, linear_rec709


NCLX_GAMUTS = {1: 0, 12: 1, 9: 2}
DEFAULT_REFERENCE_WHITE_NITS = 203.0


def run_decoder(path, *arguments):
    process = subprocess.run([path, *arguments], capture_output=True, text=True, check=False)
    if process.returncode:
        raise ValueError(process.stderr.strip() or "HEIC decoder rejected the image")
    return json.loads(process.stdout)


def pq_lookup(bits, reference_white_nits):
    # SMPTE ST 2084 maps the encoded range to absolute luminance up to 10,000 cd/m².
    codes = np.arange(1 << bits, dtype=np.float64) / ((1 << bits) - 1)
    root = np.power(codes, 32 / 2523)
    luminance = np.power(
        np.maximum(root - 3424 / 4096, 0) / (2413 / 128 - (2392 / 128) * root),
        16384 / 2610,
    )
    return (luminance * (10000 / reference_white_nits)).astype(np.float32)


def decode_heic_pq(source, destination, decoder, admit):
    info = run_decoder(decoder, "--inspect", source)
    width, height, bits = (info[field] for field in ("width", "height", "bitDepth"))
    admit(width, height)
    gamut = NCLX_GAMUTS.get(info["primaries"])
    white = info["diffuseWhite"] / 10_000 or DEFAULT_REFERENCE_WHITE_NITS
    if gamut is None or bits not in (10, 12) or not 0 < white <= 10000:
        raise ValueError("Unsupported HEIC PQ color metadata")
    decoded = run_decoder(decoder, "--decode", source, str(destination))
    if decoded != info or Path(destination).stat().st_size != width * height * 6:
        raise ValueError("HEIC decode did not match the inspected raster")
    pixels = np.memmap(destination, dtype="<u2", mode="r", shape=(height, width, 3))
    lookup = pq_lookup(bits, white)

    def linearize(band):
        if np.any(band >= lookup.size):
            raise ValueError("HEIC decoded code values exceed their declared precision")
        return linear_rec709(lookup[band], gamut)

    return pixels, linearize, {
        "width": width, "height": height, "bitDepth": bits, "decodedBitDepth": bits,
        "colorSpace": f"{GAMUT_NAMES[gamut]} / ST 2084",
        "sampleEncoding": "pq",
        "pq": {"primaries": GAMUT_NAMES[gamut], "referenceWhiteNits": white},
    }, info["codec"]
