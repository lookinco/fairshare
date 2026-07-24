#!/usr/bin/env python3
# Throwaway: render a fake restaurant receipt PNG to smoke-test parse-receipt.mjs.
from PIL import Image, ImageDraw, ImageFont
import os

lines = [
    ("THE MAPLE TABLE", "big"),
    ("Vancouver, BC", "sm"),
    ("------------------------", "sm"),
    ("2  Ribeye Steak      68.00", "n"),
    ("1  Grilled Salmon    29.00", "n"),
    ("1  Kids Chicken      14.00", "n"),
    ("3  Craft Soda        13.50", "n"),
    ("1  Caesar Salad      16.00", "n"),
    ("------------------------", "sm"),
    ("Subtotal           140.50", "n"),
    ("GST 5%               7.03", "n"),
    ("Tip 18%             25.29", "n"),
    ("TOTAL              172.82", "big"),
    ("------------------------", "sm"),
    ("Thank you!  CAD", "sm"),
]

W, H = 380, 30 * len(lines) + 40
img = Image.new("RGB", (W, H), "white")
d = ImageDraw.Draw(img)

def font(kind):
    paths = ["/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
             "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"]
    size = {"big": 22, "sm": 15, "n": 18}[kind]
    for p in paths:
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()

y = 20
for text, kind in lines:
    d.text((20, y), text, fill="black", font=font(kind))
    y += 30

out = os.path.join(os.path.dirname(__file__), "sample-receipt.png")
img.save(out)
print(out)
