#!/usr/bin/env python3
"""
Render social cards (1200x630) and app icons in the Amber Phosphor look.
Static assets: run when names/taglines change, commit the PNGs.

  python3 scripts/build-og.py

Fonts: Press Start 2P + JetBrains Mono (both SIL OFL), in scripts/fonts/.
Colours mirror theme.chakri.me/tokens.css v1.0.0.
"""
import json, pathlib
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = pathlib.Path(__file__).resolve().parent.parent
PUB = ROOT / "public"
FONTS = ROOT / "scripts" / "fonts"

BG, PANEL, BORDER = (0, 0, 0), (11, 11, 10), (43, 41, 37)
TEXT, MUTED, ACCENT, ACCENT_DIM, WARN = (236, 231, 218), (139, 133, 116), (255, 176, 0), (204, 138, 0), (255, 106, 43)
Y_FILL, B_FILL = (61, 42, 0), (28, 27, 23)

GAMES = json.loads((ROOT / "src" / "seo" / "games.json").read_text())


def pixel(size):
    return ImageFont.truetype(str(FONTS / "PressStart2P-Regular.ttf"), size)


def mono(size, weight="Bold"):
    f = ImageFont.truetype(str(FONTS / "JetBrainsMono.ttf"), size)
    try:
        f.set_variation_by_name(weight)
    except Exception:
        pass
    return f


def crt(w, h):
    """black canvas, faint scanlines, a warm vignette bloom top-left"""
    im = Image.new("RGB", (w, h), BG)
    glow = Image.new("RGB", (w, h), BG)
    gd = ImageDraw.Draw(glow)
    gd.ellipse([-w * 0.3, -h * 0.6, w * 0.7, h * 0.7], fill=(40, 26, 0))
    im = Image.blend(im, glow.filter(ImageFilter.GaussianBlur(160)), 1.0)
    d = ImageDraw.Draw(im)
    for y in range(0, h, 4):
        d.line([(0, y), (w, y)], fill=(0, 0, 0))
    return im


def glow_text(im, xy, text, font, fill=ACCENT, radius=14, strength=2):
    layer = Image.new("RGBA", im.size, (0, 0, 0, 0))
    ImageDraw.Draw(layer).text(xy, text, font=font, fill=fill + (255,))
    bloom = layer.filter(ImageFilter.GaussianBlur(radius))
    for _ in range(strength):
        im.paste(bloom, (0, 0), bloom)
    im.paste(layer, (0, 0), layer)


def tile(d, x, y, s, letter, kind):
    r = int(s * 0.12)
    if kind == "G":
        d.rounded_rectangle([x, y, x + s, y + s], r, fill=ACCENT)
        col = BG
    elif kind == "Y":
        d.rounded_rectangle([x, y, x + s, y + s], r, fill=Y_FILL, outline=ACCENT_DIM, width=max(3, s // 28))
        col = ACCENT
    elif kind == "B":
        d.rounded_rectangle([x, y, x + s, y + s], r, fill=B_FILL)
        col = TEXT
    else:  # empty / faded: dashed outline
        col = MUTED
        step = s // 8
        for k in range(0, s, step * 2):
            for (a, b) in [((x + k, y), (x + min(k + step, s), y)), ((x + k, y + s), (x + min(k + step, s), y + s))]:
                d.line([a, b], fill=MUTED, width=3)
            for (a, b) in [((x, y + k), (x, y + min(k + step, s))), ((x + s, y + k), (x + s, y + min(k + step, s)))]:
                d.line([a, b], fill=MUTED, width=3)
    f = mono(int(s * 0.52))
    if letter.strip():
        bb = d.textbbox((0, 0), letter.upper(), font=f)
        d.text((x + (s - (bb[2] - bb[0])) / 2 - bb[0], y + (s - (bb[3] - bb[1])) / 2 - bb[1]), letter.upper(), font=f, fill=col)


def wrap(d, text, font, width):
    words, lines, cur = text.split(), [], ""
    for w in words:
        t = (cur + " " + w).strip()
        if d.textlength(t, font=font) <= width:
            cur = t
        else:
            lines.append(cur)
            cur = w
    lines.append(cur)
    return lines


def card(name, tagline, word, kinds, out, eyebrow="> MANY WORDLES"):
    W, H = 1200, 630
    im = crt(W, H)
    d = ImageDraw.Draw(im)
    d.rectangle([24, 24, W - 25, H - 25], outline=BORDER, width=2)
    glow_text(im, (72, 72), eyebrow, pixel(22), ACCENT, 8, 1)
    big = pixel(76 if len(name) <= 9 else 58)
    glow_text(im, (72, 148), name.upper(), big, ACCENT, 18, 2)
    d = ImageDraw.Draw(im)
    f = mono(36, "Medium")
    for i, line in enumerate(wrap(d, tagline, f, 1040)[:3]):
        d.text((72, 270 + i * 50), line, font=f, fill=TEXT)
    s, gap = 104, 14
    for i, (ch, k) in enumerate(zip(word, kinds)):
        tile(d, 72 + i * (s + gap), 440, s, ch, k)
    foot = mono(26, "Regular")
    t = "a new puzzle every day"
    d.text((W - 72 - d.textlength(t, font=foot), 520), t, font=foot, fill=MUTED)
    im.save(out, optimize=True)


def icon(size, pad_frac, out, rounded=True):
    im = Image.new("RGB", (size, size), BG)
    d = ImageDraw.Draw(im)
    pad = size * pad_frac
    g = size * 0.06
    s = (size - 2 * pad - g) / 2
    kinds = [("G", 0, 0), ("Y", 1, 0), ("faded", 0, 1), ("B", 1, 1)]
    for k, cx, cy in kinds:
        x, y = pad + cx * (s + g), pad + cy * (s + g)
        tile(d, int(x), int(y), int(s), " ", k)
    im.save(out, optimize=True)


def main():
    (PUB / "og").mkdir(exist_ok=True)
    (PUB / "icons").mkdir(exist_ok=True)
    card("Many Wordles", "Daily word games, each a twist on the classic. One puzzle each, same for everyone.", "many", ["G", "Y", "B", "G"], PUB / "og" / "home.png", "> DAILY PUZZLES")
    for g in GAMES:
        card(g["name"], g["tagline"], g["word"], g["kinds"], PUB / "og" / f"{g['id']}.png")
    icon(32, 0.08, PUB / "icons" / "favicon-32.png")
    icon(180, 0.14, PUB / "icons" / "apple-touch-icon.png")
    icon(192, 0.14, PUB / "icons" / "icon-192.png")
    icon(512, 0.14, PUB / "icons" / "icon-512.png")
    icon(512, 0.24, PUB / "icons" / "maskable-512.png")  # safe zone for Android masks
    print("ok:", len(GAMES) + 1, "cards")


if __name__ == "__main__":
    main()
