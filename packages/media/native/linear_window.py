"""Read bounded native windows in one isolated, reusable interpreter."""
import hashlib
import json
import os
import stat
import sys

import OpenImageIO as oiio
from linear_export import render


def identity(info):
    return (info.st_dev, info.st_ino, info.st_size, info.st_mode, info.st_ctime_ns, info.st_mtime_ns)


def render_window(request, verified):
    region = request["region"]
    if any(type(region[key]) is not int for key in ("left", "top", "width", "height")):
        raise ValueError("Invalid window coordinates")
    if not (1 <= region["width"] <= 2048 and 1 <= region["height"] <= 2048):
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
            if image.format_name() != "openexr":
                raise ValueError("Invalid retained master format")
            result = render(image, request, window_png=True)
        finally:
            image.close()
        if (
            identity(os.fstat(source.fileno())) != stamp
            or identity(os.stat(path, follow_symlinks=False)) != stamp
        ):
            raise ValueError("Retained master changed during preview")
        return result, candidate


def main():
    os.umask(0o077)
    oiio.attribute("threads", 2)
    oiio.attribute("exr_threads", 2)
    verified = None
    while line := sys.stdin.buffer.readline(16385):
        if len(line) > 16384 or not line.endswith(b"\n"):
            raise ValueError("Oversized native preview request")
        try:
            request = json.loads(line)
            result, verified = render_window(request, verified)
        except (OSError, ValueError, RuntimeError):
            verified = None
            result = {"error": "processing"}
        print(json.dumps(result, separators=(",", ":")), flush=True)


if __name__ == "__main__":
    main()
