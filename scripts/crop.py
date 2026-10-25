# Dev helper: crop a tall screenshot into viewable tiles. usage: crop.py img out_prefix [tile_h]
import sys
from PIL import Image
img = Image.open(sys.argv[1]); h = int(sys.argv[3]) if len(sys.argv) > 3 else 1400
for i, y in enumerate(range(0, img.height, h)):
    img.crop((0, y, img.width, min(img.height, y + h))).save(f"{sys.argv[2]}-{i}.png")
print(img.size, (img.height + h - 1) // h, 'tiles')
