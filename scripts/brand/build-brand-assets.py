#!/usr/bin/env python3
"""Regenerate brand assets (logo, favicon, PWA icons) from scripts/brand/logo-source.jpg.

Usage:
    pip install pillow
    python scripts/brand/build-brand-assets.py

Outputs (all committed, so a normal `pnpm build` never needs Python):
    apps/web/public/brand/logo.png          512  transparent mark (UI)
    apps/web/public/brand/logo-1024.png     1024 transparent mark (og:image)
    apps/web/public/favicon.ico             16/32/48/64/128/256
    apps/web/public/favicon-16.png
    apps/web/public/favicon-32.png
    apps/web/public/apple-touch-icon.png    180, opaque (iOS ignores alpha)
    apps/web/public/icons/icon-192.png      PWA "any"
    apps/web/public/icons/icon-512.png      PWA "any"
    apps/web/public/icons/maskable-512.png  PWA "maskable" (extra safe-zone padding)

Why the flood fill: the source JPG has a white background *plus* a soft
blue-grey drop shadow. A fixed "is it white?" threshold either eats the logo or
leaves a smudge, so we region-grow from the border in progressively bolder
passes: a pixel joins the background when its colour changes by at most `step`
per channel, and the FLOOR guard stops the fill from ever entering the
saturated blue outline. The white bubble interior is enclosed by that outline,
so it survives untouched.
"""

import os
from collections import deque

from PIL import Image, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
SRC = os.path.join(HERE, "logo-source.jpg")
OUT = os.path.join(ROOT, "apps", "web", "public")

FLOOR = 130
STEPS = (8, 16, 30, 55)

img = Image.open(SRC).convert("RGB")
W, H = img.size
print("source", img.size)

px = img.load()
visited = bytearray(W * H)
for x in range(W):
    visited[x] = 1
    visited[(H - 1) * W + x] = 1
for y in range(H):
    visited[y * W] = 1
    visited[y * W + W - 1] = 1


def grow(step):
    added = 0
    q = deque(i for i in range(W * H) if visited[i])
    while q:
        i = q.popleft()
        x, y = i % W, i // W
        here = px[x, y]
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < W and 0 <= ny < H:
                j = ny * W + nx
                if visited[j]:
                    continue
                cur = px[nx, ny]
                if min(cur) < FLOOR:
                    continue
                if max(abs(cur[0] - here[0]), abs(cur[1] - here[1]), abs(cur[2] - here[2])) <= step:
                    visited[j] = 1
                    q.append(j)
                    added += 1
    return added


for step in STEPS:
    print("grow step", step, "->", grow(step), "px")

alpha = Image.new("L", (W, H), 255)
ap = alpha.load()
for y in range(H):
    row = y * W
    for x in range(W):
        if visited[row + x]:
            ap[x, y] = 0

# Soften the cut-out edge, then pull the ramp back so the mark stays solid
# instead of showing a pale 1px rim on dark backgrounds.
alpha = alpha.filter(ImageFilter.GaussianBlur(1.2))
alpha = alpha.point(lambda v: 0 if v < 24 else min(255, int(((v - 24) / 231) ** 0.85 * 255)))

rgba = img.convert("RGBA")
rgba.putalpha(alpha)

bbox = rgba.getbbox()
print("bbox", bbox)
rgba = rgba.crop(bbox)


def square(im, pad_ratio):
    w, h = im.size
    side = max(w, h)
    pad = int(side * pad_ratio)
    canvas = Image.new("RGBA", (side + 2 * pad, side + 2 * pad), (0, 0, 0, 0))
    canvas.paste(im, ((canvas.width - w) // 2, (canvas.height - h) // 2), im)
    return canvas


def on_white(im, size, pad_ratio=0.0):
    sq = square(im, pad_ratio).resize((size, size), Image.LANCZOS)
    bg = Image.new("RGBA", (size, size), (255, 255, 255, 255))
    bg.alpha_composite(sq)
    return bg


mark = square(rgba, 0.05)  # transparent, tight-ish
os.makedirs(os.path.join(OUT, "brand"), exist_ok=True)
os.makedirs(os.path.join(OUT, "icons"), exist_ok=True)

mark.resize((512, 512), Image.LANCZOS).save(os.path.join(OUT, "brand", "logo.png"), optimize=True)
mark.resize((1024, 1024), Image.LANCZOS).save(os.path.join(OUT, "brand", "logo-1024.png"), optimize=True)

mark.resize((32, 32), Image.LANCZOS).save(os.path.join(OUT, "favicon-32.png"), optimize=True)
mark.resize((16, 16), Image.LANCZOS).save(os.path.join(OUT, "favicon-16.png"), optimize=True)

mark.resize((256, 256), Image.LANCZOS).save(
    os.path.join(OUT, "favicon.ico"),
    sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
)

on_white(rgba, 180, 0.10).convert("RGB").save(os.path.join(OUT, "apple-touch-icon.png"), optimize=True)
on_white(rgba, 192, 0.06).convert("RGB").save(os.path.join(OUT, "icons", "icon-192.png"), optimize=True)
on_white(rgba, 512, 0.06).convert("RGB").save(os.path.join(OUT, "icons", "icon-512.png"), optimize=True)
on_white(rgba, 512, 0.22).convert("RGB").save(
    os.path.join(OUT, "icons", "maskable-512.png"), optimize=True
)

for f in ("brand/logo.png", "favicon.ico", "apple-touch-icon.png", "icons/icon-512.png"):
    p = os.path.join(OUT, f)
    print(f, os.path.getsize(p), "bytes")
