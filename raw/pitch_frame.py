import random
from PIL import Image, ImageDraw

random.seed(7)
W, H = 320, 280
SCALE = 4

# Palette sampled from reference screenshot
GRASS_L = (151, 176, 33)
GRASS_D = (143, 170, 25)
GRASS_DD= (134, 162, 20)
LINE    = (236, 240, 226)
POST    = (234, 236, 215)
NET     = (150, 152, 146)
NET_BG  = (71, 106, 4)
SHAD    = (86, 120, 8)      # cast shadow green
SKIN    = (235, 178, 122)
RED     = (199, 60, 32)
BLUE    = (44, 80, 200)
WHITE   = (238, 238, 232)
BLACK   = (20, 20, 20)
H_DARK  = (40, 30, 22)
H_BLOND = (222, 186, 80)
H_GING  = (170, 90, 30)
# crowd palette
CROWD = [(228,107,54),(241,125,50),(126,71,40),(160,90,50),(200,160,120),
         (90,50,30),(240,200,90),(220,220,210),(180,70,35)]
BARRIER = (170, 174, 178)
BARRIER_D = (120, 124, 128)

img = Image.new("RGB", (W, H), GRASS_L)
px = img.load()

CROWD_H = 56   # stands
BOARD_Y = CROWD_H + 8   # ad board strip after photographers row
PITCH_Y = BOARD_Y + 12  # pitch starts

# --- Crowd: noisy pixels in two tiers split by barriers ---
for y in range(0, CROWD_H):
    for x in range(W):
        px[x, y] = random.choice(CROWD)
for ty in (0, 1, CROWD_H // 2, CROWD_H // 2 + 1, CROWD_H - 2, CROWD_H - 1):
    for x in range(W):
        px[x, ty] = BARRIER if ty % 2 == 0 else BARRIER_D

# --- Strip between stands and boards: dark green walkway with photographers ---
for y in range(CROWD_H, BOARD_Y):
    for x in range(W):
        px[x, y] = (60, 90, 20)

# --- Ad boards ---
d = ImageDraw.Draw(img)
d.rectangle([0, BOARD_Y, W, PITCH_Y - 1], fill=(150, 60, 20))
d.rectangle([0, BOARD_Y, 78, PITCH_Y - 1], fill=(10, 10, 30))
d.rectangle([108, BOARD_Y, 230, PITCH_Y - 1], fill=(199, 60, 32))
d.rectangle([252, BOARD_Y, W, PITCH_Y - 1], fill=(10, 10, 30))
d.text((6, BOARD_Y + 2), "SMASH-NIKE", fill=WHITE)
d.text((116, BOARD_Y + 2), "LUKE UNITED FC", fill=WHITE)
d.text((256, BOARD_Y + 2), "SENSIBLE", fill=(220, 200, 60))
px_refresh = img.load(); px = px_refresh

# --- Pitch: mottled yellow-green with subtle diagonal diamond banding ---
for y in range(PITCH_Y, H):
    for x in range(W):
        band = ((x + y) // 24 + (x - y) // 24) % 2   # diamond pattern
        base = GRASS_L if band == 0 else GRASS_D
        if random.random() < 0.18:                    # mottle noise
            base = GRASS_DD if base == GRASS_D else GRASS_D
        px[x, y] = base

def hline(x0, x1, y, c=LINE, t=1):
    for yy in range(y, y + t):
        for x in range(x0, x1 + 1):
            if 0 <= x < W and 0 <= yy < H: px[x, yy] = c

def vline(x, y0, y1, c=LINE, t=1):
    for xx in range(x, x + t):
        for y in range(y0, y1 + 1):
            if 0 <= xx < W and 0 <= y < H: px[xx, y] = c

# --- Pitch markings: goal line, penalty box, six-yard, D-arc ---
GL = PITCH_Y + 46                # goal line y
hline(0, W - 1, GL)
bx0, bx1 = 60, 260               # penalty box
hline(bx0, bx1, GL + 64); vline(bx0, GL, GL + 64); vline(bx1, GL, GL + 64)
sx0, sx1 = 116, 204              # six-yard box
hline(sx0, sx1, GL + 22); vline(sx0, GL, GL + 22); vline(sx1, GL, GL + 22)
px[W // 2, GL + 42] = LINE       # penalty spot
import math                       # D arc below box
for i in range(120):
    a = math.pi * (i / 119.0)
    x = int(W / 2 + 36 * math.cos(a)); y = int(GL + 64 + 13 * math.sin(a))
    if y > GL + 64: px[x, y] = LINE

# --- Goal: white frame, grey net mesh on dark green, checkered cast shadow ---
gx0, gx1 = 124, 196
gy0, gy1 = GL - 26, GL
# Goal: vertical plane on the goal line. Light from upper-left:
# point at height z above (x, GL) projects to (x + z, GL + z*0.55).
goal_solid = {}
for y in range(gy0, gy1):
    for x in range(gx0, gx1 + 1):
        goal_solid[(x, y)] = NET if (x % 2 == 0 or y % 2 == 0) else NET_BG
for y in range(gy0, gy1 + 1):
    for xx in (gx0, gx0 + 1, gx1 - 1, gx1):
        goal_solid[(xx, y)] = POST
for x in range(gx0, gx1 + 1):
    goal_solid[(x, gy0)] = POST
    goal_solid[(x, gy0 + 1)] = POST
    goal_solid[(x, gy0 + 2)] = (170, 172, 162)   # crossbar underside shading
# projected shadow: higher parts cast further down-right
for (x, y) in goal_solid:
    z = gy1 - y
    sx = x + int(z * 1.4) + 2
    sy = gy1 + int(z * 0.5)
    if 0 <= sx < W and 0 <= sy < H and (sx + sy) % 2 == 0:
        px[sx, sy] = SHAD
for (x, y), c in goal_solid.items():
    if 0 <= x < W and 0 <= y < H: px[x, y] = c
px[gx0 - 1, gy1 - 1] = POST; px[gx1 + 1, gy1 - 1] = POST

def blit(s, ox, oy):
    for (sx, sy), c in s.items():
        x, y = ox + sx, oy + sy
        if 0 <= x < W and 0 <= y < H: px[x, y] = c

def player(shirt, shorts, hair, socks=None):
    """6x11 standing sprite, hair-dominant head like the reference."""
    s = {}
    def p(x, y, c): s[(x, y)] = c
    socks = socks or shorts
    for x in range(2, 8): p(x, 11, SHAD)         # shadow right (sun upper-left)
    p(1, 10, BLACK); p(4, 10, BLACK)             # boots
    p(1, 9, socks);  p(4, 9, socks)              # socks
    p(1, 8, SKIN);   p(4, 8, SKIN)               # legs
    for x in range(1, 5): p(x, 6, shorts); p(x, 7, shorts)
    for x in range(1, 5): p(x, 4, shirt); p(x, 5, shirt)
    p(0, 4, shirt); p(5, 4, shirt)               # arms
    p(0, 5, SKIN);  p(5, 5, SKIN)                # hands
    for x in range(1, 5): p(x, 3, SKIN)          # face sliver
    for x in range(1, 5): p(x, 1, hair); p(x, 2, hair)   # hair dominates
    p(1, 0, hair); p(2, 0, hair); p(3, 0, hair); p(4, 0, hair)
    p(0, 2, hair); p(5, 2, hair)
    return s

def keeper_diving(shirt, hair):
    """Horizontal diving sprite, ~12x6."""
    s = {}
    def p(x, y, c): s[(x, y)] = c
    for x in range(2, 14): p(x, 6, SHAD)
    for x in range(0, 3): p(x, 3, hair)          # head left
    p(1, 4, SKIN); p(2, 4, SKIN)
    for x in range(3, 9): p(x, 3, shirt); p(x, 4, shirt)
    p(9, 4, WHITE); p(10, 4, WHITE)              # shorts
    p(11, 4, SKIN); p(11, 3, SKIN)               # legs
    p(3, 2, SKIN); p(4, 1, SKIN)                 # raised arm
    return s

# --- Place players: corner-kick style scramble in the box ---
whites = [(118, GL + 36), (196, GL + 50), (90, GL + 78), (236, GL + 70)]
reds   = [(160, GL + 44), (130, GL + 88), (210, GL + 96), (60, GL + 110)]
for x, y in whites: blit(player(WHITE, BLACK, random.choice([H_DARK, H_BLOND, H_GING])), x, y)
for x, y in reds:   blit(player(RED, WHITE, random.choice([H_DARK, H_BLOND, H_GING])), x, y)
blit(keeper_diving((20, 120, 60), H_DARK), 150, GL + 8)   # keeper diving on goal line

# ball airborne in net; shadow projected down-right
bx, by = 168, GL - 14
bz = GL - by
sxx, syy = bx + bz + 2, GL + int(bz * 0.55)
for dx in range(3):
    if 0 <= sxx + dx < W and 0 <= syy < H: px[sxx + dx, syy] = SHAD
for (dx, dy) in [(0,0),(1,0),(0,1),(1,1)]: px[bx+dx, by+dy] = WHITE
px[bx, by + 1] = (190, 190, 185)
# crowd-side photographers
for x in (40, 46, 250, 256):
    for yy in range(CROWD_H + 1, BOARD_Y - 1):
        px[x, yy] = BLACK; px[x + 1, yy] = (60, 60, 70)

out = img.resize((W * SCALE, H * SCALE), Image.NEAREST)
out.save("/mnt/user-data/outputs/sensi-frame-v5.png")
print("done")
