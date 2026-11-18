#!/usr/bin/env python3
"""Generate PMCS launcher's pixel-art icon and NSIS installer sidebar."""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"
ASSETS.mkdir(exist_ok=True)

# ---------------------------------------------------------------- icon (64x64)
S = 64
img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)
bg = (7, 18, 12, 255)
border = (35, 82, 53, 255)
shape = [(10, 1), (54, 1), (58, 3), (61, 7), (61, 56), (58, 60), (54, 62),
         (10, 62), (6, 60), (2, 56), (2, 7), (6, 3)]
d.polygon(shape, fill=bg)
d.line(shape + [shape[0]], fill=border, width=1)
for y in range(4, 60, 4):
    for x in range(4, 60, 4):
        if ((x * 3 + y * 5) // 4) % 4 == 0:
            d.rectangle((x, y, x + 3, y + 3), fill=(10, 27, 16, 255))
for r, c in [(28, (12, 42, 24, 255)), (22, (15, 55, 31, 255)), (15, (18, 70, 39, 255))]:
    d.ellipse((32 - r, 24 - r // 2, 32 + r, 24 + r // 2), fill=c)

top = [(32, 5), (58, 20), (32, 35), (6, 20)]
left = [(6, 20), (32, 35), (32, 52), (6, 37)]
right = [(58, 20), (32, 35), (32, 52), (58, 37)]
d.polygon(top, fill=(82, 214, 126, 255))
d.polygon(left, fill=(124, 75, 45, 255))
d.polygon(right, fill=(84, 49, 28, 255))
for y in range(6, 35):
    if y <= 20:
        x0 = 32 - int((y - 5) * 26 / 15)
        x1 = 32 + int((y - 5) * 26 / 15)
    else:
        x0 = 6 + int((y - 20) * 26 / 15)
        x1 = 58 - int((y - 20) * 26 / 15)
    if y % 2 == 0:
        d.line((x0 + 1, y, x1 - 1, y), fill=(98, 231, 144, 255))
    if y % 3 == 0:
        for x in range(x0 + 4, x1 - 2, 6):
            d.rectangle((x, y, min(x + 2, x1 - 2), y + 1), fill=(58, 188, 99, 255))
d.polygon([(6, 20), (32, 35), (32, 39), (6, 24)], fill=(68, 203, 111, 255))
d.polygon([(58, 20), (32, 35), (32, 39), (58, 24)], fill=(46, 158, 87, 255))
for x in range(8, 31, 5):
    yy = 22 + (x - 8) * 2 // 3
    d.rectangle((x, yy, min(x + 2, 30), yy + 3), fill=(34, 139, 74, 255))
for (x, y, w, h) in [(11, 29, 3, 3), (17, 35, 2, 2), (24, 42, 3, 2), (28, 47, 2, 2),
                     (53, 30, 3, 3), (47, 37, 2, 2), (40, 44, 3, 2), (35, 49, 2, 2)]:
    d.rectangle((x, y, x + w - 1, y + h - 1), fill=(91, 52, 29, 255))
for (x, y) in [(15, 31), (21, 38), (51, 33), (44, 41), (37, 47)]:
    d.rectangle((x, y, x + 1, y + 1), fill=(154, 100, 61, 255))
for poly in (top, left, right):
    d.line(poly + [poly[0]], fill=(5, 16, 9, 255), width=1)

bx0, by0, bx1, by1 = 10, 38, 54, 61
d.rectangle((bx0, by0, bx1, by1), fill=(5, 14, 8, 255), outline=(44, 107, 67, 255))
d.line((bx0 + 1, by0 + 1, bx1 - 1, by0 + 1), fill=(23, 70, 42, 255))

# PMCS monogram: a large pixel P, with a subtle block-shadow.
FONT = {
    "P": ["111110", "100011", "100011", "111110", "100000", "100000", "100000"],
}

def glyph7(ch, x, y, color, scale=2):
    for r, row in enumerate(FONT[ch]):
        for c, b in enumerate(row):
            if b == "1":
                d.rectangle((x + c * scale, y + r * scale,
                             x + c * scale + scale - 1, y + r * scale + scale - 1), fill=color)

glyph7("P", 22, 40, (17, 66, 40, 255), 3)
glyph7("P", 21, 39, (232, 255, 241, 255), 3)
# A mint pixel notch keeps the mark connected to the old pixel-block language.
for (x, y) in [(7, 10), (9, 8), (11, 12), (52, 9), (54, 12)]:
    d.rectangle((x, y, x + 1, y + 1), fill=(112, 234, 152, 210))

icon512 = img.resize((512, 512), Image.Resampling.NEAREST)
icon512.save(ASSETS / "icon.png")
icon512.save(ASSETS / "icon-512.png")
img.resize((256, 256), Image.Resampling.NEAREST).save(ASSETS / "icon-256.png")
icon512.save(ASSETS / "icon.ico", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
img.resize((64, 64), Image.Resampling.NEAREST).save(ASSETS / "icon-preview-64.png")
img.resize((32, 32), Image.Resampling.NEAREST).save(ASSETS / "icon-preview-32.png")

# ------------------------------------------------------- NSIS sidebar 164x314
W, H = 164, 314
side = Image.new("RGB", (W, H), (6, 16, 10))
sd = ImageDraw.Draw(side)
for y in range(0, H, 16):
    for x in range(0, W, 16):
        if ((x + y) // 16) % 3 == 0:
            sd.rectangle((x, y, x + 15, y + 15), fill=(8, 22, 14))
for y in range(0, H, 8):
    sd.line((0, y, W, y), fill=(10, 27, 17))
sd.rectangle((0, 0, W - 1, 3), fill=(110, 231, 149))
sd.rectangle((0, 4, W - 1, 5), fill=(37, 102, 64))
side.paste(icon512.resize((104, 104), Image.Resampling.NEAREST), (30, 24))

FONT3 = {
    "A": ["010", "101", "111", "101", "101"], "B": ["110", "101", "110", "101", "110"],
    "C": ["011", "100", "100", "100", "011"], "D": ["110", "101", "101", "101", "110"],
    "E": ["111", "100", "110", "100", "111"], "F": ["111", "100", "110", "100", "100"],
    "G": ["011", "100", "101", "101", "011"], "H": ["101", "101", "111", "101", "101"],
    "I": ["111", "010", "010", "010", "111"], "J": ["001", "001", "001", "101", "010"],
    "K": ["101", "101", "110", "101", "101"], "L": ["100", "100", "100", "100", "111"],
    "M": ["101", "111", "111", "101", "101"], "N": ["101", "111", "111", "111", "101"],
    "O": ["010", "101", "101", "101", "010"], "P": ["110", "101", "110", "100", "100"],
    "Q": ["010", "101", "101", "111", "011"], "R": ["110", "101", "110", "101", "101"],
    "S": ["011", "100", "010", "001", "110"], "T": ["111", "010", "010", "010", "010"],
    "U": ["101", "101", "101", "101", "111"], "V": ["101", "101", "101", "101", "010"],
    "W": ["101", "101", "111", "111", "101"], "X": ["101", "101", "010", "101", "101"],
    "Y": ["101", "101", "010", "010", "010"], "Z": ["111", "001", "010", "100", "111"],
    "0": ["111", "101", "101", "101", "111"], "1": ["010", "110", "010", "010", "111"],
    "2": ["110", "001", "010", "100", "111"], "3": ["110", "001", "010", "001", "110"],
    "4": ["101", "101", "111", "001", "001"], "5": ["111", "100", "110", "001", "110"],
    "6": ["011", "100", "110", "101", "010"], "7": ["111", "001", "010", "010", "010"],
    "8": ["010", "101", "010", "101", "010"], "9": ["010", "101", "011", "001", "110"],
    ".": ["000", "000", "000", "000", "010"], " ": ["000", "000", "000", "000", "000"],
}

def text3(text, cx, y, color, scale=2):
    width = (len(text) * 4 - 1) * scale
    x = cx - width // 2
    for ch in text:
        pat = FONT3.get(ch.upper(), FONT3[" "])
        for r, row in enumerate(pat):
            for c, b in enumerate(row):
                if b == "1":
                    sd.rectangle((x + c * scale, y + r * scale,
                                  x + c * scale + scale - 1, y + r * scale + scale - 1), fill=color)
        x += 4 * scale

text3("PMCS LAUNCHER", W // 2, 148, (201, 255, 214), 3)
text3("MINECRAFT JAVA", W // 2, 178, (110, 231, 149), 1)
text3("PIXEL EDITION", W // 2, 188, (74, 160, 104), 1)
text3("VERSION 2.7.2", W // 2, 210, (143, 212, 164), 1)
for y in (232, 236):
    sd.line((24, y, W - 24, y), fill=(33, 86, 55))
side.paste(icon512.resize((44, 44), Image.Resampling.NEAREST), (60, 248))
for (x, y) in [(18, 270), (22, 266), (26, 274), (140, 266), (136, 272)]:
    sd.rectangle((x, y, x + 3, y + 3), fill=(56, 156, 92))
side.save(ASSETS / "installer-sidebar.bmp")
side.save(ASSETS / "installer-sidebar.png")
print("brand assets written to", ASSETS)
