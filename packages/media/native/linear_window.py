"""Read bounded native windows in one isolated, reusable interpreter."""
import hashlib
import json
import os
import stat
import sys

import OpenImageIO as oiio
from linear_export import read_band, render


MAX_CACHED_BYTES = 128 * 1024 * 1024
MAX_FITTED_PIXELS = 16_777_216


def identity(info):
    return (info.st_dev, info.st_ino, info.st_size, info.st_mode, info.st_ctime_ns, info.st_mtime_ns)


def render_window(request, verified, window_cache):
    region = request["region"]
    fitted = request.get("fitted", False)
    if any(type(region[key]) is not int for key in ("left", "top", "width", "height")):
        raise ValueError("Invalid window coordinates")
    width, height = region["width"], region["height"]
    input_srgb = request.get("inputSrgb", False)
    if min(width, height) < 1 or (
        width * height > MAX_FITTED_PIXELS if fitted else max(width, height) > 2048
    ):
        raise ValueError("Window exceeds the preview budget")
    path = request["inputPath"]
    flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC
    with os.fdopen(os.open(path, flags), "rb") as source:
        info = os.fstat(source.fileno())
        stamp = identity(info)
        if not stat.S_ISREG(info.st_mode) or info.st_size != request["inputBytes"]:
            raise ValueError("Invalid retained master")
        candidate = (path, request["inputSha256"], stamp)
        if verified != candidate:
            if hashlib.file_digest(source, "sha256").hexdigest() != request["inputSha256"]:
                raise ValueError("Retained master checksum mismatch")
            if identity(os.fstat(source.fileno())) != stamp:
                raise ValueError("Retained master changed during verification")
        # OpenImageIO reads the same inode that was checked, even if a path is
        # replaced while the native decoder is active.
        image = oiio.ImageInput.open(f"/proc/self/fd/{source.fileno()}")
        if image is None:
            raise ValueError("Cannot open retained master")
        try:
            if image.format_name() != ("tiff" if input_srgb else "openexr"):
                raise ValueError("Invalid retained master format")
            cache_key = (candidate, region["left"], region["top"], region["width"], region["height"])
            if window_cache and window_cache[0] != cache_key:
                window_cache[1].clear()
            cached_bands = window_cache[1] if window_cache and window_cache[0] == cache_key else {}

            def read_window_band(source, spec, left, top, width, height, sample_type):
                key = (top, height)
                if key not in cached_bands:
                    band = read_band(source, spec, left, top, width, height, sample_type).copy()
                    band.setflags(write=False)
                    cached_bands[key] = band
                return cached_bands[key]

            sample_bytes = 2 if input_srgb else 4
            cacheable = width * height * image.spec().nchannels * sample_bytes <= MAX_CACHED_BYTES
            result = render(
                image, request, window_png=not fitted, window_raw=fitted,
                read_source_band=read_window_band if cacheable else read_band,
            )
        finally:
            image.close()
        if (
            identity(os.fstat(source.fileno())) != stamp
            or identity(os.stat(path, follow_symlinks=False)) != stamp
        ):
            raise ValueError("Retained master changed during preview")
        return result, candidate, (cache_key, cached_bands) if cacheable else None


def main():
    os.umask(0o077)
    oiio.attribute("threads", 2)
    oiio.attribute("exr_threads", 2)
    verified = None
    window_cache = None
    while line := sys.stdin.buffer.readline(16385):
        if len(line) > 16384 or not line.endswith(b"\n"):
            raise ValueError("Oversized native preview request")
        try:
            request = json.loads(line)
            result, verified, window_cache = render_window(request, verified, window_cache)
        except (OSError, ValueError, RuntimeError):
            verified = None
            window_cache = None
            result = {"error": "processing"}
        print(json.dumps(result, separators=(",", ":")), flush=True)


if __name__ == "__main__":
    main()
