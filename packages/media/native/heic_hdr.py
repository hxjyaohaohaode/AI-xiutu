"""Decode bounded PQ/HLG HEIC into reference-white relative linear RGB."""

import json
import subprocess
from pathlib import Path

import numpy as np
from color_space import GAMUT_NAMES, linear_rec709


NCLX_GAMUTS = {1: 0, 12: 1, 9: 2}
DEFAULT_REFERENCE_WHITE_NITS = 203.0
HLG_REFERENCE_PEAK_NITS = 1000.0


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


def hlg_lookup(bits):
    # BT.2100 Table 5, inverse HLG OETF for the reference display.
    codes = np.arange(1 << bits, dtype=np.float64) / ((1 << bits) - 1)
    a = 0.17883277
    b = 1 - 4 * a
    c = 0.5 - a * np.log(4 * a)
    return np.where(codes <= 0.5, codes * codes / 3, (np.exp((codes - c) / a) + b) / 12).astype(np.float32)


def decode_heic_hdr(source, destination, decoder, admit):
    info = run_decoder(decoder, "--inspect", source)
    width, height, bits = (info[field] for field in ("width", "height", "bitDepth"))
    admit(width, height)
    gamut = NCLX_GAMUTS.get(info["primaries"])
    white = info["diffuseWhite"] / 10_000 or DEFAULT_REFERENCE_WHITE_NITS
    # Installed PQ-only decoders from the previous interface omit transfer.
    transfer = info.get("transfer", 16)
    hlg = transfer == 18
    if (gamut is None or bits not in (10, 12) or transfer not in (16, 18)
            or (hlg and gamut != 2) or not 0 < white <= (HLG_REFERENCE_PEAK_NITS if hlg else 10000)):
        raise ValueError("Unsupported HEIC HDR color metadata")
    decoded = run_decoder(decoder, "--decode", source, str(destination))
    if decoded != info or Path(destination).stat().st_size != width * height * 6:
        raise ValueError("HEIC decode did not match the inspected raster")
    pixels = np.memmap(destination, dtype="<u2", mode="r", shape=(height, width, 3))
    lookup = hlg_lookup(bits) if hlg else pq_lookup(bits, white)
    reference = {"primaries": GAMUT_NAMES[gamut], "referenceWhiteNits": white}

    def linearize(band):
        if np.any(band >= lookup.size):
            raise ValueError("HEIC decoded code values exceed their declared precision")
        linear = lookup[band]
        if hlg:
            # Apply the reference display OOTF to Rec.2020 luminance before the
            # conversion to Rec.709. A per-channel power changes saturated hues.
            luminance = linear[..., 0] * 0.2627 + linear[..., 1] * 0.6780 + linear[..., 2] * 0.0593
            gain = np.power(luminance, np.float32(0.2)) * np.float32(HLG_REFERENCE_PEAK_NITS / white)
            linear *= gain[..., None]
        return linear_rec709(linear, gamut)

    encoding = "hlg" if hlg else "pq"
    return pixels, linearize, {
        "width": width, "height": height, "bitDepth": bits, "decodedBitDepth": bits,
        "colorSpace": f"{GAMUT_NAMES[gamut]} / {'BT.2100 HLG' if hlg else 'ST 2084'}",
        "sampleEncoding": encoding,
        encoding: {**reference, "referencePeakNits": HLG_REFERENCE_PEAK_NITS} if hlg else reference,
    }, info["codec"]
