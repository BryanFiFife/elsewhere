"""Generate ELSEWHERE icon set and OG card. Deterministic, no network."""
import math, random, os
from PIL import Image, ImageDraw, ImageFont, ImageFilter

OUT = r"C:\Users\bryan\Desktop\Projects\Elsewhere\site\assets\img"
os.makedirs(OUT, exist_ok=True)

INK   = (6, 7, 10)
ACID  = (216, 255, 62)
TEXT  = (233, 231, 224)
MUTED = (141, 140, 133)
DIM   = (93, 93, 88)

BOLD = r"C:\Windows\Fonts\segoeuib.ttf"
REG  = r"C:\Windows\Fonts\segoeui.ttf"
MONO = r"C:\Windows\Fonts\consola.ttf"
MONOB= r"C:\Windows\Fonts\consolab.ttf"


def tracked(draw, xy, text, font, fill, tracking=0.0):
    x, y = xy
    for ch in text:
        draw.text((x, y), ch, font=font, fill=fill)
        x += draw.textlength(ch, font=font) + tracking
    return x


def tracked_width(draw, text, font, tracking=0.0):
    w = sum(draw.textlength(c, font=font) for c in text)
    return w + tracking * max(0, len(text) - 1)


def icon(size, maskable=False):
    S = size * 4
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    if maskable:
        d.rectangle([0, 0, S, S], fill=INK + (255,))
        scale = 0.78
    else:
        d.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.225), fill=INK + (255,))
        scale = 1.0

    cx = cy = S / 2
    r1 = S * 0.255 * scale
    d.ellipse([cx - r1, cy - r1, cx + r1, cy + r1],
              outline=ACID + (255,), width=max(2, int(S * 0.042 * scale)))
    r2 = S * 0.095 * scale
    d.ellipse([cx - r2, cy - r2, cx + r2, cy + r2],
              outline=ACID + (255,), width=max(2, int(S * 0.030 * scale)))
    rd = S * 0.038 * scale
    d.ellipse([cx - rd, cy - rd, cx + rd, cy + rd], fill=ACID + (255,))

    return img.resize((size, size), Image.LANCZOS)


def og():
    W, H = 1200, 630
    S = 2
    img = Image.new("RGB", (W * S, H * S), INK)
    d = ImageDraw.Draw(img)

    # faint radial bloom behind the graphic
    glow = Image.new("RGB", (W * S, H * S), INK)
    gd = ImageDraw.Draw(glow)
    for i in range(26, 0, -1):
        f = i / 26.0
        rr = int(420 * S * f)
        shade = int(6 + 16 * (1 - f) ** 2)
        gd.ellipse([W * S * 0.76 - rr, H * S * 0.5 - rr,
                    W * S * 0.76 + rr, H * S * 0.5 + rr],
                   fill=(shade, int(shade * 1.03), int(shade * 0.55)))
    img = Image.blend(img, glow.filter(ImageFilter.GaussianBlur(40 * S)), 0.9)
    d = ImageDraw.Draw(img)

    # scatter field
    rnd = random.Random(20261112)
    cx, cy = W * S * 0.775, H * S * 0.5
    for _ in range(1400):
        a = rnd.random() * math.tau
        r = math.sqrt(rnd.random()) * 250 * S
        x, y = cx + math.cos(a) * r, cy + math.sin(a) * r
        v = rnd.random()
        col = (34, 38, 30) if v < 0.88 else (58, 66, 44)
        rr = 1.1 * S if v < 0.97 else 1.9 * S
        d.ellipse([x - rr, y - rr, x + rr, y + rr], fill=col)

    # the anomaly
    ax, ay = cx + 62 * S, cy - 78 * S
    for i in range(16, 0, -1):
        f = i / 16.0
        rr = (86 * f) * S
        c = int(12 + 120 * (1 - f) ** 2)
        d.ellipse([ax - rr, ay - rr, ax + rr, ay + rr], fill=(c // 6, c, c // 4))

    d.ellipse([ax - 9 * S, ay - 9 * S, ax + 9 * S, ay + 9 * S], fill=ACID)
    d.ellipse([ax - 52 * S, ay - 52 * S, ax + 52 * S, ay + 52 * S],
              outline=(216, 255, 62), width=int(1.6 * S))
    d.ellipse([ax - 120 * S, ay - 120 * S, ax + 120 * S, ay + 120 * S],
              outline=(66, 74, 52), width=int(1.2 * S))

    # crosshair on the anomaly
    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        d.line([ax + dx * 20 * S, ay + dy * 20 * S,
                ax + dx * 34 * S, ay + dy * 34 * S],
               fill=ACID, width=int(1.2 * S))

    # type block
    f_logo = ImageFont.truetype(BOLD, int(64 * S))
    f_head = ImageFont.truetype(BOLD, int(46 * S))
    f_body = ImageFont.truetype(REG, int(25 * S))
    f_mono = ImageFont.truetype(MONO, int(17 * S))
    f_monob = ImageFont.truetype(MONOB, int(15 * S))

    x0 = 84 * S
    tracked(d, (x0, 92 * S), "ELSEWHERE", f_logo, TEXT, 7 * S)

    # rule
    d.line([x0, 196 * S, x0 + 78 * S, 196 * S], fill=ACID, width=int(2 * S))

    d.text((x0, 232 * S), "Random points,", font=f_head, fill=TEXT)
    d.text((x0, 288 * S), "real places.", font=f_head, fill=TEXT)

    d.text((x0, 372 * S), "42,000 points. One statistical outlier.", font=f_body, fill=MUTED)
    d.text((x0, 408 * S), "Then you go and look at it properly.", font=f_body, fill=MUTED)

    tracked(d, (x0, 500 * S), "FREE  ·  OPEN SOURCE  ·  RUNS IN YOUR BROWSER",
            f_monob, DIM, 1.6 * S)

    d.text((x0, 556 * S), "elsewhere-point.pages.dev", font=f_mono, fill=(110, 130, 60))

    return img.resize((W, H), Image.LANCZOS)


icon(192).save(os.path.join(OUT, "icon-192.png"), optimize=True)
icon(512).save(os.path.join(OUT, "icon-512.png"), optimize=True)
icon(512, maskable=True).save(os.path.join(OUT, "icon-maskable-512.png"), optimize=True)
icon(180).save(os.path.join(OUT, "apple-touch-icon.png"), optimize=True)
og().save(os.path.join(OUT, "og.png"), optimize=True)

for f in sorted(os.listdir(OUT)):
    p = os.path.join(OUT, f)
    print(f"{f:28s} {os.path.getsize(p):>8,} bytes")
