"""Cuts the TuitionBook logo (assets/brand/logo-source.png) into the app icon set and the
pieces used by the animated splash. Run: python3 scripts/make-brand-assets.py"""
import json
from pathlib import Path
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'assets' / 'brand' / 'logo-source.png'
OUT = ROOT / 'assets'
SPL = OUT / 'splash'
SPL.mkdir(exist_ok=True)

im = np.asarray(Image.open(SRC).convert('RGB')).astype(np.float32)
bg = np.median(np.concatenate([im[:20, :20].reshape(-1, 3), im[-20:, -20:].reshape(-1, 3)]), axis=0)
dist = np.max(bg - im, axis=2)  # how far each pixel is from the (near-white) background
dist = np.maximum(dist, np.max(im - bg, axis=2) * 0)  # background is lighter than the art

def to_rgba(region):
    y0, y1, x0, x1 = region
    px = im[y0:y1, x0:x1]
    a = np.clip(dist[y0:y1, x0:x1] / 110.0, 0, 1)
    a[a < 0.04] = 0
    # undo the blend with the white background so edges are not light-fringed
    safe = np.maximum(a, 1e-3)[..., None]
    col = np.clip((px - (1 - safe) * bg) / safe, 0, 255)
    rgba = np.dstack([col, a * 255]).astype(np.uint8)
    return Image.fromarray(rgba, 'RGBA')

def bbox(region, thr=40):
    y0, y1, x0, x1 = region
    ys, xs = np.where(dist[y0:y1, x0:x1] > thr)
    return y0 + ys.min(), y0 + ys.max() + 1, x0 + xs.min(), x0 + xs.max() + 1

MARK = tuple(int(v) for v in bbox((150, 625, 400, 1150)))
WORD = tuple(int(v) for v in bbox((630, 800, 250, 1300)))
my0, my1, mx0, mx1 = MARK
mark = to_rgba(MARK)
mw, mh = mark.size
print('mark', MARK, mark.size, 'word', WORD)

# halves of the book, each on a full-size mark canvas so they stack exactly
# split where the T's stem is (its centre column)
col_has_art = dist[my0:my1, mx0:mx1].max(axis=0) > 40
stem = [i for i in range(mw) if not col_has_art[i] or (dist[my0 + int(mh * .55):my1 - 25, mx0 + i] < 40).all()]
cx = int(np.mean([i for i in stem if abs(i - mw / 2) < mw * 0.1])) if stem else mw // 2
left = mark.copy(); right = mark.copy()
ar = np.asarray(left).copy(); ar[:, cx:, 3] = 0; left = Image.fromarray(ar)
ar = np.asarray(right).copy(); ar[:, :cx, 3] = 0; right = Image.fromarray(ar)
left.save(SPL / 'page-left.png'); right.save(SPL / 'page-right.png'); mark.save(SPL / 'mark.png')

# wordmark: "Tuition" (navy) and "Book" (blue)
wy0, wy1, wx0, wx1 = WORD
colmask = dist[wy0:wy1, wx0:wx1].max(axis=0) > 40
# widest empty gap = the space between the words
gaps, start = [], None
for i, v in enumerate(colmask):
    if not v and start is None: start = i
    if v and start is not None: gaps.append((i - start, start)); start = None
g = max(gaps)
split = wx0 + g[1] + g[0] // 2
tu = to_rgba((wy0, wy1, wx0, split)); bk = to_rgba((wy0, wy1, split, wx1))
tu.save(SPL / 'word-tuition.png'); bk.save(SPL / 'word-book.png')
layout = {
    'mark': [mw, mh], 'tuition': list(tu.size), 'book': list(bk.size),
    'wordLeft': int(wx0 - mx0), 'wordTop': int(wy0 - my0), 'wordWidth': int(wx1 - wx0), 'wordHeight': int(wy1 - wy0),
    'bookLeft': int(split - wx0), 'stemCenter': int(cx),
}
(SPL / 'layout.json').write_text(json.dumps(layout, indent=1))
print(layout)

def place(canvas_px, width_px, bgcolor=None, silhouette=False):
    s = width_px / mw
    m = mark.resize((round(mw * s), round(mh * s)), Image.LANCZOS)
    if silhouette:
        a = np.asarray(m).copy(); a[..., :3] = 0; m = Image.fromarray(a)
    c = Image.new('RGBA', (canvas_px, canvas_px), bgcolor or (0, 0, 0, 0))
    c.alpha_composite(m, ((canvas_px - m.width) // 2, (canvas_px - m.height) // 2))
    return c

place(1024, 640, (255, 255, 255, 255)).convert('RGB').save(OUT / 'icon.png')
place(1024, 470).save(OUT / 'android-icon-foreground.png')
place(1024, 470, silhouette=True).save(OUT / 'android-icon-monochrome.png')
Image.new('RGB', (1024, 1024), (255, 255, 255)).save(OUT / 'android-icon-background.png')
place(256, 190, (255, 255, 255, 255)).convert('RGB').resize((196, 196), Image.LANCZOS).save(OUT / 'favicon.png')
Image.new('RGBA', (200, 200), (255, 255, 255, 0)).save(OUT / 'splash-icon.png')  # native splash is plain white
print('done')
