from PIL import Image, ImageDraw
import random, math

random.seed(1)
W, H = 640, 480
outdir = "public/images"

def gradient_bg(draw, c1, c2):
    for y in range(H):
        t = y / H
        r = int(c1[0] + (c2[0]-c1[0])*t)
        g = int(c1[1] + (c2[1]-c1[1])*t)
        b = int(c1[2] + (c2[2]-c1[2])*t)
        draw.line([(0,y),(W,y)], fill=(r,g,b))

# 1) Sunset hearts scene
img = Image.new("RGB", (W,H))
d = ImageDraw.Draw(img)
gradient_bg(d, (255,140,120), (120,60,160))
d.ellipse((W//2-90, 60, W//2+90, 240), fill=(255,220,120))
for i in range(6):
    x = random.randint(30, W-30)
    y = random.randint(H-160, H-20)
    s = random.randint(18,34)
    d.polygon([(x, y+s), (x-s, y-s*0.3), (x, y-s), (x+s, y-s*0.3)], fill=(255,90,140))
img.save(f"{outdir}/sunset.png")

# 2) Ocean waves scene
img = Image.new("RGB", (W,H))
d = ImageDraw.Draw(img)
gradient_bg(d, (135,206,235), (10,60,120))
for i in range(8):
    y = 200 + i*30
    pts = []
    for x in range(0, W+20, 20):
        yy = y + 12*math.sin((x/40)+i)
        pts.append((x,yy))
    pts += [(W,H),(0,H)]
    shade = max(10, 60 - i*5)
    d.polygon(pts, fill=(10+shade, 80+shade, 140+shade))
d.ellipse((60,50,150,140), fill=(255,250,220))
img.save(f"{outdir}/ocean.png")

# 3) Abstract geometric scene
img = Image.new("RGB", (W,H))
d = ImageDraw.Draw(img)
gradient_bg(d, (40,40,60), (90,40,120))
colors = [(255,99,132),(54,162,235),(255,206,86),(75,192,192),(153,102,255)]
for i in range(30):
    c = random.choice(colors)
    x,y = random.randint(0,W), random.randint(0,H)
    s = random.randint(20,70)
    shape = random.choice(["circle","square"])
    if shape=="circle":
        d.ellipse((x,y,x+s,y+s), fill=c)
    else:
        d.rectangle((x,y,x+s,y+s), fill=c)
img.save(f"{outdir}/abstract.png")

print("done")
