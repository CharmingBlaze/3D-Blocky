"""Generate Quadlo app icons — letter Q inside a lined box (dark CAD mark)."""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

SIZE = 1024
ROOT = Path(__file__).resolve().parents[1]
OUT_PNG = ROOT / "build" / "appicon.png"
OUT_ICO = ROOT / "build" / "windows" / "icon.ico"
PUBLIC = ROOT / "public"
OUT_FAVICON = PUBLIC / "favicon.png"
OUT_APPLE = PUBLIC / "apple-touch-icon.png"
OUT_BRAND = PUBLIC / "brand-mark.png"

# Dark CAD palette — high contrast, no glow
BG = (18, 18, 20)
FRAME = (232, 232, 236)
Q_FILL = (248, 248, 250)
INSET = (28, 28, 32)


def rounded_rect_mask(size: int, radius: int) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=255)
    return mask


def load_font(size: int) -> ImageFont.ImageFont | ImageFont.FreeTypeFont:
    candidates = [
        "C:/Windows/Fonts/segoeuib.ttf",
        "C:/Windows/Fonts/arialbd.ttf",
        "C:/Windows/Fonts/consolab.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    ]
    for path in candidates:
        try:
            return ImageFont.truetype(path, size=size)
        except OSError:
            continue
    return ImageFont.load_default()


def draw_lined_box(draw: ImageDraw.ImageDraw, pad: int, stroke: int) -> None:
    """Outer frame with a second inner stroke — reads as a lined box at any size."""
    draw.rectangle(
        (pad, pad, SIZE - pad - 1, SIZE - pad - 1),
        outline=FRAME,
        width=stroke,
    )
    gap = max(stroke + 10, int(stroke * 1.35))
    inner = pad + gap
    inner_stroke = max(6, stroke // 2)
    draw.rectangle(
        (inner, inner, SIZE - inner - 1, SIZE - inner - 1),
        outline=FRAME,
        width=inner_stroke,
    )


def render_mark() -> Image.Image:
    img = Image.new("RGB", (SIZE, SIZE), BG)
    draw = ImageDraw.Draw(img)

    panel_pad = 72
    draw.rounded_rectangle(
        (panel_pad, panel_pad, SIZE - panel_pad - 1, SIZE - panel_pad - 1),
        radius=48,
        fill=INSET,
    )

    pad = 118
    stroke = 28
    draw_lined_box(draw, pad=pad, stroke=stroke)

    font = load_font(560)
    text = "Q"
    bbox = draw.textbbox((0, 0), text, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    tx = (SIZE - tw) / 2 - bbox[0]
    ty = (SIZE - th) / 2 - bbox[1] - 28
    draw.text((tx, ty), text, font=font, fill=Q_FILL)

    mask = rounded_rect_mask(SIZE, 200)
    framed = Image.new("RGB", (SIZE, SIZE), BG)
    framed.paste(img, (0, 0), mask)
    return framed


def main() -> None:
    framed = render_mark()
    OUT_PNG.parent.mkdir(parents=True, exist_ok=True)
    framed.save(OUT_PNG, "PNG", optimize=True)
    print(f"Wrote {OUT_PNG} ({SIZE}x{SIZE})")

    OUT_ICO.parent.mkdir(parents=True, exist_ok=True)
    rgba = framed.convert("RGBA")
    rgba.save(
        OUT_ICO,
        format="ICO",
        sizes=[(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)],
    )
    print(f"Wrote {OUT_ICO}")

    PUBLIC.mkdir(parents=True, exist_ok=True)
    rgba.resize((32, 32), Image.Resampling.LANCZOS).save(OUT_FAVICON, "PNG", optimize=True)
    rgba.resize((180, 180), Image.Resampling.LANCZOS).save(OUT_APPLE, "PNG", optimize=True)
    rgba.resize((64, 64), Image.Resampling.LANCZOS).save(OUT_BRAND, "PNG", optimize=True)
    print(f"Wrote {OUT_FAVICON}, {OUT_APPLE}, {OUT_BRAND}")


if __name__ == "__main__":
    main()
