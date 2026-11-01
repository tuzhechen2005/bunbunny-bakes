"""Reduce review PNG delivery cost; GLBs are untouched. Requires Pillow 11.x."""
from pathlib import Path
from PIL import Image
out=Path(__file__).resolve().parents[2]/'public/brand/run3d'
for name in ('preview.png','bunny-closeup.png'):
    p=out/name;before=p.stat().st_size
    with Image.open(p) as image:
        image.convert('RGB').quantize(colors=256,method=Image.Quantize.MEDIANCUT,dither=Image.Dither.NONE).save(p,optimize=True)
    print(f'{name}: {before:,} → {p.stat().st_size:,} bytes (256-colour review PNG)')
