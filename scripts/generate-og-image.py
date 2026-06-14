"""Gera og-image.png (1200x630) para preview em WhatsApp / Open Graph."""
import math
import urllib.request
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "og-image.png"
EARTH_URL = "https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg"
W, H = 1200, 630


def load_font(size, bold=False):
    candidates = [
        "C:/Windows/Fonts/Orbitron-Bold.ttf" if bold else "C:/Windows/Fonts/Orbitron-Regular.ttf",
        "C:/Windows/Fonts/arialbd.ttf" if bold else "C:/Windows/Fonts/arial.ttf",
        "C:/Windows/Fonts/segoeui.ttf",
    ]
    for path in candidates:
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default()


def main():
    bg = Image.new("RGB", (W, H), (2, 8, 14))
    draw = ImageDraw.Draw(bg)

    for y in range(H):
        t = y / H
        c = int(6 + t * 8)
        draw.line([(0, y), (W, y)], fill=(c, c + 12, c + 18))

    for i in range(0, W, 46):
        draw.line([(i, 0), (i, H)], fill=(70, 230, 255, 18))
    for j in range(0, H, 46):
        draw.line([(0, j), (W, j)], fill=(70, 230, 255, 18))

    try:
        with urllib.request.urlopen(EARTH_URL, timeout=30) as resp:
            earth = Image.open(BytesIO(resp.read())).convert("RGBA")
    except Exception:
        earth = Image.new("RGBA", (512, 512), (20, 80, 120, 255))

    size = 420
    earth = earth.resize((size, size), Image.Resampling.LANCZOS)
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, size, size), fill=255)
    earth.putalpha(mask)

    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    gdraw = ImageDraw.Draw(glow)
    cx, cy = W // 2 + 120, H // 2 + 10
    for r, alpha in [(240, 30), (210, 45), (180, 70)]:
        gdraw.ellipse((cx - r, cy - r, cx + r, cy + r), fill=(70, 230, 255, alpha))
    glow = glow.filter(ImageFilter.GaussianBlur(18))
    bg = Image.alpha_composite(bg.convert("RGBA"), glow)

    bg.paste(earth, (cx - size // 2, cy - size // 2), earth)
    draw = ImageDraw.Draw(bg)

    title_font = load_font(52, bold=True)
    sub_font = load_font(24)
    tag_font = load_font(18)

    draw.text((60, 90), "GLOBO INTERATIVO", fill=(70, 230, 255), font=title_font)
    draw.text((60, 165), "Explore o planeta Terra em tempo real", fill=(154, 243, 255), font=sub_font)
    draw.text(
        (60, 210),
        "Geografia · Fusos horários · Cabos submarinos · Dossiês por país",
        fill=(120, 190, 210),
        font=tag_font,
    )

    draw.rounded_rectangle((58, 260, 520, 310), radius=8, outline=(255, 180, 84), width=2)
    draw.text((78, 272), "Ferramenta digital didática · BNCC Geografia", fill=(255, 180, 84), font=tag_font)

    draw.line([(60, 340), (540, 340)], fill=(70, 230, 255, 120), width=1)
    draw.text((60, 360), "globo.educar.workers.dev", fill=(93, 255, 155), font=sub_font)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    bg.convert("RGB").save(OUT, "PNG", optimize=True)
    print(f"Saved {OUT} ({OUT.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
