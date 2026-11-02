"""Reduce review PNG delivery cost; GLBs are untouched. Requires Pillow 11.x."""
from pathlib import Path
import sys
from PIL import Image
out=Path(__file__).resolve().parent
paths=list((out/'review').rglob('*.png')) if '--review' in sys.argv else [out/n for n in ('preview.png','bunny-closeup.png','mechanics-preview.png')]
for p in paths:
    name=str(p.relative_to(out));before=p.stat().st_size
    with Image.open(p) as image:
        image.convert('RGB').save(p,optimize=True)
    if p.stat().st_size>=1000000:
        with Image.open(p) as image:
            image.convert('RGB').quantize(colors=256,method=Image.Quantize.MEDIANCUT,dither=Image.Dither.NONE).save(p,optimize=True)
    assert p.stat().st_size<1000000
    print(f'{name}: {before:,} → {p.stat().st_size:,} bytes (review PNG)')
