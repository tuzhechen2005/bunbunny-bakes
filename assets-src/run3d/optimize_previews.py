"""Reduce review PNG delivery cost; GLBs are untouched. Requires Pillow 11.x."""
from pathlib import Path
from PIL import Image
out=Path(__file__).resolve().parent
for name in ('preview.png','bunny-closeup.png','mechanics-preview.png'):
    p=out/name;before=p.stat().st_size
    with Image.open(p) as image:
        image.convert('RGB').quantize(colors=128,method=Image.Quantize.MEDIANCUT,dither=Image.Dither.NONE).save(p,optimize=True)
    print(f'{name}: {before:,} → {p.stat().st_size:,} bytes (128-colour review PNG)')
