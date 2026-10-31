"""D6: original procedural bakery clay models. Run inside Blender, not Python.

Map surfaces are inverse-projected from the authoritative TD points, including
their elevation, so the 55-degree camera cannot skew path/slot coordinates.
"""
import argparse
import hashlib
import json
import math
import random
import re
import sys
from pathlib import Path

import bpy
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view

ROOT = Path(__file__).resolve().parent
CACHE = ROOT / ".cache"
CACHE.mkdir(exist_ok=True)
MAP_SOURCE = ROOT.parents[1] / "src/lib/td/maps.ts"
source = MAP_SOURCE.read_text()
MAPS = [{"name": name, "path": json.loads(path), "slots": json.loads(slots)}
        for name, path, slots in re.findall(
            r'map\("([^"]+)",\s*(\[\[.*?\]\]),\s*(\[\[.*?\]\])\)', source, re.S)]
assert len(MAPS) == 3 and all(len(m["slots"]) == 11 for m in MAPS)
SLOT_RADIUS = int(re.search(r"TD_SLOT_RADIUS = (\d+)", (ROOT.parents[1] / "src/lib/td/types.ts").read_text()).group(1))
MAP_HASH = hashlib.sha256(MAP_SOURCE.read_bytes()).hexdigest()
parser = argparse.ArgumentParser()
parser.add_argument("--only", default="")
parser.add_argument("--samples", type=int, default=128)
args = parser.parse_args(sys.argv[sys.argv.index("--")+1:] if "--" in sys.argv else [])
SELECTED = set(filter(None, args.only.split(",")))
ELEVATION = math.radians(55)
SIN, COS = math.sin(ELEVATION), math.cos(ELEVATION)
PPM = 56
PALETTE = {
    "cream": "F8EEDB", "flour": "FFF9ED", "pink": "E8B3A0", "butter": "E5B95F",
    "crust": "B86E32", "bread": "E5AA56", "score": "FADE9D", "kraft": "BD8A53",
    "fold": "99683D", "wood": "80573E", "dark": "46392F", "sage": "9CA981",
    "stone": "C1B6A6", "grout": "9D9388", "rose": "CF9580", "glass": "AFC8C3",
    "rim": "CCDAD0", "roof": "BD8062", "plaster": "E6D5B9", "leaf": "6E8760",
    "soil": "9C8066", "tile": "E2CFB1", "mouse": "B4A598", "ant": "784D36",
    "shell": "586C58", "iron": "6C7772", "fire": "F4B85C",
}
MATS = {}


def material(key):
    if key not in MATS:
        h = PALETTE[key]
        srgb = [int(h[i:i+2], 16)/255 for i in (0, 2, 4)]
        rgb = [v/12.92 if v < .04045 else ((v+.055)/1.055)**2.4 for v in srgb]
        m = bpy.data.materials.new(key)
        m.diffuse_color = (*rgb, 1)
        m.use_nodes = True
        bsdf = m.node_tree.nodes.get("Principled BSDF")
        bsdf.inputs["Base Color"].default_value = (*rgb, 1)
        bsdf.inputs["Roughness"].default_value = .72
        MATS[key] = m
    return MATS[key]


def finish(obj, name, mat):
    obj.name = name
    obj.data.materials.append(material(mat))
    return obj


def ball(name, loc, scale, mat):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=20, location=loc)
    obj = bpy.context.object
    obj.scale = scale
    for face in obj.data.polygons:
        face.use_smooth = True
    return finish(obj, name, mat)


def box(name, loc, size, mat, bevel=.06):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    obj = bpy.context.object
    obj.dimensions = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        mod = obj.modifiers.new("Hand-rounded clay edges", "BEVEL")
        mod.width, mod.segments = bevel, 4
        obj.modifiers.new("Weighted normals", "WEIGHTED_NORMAL")
    return finish(obj, name, mat)


def cylinder(name, loc, radius, depth, mat, rotation=(0, 0, 0), top=None):
    bpy.ops.mesh.primitive_cone_add(vertices=48, radius1=radius,
                                    radius2=radius if top is None else top,
                                    depth=depth, location=loc, rotation=rotation)
    obj = bpy.context.object
    mod = obj.modifiers.new("Rounded lip", "BEVEL")
    mod.width, mod.segments = .025, 3
    obj.modifiers.new("Weighted normals", "WEIGHTED_NORMAL")
    return finish(obj, name, mat)


def tube(name, points, radius, mat, smooth=True):
    curve = bpy.data.curves.new(name, "CURVE")
    curve.dimensions = "3D"
    curve.resolution_u = 12
    curve.bevel_depth, curve.bevel_resolution = radius, 3
    spline = curve.splines.new("BEZIER" if smooth else "POLY")
    if smooth:
        spline.bezier_points.add(len(points)-1)
        for point, co in zip(spline.bezier_points, points):
            point.co = co
            point.handle_left_type = point.handle_right_type = "AUTO"
    else:
        spline.points.add(len(points)-1)
        for point, co in zip(spline.points, points):
            point.co = (*co, 1)
    obj = bpy.data.objects.new(name, curve)
    bpy.context.collection.objects.link(obj)
    return finish(obj, name, mat)


def ring(name, center, radius, thickness, mat):
    x, y, z = center
    return tube(name, [(x+radius*math.cos(a*math.tau/48),
                        y+radius*math.sin(a*math.tau/48), z) for a in range(49)], thickness, mat)


def setup(width, height, span, transparent=True, target=(0, 0, .25)):
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for collection in (bpy.data.meshes, bpy.data.curves, bpy.data.cameras, bpy.data.lights):
        for block in list(collection):
            if block.users == 0:
                collection.remove(block)
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = args.samples
    scene.cycles.use_denoising = False
    scene.cycles.seed = 152
    scene.render.threads_mode, scene.render.threads = "FIXED", 8
    scene.render.resolution_x, scene.render.resolution_y = width*2, height*2
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.film_transparent = transparent
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.exposure = .6
    scene.world.use_nodes = True
    scene.world.node_tree.nodes["Background"].inputs[0].default_value = (.78, .83, 1, 1)
    scene.world.node_tree.nodes["Background"].inputs[1].default_value = .55
    bpy.ops.object.camera_add()
    camera = bpy.context.object
    target = Vector(target)
    camera.location = target + Vector((0, -12*COS, 12*SIN))
    camera.rotation_euler = (target-camera.location).to_track_quat("-Z", "Y").to_euler()
    camera.data.type, camera.data.ortho_scale = "ORTHO", span
    scene.camera = camera
    bpy.ops.object.light_add(type="SUN", location=(-3, -4, 8))
    sun = bpy.context.object
    sun.rotation_euler = (.4, -.5, -.4)
    sun.data.energy, sun.data.angle = 2.4, .3
    sun.data.color = (1, .86, .68)
    return scene


def projected(scene, point):
    bpy.context.view_layer.update()
    uv = world_to_camera_view(scene, scene.camera, Vector(point))
    return [round(uv.x*scene.render.resolution_x/2, 4),
            round((1-uv.y)*scene.render.resolution_y/2, 4)]


def pixel_world(x, y, z=0):
    # Map camera has 100 px/metre. Elevation compensation keeps raised surfaces exact.
    return ((x-720)/100, ((405-y)/100-z*COS)/SIN, z)


def polygon_pixels(name, points, z, mat):
    # Screen Y points down; normalize winding to an upward-facing world surface.
    signed_area = sum(a[0]*b[1]-b[0]*a[1] for a, b in zip(points, points[1:]+points[:1]))
    if signed_area > 0:
        points = list(reversed(points))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([pixel_world(x, y, z) for x, y in points], [], [tuple(range(len(points)))])
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    return finish(obj, name, mat)


def disk_pixels(name, x, y, radius, z, mat):
    return polygon_pixels(name, [(x+radius*math.cos(a*math.tau/64),
                                  y+radius*math.sin(a*math.tau/64)) for a in range(64)], z, mat)


def stroke_pixels(name, path, width, z, mat):
    # One non-overlapping surface: round OUTER joins, miter inner joins. The exact
    # engine polyline remains centered in the band; never smooth the centerline.
    normals = []
    for a, b in zip(path, path[1:]):
        dx, dy = b[0]-a[0], b[1]-a[1]
        length = math.hypot(dx, dy)
        normals.append((-dy/length, dx/length))
    sides = []
    for side in (1, -1):
        edge = [(path[0][0]+side*normals[0][0]*width/2,
                 path[0][1]+side*normals[0][1]*width/2)]
        for i in range(1, len(path)-1):
            x, y = path[i]
            a, b = normals[i-1], normals[i]
            cross = a[0]*b[1]-a[1]*b[0]
            if abs(cross) < .001 or cross*side > 0:
                denom = 1+a[0]*b[0]+a[1]*b[1]
                edge.append((x+side*(a[0]+b[0])*width/2/denom,
                             y+side*(a[1]+b[1])*width/2/denom))
            else:
                angle = math.atan2(side*a[1], side*a[0])
                turn = math.atan2(cross, a[0]*b[0]+a[1]*b[1])
                for j in range(13):
                    theta = angle+turn*j/12
                    edge.append((x+math.cos(theta)*width/2, y+math.sin(theta)*width/2))
        edge.append((path[-1][0]+side*normals[-1][0]*width/2,
                     path[-1][1]+side*normals[-1][1]*width/2))
        sides.append(edge)
    polygon_pixels(name, sides[0]+list(reversed(sides[1])), z, mat)


def clearance(x, y, data):
    distances = [math.hypot(x-sx, y-sy)-(SLOT_RADIUS+15) for sx, sy in data["slots"]]
    for a, b in zip(data["path"], data["path"][1:]):
        dx, dy = b[0]-a[0], b[1]-a[1]
        t = max(0, min(1, ((x-a[0])*dx+(y-a[1])*dy)/(dx*dx+dy*dy)))
        distances.append(math.hypot(x-a[0]-t*dx, y-a[1]-t*dy)-48)
    # Empty end apron: no props, bread or marks here; runtime draws owner bread photos.
    ex, ey = data["path"][-1]
    distances.append(math.hypot(x-ex, y-ey)-115)
    return min(distances)


def prop(kind, x, y, scale=.55):
    before = set(bpy.context.scene.objects)
    if kind == "plant":
        cylinder("Terracotta herb pot", (0, 0, .22), .27, .4, "roof", top=.34)
        cylinder("Pot soil", (0, 0, .43), .28, .02, "soil")
        ring("Pot rim", (0, 0, .42), .32, .045, "roof")
        for i in range(7):
            a = i*2.4
            tube("Herb stem", [(0, 0, .4), (.16*math.cos(a), .16*math.sin(a), .7+i*.025)], .018, "leaf")
            leaf = ball("Sage leaf", (.23*math.cos(a), .23*math.sin(a), .7+i*.025), (.22, .10, .055), "sage")
            leaf.rotation_euler.z = a
    elif kind == "bowl":
        cylinder("Glazed mixing bowl", (0, 0, .22), .25, .4, "glass", top=.43)
        cylinder("Flour in bowl", (0, 0, .43), .37, .02, "flour")
        ring("Ceramic rim", (0, 0, .44), .4, .045, "rim")
        tube("Wood spoon", [(.05, 0, .45), (.24, .2, .66), (.38, .35, .85)], .047, "wood")
    elif kind == "sack":
        ball("Soft flour sack", (0, 0, .3), (.36, .26, .4), "cream")
        tube("Folded sack seam", [(-.28, 0, .61), (0, .01, .65), (.28, 0, .61)], .035, "kraft")
        for i in range(3):
            ball("Embossed wheat", ((i-1)*.09, -.24, .35), (.04, .022, .1), "butter")
    else:
        box("Wooden cooling tray", (0, 0, .06), (.9, .65, .1), "wood")
        box("Tray paper", (0, 0, .12), (.79, .54, .02), "cream", .02)
        for i in range(5):
            tube("Cooling rack bar", [(-.36, (i-2)*.10, .16), (.36, (i-2)*.10, .16)], .015, "iron", False)
    loc = Vector(pixel_world(x, y, .025))
    root = bpy.data.objects.new("Map dressing", None)
    bpy.context.collection.objects.link(root)
    for obj in set(bpy.context.scene.objects)-before-{root}:
        obj.parent = root
    root.location, root.scale = loc, (scale,)*3


def map_scene(index):
    data = MAPS[index]
    polygon_pixels("Full background", [(-10, -10), (1450, -10), (1450, 820), (-10, 820)], -.025,
                   ["kraft", "grout", "sage"][index])
    if index == 0:
        # Broad maple planks, discreet joints and inset grain; kitchen countertop.
        for row in range(9):
            y = row*100-20
            polygon_pixels("Maple counter board", [(0, y), (1440, y), (1440, y+98), (0, y+98)], -.02,
                           "plaster" if row % 3 else "tile")
            for x in range(30+(row % 2)*90, 1440, 180):
                stroke_pixels("Short wood grain", [[x, y+30], [x+66, y+30]], .7, -.018, "tile")
    elif index == 1:
        for row in range(10):
            for col in range(17):
                x, y = col*90-45, row*90-35
                polygon_pixels("Shop ceramic tile", [(x+2, y+2), (x+88, y+2), (x+88, y+88), (x+2, y+88)], -.02,
                               "cream" if (row+col) % 2 else "tile")
                if (row+col) % 2 == 0:
                    disk_pixels("Tile corner inlay", x+5, y+5, 3, -.018, "rose")
    else:
        rng = random.Random(152)
        for _ in range(350):
            x, y = rng.uniform(0, 1440), rng.uniform(0, 810)
            if clearance(x, y, data) > 12:
                disk_pixels("Garden clay pebble", x, y, rng.uniform(1.2, 3), -.019, "stone")
        for y in (45, 300, 570, 760):
            for x in (29, 1405):
                if clearance(x, y, data) > 25:
                    prop("plant", x, y, .5)
    stroke_pixels("Path edge", data["path"], 86, .006, ["wood", "roof", "soil"][index])
    stroke_pixels("Continuous walkable path", data["path"], 74, .012, ["cream", "plaster", "tile"][index])
    # Deterministic sparse props, rejected near every route segment and slot.
    chosen = []
    kinds = ["bowl", "sack", "tray"] if index == 0 else ["plant", "sack", "tray"] if index == 1 else ["plant"]
    for j, (x, y) in enumerate([(55, 55), (350, 60), (655, 65), (955, 60), (1350, 60), (55, 730),
                                (355, 740), (660, 740), (960, 740), (1370, 740)]):
        if clearance(x, y, data) > 42:
            prop(kinds[j % len(kinds)], x, y, .9)
            chosen.append([x, y])
    return chosen


def tower_base(tier, color):
    cylinder("Round wood foot", (0, 0, .09), .73, .16, "wood")
    cylinder("Glazed pedestal", (0, 0, .19), .67, .14, color)
    ring("Pedestal cream rim", (0, 0, .25), .60, .035, "cream")
    for i in range(tier+1):
        ball("Upgrade brass rivet", ((i-tier/2)*.18, -.62, .25), (.048, .04, .047), "butter")


def pin(loc=(0, 0, .7), size=1, reinforced=False):
    x, y, z = loc
    cylinder("Maple rolling barrel", (x, y, z), .20*size, .99*size, "bread", (0, math.pi/2, 0))
    for s in (-1, 1):
        cylinder("Rolling pin handle", (x+s*.65*size, y, z), .09*size, .30*size, "wood", (0, math.pi/2, 0))
        if reinforced:
            cylinder("Brass barrel collar", (x+s*.39*size, y, z), .216*size, .075*size, "butter", (0, math.pi/2, 0))


def whisk(x, y, z, size=1, mat="rim"):
    cylinder("Whisk wood grip", (x, y, z+.15*size), .095*size, .30*size, "wood")
    cylinder("Whisk brass ferrule", (x, y, z+.32*size), .10*size, .065*size, "butter")
    for a in range(4):
        t = math.pi*a/4
        dx, dy = .28*size*math.cos(t), .28*size*math.sin(t)
        tube("Thick clay wire loop", [(x, y, z+.32*size), (x-dx, y-dy, z+.65*size),
             (x, y, z+1.02*size), (x+dx, y+dy, z+.65*size), (x, y, z+.32*size)], .027*size, mat)


def tower(kind, tier):
    tower_base(tier, {"pin": "roof", "sifter": "glass", "whisk": "sage", "oven": "rose"}[kind])
    if kind == "pin":
        for s in (-1, 1):
            box("Pin fork support", (s*.44, 0, .44), (.13, .28, .43), "wood")
        pin((0, 0, .69), 1, tier > 0)
        if tier == 1:
            box("Heavy rolling cradle", (0, .12, .4), (1.12, .44, .12), "butter")
        if tier == 2:
            pin((0, .04, 1.11), .85, True)
            for s in (-1, 1):
                box("Double barrel upright", (s*.5, .15, .75), (.09, .12, .75), "butter")
    elif kind == "sifter":
        h = .54 + tier*.10
        cylinder("Enamel flour sifter", (0, 0, .31+h/2), .43, h, "glass")
        cylinder("Open flour top", (0, 0, .32+h), .37, .022, "flour")
        ring("Sifter rolled lip", (0, 0, .34+h), .42, .045, "rim")
        tube("Loop handle", [(.4, 0, .7), (.7, 0, .72), (.72, 0, .42), (.41, 0, .42)], .055, "wood")
        for i in range(5):
            for j in range(2):
                ball("Sieve perforation", ((i-2)*.13, -.415, .43+j*.11), (.025, .016, .025), "iron")
        if tier > 0:
            ring("Brass sieve band", (0, 0, .38), .44, .045, "butter")
            tube("Hand crank", [(-.43, 0, .63), (-.63, 0, .63), (-.63, 0, .88)], .045, "butter", False)
            ball("Crank knob", (-.63, 0, .9), (.085, .075, .075), "wood")
        if tier == 2:
            cylinder("Second sieve chamber", (0, 0, 1.15), .3, .26, "cream")
            ring("Upper chamber lip", (0, 0, 1.29), .3, .045, "butter")
            ball("Flour mound", (0, 0, 1.28), (.25, .25, .10), "flour")
    elif kind == "whisk":
        cylinder("Mixing bowl", (0, 0, .39), .29, .3, "sage", top=.45)
        cylinder("Cream inside bowl", (0, 0, .55), .39, .025, "cream")
        ring("Bowl rim", (0, 0, .55), .43, .035, "rim")
        if tier == 0:
            whisk(0, 0, .53, .78)
        else:
            for s in (-1, 1):
                whisk(s*.21, 0, .52, .68 if tier == 1 else .8, "rim" if tier == 1 else "butter")
        if tier == 2:
            box("Stand mixer arm", (0, .28, 1.19), (.91, .28, .19), "sage")
            box("Mixer upright", (.5, .28, .77), (.16, .22, .95), "sage")
            ball("Mixer brass dial", (.49, .12, .94), (.065, .03, .065), "butter")
    else:
        box("Rounded enamel oven", (0, .03, .69), (1.05, .82, .88), "roof" if tier == 0 else "rose", .13)
        box("Dark oven door", (0, -.396, .61), (.77, .045, .53), "dark", .08)
        box("Warm fire window", (0, -.425, .60), (.59, .025, .34), "crust", .07)
        for i in (-1, 0, 1):
            ball("Warm coals", (i*.16, -.445, .50), (.095, .018, .05), "fire")
        tube("Oven door handle", [(-.26, -.47, .85), (0, -.49, .85), (.26, -.47, .85)], .037, "butter")
        for s in (-1, 1):
            ball("Enamel control dial", (s*.28, -.42, 1.01), (.065, .035, .065), "cream")
        if tier > 0:
            cylinder("Chimney", (.30, .18, 1.27), .13, .4, "iron")
            cylinder("Chimney cap", (.30, .18, 1.48), .18, .07, "butter")
            box("Oven top trim", (0, 0, 1.12), (1.08, .86, .07), "butter", .035)
        if tier == 2:
            box("Upper baking chamber", (-.12, .03, 1.29), (.69, .65, .29), "cream", .08)
            box("Upper chamber slit", (-.12, -.31, 1.29), (.49, .03, .12), "dark", .035)
            for s in (-1, 1):
                box("Reinforced side panel", (s*.54, .02, .68), (.11, .72, .72), "butter", .04)


def pest(kind, frame):
    phase = .3 + frame*math.tau/4
    bob = .015*math.cos(2*phase)
    if kind in ("ant", "beetle"):
        for side in (-1, 1):
            for j in range(3):
                x = (j-1)*.23
                swing = .11*math.sin(phase+j*math.pi+side*.5)
                tube("Stepping insect leg", [(x, side*.12, .23), (x-.10, side*.32, .16),
                     (x+swing, side*.47, .035+.035*max(0, math.cos(phase+j+side)))], .026, "ant" if kind == "ant" else "dark", False)
        if kind == "ant":
            ball("Ant abdomen", (-.31, 0, .29+bob), (.29, .22, .22), "ant")
            ball("Ant waist", (.01, 0, .27+bob), (.14, .12, .14), "crust")
            ball("Ant head", (.28, 0, .30+bob), (.21, .19, .18), "ant")
        else:
            ball("Armored beetle body", (-.12, 0, .29+bob), (.40, .30, .27), "shell")
            for side in (-1, 1):
                ball("Hard wing case", (-.13, side*.13, .39+bob), (.36, .16, .20), "sage")
                for j in range(3):
                    ball("Armor rivet", (-.32+j*.19, side*.235, .43+bob), (.025, .025, .025), "butter")
            tube("Wing armor seam", [(-.46, 0, .44), (-.10, 0, .59+bob), (.20, 0, .45)], .018, "shell")
            ball("Beetle helmet", (.28, 0, .30+bob), (.21, .23, .18), "shell")
        for side in (-1, 1):
            tube("Inquisitive antenna", [(.34, side*.10, .40), (.48, side*.20, .51),
                 (.57, side*(.24+.02*math.sin(phase)), .48)], .019, "dark")
            ball("Insect eye", (.42, side*.13, .35+bob), (.04, .025, .045), "dark")
            ball("Eye glint", (.44, side*.14, .37+bob), (.013, .01, .014), "cream")
    elif kind == "boss":
        before = set(bpy.data.objects)
        pest("mouse", frame)
        for obj in set(bpy.data.objects) - before:
            obj.location.x *= 1.3
            obj.location.y *= 1.65
            obj.location.z *= 1.35
            obj.scale.x *= 1.3
            obj.scale.y *= 1.65
            obj.scale.z *= 1.35
        ball("Big round boss belly", (-.13, 0, .38), (.49, .39, .35), "mouse")
    elif kind == "mouse":
        tube("Curled pink tail", [(-.35, 0, .20), (-.59, .03, .13), (-.67, .26, .09),
             (-.52, .38+.04*math.sin(phase), .08)], .028, "pink")
        for side in (-1, 1):
            for j in (-1, 1):
                swing = math.sin(phase+j+side)*.09
                ball("Scampering paw", (j*.22+swing, side*.20, .055), (.11, .07, .047), "pink")
        ball("Mouse pear body", (-.10, 0, .28+bob), (.38, .25, .25), "mouse")
        ball("Mouse snout", (.27, 0, .25+bob), (.28, .17, .16), "mouse")
        ball("Pink nose", (.52, 0, .26+bob), (.047, .056, .047), "pink")
        for side in (-1, 1):
            ball("Round mouse ear", (.14, side*.17, .48+bob), (.13, .085, .15), "mouse")
            ball("Velvet ear inside", (.19, side*.174, .50+bob), (.082, .06, .10), "pink")
            ball("Mouse eye", (.34, side*.13, .35+bob), (.038, .026, .047), "dark")
            ball("Eye highlight", (.355, side*.145, .37+bob), (.012, .01, .014), "flour")
            for j in (-1, 1):
                tube("Mouse whisker", [(.41, side*.09, .25), (.44+j*.09, side*.28, .27+j*.035)], .009, "cream", False)
    else:
        z = .47 + .035*math.sin(phase)
        ball("Flying sparrow body", (-.04, 0, z), (.30, .18, .22), "kraft")
        ball("Cream sparrow breast", (.10, -.055, z-.07), (.22, .155, .16), "cream")
        ball("Chestnut crown", (.24, 0, z+.12), (.20, .16, .19), "wood")
        ball("Sparrow cheek", (.29, -.12, z+.06), (.12, .045, .10), "cream")
        beak = ball("Pointed golden beak", (.43, 0, z+.08), (.13, .07, .06), "butter")
        for side in (-1, 1):
            wing = ball("Flapping wing", (-.14, side*.28, z+.04+.16*math.sin(phase)), (.26, .34, .065), "wood")
            wing.rotation_euler.x = side*.48*math.sin(phase)
            for j in range(3):
                feather = ball("Cream wing feather edge", (-.31+j*.1, side*.42, z+.01+.16*math.sin(phase)), (.055, .15, .035), "kraft")
                feather.rotation_euler.x = wing.rotation_euler.x
            ball("Sparrow eye", (.33, side*.125, z+.15), (.033, .022, .038), "dark")
            ball("Sparrow eye glint", (.34, side*.14, z+.165), (.011, .009, .012), "flour")
            tube("Tucked bird foot", [(-.02, side*.08, z-.15), (.09, side*.10, z-.24)], .021, "roof", False)
        for side in (-1, 0, 1):
            tail = ball("Tail feather", (-.40, side*.065, z+.06), (.20, .05, .035), "wood")
            tail.rotation_euler.y = -.18


def projectile(kind):
    if kind == "pin":
        pin((0, 0, .16), .46, True)
    elif kind == "whisk":
        for i in range(3):
            ring("Whisk cream spiral", (0, 0, .10+i*.04), .13+i*.07, .038, "cream" if i % 2 else "butter")
        ball("Whipped center", (0, 0, .18), (.1, .10, .09), "flour")
    else:
        for i in range(4):
            ball("Baked heat trail", (-.25+i*.12, 0, .15), (.13+i*.02, .07+i*.026, .06+i*.025), "roof" if i < 2 else "fire")
        ball("Golden ember core", (.18, -.035, .20), (.10, .065, .07), "score")


def puff(frame):
    phase = frame/3
    for i in range(7):
        a = i*math.tau/7
        distance = .09+phase*.32
        radius = .13*(1-phase*.50)
        ball("Flour impact puff", (distance*math.cos(a), distance*math.sin(a), .13+phase*.1),
             (radius, radius, radius), "flour" if i % 2 else "cream")
    if frame < 2:
        ball("Puff center", (0, 0, .16), (.22-frame*.05,)*3, "flour")


def slot():
    cylinder("Quiet placement pad", (0, 0, .025), .52, .035, "plaster")
    ring("Pad inset", (0, 0, .045), .47, .016, "kraft")
    for x, y in ((-.32, 0), (.32, 0), (0, -.32), (0, .32)):
        ball("Pad peg", (x, y, .05), (.022, .022, .012), "cream")


def soft_shadow(name):
    # Finite alpha decal: an infinite Cycles shadow catcher also captures distant
    # ambient occlusion/noise, which makes cropped sprite edges visibly rectangular.
    # Keep object self-shading physical, but bake a compact radial ground shadow.
    if name.startswith("tower-"):
        size, opacity = (1.88, 1.72), .42
    elif name.startswith("pest-"):
        size, opacity = (1.55, 1.05), .30 if name == "pest-sparrow" else .40
    elif name == "slot":
        size, opacity = (1.18, 1.18), .25
    else:
        size, opacity = (.98, .84), .22
    bpy.ops.mesh.primitive_plane_add(size=1, location=(.06, .02, .001))
    obj = bpy.context.object
    obj.name = "Soft finite ground shadow"
    obj.scale = (*size, 1)
    mat = bpy.data.materials.new("Radial transparent clay shadow")
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    nodes.clear()
    tex = nodes.new("ShaderNodeTexCoord")
    sub = nodes.new("ShaderNodeVectorMath")
    sub.operation = "SUBTRACT"
    sub.inputs[1].default_value = (.5, .5, 0)
    links.new(tex.outputs["Generated"], sub.inputs[0])
    scale = nodes.new("ShaderNodeVectorMath")
    scale.operation = "MULTIPLY"
    scale.inputs[1].default_value = (2, 2, 0)
    links.new(sub.outputs[0], scale.inputs[0])
    length = nodes.new("ShaderNodeVectorMath")
    length.operation = "LENGTH"
    links.new(scale.outputs[0], length.inputs[0])
    falloff = nodes.new("ShaderNodeMath")
    falloff.operation = "SUBTRACT"
    falloff.inputs[0].default_value = 1
    falloff.use_clamp = True
    links.new(length.outputs["Value"], falloff.inputs[1])
    alpha = nodes.new("ShaderNodeMath")
    alpha.operation = "MULTIPLY"
    alpha.inputs[1].default_value = opacity
    links.new(falloff.outputs[0], alpha.inputs[0])
    transparent = nodes.new("ShaderNodeBsdfTransparent")
    ink = nodes.new("ShaderNodeEmission")
    ink.inputs[0].default_value = (.065, .045, .027, 1)
    mix = nodes.new("ShaderNodeMixShader")
    links.new(alpha.outputs[0], mix.inputs[0])
    links.new(transparent.outputs[0], mix.inputs[1])
    links.new(ink.outputs[0], mix.inputs[2])
    out = nodes.new("ShaderNodeOutputMaterial")
    links.new(mix.outputs[0], out.inputs[0])
    obj.data.materials.append(mat)
    # The shadow is compositing art, not an opaque surface seen by other light rays.
    obj.visible_shadow = False
    obj.visible_diffuse = False
    obj.visible_glossy = False


SPECS = []


def render_asset(name, count, width, height, build, fps=0, loop=False, map_index=None):
    if SELECTED and name not in SELECTED:
        return
    is_map = map_index is not None
    ppm = 100 if is_map else PPM
    spec = {"id": name, "frameSize": [width, height], "frameCount": count,
            "supersample": 2, "pixelsPerMetre": ppm, "fps": fps, "loop": loop,
            "renderer": {"blender": bpy.app.version_string, "engine": "Cycles CPU",
                         "samples": args.samples, "supersample": 2, "downsample": "Lanczos3"}, "frames": []}
    if is_map:
        spec["map"] = {**MAPS[map_index], "source": "src/lib/td/maps.ts", "sha256": MAP_HASH,
                       "pathWidth": 74, "slotRadius": SLOT_RADIUS, "breadClearance": 115}
    if name.startswith("pest-"):
        spec["facing"] = {"mode": "rotate", "defaultDirection": "right", "radians": "atan2(dy, dx)",
                          "pivot": "frame.anchor", "shadow": "baked; rotates with sprite"}
    for frame in range(count):
        scene = setup(width, height, max(width, height)/ppm, not is_map,
                      target=(0, 0, 0) if is_map else (0, 0, .25))
        build(frame)
        if is_map:
            data = spec["map"]
            data["projectedPath"] = [projected(scene, pixel_world(x, y, .012)) for x, y in data["path"]]
            data["projectedSlots"] = [projected(scene, pixel_world(x, y, .024)) for x, y in data["slots"]]
            for key in ("Path", "Slots"):
                for actual, expected in zip(data["projected"+key], data[key.lower()]):
                    assert math.dist(actual, expected) < .01, (name, key, actual, expected)
        else:
            soft_shadow(name)
        file = f"{name}-{frame:02d}.png"
        scene.render.filepath = str(CACHE / file)
        bpy.ops.render.render(write_still=True)
        spec["frames"].append({"file": file, "anchor": [0, 0] if is_map else projected(scene, (0, 0, 0))})
    SPECS.append(spec)
    # Checkpoint every completed atlas; interrupted builds can resume with --only.
    metadata = CACHE / "renders.json"
    previous = {s["id"]: s for s in json.loads(metadata.read_text())} if metadata.exists() else {}
    previous[name] = spec
    metadata.write_text(json.dumps(list(previous.values()), indent=2)+"\n")


for index in range(3):
    render_asset(f"map-{index+1}", 1, 1440, 810, lambda f, i=index: map_scene(i), map_index=index)
for kind in ("pin", "sifter", "whisk", "oven"):
    for tier in range(3):
        render_asset(f"tower-{kind}-{tier}", 1, 128, 144, lambda f, k=kind, t=tier: tower(k, t))
for kind in ("ant", "mouse", "sparrow", "beetle", "boss"):
    render_asset(f"pest-{kind}", 4, 112, 112, lambda f, k=kind: pest(k, f), fps=10 if kind == "sparrow" else 8, loop=True)
for kind in ("pin", "whisk", "oven"):
    render_asset(f"proj-{kind}", 1, 64, 64, lambda f, k=kind: projectile(k))
render_asset("fx-hit", 4, 80, 80, puff, fps=16)
render_asset("slot", 1, 80, 80, lambda f: slot())
print("D6 rendering complete:", CACHE / "renders.json", flush=True)
