"""
Removes the white background around a line drawing (black outline on white) and saves a PNG.

Only the white that is OUTSIDE the outline becomes see-through: we "flood" in from the
top edge, and the flood stops at the black lines. So the white inside the character
stays white. (The other edges are not used, because drawings are often cut off there,
and the flood would leak inside the body.)
Afterwards only the biggest piece is kept, so stray marks like watermarks disappear.

One picture:
    python tools/remove_bg.py picture.jpg frontend/assets/mascot/idle-1.png

A whole folder with one sub-folder per mood (idle/, pressed/, answer/ ...):
    python tools/remove_bg.py --batch mascot frontend/assets/mascot
    -> idle-1.png, idle-2.png, pressed-1.png ... and mascot.json listing them for the app
"""
import json
import os
import sys
from collections import deque

from PIL import Image

SOFT_EDGE = 175    # pixels between this and LIGHT, touching the background, become half see-through
BORDER = 6         # trim this many pixels off every edge first (frame lines, grey strips)
MAX_HEIGHT = 600   # make big pictures smaller, so the page loads fast
LINE_BELOW_BG = 22 # a pixel this much darker than the background counts as outline (pale lines too)
LIGHT_BELOW_BG = 14  # a pixel within this of the background colour counts as background
GAP_MIN = 2        # thicken the outline by at least this many pixels while flooding (closes small gaps)


def brightness(pixel):
    r, g, b = pixel[:3]
    return (r + g + b) / 3


def neighbours(x, y, width, height, diagonal=False):
    steps = ((1, 0), (-1, 0), (0, 1), (0, -1))
    if diagonal:
        steps += ((1, 1), (1, -1), (-1, 1), (-1, -1))
    for dx, dy in steps:
        nx, ny = x + dx, y + dy
        if 0 <= nx < width and 0 <= ny < height:
            yield nx, ny


def remove_background(source, target):
    image = Image.open(source).convert("RGBA")
    width, height = image.size
    image = image.crop((BORDER, BORDER, width - BORDER, height))   # keep the bottom: the body is cut off there
    width, height = image.size
    pixels = image.load()

    # Cut off empty white rows at the bottom: the flood could slip under the body there
    bottom = height
    while bottom > 1 and min(brightness(pixels[x, bottom - 1]) for x in range(width)) > 240:
        bottom -= 1
    if bottom < height:
        image = image.crop((0, 0, width, bottom))
        width, height = image.size
        pixels = image.load()

    # Measure this picture's background white (the middle value along the top edge),
    # because some pictures are pure white and some are greyish or pinkish
    top = sorted(brightness(pixels[x, 0]) for x in range(width))
    background = top[len(top) // 2]
    LINE = background - LINE_BELOW_BG
    LIGHT = background - LIGHT_BELOW_BG
    # Big pictures have bigger gaps in their lines, so patch more for them
    GAP = max(GAP_MIN, round(min(width, height) / 300))

    # 1. Make the outline a little thicker (just for the flood), so the flood can't leak
    #    inside the body through thin, pale or broken bits of the line
    wall = [[False] * width for _ in range(height)]
    for y in range(height):
        for x in range(width):
            if brightness(pixels[x, y]) < LINE:
                for wy in range(max(0, y - GAP), min(height, y + GAP + 1)):
                    for wx in range(max(0, x - GAP), min(width, x + GAP + 1)):
                        wall[wy][wx] = True

    # 2. Flood the background in from the top edge only. The background around the head
    #    reaches the top and flows down both sides; the left, right and bottom edges are
    #    not used, because the body is often cut off there and the flood would leak inside.
    outside = [[False] * width for _ in range(height)]
    queue = deque()

    def seed(x, y):
        if not outside[y][x] and not wall[y][x] and brightness(pixels[x, y]) > LIGHT:
            outside[y][x] = True
            queue.append((x, y))

    # Along the top edge, only start from each corner up to the first line: if the head
    # is cut off at the top, the part between its lines is inside the head, not background
    for xs in (range(width), range(width - 1, -1, -1)):
        for x in xs:
            if wall[0][x]:
                break
            seed(x, 0)
    while queue:
        x, y = queue.popleft()
        for nx, ny in neighbours(x, y, width, height):
            seed(nx, ny)

    # The thick wall left a thin white rim outside the real line: clear it
    # (light pixels next to the background, a few rounds)
    for _ in range(GAP):
        rim = [(x, y) for y in range(height) for x in range(width)
               if not outside[y][x] and brightness(pixels[x, y]) > LIGHT
               and any(outside[ny][nx] for nx, ny in neighbours(x, y, width, height))]
        for x, y in rim:
            outside[y][x] = True

    # 3. Make the background see-through, with a soft edge on the outline
    for y in range(height):
        for x in range(width):
            r, g, b, _ = pixels[x, y]
            if outside[y][x]:
                pixels[x, y] = (r, g, b, 0)
                continue
            light = brightness((r, g, b))
            if light > SOFT_EDGE and any(outside[ny][nx] for nx, ny in neighbours(x, y, width, height)):
                alpha = int(255 * (255 - light) / (255 - SOFT_EDGE))
                pixels[x, y] = (r, g, b, max(0, min(255, alpha)))

    # 4. Keep only the biggest piece (the character); stray marks and watermarks go
    seen = [[False] * width for _ in range(height)]
    pieces = []
    for y in range(height):
        for x in range(width):
            if seen[y][x] or pixels[x, y][3] == 0:
                continue
            piece, todo = [], deque([(x, y)])
            seen[y][x] = True
            while todo:
                px, py = todo.popleft()
                piece.append((px, py))
                for nx, ny in neighbours(px, py, width, height, diagonal=True):
                    if not seen[ny][nx] and pixels[nx, ny][3] > 0:
                        seen[ny][nx] = True
                        todo.append((nx, ny))
            pieces.append(piece)
    pieces.sort(key=len, reverse=True)
    for piece in pieces[1:]:
        for px, py in piece:
            r, g, b, _ = pixels[px, py]
            pixels[px, py] = (r, g, b, 0)

    # 5. Trim the empty space, and shrink very big pictures
    box = image.getbbox()
    if box:
        image = image.crop(box)
    if image.height > MAX_HEIGHT:
        image = image.resize((round(image.width * MAX_HEIGHT / image.height), MAX_HEIGHT), Image.LANCZOS)
    image.save(target, optimize=True)
    print(f"Saved {target} ({image.size[0]} x {image.size[1]})")


def batch(folder, out_folder):
    """Every sub-folder is a mood; writes mood-1.png, mood-2.png ... and mascot.json."""
    os.makedirs(out_folder, exist_ok=True)
    manifest = {}
    for mood in sorted(os.listdir(folder)):
        mood_dir = os.path.join(folder, mood)
        if not os.path.isdir(mood_dir):
            continue
        pictures = sorted(f for f in os.listdir(mood_dir) if f.lower().endswith((".jpg", ".jpeg", ".png", ".webp")))
        manifest[mood] = []
        for number, name in enumerate(pictures, start=1):
            out_name = f"{mood}-{number}.png"
            remove_background(os.path.join(mood_dir, name), os.path.join(out_folder, out_name))
            manifest[mood].append(out_name)
    with open(os.path.join(out_folder, "mascot.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)
    print(f"Wrote {os.path.join(out_folder, 'mascot.json')}: " + ", ".join(f"{k} {len(v)}" for k, v in manifest.items()))


if __name__ == "__main__":
    if len(sys.argv) == 4 and sys.argv[1] == "--batch":
        batch(sys.argv[2], sys.argv[3])
    elif len(sys.argv) == 3:
        remove_background(sys.argv[1], sys.argv[2])
    else:
        print(__doc__)
        sys.exit(1)
