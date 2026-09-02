#!/usr/bin/env python3
"""
Generates every raster icon this app ships, so the marks live in version control
as code rather than as opaque binaries nobody can edit.

    python3 scripts/generate-icons.py

The mark is an uplink: a solid core at lower-left with three broadcast arcs
radiating north-east, crossed by a tilted orbital ring. Two accents only —
lime for the signal, cyan for the orbit.

Design notes: arc weights step down as they move outward and every stroke has a
round cap (Apple's optical refinement), while the construction itself is strict
geometry on a fixed grid with flat, confident colour (Material's clarity).

Requires Pillow.
"""

from __future__ import annotations

import math
import os
from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(__file__), "..", "assets", "images")

VOID = (8, 9, 11, 255)
VOID_HI = (17, 21, 28, 255)
SIGNAL = (198, 242, 78, 255)
COOL = (78, 200, 242, 255)
WHITE = (255, 255, 255, 255)

# Supersample factor. PIL has no anti-aliased primitives, so everything is drawn
# large and reduced with LANCZOS.
SS = 4
BASE = 1024
S = BASE * SS


def vertical_gradient(size: int, top: tuple, bottom: tuple) -> Image.Image:
    grad = Image.new("RGBA", (1, size))
    px = grad.load()
    for y in range(size):
        t = y / max(1, size - 1)
        px[0, y] = tuple(round(top[i] + (bottom[i] - top[i]) * t) for i in range(4))
    return grad.resize((size, size), Image.NEAREST)


def stamp_arc(draw, cx, cy, rx, ry, a0, a1, width, fill, rot_deg=0.0):
    """Strokes an arc by stamping circles along it.

    PIL's arc() leaves square ends and cannot rotate, so instead of fighting it
    we walk the parametric path. Every stamp is a disc, which gives genuine round
    caps and a constant stroke weight even on a rotated ellipse.
    """
    span = abs(a1 - a0)
    steps = max(96, int(max(rx, ry) * math.radians(span) / 1.2))
    r = width / 2
    cos_r, sin_r = math.cos(math.radians(rot_deg)), math.sin(math.radians(rot_deg))

    for i in range(steps + 1):
        a = math.radians(a0 + (a1 - a0) * i / steps)
        x, y = rx * math.cos(a), ry * math.sin(a)
        if rot_deg:
            x, y = x * cos_r - y * sin_r, x * sin_r + y * cos_r
        px, py = cx + x, cy + y
        draw.ellipse((px - r, py - r, px + r, py + r), fill=fill)


def center_on_alpha(img: Image.Image) -> Image.Image:
    """Re-centres a mark on its own ink rather than its construction grid, so the
    icon sits optically centred whatever the geometry does."""
    bbox = img.getbbox()
    if not bbox:
        return img
    ink = img.crop(bbox)
    out = Image.new("RGBA", img.size, (0, 0, 0, 0))
    out.alpha_composite(ink, ((img.width - ink.width) // 2, (img.height - ink.height) // 2))
    return out


def draw_mark(size: int, signal=SIGNAL, cool=COOL, mono: bool = False) -> Image.Image:
    """The uplink mark on a transparent ground, sized to `size`."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    ring_layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    rd = ImageDraw.Draw(ring_layer)

    sig = WHITE if mono else signal
    orb = WHITE if mono else cool

    ox, oy = size * 0.30, size * 0.70

    # Three arcs sweeping the north-east quadrant. Weight steps down as radius
    # grows, so the mark reads as emission rather than concentric rings.
    for radius_f, width_f in ((0.21, 0.082), (0.37, 0.067), (0.53, 0.053)):
        stamp_arc(d, ox, oy, size * radius_f, size * radius_f, -78, -4, size * width_f, sig)

    cr = size * 0.065
    d.ellipse((ox - cr, oy - cr, ox + cr, oy + cr), fill=sig)

    # Tilted orbital ring, stamped directly at its rotation.
    stamp_arc(
        rd, size * 0.50, size * 0.46, size * 0.40, size * 0.168,
        0, 360, size * 0.042, orb, rot_deg=-26,
    )

    # Ring under the signal: where they cross, the lime stays dominant.
    return center_on_alpha(Image.alpha_composite(ring_layer, img))


def save(img: Image.Image, name: str, size: int):
    img.resize((size, size), Image.LANCZOS).save(os.path.join(OUT, name))
    print(f"  {name}  {size}x{size}")


def main():
    os.makedirs(OUT, exist_ok=True)
    print("generating icons")

    # iOS / general app icon: full bleed, mark inset to Apple's optical margin.
    ground = vertical_gradient(S, VOID_HI, VOID)
    mark = draw_mark(round(S * 0.66))
    icon = ground.copy()
    off = (S - mark.width) // 2
    icon.alpha_composite(mark, (off, off))
    save(icon, "icon.png", BASE)
    save(icon, "favicon.png", 196)

    # Android adaptive icon: background and foreground ship separately, and the
    # launcher may crop to a circle — content must stay inside the middle ~66%.
    save(vertical_gradient(S, VOID_HI, VOID), "android-icon-background.png", BASE)

    fg = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    safe = draw_mark(round(S * 0.52))
    fg.alpha_composite(safe, ((S - safe.width) // 2, (S - safe.width) // 2))
    save(fg, "android-icon-foreground.png", BASE)

    # Themed (monochrome) icon: silhouette only, the launcher applies its tint.
    mono = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    mono_mark = draw_mark(round(S * 0.52), mono=True)
    mono.alpha_composite(mono_mark, ((S - mono_mark.width) // 2, (S - mono_mark.width) // 2))
    save(mono, "android-icon-monochrome.png", BASE)

    # Splash: transparent, sits on the app ground colour set in app.json.
    splash = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    sm = draw_mark(round(S * 0.86))
    splash.alpha_composite(sm, ((S - sm.width) // 2, (S - sm.width) // 2))
    save(splash, "splash-icon.png", 512)

    print("done")


if __name__ == "__main__":
    main()
