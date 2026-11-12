"""Develop retained scene-linear or sRGB samples without an 8-bit intermediate."""
import json
import sys
from pathlib import Path

import numpy as np
import OpenImageIO as oiio
from exr_layout import apply_layout, capture_layout


def read_band(image, spec, left, top, width, height, sample_type=oiio.FLOAT):
    if spec.tile_width:
        x0 = left // spec.tile_width * spec.tile_width
        y0 = top // spec.tile_height * spec.tile_height
        x1 = min(spec.width, (left + width + spec.tile_width - 1) // spec.tile_width * spec.tile_width)
        y1 = min(spec.height, (top + height + spec.tile_height - 1) // spec.tile_height * spec.tile_height)
        pixels = image.read_tiles(
            spec.x + x0, spec.x + x1, spec.y + y0, spec.y + y1,
            spec.z, spec.z + 1, 0, spec.nchannels, sample_type,
        )
        if pixels is None:
            raise ValueError("Cannot read retained master tiles")
        pixels = np.asarray(pixels).reshape(y1 - y0, x1 - x0, spec.nchannels)
        return pixels[top - y0:top - y0 + height, left - x0:left - x0 + width]
    pixels = image.read_scanlines(
        spec.y + top, spec.y + top + height, spec.z, 0, spec.nchannels, sample_type,
    )
    if pixels is None:
        raise ValueError("Cannot read retained master scanlines")
    return np.asarray(pixels).reshape(height, spec.width, spec.nchannels)[:, left:left + width]


def curve_gain(value, points):
    positive = value > 0
    stops = np.log2(np.where(positive, value, 0.18) / 0.18)
    # Outside the knots the last exposure offset continues, keeping the
    # original highlight headroom and leaving zero/negative samples intact.
    offsets = np.interp(stops, points[:, 0], points[:, 1] - points[:, 0])
    return np.where(positive, np.exp2(offsets), 1)


def luminance(rgb):
    return (rgb[..., 0:1] * 0.2126 + rgb[..., 1:2] * 0.7152) + rgb[..., 2:3] * 0.0722


def grade_gains(edit):
    exposure = edit.get("exposure", 0)
    temperature = edit.get("temperature", 0)
    tint = edit.get("tint", 0)
    return np.exp2([
        exposure + 0.0035 * temperature + 0.0012 * tint,
        exposure - 0.0018 * tint,
        exposure - 0.0035 * temperature + 0.0012 * tint,
    ])


def grade_rgb(rgb, edit, gains, measure_y=False):
    rgb *= gains
    shadows = edit.get("shadows", 0)
    highlights = edit.get("highlights", 0)
    contrast = edit.get("contrast", 0)
    saturation = edit.get("saturation", 0)
    if not (measure_y or shadows or highlights or contrast or saturation):
        return rgb, None, 1
    signed_y = luminance(rgb)
    y = np.maximum(0, signed_y)
    gain = 1
    if shadows or highlights:
        highlight = y / (y + 0.18)
        gain = np.exp2((shadows * (1 - highlight) + highlights * highlight) / 100)
    if contrast:
        gain = gain * np.power(np.where(y > 0, y / 0.18, 1), 2 ** (contrast / 100) - 1)
    if saturation:
        rgb = signed_y + (rgb - signed_y) * (1 + saturation / 100)
    if shadows or highlights or contrast:
        rgb *= gain
    return rgb, y, gain


def compile_mask(mask, source_width, source_height):
    def smooth(t):
        return t * t * (3 - 2 * t)

    if mask["type"] == "linear":
        short = min(source_width, source_height)
        ax, ay = source_width / short, source_height / short
        start, end = mask["start"], mask["end"]
        x0, y0 = start["x"] * ax, start["y"] * ay
        dx = (end["x"] - start["x"]) * ax
        dy = (end["y"] - start["y"]) * ay
        norm = dx * dx + dy * dy

        def weights(x, y):
            t = np.clip(((x * ax - x0) * dx + (y * ay - y0) * dy) / norm, 0, 1)
            return smooth(t) if mask["smooth"] else t

    elif mask["type"] == "radial":
        angle = mask.get("rotationDegrees", 0)
        radians = angle * np.pi / 180
        cos, sin = np.cos(radians), np.sin(radians)
        if angle % 90 == 0:
            cos, sin = np.rint(cos), np.rint(sin)
        rx, ry = mask["radiusX"], mask["radiusY"]
        xx, xy = cos / rx, sin * source_height / (rx * source_width)
        yx, yy = -sin * source_width / (ry * source_height), cos / ry
        feather = mask["feather"]
        shape = mask.get("shape", "ellipse")

        def weights(x, y):
            x = x - mask["centerX"]
            y = y - mask["centerY"]
            u, v = x * xx + y * xy, x * yx + y * yy
            if shape == "rectangle":
                distance = np.maximum(np.abs(u), np.abs(v))
            elif shape == "diamond":
                distance = np.abs(u) + np.abs(v)
            else:
                distance = np.sqrt(u * u + v * v)
            if not feather:
                return (distance < 1).astype(np.float64)
            return smooth(np.clip((1 - distance) / feather, 0, 1))

    else:
        raise ValueError("Unsupported scene-linear region mask")
    if mask["invert"]:
        return lambda x, y: 1 - weights(x, y)
    return weights


def apply_regions(rgb, regions, x, y):
    changed = np.zeros(rgb.shape[:2], dtype=bool)
    for mask, opacity, adjustments, gains in regions:
        weight = mask(x, y) * opacity
        support = weight > 0
        if not np.any(support):
            continue
        old = rgb[support]
        graded, _, _ = grade_rgb(old.copy(), adjustments, gains)
        factor = weight[support, None]
        edited = np.where(factor == 1, graded, old + factor * (graded - old))
        rgb[support] = edited
        changed[support] |= np.any(edited != old, axis=-1)
    return changed


def pixel_centers(start, count, extent):
    return (np.arange(start, start + count, dtype=np.float64) + 0.5) / extent


def develop(pixels, edit, gains, sdr, curves, regions=(), x=None, y=None, sdr_tone_map=False, srgb_decode=None):
    if not np.all(np.isfinite(pixels)):
        raise ValueError("Non-finite retained float samples")
    alpha = pixels[:, :, 3:4].astype(np.float64) if pixels.shape[2] == 4 else None
    rgb = (pixels[:, :, :3].astype(np.float64) if srgb_decode is None else srgb_decode[pixels])
    if alpha is not None:
        if np.any(alpha < 0) or np.any(alpha > 1):
            raise ValueError("Invalid retained alpha")
        rgb = np.divide(rgb, alpha, out=np.zeros_like(rgb), where=alpha > 0)
    tone_map = edit["toneMap"] == "reinhard" or sdr_tone_map
    rgb, base_y, gain = grade_rgb(rgb, edit, gains, measure_y=tone_map and not curves)
    if "luminance" in curves:
        rgb *= curve_gain(luminance(rgb), curves["luminance"])
    for channel, name in enumerate(("red", "green", "blue")):
        if name in curves:
            rgb[:, :, channel] *= curve_gain(rgb[:, :, channel], curves[name])
    if tone_map:
        mapped_y = np.maximum(0, luminance(rgb)) if curves else base_y * gain
    if regions:
        changed = apply_regions(rgb, regions, x, y)
        if tone_map:
            mapped_y = np.where(changed[:, :, None], np.maximum(0, luminance(rgb)), mapped_y)
    if tone_map:
        rgb /= 1 + mapped_y
    if sdr:
        rgb = np.clip(rgb, 0, 1)
        encoded = np.where(rgb <= 0.0031308, 12.92 * rgb, 1.055 * np.power(rgb, 1 / 2.4) - 0.055)
        if alpha is not None:
            encoded = np.concatenate((encoded, alpha), axis=2)
        codes = encoded * 65535
        return (np.rint(codes) if srgb_decode is None else np.floor(codes + 0.5)).astype(np.uint16)
    rgb = (rgb if alpha is None else rgb * alpha).astype(np.float32)
    if not np.all(np.isfinite(rgb)):
        raise ValueError("Precision edit overflow")
    result = pixels.copy()
    result[:, :, :3] = rgb if alpha is None else np.where(alpha > 0, rgb, pixels[:, :, :3])
    return result


def render(image, request, window_png=False, read_source_band=read_band, window_raw=False):
    spec = image.spec()
    width, height, channels = spec.width, spec.height, spec.nchannels
    if (
        width != request["width"]
        or height != request["height"]
        or channels not in (3, 4)
        or spec.deep
        or spec.depth != 1
        or width * height > request["maxPixels"]
    ):
        raise ValueError("Retained master exceeds precision export contract")
    if image.seek_subimage(1, 0):
        raise ValueError("Multipart master is not supported")
    image.seek_subimage(0, 0)
    edit = request["edit"]
    if edit["algorithm"] not in ("scene-linear-v1", "scene-linear-v2", "scene-linear-v3"):
        raise ValueError("Unsupported precision edit")
    curves = {
        channel: np.asarray(points, dtype=np.float64)
        for channel, points in edit.get("curves", {}).items()
        if any(x != y for x, y in points)
    }
    gains = grade_gains(edit)
    regions = [
        (
            compile_mask(region["mask"], spec.width, spec.height),
            region["opacity"],
            region["adjustments"],
            grade_gains(region["adjustments"]),
        )
        for region in edit.get("regions", ())
        if region["enabled"] and region["opacity"] and any(region["adjustments"].values())
    ]
    sdr = request["sdr"]
    sdr_tone_map = sdr and request.get("sdrToneMap", False)
    linear_tiff = request.get("linearTiff", False)
    if linear_tiff and (sdr or channels != 3):
        raise ValueError("Ultra HDR JPEG development requires opaque RGB samples")
    region = request.get("region")
    srgb_decode = None
    if request.get("inputSrgb", False):
        if (
            not sdr or sdr_tone_map or region or channels != 3 or spec.format != oiio.UINT16
            or image.format_name() != "tiff" or edit["algorithm"] != "scene-linear-v1"
        ):
            raise ValueError("SDR development requires the opaque RGB16 TIFF master and v1 grade")
        codes = np.arange(65536, dtype=np.float64) / 65535
        srgb_decode = np.where(codes <= 0.04045, codes / 12.92, np.power((codes + 0.055) / 1.055, 2.4))
    left, top = 0, 0
    if region:
        left, top, width, height = (region[key] for key in ("left", "top", "width", "height"))
        if (
            not (sdr or linear_tiff)
            or min(left, top) < 0
            or min(width, height) < 1
            or left + width > spec.width
            or top + height > spec.height
        ):
            raise ValueError("Invalid native precision window")
    columns = pixel_centers(left, width, spec.width) if regions else None

    def developed_stripes():
        end = top + height
        row = top
        while row < end:
            next_row = min(
                end,
                (row // spec.tile_height + 1) * spec.tile_height if spec.tile_height else row + 64,
            )
            band = (
                read_source_band(image, spec, left, row, width, next_row - row)
                if srgb_decode is None
                else read_band(image, spec, left, row, width, next_row - row, oiio.UINT16)
            )
            for offset in range(0, band.shape[0], 64):
                source = band[offset:offset + 64]
                rows = (
                    pixel_centers(row + offset, source.shape[0], spec.height)[:, None]
                    if regions else None
                )
                yield row + offset - top, develop(
                    source, edit, gains, sdr, curves, regions, columns, rows, sdr_tone_map, srgb_decode,
                )
            row = next_row

    result = {"width": width, "height": height, "channels": channels, "bitDepth": 16 if sdr else 32}
    if window_raw:
        if not (sdr and region) or window_png:
            raise ValueError("A raw preview requires an SDR window")
        with open(request["outputPath"], "xb") as output:
            for _, stripe in developed_stripes():
                output.write(memoryview(np.ascontiguousarray(stripe)).cast("B"))
        return result

    out_spec = oiio.ImageSpec(width, height, channels, oiio.UINT16 if sdr else oiio.FLOAT)
    out_spec.attribute("oiio:ColorSpace", "sRGB" if sdr else "Linear")
    # Fitted previews immediately consume the private TIFF for resizing.
    # Its samples can be stored losslessly without a deflate/inflate round trip.
    uncompressed = sdr and not window_png and request.get("uncompressedSdr", False)
    out_spec.attribute("compression", "none" if uncompressed else "zip")
    if window_png:
        out_spec.attribute("png:compressionLevel", 1)
    if sdr and channels == 4:
        out_spec.attribute("oiio:UnassociatedAlpha", 1)
    if not sdr and not linear_tiff:
        apply_layout(out_spec, capture_layout(spec))
    target = "preview.png" if window_png else "developed.tif" if sdr or linear_tiff else "precision.exr"
    out = oiio.ImageOutput.create(target)
    if out is None or not out.open(request["outputPath"], out_spec):
        raise ValueError("Cannot create precision output")
    try:
        for row, stripe in developed_stripes():
            y = out_spec.y + row
            if not out.write_scanlines(y, y + stripe.shape[0], out_spec.z, stripe):
                raise ValueError("Cannot write precision samples")
    finally:
        closed = out.close()
    if not closed:
        raise ValueError("Cannot close precision output")
    return result


def main():
    request = json.loads(Path(sys.argv[1]).read_text())
    image = oiio.ImageInput.open(request["inputPath"])
    if image is None:
        raise ValueError("Cannot open retained master")
    try:
        result = render(image, request)
        Path(request["resultPath"]).write_text(json.dumps(result))
    finally:
        image.close()


if __name__ == "__main__":
    main()
