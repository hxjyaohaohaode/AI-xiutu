"""Optional native decoder. Run only inside the parent's isolated media process group.

Camera RAW -> linear development and sRGB uint16; EXR/Radiance -> retained float32 EXR plus
fixed luminance-preserving Reinhard SDR proxy master. Never executes file metadata.
"""
import json
import math
import resource
import shutil
import sys
from pathlib import Path

import numpy as np
import OpenImageIO as oiio
from exr_layout import apply_layout, capture_layout


def write_image(path, pixels, kind, colorspace, unassociated=False, layout=None):
    height, width, channels = pixels.shape
    spec = oiio.ImageSpec(width, height, channels, kind)
    spec.attribute("oiio:ColorSpace", colorspace)
    spec.attribute("compression", "zip")
    if layout is not None:
        apply_layout(spec, layout)
    if unassociated and channels == 4:
        spec.attribute("oiio:UnassociatedAlpha", 1)
    spec.tile_width = 256
    spec.tile_height = 256
    output = oiio.ImageOutput.create(str(path))
    if output is None or not output.open(str(path), spec):
        raise RuntimeError("Cannot create native intermediate")
    try:
        if not output.write_image(pixels):
            raise RuntimeError(output.geterror())
    finally:
        output.close()


def admit_native(width, height, maximum, directory):
    if min(width, height) < 1 or max(width, height) > 65_535 or width * height > maximum:
        raise ValueError("Native source exceeds the dimension budget")
    # Native development can publish both an EXR and a TIFF before the worker
    # builds the proxy or tiles. Reserve headroom for those intermediates first.
    if shutil.disk_usage(directory).free < width * height * 26 + 8 * 1024**2:
        raise ValueError("Insufficient disk capacity for native development")


def main():
    request = json.loads(Path(sys.argv[1]).read_text())
    source, destination = request["inputPath"], Path(request["outputPath"])
    max_pixels = min(int(request["maxPixels"]), 50_000_000)
    native = {"openimageio": oiio.VERSION_STRING}
    if request["kind"] == "raw":
        import rawpy
        native["rawpy"] = rawpy.__version__
        native["libraw"] = ".".join(map(str, rawpy.libraw_version))
        with rawpy.imread(source) as raw:
            width, height = raw.sizes.raw_width, raw.sizes.raw_height
            admit_native(width, height, max_pixels, destination.parent)
            pixels = raw.postprocess(output_bps=16, output_color=rawpy.ColorSpace.sRGB,
                                     use_camera_wb=True, no_auto_bright=True, gamma=(1, 1))
            source_info = {"width": width, "height": height, "bitDepth": math.ceil(math.log2(int(raw.white_level) + 1)),
                           "colorSpace": "camera-native", "sampleEncoding": "sensor-raw", "decodedBitDepth": 16, "whiteLevel": int(raw.white_level),
                           "blackLevels": list(map(int, raw.black_level_per_channel))}
        linear = pixels.astype(np.float32)
        linear /= np.float32(65535)
        write_image(destination.with_name("linear-master.exr"), linear, oiio.FLOAT, "Linear")
        del linear
        ramp = np.arange(65536, dtype=np.float64) / 65535
        encoded = np.where(ramp <= 0.0031308, 12.92 * ramp, 1.055 * np.power(ramp, 1 / 2.4) - 0.055)
        lookup = np.rint(encoded * 65535).astype(np.uint16)
        for row in range(0, pixels.shape[0], 64):
            pixels[row:row + 64] = lookup[pixels[row:row + 64]]
        write_image(destination, pixels, oiio.UINT16, "sRGB")
        warnings = ["RAW is demosaiced by LibRaw with camera white balance and no automatic brightening. The float master preserves the normalized 16-bit linear development; it cannot restore clipped sensor data. Original sensor bytes are retained."]
    elif request["kind"] == "hdr":
        image = oiio.ImageInput.open(source)
        if image is None:
            raise ValueError("Unsupported HDR source")
        try:
            spec = image.spec()
            width, height, channels = spec.width, spec.height, spec.nchannels
            if channels not in (1, 3, 4) or spec.deep or spec.depth != 1:
                raise ValueError("HDR exceeds the flat 1/3/4-channel 50MP budget")
            admit_native(width, height, max_pixels, destination.parent)
            if image.seek_subimage(1, 0):
                raise ValueError("Multipart or multi-image HDR is not supported")
            image.seek_subimage(0, 0)
            space = str(spec.getattribute("oiio:ColorSpace") or "").strip().lower()
            interop = str(spec.getattribute("colorInteropID") or "").strip().lower()
            accepted = {"", "linear", "lin_rec709_scene", "linear rec.709", "linear srgb", "scene_linear"}
            if space not in accepted or interop not in accepted:
                raise ValueError("HDR declares unsupported primaries or transfer; convert explicitly to linear Rec.709 first")
            chromaticities = spec.getattribute("chromaticities")
            if chromaticities is not None:
                xy = np.asarray(chromaticities, dtype=np.float64).reshape(-1)
                rec709 = np.array([0.64, 0.33, 0.30, 0.60, 0.15, 0.06, 0.3127, 0.3290])
                if xy.size != 8 or not np.all(np.isfinite(xy)) or not np.allclose(xy, rec709, atol=0.0002, rtol=0):
                    raise ValueError("HDR chromaticities are not validated linear Rec.709")
            radiance = image.format_name() in ("hdr", "rgbe")
            source_info = {"width": width, "height": height, "bitDepth": 8 if radiance else 16 if str(spec.format) == "half" else 32,
                           "sampleEncoding": "rgbe" if radiance else "half-float" if str(spec.format) == "half" else "float",
                           "decodedBitDepth": 32, "colorSpace": "linear-sRGB/Rec709-assumed"}
            names = list(spec.channelnames)
            if channels == 4 and "A" not in names:
                raise ValueError("Four-channel HDR requires an explicit alpha channel")
            layout = capture_layout(spec)
            pixels = image.read_image(format=oiio.FLOAT)
            if pixels is None:
                raise ValueError("HDR decode failed")
        finally:
            image.close()
        pixels = np.asarray(pixels, dtype=np.float32).reshape(height, width, channels)
        if not np.all(np.isfinite(pixels)):
            raise ValueError("Non-finite HDR samples are rejected")
        if channels == 1:
            pixels = np.repeat(pixels, 3, axis=2)
        elif names[:3] != ["R", "G", "B"]:
            if not all(c in names for c in ["R", "G", "B"]):
                raise ValueError("HDR must declare RGB channels")
            indices = [names.index(c) for c in ["R", "G", "B"]]
            if "A" in names:
                indices.append(names.index("A"))
            pixels = pixels[:, :, indices]
        write_image(destination.with_name("linear-master.exr"), pixels, oiio.FLOAT, "Linear", layout=layout)
        result = np.empty(pixels.shape, dtype=np.uint16)
        weights = np.array([0.2126, 0.7152, 0.0722], dtype=np.float64)
        for row in range(0, height, 64):
            stripe = pixels[row:row + 64]
            output = result[row:row + 64]
            rgb = np.maximum(stripe[:, :, :3].astype(np.float64), 0)
            # Work in straight color before the nonlinear tone map.
            if stripe.shape[2] == 4:
                alpha = stripe[:, :, 3:4]
                if np.any(alpha < 0) or np.any(alpha > 1):
                    raise ValueError("HDR alpha must be finite coverage in [0,1]")
                rgb = np.divide(rgb, alpha, out=np.zeros_like(rgb), where=alpha > 0)
                output[:, :, 3:4] = np.rint(alpha * 65535)
            luminance = np.sum(rgb * weights, axis=2, keepdims=True)
            mapped = rgb / (1 + luminance)
            encoded = np.where(mapped <= 0.0031308, 12.92 * mapped, 1.055 * np.power(mapped, 1 / 2.4) - 0.055)
            output[:, :, :3] = np.rint(np.clip(encoded, 0, 1) * 65535)
        write_image(destination, result, oiio.UINT16, "sRGB", unassociated=True)
        warnings = ["HDR is interpreted as linear Rec.709/sRGB; explicit unsupported primaries/transfer are rejected. The float32 master retains the source data window, display window and pixel aspect ratio. The SDR proxy uses data-window pixels and fixed luminance Reinhard tone mapping, clipping negative/out-of-gamut SDR values."]
    else:
        raise ValueError("Unknown native decoder kind")
    Path(request["resultPath"]).write_text(json.dumps({"source": source_info, "native": native, "warnings": warnings,
                                                     "peakRssBytes": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * 1024}))


if __name__ == "__main__":
    main()
