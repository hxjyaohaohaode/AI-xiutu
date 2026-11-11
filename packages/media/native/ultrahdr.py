"""Decode JPEG gain maps through the optional reference libultrahdr C API."""

import ctypes as c
from pathlib import Path

import numpy as np
from color_space import GAMUT_NAMES, linear_rec709


RGBA_HALF_FLOAT = 4
LINEAR_TRANSFER = 0


class DecodeStatus(c.Structure):
    _fields_ = [("code", c.c_int), ("has_detail", c.c_int), ("detail", c.c_char * 256)]


class CompressedImage(c.Structure):
    _fields_ = [("data", c.c_void_p), ("size", c.c_size_t), ("capacity", c.c_size_t),
                ("gamut", c.c_int), ("transfer", c.c_int), ("range", c.c_int)]


class RawImage(c.Structure):
    _fields_ = [("format", c.c_int), ("gamut", c.c_int), ("transfer", c.c_int), ("range", c.c_int),
                ("width", c.c_uint), ("height", c.c_uint), ("planes", c.c_void_p * 3),
                ("strides", c.c_uint * 3)]


def bind_codec(path):
    codec = c.CDLL(path)
    decoder = c.c_void_p
    signatures = {
        "create_decoder": (decoder, ()),
        "release_decoder": (None, (decoder,)),
        "dec_set_image": (DecodeStatus, (decoder, c.POINTER(CompressedImage))),
        "dec_set_out_img_format": (DecodeStatus, (decoder, c.c_int)),
        "dec_set_out_color_transfer": (DecodeStatus, (decoder, c.c_int)),
        "dec_probe": (DecodeStatus, (decoder,)),
        "dec_get_image_width": (c.c_int, (decoder,)),
        "dec_get_image_height": (c.c_int, (decoder,)),
        "dec_get_gainmap_width": (c.c_int, (decoder,)),
        "dec_get_gainmap_height": (c.c_int, (decoder,)),
        "decode": (DecodeStatus, (decoder,)),
        "get_decoded_image": (c.POINTER(RawImage), (decoder,)),
    }
    for name, (result, args) in signatures.items():
        fn = getattr(codec, "uhdr_" + name)
        fn.argtypes = args
        fn.restype = result
    return codec


def require_ok(result):
    if result.code:
        raise ValueError(f"Ultra HDR decoder rejected the gain map (status {result.code})")


def decode_gain_map(source, library, admit):
    size = Path(source).stat().st_size
    if not 1 <= size <= 128 * 1024**2:
        raise ValueError("Ultra HDR input exceeds the compressed byte budget")
    data = np.memmap(source, dtype=np.uint8, mode="r")
    packed = CompressedImage(data.ctypes.data, size, size, -1, -1, -1)
    codec = bind_codec(library)
    decoder = codec.uhdr_create_decoder()
    if not decoder:
        raise RuntimeError("Cannot initialize Ultra HDR decoder")
    try:
        require_ok(codec.uhdr_dec_set_image(decoder, c.byref(packed)))
        require_ok(codec.uhdr_dec_set_out_img_format(decoder, RGBA_HALF_FLOAT))
        require_ok(codec.uhdr_dec_set_out_color_transfer(decoder, LINEAR_TRANSFER))
        require_ok(codec.uhdr_dec_probe(decoder))
        width = codec.uhdr_dec_get_image_width(decoder)
        height = codec.uhdr_dec_get_image_height(decoder)
        gain_width = codec.uhdr_dec_get_gainmap_width(decoder)
        gain_height = codec.uhdr_dec_get_gainmap_height(decoder)
        admit(width, height)
        if not (0 < gain_width <= width and 0 < gain_height <= height):
            raise ValueError("Ultra HDR gain map dimensions exceed the base image")
        require_ok(codec.uhdr_decode(decoder))
        decoded = codec.uhdr_get_decoded_image(decoder)
        if not decoded:
            raise ValueError("Ultra HDR decoder returned no samples")
        info = decoded.contents
        if (info.format != RGBA_HALF_FLOAT or info.transfer != LINEAR_TRANSFER or
                info.gamut not in GAMUT_NAMES or (info.width, info.height) != (width, height) or
                not width <= info.strides[0] <= width + 256 or not info.planes[0]):
            raise ValueError("Ultra HDR decoder returned an unsupported raster layout")
        source_words = (c.c_uint16 * (height * info.strides[0] * 4)).from_address(info.planes[0])
        rgba = np.ctypeslib.as_array(source_words).view("<f2").reshape(height, info.strides[0], 4)
        return rgba[:, :width, :3].copy(), info.gamut, (gain_width, gain_height)
    finally:
        codec.uhdr_release_decoder(decoder)


def orient(pixels, orientation):
    if orientation in (2, 3, 4):
        return pixels[:: -1 if orientation in (3, 4) else 1, :: -1 if orientation in (2, 3) else 1]
    if orientation in (5, 6, 7, 8):
        return pixels.swapaxes(0, 1)[:: -1 if orientation in (7, 8) else 1,
                                     :: -1 if orientation in (6, 7) else 1]
    return pixels
