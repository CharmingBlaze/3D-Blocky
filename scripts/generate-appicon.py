"""Generate build/appicon.png — isometric voxel logo, NES palette."""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

SIZE = 1024
OUT = Path(__file__).resolve().parents[1] / "build" / "appicon.png"

BG = (28, 28, 30)
BG_EDGE = (18, 18, 20)
OUTLINE = (12, 12, 14)
RED = (228, 0, 32)
RED_L = (255, 48, 64)
RED_D = (148, 0, 20)
BLUE = (0, 120, 248)
BLUE_L = (72, 168, 255)
BLUE_D = (0, 72, 168)
YELLOW = (248, 184, 0)
YELLOW_L = (255, 220, 72)
YELLOW_D = (184, 128, 0)


def rounded_rect_mask(size: int, radius: int) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=255)
    return mask


def iso_face(
    draw: ImageDraw.ImageDraw,
    origin: tuple[float, float],
    tile_w: float,
    tile_h: float,
    face: str,
    fill: tuple[int, int, int],
) -> list[tuple[float, float]]:
    ox, oy = origin
    hw, hh = tile_w / 2, tile_h / 2
    if face == "top":
        pts = [(ox, oy - hh), (ox + hw, oy), (ox, oy + hh), (ox - hw, oy)]
    elif face == "left":
        pts = [(ox - hw, oy), (ox, oy + hh), (ox, oy + hh + tile_h), (ox - hw, oy + tile_h)]
    else:
        pts = [(ox + hw, oy), (ox, oy + hh), (ox, oy + hh + tile_h), (ox + hw, oy + tile_h)]
    draw.polygon(pts, fill=fill)
    return pts


def outline_face(
    draw: ImageDraw.ImageDraw,
    pts: list[tuple[float, float]],
    width: int = 10,
) -> None:
    draw.line(pts + [pts[0]], fill=OUTLINE, width=width, joint="curve")


def draw_voxel(
    draw: ImageDraw.ImageDraw,
    cx: float,
    cy: float,
    tile_w: float,
    tile_h: float,
    top: tuple[int, int, int],
    left: tuple[int, int, int],
    right: tuple[int, int, int],
) -> None:
    left_pts = iso_face(draw, (cx, cy), tile_w, tile_h, "left", left)
    right_pts = iso_face(draw, (cx, cy), tile_w, tile_h, "right", right)
    top_pts = iso_face(draw, (cx, cy), tile_w, tile_h, "top", top)
    outline_face(draw, left_pts)
    outline_face(draw, right_pts)
    outline_face(draw, top_pts)


def add_top_shine(img: Image.Image, cx: float, cy: float, tile_w: float, tile_h: float) -> None:
    overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    hw, hh = tile_w / 2, tile_h / 2
    od.polygon(
        [
            (cx - hw * 0.55, cy - hh * 0.35),
            (cx - hw * 0.05, cy - hh * 0.75),
            (cx + hw * 0.15, cy - hh * 0.45),
            (cx - hw * 0.15, cy - hh * 0.05),
        ],
        fill=(255, 255, 255, 55),
    )
    img.alpha_composite(overlay)


def main() -> None:
    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    base = Image.new("RGB", (SIZE, SIZE), BG)
    draw = ImageDraw.Draw(base)

    # Soft radial backdrop
    glow = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    cx, cy = SIZE // 2, SIZE // 2 + 20
    gd.ellipse((cx - 360, cy - 300, cx + 360, cy + 340), fill=(48, 48, 52, 255))
    gd.ellipse((cx - 280, cy - 220, cx + 280, cy + 260), fill=(36, 36, 40, 255))
    base = Image.alpha_composite(base.convert("RGBA"), glow).convert("RGB")
    img = base.convert("RGBA")
    draw = ImageDraw.Draw(img)

    tile_w = 260
    tile_h = 150
    origin_x = SIZE / 2
    origin_y = SIZE / 2 + 50

    def grid_to_screen(gx: int, gy: int, gz: int) -> tuple[float, float]:
        sx = origin_x + (gx - gy) * (tile_w / 2)
        sy = origin_y + (gx + gy) * (tile_h / 2) - gz * tile_h
        return sx, sy

    voxels = [
        (0, 0, 0, BLUE_L, BLUE, BLUE_D),
        (1, 0, 0, YELLOW_L, YELLOW, YELLOW_D),
        (1, 0, 1, RED_L, RED, RED_D),
    ]
    voxels.sort(key=lambda v: (v[0] + v[1] - v[2], v[2]))

    for gx, gy, gz, top, left, right in voxels:
        sx, sy = grid_to_screen(gx, gy, gz)
        draw_voxel(draw, sx, sy, tile_w, tile_h, top, left, right)

    for gx, gy, gz, *_ in voxels:
        sx, sy = grid_to_screen(gx, gy, gz)
        add_top_shine(img, sx, sy, tile_w, tile_h)

    shadow = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    sx, sy = grid_to_screen(0.55, 0.45, -0.08)
    sd.ellipse((sx - 230, sy + 30, sx + 230, sy + 120), fill=(0, 0, 0, 85))
    shadow = shadow.filter(ImageFilter.GaussianBlur(8))
    img = Image.alpha_composite(img, shadow)

    mask = rounded_rect_mask(SIZE, 230)
    framed = Image.new("RGBA", (SIZE, SIZE), BG_EDGE)
    framed.paste(img, (0, 0), mask)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    framed.convert("RGB").save(OUT, "PNG", optimize=True)
    print(f"Wrote {OUT} ({SIZE}x{SIZE})")


if __name__ == "__main__":
    main()
