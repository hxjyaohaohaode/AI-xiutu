"""Linear D65 RGB transforms shared by retained display HDR sources."""

import numpy as np


GAMUT_NAMES = {0: "Rec.709", 1: "Display P3", 2: "Rec.2020"}
TO_REC709 = {
    1: np.array([[1.22494018, -0.22494018, 0], [-0.04205695, 1.04205695, 0],
                 [-0.01963755, -0.07863605, 1.09827360]], dtype=np.float32),
    2: np.array([[1.66049100, -0.58764114, -0.07284986], [-0.12455047, 1.13289990, -0.00834942],
                 [-0.01815076, -0.10057890, 1.11872966]], dtype=np.float32),
}


def linear_rec709(band, gamut):
    linear = band.astype(np.float32, copy=False)
    if not np.all(np.isfinite(linear)):
        raise ValueError("HDR decoder produced non-finite samples")
    return linear if gamut == 0 else linear @ TO_REC709[gamut].T
