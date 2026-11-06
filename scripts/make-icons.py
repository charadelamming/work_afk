"""生成 Tauri 需要的应用图标（金色 ¥ / 深色圆角卡片）

用法：python scripts/make-icons.py
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "src-tauri" / "icons"
OUT.mkdir(parents=True, exist_ok=True)

SIZE = 512
BG_TOP = (32, 37, 54)
BG_BOTTOM = (11, 13, 20)
GOLD = (255, 200, 107)


def rounded_mask(size: int, radius: int) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=255)
    return mask


def build_icon(size: int) -> Image.Image:
    # 竖向渐变底
    gradient = Image.new("RGB", (1, size))
    for y in range(size):
        t = y / max(1, size - 1)
        gradient.putpixel(
            (0, y),
            (
                int(BG_TOP[0] + (BG_BOTTOM[0] - BG_TOP[0]) * t),
                int(BG_TOP[1] + (BG_BOTTOM[1] - BG_TOP[1]) * t),
                int(BG_TOP[2] + (BG_BOTTOM[2] - BG_TOP[2]) * t),
            ),
        )
    base = gradient.resize((size, size), Image.Resampling.BILINEAR).convert("RGBA")

    # 圆角 + 内描边
    mask = rounded_mask(size, int(size * 0.23))
    base.putalpha(mask)
    border = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    ImageDraw.Draw(border).rounded_rectangle(
        (1, 1, size - 2, size - 2),
        radius=int(size * 0.23),
        outline=(255, 255, 255, 34),
        width=max(1, size // 170),
    )
    base = Image.alpha_composite(base, border)

    # 金色 ¥
    font = None
    for candidate in ("C:/Windows/Fonts/msyhbd.ttc", "C:/Windows/Fonts/seguisb.ttf", "C:/Windows/Fonts/arialbd.ttf"):
        try:
            font = ImageFont.truetype(candidate, int(size * 0.6))
            break
        except OSError:
            continue
    if font is None:
        font = ImageFont.load_default()

    glyph_layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(glyph_layer)
    draw.text((size / 2, size * 0.53), "¥", font=font, fill=GOLD + (255,), anchor="mm")

    # 轻微辉光
    glow = glyph_layer.filter(ImageFilter.GaussianBlur(size * 0.03))
    glow.putalpha(glow.getchannel("A").point(lambda a: int(a * 0.55)))
    base = Image.alpha_composite(base, glow)
    base = Image.alpha_composite(base, glyph_layer)

    # 右上角薄荷色小亮点
    spark = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    sd = ImageDraw.Draw(spark)
    cx, cy, r = size * 0.74, size * 0.26, size * 0.045
    sd.ellipse((cx - r, cy - r, cx + r, cy + r), fill=(91, 227, 179, 220))
    base = Image.alpha_composite(base, spark.filter(ImageFilter.GaussianBlur(size * 0.008)))
    return base


def main() -> None:
    master = build_icon(1024)
    for size, name in ((32, "32x32.png"), (128, "128x128.png"), (256, "128x128@2x.png"), (512, "icon.png")):
        master.resize((size, size), Image.Resampling.LANCZOS).save(OUT / name)

    ico = OUT / "icon.ico"
    master.resize((256, 256), Image.Resampling.LANCZOS).save(
        ico, sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    )
    print("icons written to", OUT)


if __name__ == "__main__":
    main()
