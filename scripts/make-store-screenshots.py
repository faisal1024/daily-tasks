#!/usr/bin/env python3
"""Caption App Store screenshots for Three Today.

Takes raw simulator captures and writes App Store-sized images with a caption
band on top and the screen below (rounded corners, soft shadow).

  python3 scripts/make-store-screenshots.py RAW_DIR OUT_DIR

RAW_DIR has iphone/01.png … and ipad/01.png …; captions are listed below in the
same order as docs/app-store-listing.md. Needs Pillow and macOS system fonts.
"""

import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

# (title, subtitle, is a Plus feature). "\n" forces a line break; the key
# message is always in the title (subtitles don't read at thumbnail size).
CAPTIONS = [
    ("Three tasks.\nNo overdue pile.", "Every day starts fresh.", False),
    ("Dump it all.\nGet your three.", "3 free AI sorts to try. The rest is saved.", False),
    ("Your coach drafts\ntomorrow", "One tap in the evening, three ready by morning.", True),
    ("Break big tasks\ninto tiny steps", "When a task feels too big to start.", True),
    ("See your progress,\nnot your misses", "Your day count only goes up.", False),
]

# App Store sizes: iPhone 6.9" and iPad 13".
SIZES = {"iphone": (1320, 2868), "ipad": (2064, 2752)}
BACKGROUND = (91, 82, 232)  # brand primary
TITLE_FONT = "/System/Library/Fonts/SFNSRounded.ttf"
BODY_FONT = "/System/Library/Fonts/SFNS.ttf"


def font(path, size, style=None):
    """A system font at a named style ("Bold", "Medium"): these are variable
    fonts, and the named instance sets every axis correctly."""
    f = ImageFont.truetype(path, size)
    if style:
        try:
            f.set_variation_by_name(style)
        except Exception:  # not a variable font: use as is
            pass
    return f


def fit_lines(draw, text, f, max_width):
    lines = []
    for part in text.split("\n"):
        line = ""
        for word in part.split():
            trial = f"{line} {word}".strip()
            if not line or draw.textlength(trial, font=f) <= max_width:
                line = trial
            else:
                lines.append(line)
                line = word
        lines.append(line)
    return lines


def compose(raw_path, out_path, size, title, body, plus=False):
    width, height = size
    canvas = Image.new("RGB", size, BACKGROUND)
    draw = ImageDraw.Draw(canvas)
    margin = int(width * 0.07)
    title_font = font(TITLE_FONT, int(width * 0.075), "Bold")
    body_font = font(BODY_FONT, int(width * 0.038), "Medium")

    y = int(height * 0.05)
    if plus:
        # A small "PLUS" pill: paid features are labelled (App Store 2.3.2).
        pill_font = font(TITLE_FONT, int(width * 0.03), "Bold")
        label = "PLUS"
        tw = draw.textlength(label, font=pill_font)
        ph = int(pill_font.size * 1.6)
        pw = int(tw + pill_font.size * 1.6)
        px = (width - pw) // 2
        draw.rounded_rectangle([px, y, px + pw, y + ph], ph // 2, fill=(255, 211, 122))
        draw.text((px + (pw - tw) / 2, y + (ph - pill_font.size) / 2 - pill_font.size * 0.12), label, font=pill_font, fill=(40, 30, 90))
        y += ph + int(height * 0.012)
    for line in fit_lines(draw, title, title_font, width - 2 * margin):
        w = draw.textlength(line, font=title_font)
        draw.text(((width - w) / 2, y), line, font=title_font, fill="white")
        y += int(title_font.size * 1.15)
    y += int(body_font.size * 0.4)
    for line in fit_lines(draw, body, body_font, width - 2 * margin):
        w = draw.textlength(line, font=body_font)
        draw.text(((width - w) / 2, y), line, font=body_font, fill=(235, 232, 255))
        y += int(body_font.size * 1.3)

    # The screen, scaled to the space left, with rounded corners and a shadow.
    shot = Image.open(raw_path).convert("RGB")
    top = y + int(height * 0.035)
    avail_h = height - top - int(height * 0.03)
    avail_w = width - 2 * margin
    scale = min(avail_w / shot.width, avail_h / shot.height)
    shot = shot.resize((int(shot.width * scale), int(shot.height * scale)), Image.LANCZOS)
    # iPhone screens have big rounded corners; the iPad's are small, and a big
    # radius would clip its status bar.
    radius = int(shot.width * (0.07 if shot.height > shot.width * 1.8 else 0.03))
    mask = Image.new("L", shot.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, shot.width, shot.height], radius, fill=255)
    x = (width - shot.width) // 2
    shadow = Image.new("RGBA", size, (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle(
        [x, top + 18, x + shot.width, top + 18 + shot.height], radius, fill=(20, 10, 60, 120)
    )
    shadow = shadow.filter(ImageFilter.GaussianBlur(30))
    canvas.paste(shadow, (0, 0), shadow)
    canvas.paste(shot, (x, top), mask)
    canvas.save(out_path, "PNG")


def main():
    raw_dir, out_dir = Path(sys.argv[1]), Path(sys.argv[2])
    for device, size in SIZES.items():
        src = raw_dir / device
        if not src.is_dir():
            continue
        dest = out_dir / device
        dest.mkdir(parents=True, exist_ok=True)
        for index, (title, body, plus) in enumerate(CAPTIONS, start=1):
            raw = src / f"{index:02d}.png"
            if raw.exists():
                compose(raw, dest / f"{index:02d}.png", size, title, body, plus)
                print(f"{device} {index:02d}: {title.replace(chr(10), ' ')}")


if __name__ == "__main__":
    main()
