"""Develop retained scene-linear samples into float EXR or display-referred uint16 TIFF."""
import json
import sys
from pathlib import Path

import numpy as np
import OpenImageIO as oiio
from exr_layout import apply_layout, capture_layout


def read_band(image, spec, left, top, width, height):
    if spec.tile_width:
        x0 = left // spec.tile_width * spec.tile_width
        y0 = top // spec.tile_height * spec.tile_height
        x1 = min(spec.width, (left + width + spec.tile_width - 1) // spec.tile_width * spec.tile_width)
        y1 = min(spec.height, (top + height + spec.tile_height - 1) // spec.tile_height * spec.tile_height)
        pixels = image.read_tiles(
            spec.x + x0, spec.x + x1, spec.y + y0, spec.y + y1,
            spec.z, spec.z + 1, 0, spec.nchannels, oiio.FLOAT,
        )
        if pixels is None:
            raise ValueError("Cannot read retained EXR tiles")
        pixels = np.asarray(pixels).reshape(y1 - y0, x1 - x0, spec.nchannels)
        return pixels[top - y0:top - y0 + height, left - x0:left - x0 + width]
    pixels = image.read_scanlines(
        spec.y + top, spec.y + top + height, spec.z, 0, spec.nchannels, oiio.FLOAT,
    )
    if pixels is None:
        raise ValueError("Cannot read retained EXR scanlines")
    return np.asarray(pixels).reshape(height, spec.width, spec.nchannels)[:, left:left + width]


def curve_gain(value, points):
    positive = value > 0
    stops = np.log2(np.where(positive, value, 0.18) / 0.18)
    # Outside the knots the last exposure offset continues, keeping the
    # original highlight headroom and leaving zero/negative samples intact.
    offsets = np.interp(stops, points[:, 0], points[:, 1] - points[:, 0])
    return np.where(positive, np.exp2(offsets), 1)


def develop(pixels, edit, gains, sdr, curves):
    if not np.all(np.isfinite(pixels)):
        raise ValueError("Non-finite retained float samples")
    alpha = pixels[:, :, 3:4].astype(np.float64) if pixels.shape[2] == 4 else None
    rgb = pixels[:, :, :3].astype(np.float64)
    if alpha is not None:
        if np.any(alpha < 0) or np.any(alpha > 1):
            raise ValueError("Invalid retained alpha")
        rgb = np.divide(rgb, alpha, out=np.zeros_like(rgb), where=alpha > 0)
    rgb *= gains
    signed_y = np.sum(rgb * [0.2126, 0.7152, 0.0722], axis=2, keepdims=True)
    y = np.maximum(0, signed_y)
    highlight = y / (y + 0.18)
    gain = np.exp2((edit["shadows"] * (1 - highlight) + edit["highlights"] * highlight) / 100)
    if edit["contrast"]:
        gain *= np.power(np.where(y > 0, y / 0.18, 1), 2 ** (edit["contrast"] / 100) - 1)
    if edit["saturation"]:
        rgb = signed_y + (rgb - signed_y) * (1 + edit["saturation"] / 100)
    rgb *= gain
    if "luminance" in curves:
        luminance = np.sum(rgb * [0.2126, 0.7152, 0.0722], axis=2, keepdims=True)
        rgb *= curve_gain(luminance, curves["luminance"])
    for channel, name in enumerate(("red", "green", "blue")):
        if name in curves:
            rgb[:, :, channel] *= curve_gain(rgb[:, :, channel], curves[name])
    if edit["toneMap"] == "reinhard":
        mapped_y = np.maximum(0, np.sum(rgb * [0.2126, 0.7152, 0.0722], axis=2, keepdims=True)) if curves else y * gain
        rgb /= 1 + mapped_y
    if sdr:
        rgb = np.clip(rgb, 0, 1)
        encoded = np.where(rgb <= 0.0031308, 12.92 * rgb, 1.055 * np.power(rgb, 1 / 2.4) - 0.055)
        if alpha is not None:
            encoded = np.concatenate((encoded, alpha), axis=2)
        return np.rint(encoded * 65535).astype(np.uint16)
    rgb = (rgb if alpha is None else rgb * alpha).astype(np.float32)
    if not np.all(np.isfinite(rgb)):
        raise ValueError("Precision edit overflow")
    result = pixels.copy()
    result[:, :, :3] = rgb if alpha is None else np.where(alpha > 0, rgb, pixels[:, :, :3])
    return result


def render(image, request, window_png=False):
    spec = image.spec()
    width, height, channels = spec.width, spec.height, spec.nchannels
    if (
        width != request["width"]
        or height != request["height"]
        or channels not in (3, 4)
        or spec.deep
        or spec.depth != 1
        or width * height > 50_000_000
    ):
        raise ValueError("Retained float master exceeds precision export contract")
    if image.seek_subimage(1, 0):
        raise ValueError("Multipart float master is not supported")
    image.seek_subimage(0, 0)
    edit = request["edit"]
    if edit["algorithm"] not in ("scene-linear-v1", "scene-linear-v2"):
        raise ValueError("Unsupported precision edit")
    curves = {
        channel: np.asarray(points, dtype=np.float64)
        for channel, points in (edit["curves"].items() if edit["algorithm"] == "scene-linear-v2" else ())
        if any(x != y for x, y in points)
    }
    gains = np.exp2([
        edit["exposure"] + 0.0035 * edit["temperature"] + 0.0012 * edit["tint"],
        edit["exposure"] - 0.0018 * edit["tint"],
        edit["exposure"] - 0.0035 * edit["temperature"] + 0.0012 * edit["tint"],
    ])
    sdr = request["sdr"]
    region = request.get("region")
    left, top = 0, 0
    if region:
        left, top, width, height = (region[key] for key in ("left", "top", "width", "height"))
        if (
            not sdr
            or min(left, top) < 0
            or min(width, height) < 1
            or left + width > spec.width
            or top + height > spec.height
        ):
            raise ValueError("Invalid native precision window")
    out_spec = oiio.ImageSpec(width, height, channels, oiio.UINT16 if sdr else oiio.FLOAT)
    out_spec.attribute("oiio:ColorSpace", "sRGB" if sdr else "Linear")
    out_spec.attribute("compression", "zip")
    if sdr and channels == 4:
        out_spec.attribute("oiio:UnassociatedAlpha", 1)
    if not sdr:
        apply_layout(out_spec, capture_layout(spec))
    target = "preview.png" if window_png else "developed.tif" if sdr else "precision.exr"
    out = oiio.ImageOutput.create(target)
    if out is None or not out.open(request["outputPath"], out_spec):
        raise ValueError("Cannot create precision output")
    try:
        end = top + height
        row = top
        while row < end:
            next_row = min(
                end,
                (row // spec.tile_height + 1) * spec.tile_height if spec.tile_height else row + 64,
            )
            band = read_band(image, spec, left, row, width, next_row - row)
            for offset in range(0, band.shape[0], 64):
                stripe = develop(band[offset:offset + 64], edit, gains, sdr, curves)
                y = out_spec.y + row + offset - top
                if not out.write_scanlines(y, y + stripe.shape[0], out_spec.z, stripe):
                    raise ValueError("Cannot write precision samples")
            row = next_row
    finally:
        closed = out.close()
    if not closed:
        raise ValueError("Cannot close precision output")
    return {"width": width, "height": height, "channels": channels, "bitDepth": 16 if sdr else 32}


def main():
    request = json.loads(Path(sys.argv[1]).read_text())
    image = oiio.ImageInput.open(request["inputPath"])
    if image is None:
        raise ValueError("Cannot open retained float master")
    try:
        result = render(image, request)
        Path(request["resultPath"]).write_text(json.dumps(result))
    finally:
        image.close()


if __name__ == "__main__":
    main()
