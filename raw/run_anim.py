import random
from PIL import Image

random.seed(3)
VW, VH = 72, 88        # viewport in game pixels
SCALE = 6
N_FRAMES = 24
SPEED = 2              # px per frame downward
STRIDE = 6             # px of travel per animation step

GRASS_L = (151, 176, 33)
GRASS_D = (143, 170, 25)
GRASS_DD= (134, 162, 20)
LINE    = (236, 240, 226)
SHAD    = (104, 134, 12)
SKIN    = (235, 178, 122)
RED     = (199, 60, 32)
WHITE   = (238, 238, 232)
BLACK   = (20, 20, 20)
HAIR    = (40, 30, 22)

def grass_color(wx, wy):
    """Deterministic world-space grass so scrolling is coherent."""
    band = ((wx + wy) // 24 + (wx - wy) // 24) % 2
    base = GRASS_L if band == 0 else GRASS_D
    h = (wx * 374761393 + wy * 668265263) & 0xFFFFFFFF
    h = (h ^ (h >> 13)) * 1274126177 & 0xFFFFFFFF
    if (h % 100) < 18:
        base = GRASS_DD if base == GRASS_D else GRASS_D
    return base

def run_sprite(phase):
    """Down-facing run, phase 0/1/2. 8x12 grid. Distance-driven outside."""
    s = {}
    def p(x, y, c): s[(x, y)] = c
    # shadow offset down-right (sun upper-left)
    for x in range(2, 8): p(x, 11, SHAD)
    if phase == 1:                       # passing pose: legs together
        p(1, 10, BLACK); p(4, 10, BLACK)
        p(1, 9, SKIN);   p(4, 9, SKIN)
        p(1, 8, SKIN);   p(4, 8, SKIN)
        arm_l, arm_r = 5, 5
    elif phase == 0:                     # left leg forward / right back
        p(1, 10, BLACK)                  # fwd boot lower
        p(1, 9, SKIN); p(1, 8, SKIN)
        p(4, 9, BLACK)                   # back boot raised
        p(4, 8, SKIN)
        arm_l, arm_r = 6, 4              # arms counter-swing
    else:                                # right leg forward
        p(4, 10, BLACK)
        p(4, 9, SKIN); p(4, 8, SKIN)
        p(1, 9, BLACK)
        p(1, 8, SKIN)
        arm_l, arm_r = 4, 6
    for x in range(1, 5): p(x, 6, WHITE); p(x, 7, WHITE)     # shorts
    for x in range(1, 5): p(x, 4, RED);   p(x, 5, RED)       # shirt
    p(0, 4, RED); p(5, 4, RED)                                # shoulders
    p(0, arm_l, SKIN); p(5, arm_r, SKIN)                      # hands swing
    for x in range(1, 5): p(x, 3, SKIN)                       # face
    for x in range(1, 5): p(x, 1, HAIR); p(x, 2, HAIR)        # hair
    for x in range(1, 5): p(x, 0, HAIR)
    p(0, 2, HAIR); p(5, 2, HAIR)
    return s

CYCLE = [0, 1, 2, 1]   # ping-pong contact-pass-contact-pass

frames = []
world_y = 0
PX, PY = VW // 2 - 3, VH // 2 - 6      # player fixed at viewport center

for f in range(N_FRAMES):
    img = Image.new("RGB", (VW, VH))
    px = img.load()
    # scrolling grass + a touchline for motion reference
    for y in range(VH):
        for x in range(VW):
            px[x, y] = grass_color(x, y + world_y)
    lx = 8
    for y in range(VH):
        px[lx, y] = LINE
    # ball dribbled ahead: nudged forward on contact frames, bobbing
    step = (world_y // STRIDE) % 4
    phase = CYCLE[step]
    bob = 1 if phase == 1 else 0
    bx, by = PX + 2, PY + 15 + (world_y % STRIDE) // 2   # drifts, retouched each stride
    for x in range(bx, bx + 2): px[x, by + 2] = SHAD      # ball shadow
    for (dx, dy) in [(0, 0), (1, 0), (0, 1), (1, 1)]:
        px[bx + dx, by - bob + dy] = WHITE
    # player
    for (sx, sy), c in run_sprite(phase).items():
        x, y = PX + sx, PY + sy
        if 0 <= x < VW and 0 <= y < VH: px[x, y] = c
    frames.append(img.resize((VW * SCALE, VH * SCALE), Image.NEAREST))
    world_y += SPEED

frames[0].save("/mnt/user-data/outputs/sensi-run.gif",
               save_all=True, append_images=frames[1:], duration=70, loop=0)
print("done")
