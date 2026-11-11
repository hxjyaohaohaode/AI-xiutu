"""Fixed scene-linear float export. Paths/recipe come only from the isolated media worker."""
import json
import sys
from pathlib import Path
import numpy as np
import OpenImageIO as oiio


def main():
    request = json.loads(Path(sys.argv[1]).read_text())
    image = oiio.ImageInput.open(request["inputPath"])
    if image is None:
        raise ValueError("Cannot open retained float master")
    try:
        spec = image.spec()
        width, height, channels = spec.width, spec.height, spec.nchannels
        if width != request["width"] or height != request["height"] or channels not in (3, 4) or spec.deep or width * height > 16_777_216:
            raise ValueError("Retained float master exceeds precision export contract")
        if image.seek_subimage(1, 0):
            raise ValueError("Multipart float master is not supported")
        image.seek_subimage(0, 0)
        pixels = image.read_image(format=oiio.FLOAT)
    finally:
        image.close()
    if pixels is None or not np.all(np.isfinite(pixels)):
        raise ValueError("Non-finite retained float samples")
    edit = request["edit"]
    if edit["algorithm"] != "scene-linear-v1":
        raise ValueError("Unsupported precision edit")
    # Row stripes bound float64 work buffers while preserving source float32 pixels.
    for row in range(0, height, 64):
        stripe = pixels[row:row + 64]
        rgb = stripe[:, :, :3].astype(np.float64)
        alpha = stripe[:, :, 3:4].astype(np.float64) if channels == 4 else np.ones((*stripe.shape[:2], 1))
        if np.any(alpha < 0) or np.any(alpha > 1):
            raise ValueError("Invalid retained alpha")
        rgb = np.divide(rgb, alpha, out=np.zeros_like(rgb), where=alpha > 0)
        gains = np.exp2([edit["exposure"] + 0.0035 * edit["temperature"] + 0.0012 * edit["tint"],
                         edit["exposure"] - 0.0018 * edit["tint"],
                         edit["exposure"] - 0.0035 * edit["temperature"] + 0.0012 * edit["tint"]])
        rgb *= gains
        signed_y = np.sum(rgb * [0.2126, 0.7152, 0.0722], axis=2, keepdims=True)
        y = np.maximum(0, signed_y)
        highlight = y / (y + 0.18)
        gain = np.exp2((edit["shadows"] * (1 - highlight) + edit["highlights"] * highlight) / 100)
        if edit["contrast"]:
            gain *= np.power(np.where(y > 0, y / 0.18, 1), 2 ** (edit["contrast"] / 100) - 1)
        rgb = (rgb if not edit["saturation"] else signed_y + (rgb - signed_y) * (1 + edit["saturation"] / 100)) * gain
        if edit["toneMap"] == "reinhard":
            rgb /= 1 + y * gain
        # EXR follows the retained associated-alpha convention. Zero alpha stays unchanged.
        result = (rgb * alpha).astype(np.float32)
        if not np.all(np.isfinite(result)):
            raise ValueError("Precision edit overflow")
        stripe[:, :, :3] = np.where(alpha > 0, result, stripe[:, :, :3])
    out_spec = oiio.ImageSpec(width, height, channels, oiio.FLOAT)
    out_spec.attribute("oiio:ColorSpace", "linear Rec.709")
    out_spec.attribute("compression", "zip")
    out = oiio.ImageOutput.create("precision.exr")
    if out is None or not out.open(request["outputPath"], out_spec):
        raise ValueError("Cannot create float output")
    try:
        if not out.write_image(pixels):
            raise ValueError("Cannot write float samples")
    finally:
        out.close()
    Path(request["resultPath"]).write_text(json.dumps({"width": width, "height": height, "channels": channels, "bitDepth": 32}))


if __name__ == "__main__":
    main()
