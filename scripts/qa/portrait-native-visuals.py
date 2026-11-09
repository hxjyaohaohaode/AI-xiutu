"""Render actual algorithm outputs and landmark overlays for visual inspection."""
from pathlib import Path
from io import BytesIO
import os
from PIL import Image, ImageDraw, ImageFont
import json

OUT = Path(__file__).resolve().parents[2] / "artifacts/portrait-cpu"
def save_png(image, path):
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    with path.open("wb") as file:
        file.write(buffer.getvalue())
        file.flush()
        os.fsync(file.fileno())
    Image.open(path).verify()
font = ImageFont.load_default(size=18)
small = ImageFont.load_default(size=14)
sheet = Image.new('RGB', (1290, 1270), '#eeeeec')
draw = ImageDraw.Draw(sheet)
draw.text((20, 15), 'Actual native CPU inference + product RecipeV3 rendering (not browser inference)', font=font, fill='#222222')
for x, text in zip([20, 450, 880], ['Canonical source', 'Actual CPU landmarks / skin estimate', 'Product renderer result']):
    draw.text((x, 52), text, font=small, fill='#444444')
face_pairs = []
for row, name in enumerate(['portrait-hopper', 'mediapipe-portrait', 'mediapipe-pose']):
    analysis = json.loads((OUT / f'{name}.analysis.json').read_text())
    source = Image.open(OUT / f'{name}.canonical.png').convert('RGBA')
    output = Image.frombytes('RGBA', source.size, (OUT / f'{name}.edited.rgba').read_bytes())
    save_png(output, OUT / f'{name}.edited.png')
    raw = json.loads((OUT / f'{name}.raw.json').read_text())
    mask = raw['categoryMask']
    categories = (OUT / mask['file']).read_bytes()
    overlay = Image.new('RGBA', source.size, (0, 0, 0, 0))
    overlay.putdata([(27, 201, 121, 55) if c in (2, 3) else (0, 0, 0, 0) for c in categories])
    marked = Image.alpha_composite(source, overlay)
    md = ImageDraw.Draw(marked)
    w,h = source.size
    for target in analysis['targets']:
        if target['kind']=='face':
            for key, contour in target['contours'].items():
                if contour:
                    xy = [(p['x'] * w, p['y'] * h) for p in contour]
                    md.line(xy + [xy[0]], fill=(255, 198, 35, 255), width=2)
            b=target['bounds']
            margin=.035
            bounds=(int(max(0,b['x']-margin)*w),int(max(0,b['y']-margin)*h),
                    int(min(1,b['x']+b['width']+margin)*w),int(min(1,b['y']+b['height']+margin)*h))
            face_pairs.append((name, source.crop(bounds), output.crop(bounds)))
        else:
            for p in target['landmarks']:
                if p.get('visibility',0)>=.5 and 0<=p['x']<=1 and 0<=p['y']<=1:
                    x,y=p['x']*w,p['y']*h
                    md.ellipse((x-3,y-3,x+3,y+3),fill=(30,210,255,255))
    save_png(marked, OUT / f'{name}.analysis-overlay.png')
    top=85+row*390
    draw.text((20,top),f'{name}  {w} x {h}',font=small,fill='#333333')
    for col,im in enumerate([source,marked,output]):
        display=im.copy()
        display.thumbnail((410,350),Image.Resampling.LANCZOS)
        sheet.paste(display.convert('RGB'), (col*430+10+(410-display.width)//2,top+28+(350-display.height)//2))
save_png(sheet, OUT/'contact-sheet.png')

detail=Image.new('RGB',(1050,1160),'#eeeeec')
dd=ImageDraw.Draw(detail)
dd.text((20,15),'Actual face crops: canonical source / recipe result',font=font,fill='#222222')
for row,(name,before,after) in enumerate(face_pairs):
    top=55+row*550
    dd.text((20,top),name,font=small,fill='#333333')
    for col,im in enumerate([before,after]):
        scale=min(500/im.width,500/im.height)
        display=im.resize((round(im.width*scale),round(im.height*scale)),Image.Resampling.NEAREST)
        detail.paste(display.convert('RGB'),(col*525+12+(500-display.width)//2,top+30+(500-display.height)//2))
save_png(detail, OUT/'face-details.png')
print('Saved canonical/edited/overlay contact sheets from real renderer bytes.')
