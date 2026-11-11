"""OpenEXR geometry shared by the retained master and graded float output."""
import math


WINDOW_FIELDS = ("x", "y", "full_x", "full_y", "full_width", "full_height")


def capture_layout(spec):
    aspect = spec.getattribute("PixelAspectRatio")
    aspect = 1.0 if aspect is None else float(aspect)
    if spec.full_width < 1 or spec.full_height < 1 or not math.isfinite(aspect) or aspect <= 0:
        raise ValueError("Invalid HDR display window or pixel aspect ratio")
    return tuple(getattr(spec, field) for field in WINDOW_FIELDS), aspect


def apply_layout(spec, layout):
    window, aspect = layout
    for field, value in zip(WINDOW_FIELDS, window):
        setattr(spec, field, value)
    spec.attribute("PixelAspectRatio", aspect)
