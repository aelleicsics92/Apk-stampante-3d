# Genera icone e splash di Spoolio (richiede Pillow). Uso: python3 scripts/make_icons.py
import os, glob
from PIL import Image, ImageDraw
RES = 'android/app/src/main/res'
def grad(w, h):
    img = Image.new('RGB', (w, h)); px = img.load()
    c1, c2 = (16, 185, 129), (99, 102, 241)
    for y in range(h):
        for x in range(w):
            t = (x + y) / (w + h); px[x, y] = tuple(int(c1[i] + (c2[i] - c1[i]) * t) for i in range(3))
    return img
def logo(size, scale=1.0):
    S = size * 4; im = Image.new('RGBA', (S, S), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    c = S / 2; R = S * 0.30 * scale
    d.ellipse([c - R, c - R, c + R, c + R], outline='white', width=int(S * 0.075 * scale))
    r = R * 0.38; d.ellipse([c - r, c - r, c + r, c + r], fill='white')
    # tre fori
    import math
    for a in (90, 210, 330):
        x = c + R * 0.68 * math.cos(math.radians(a)); y = c + R * 0.68 * math.sin(math.radians(a)); q = R * 0.09
        d.ellipse([x - q, y - q, x + q, y + q], fill='white')
    return im.resize((size, size), Image.LANCZOS)
dens = {'mdpi': (48, 108), 'hdpi': (72, 162), 'xhdpi': (96, 216), 'xxhdpi': (144, 324), 'xxxhdpi': (192, 432)}
for k, (leg, fg) in dens.items():
    d = f'{RES}/mipmap-{k}'
    os.makedirs(d, exist_ok=True)
    f = logo(fg, 0.78); f.save(f'{d}/ic_launcher_foreground.png')
    base = grad(leg, leg).convert('RGBA'); base.alpha_composite(logo(leg, 1.15))
    m = Image.new('L', (leg * 4, leg * 4), 0); ImageDraw.Draw(m).rounded_rectangle([0, 0, leg * 4 - 1, leg * 4 - 1], leg * 0.22 * 4, fill=255)
    sq = base.copy(); sq.putalpha(m.resize((leg, leg), Image.LANCZOS)); sq.save(f'{d}/ic_launcher.png')
    rm = Image.new('L', (leg * 4, leg * 4), 0); ImageDraw.Draw(rm).ellipse([0, 0, leg * 4 - 1, leg * 4 - 1], fill=255)
    rd = base.copy(); rd.putalpha(rm.resize((leg, leg), Image.LANCZOS)); rd.save(f'{d}/ic_launcher_round.png')
open(f'{RES}/values/ic_launcher_background.xml', 'w').write('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#10B981</color>\n</resources>\n')
for p in glob.glob(f'{RES}/drawable*/splash.png'):
    w, h = Image.open(p).size; im = grad(w, h).convert('RGBA'); L = int(min(w, h) * 0.34)
    im.alpha_composite(logo(L, 1.0), ((w - L) // 2, (h - L) // 2)); im.convert('RGB').save(p)
print('icone ok')
