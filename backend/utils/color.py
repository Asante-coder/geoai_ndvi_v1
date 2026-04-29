import numpy as np
from matplotlib.colors import LinearSegmentedColormap

NDVI_COLORS = [
    (-1.0, "#8B4513"),
    (-0.1, "#C8A87D"),
    ( 0.0, "#FFFF99"),
    ( 0.2, "#ADDD8E"),
    ( 0.4, "#41AB5D"),
    ( 0.6, "#238B45"),
    ( 1.0, "#004529"),
]


def ndvi_colormap() -> LinearSegmentedColormap:
    positions  = [c[0] for c in NDVI_COLORS]
    hex_colors = [c[1] for c in NDVI_COLORS]
    norm_pos   = [(p + 1) / 2 for p in positions]
    return LinearSegmentedColormap.from_list("ndvi", list(zip(norm_pos, hex_colors)))
