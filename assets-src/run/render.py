"""D146: original, procedural clay-town artwork. Run with Blender, not system Python."""
import argparse
import json
import math
import random
import sys
from pathlib import Path

import bpy
import _cycles
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view

ROOT = Path(__file__).resolve().parent
CACHE = ROOT / ".cache"
CACHE.mkdir(exist_ok=True)
parser = argparse.ArgumentParser()
parser.add_argument("--only", default="", help="Comma-separated asset IDs; default: all")
parser.add_argument("--samples", type=int, default=128)
args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
SELECTED = set(filter(None, args.only.split(",")))
PALETTE = {
    "cream": "F8EEDB", "fur": "FFF9ED", "pink": "E8B3A0", "butter": "E5B95F",
    "crust": "B86E32", "bread": "E5AA56", "score": "FADE9D", "kraft": "BD8A53",
    "fold": "99683D", "wood": "80573E", "dark": "46392F", "sage": "9CA981",
    "stone": "C1B6A6", "grout": "9D9388", "rose": "CF9580", "glass": "AFC8C3",
    "water": "91B7BD", "rim": "CCDAD0", "roof": "BD8062", "plaster": "E6D5B9",
}
MATS = {}


def linear(v):
    return v / 12.92 if v < .04045 else ((v + .055) / 1.055) ** 2.4


def material(key, color=None, roughness=.7):
    if key in MATS:
        return MATS[key]
    h = color or PALETTE[key]
    rgb = tuple(linear(int(h[i:i+2], 16) / 255) for i in (0, 2, 4))
    m = bpy.data.materials.new(key)
    m.diffuse_color = (*rgb, 1)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*rgb, 1)
    bsdf.inputs["Roughness"].default_value = roughness
    MATS[key] = m
    return m


def finish(obj, mat, parent=None):
    obj.data.materials.append(material(mat))
    if parent:
        obj.parent = parent
    return obj


def group(name, loc=(0, 0, 0), rot=(0, 0, 0), parent=None):
    obj = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(obj)
    obj.location = loc
    obj.rotation_euler = rot
    obj.parent = parent
    return obj


def ball(name, loc, scale, mat, parent=None):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=16, location=loc)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    for p in obj.data.polygons:
        p.use_smooth = True
    return finish(obj, mat, parent)


def box(name, loc, size, mat, bevel=.06, parent=None):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        mod = obj.modifiers.new("Soft molded edges", "BEVEL")
        mod.width = bevel
        mod.segments = 3
        obj.modifiers.new("Weighted face normals", "WEIGHTED_NORMAL")
    return finish(obj, mat, parent)


def tube(name, points, radius, mat, parent=None):
    curve = bpy.data.curves.new(name, "CURVE")
    curve.dimensions = "3D"
    curve.resolution_u = 16
    curve.bevel_depth = radius
    curve.bevel_resolution = 3
    spline = curve.splines.new("BEZIER")
    spline.bezier_points.add(len(points)-1)
    for p, co in zip(spline.bezier_points, points):
        p.co = co
        p.handle_left_type = "AUTO"
        p.handle_right_type = "AUTO"
    obj = bpy.data.objects.new(name, curve)
    bpy.context.collection.objects.link(obj)
    return finish(obj, mat, parent)


def cylinder(name, loc, radius, depth, mat, parent=None, rotation=(0, 0, 0), top=None):
    bpy.ops.mesh.primitive_cone_add(vertices=48, radius1=radius, radius2=radius if top is None else top,
                                    depth=depth, location=loc, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    bevel = obj.modifiers.new("Rounded rim", "BEVEL")
    bevel.width = .035
    bevel.segments = 3
    obj.modifiers.new("Weighted normals", "WEIGHTED_NORMAL")
    return finish(obj, mat, parent)


def mesh(name, vertices, faces, mat, parent=None):
    data = bpy.data.meshes.new(name)
    data.from_pydata(vertices, [], faces)
    data.update()
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    return finish(obj, mat, parent)


def loaf(parent=None, loc=(0, 0, 0), scale=1, rotation=0):
    root = group("Hand-scored little loaf", loc, (0, 0, rotation), parent)
    root.scale = (scale,) * 3
    ball("Toasted underside", (0, 0, .17), (.42, .65, .22), "crust", root)
    ball("Golden dough", (0, 0, .27), (.43, .65, .29), "bread", root)
    for y, width in ((-.32, .23), (0, .29), (.32, .26)):
        tube("Cream scoring", [(-width, y-.07, .45), (0, y, .56), (width, y+.07, .45)], .032, "score", root)
    return root


def bread_bag(parent=None, loc=(0, 0, 0), scale=1, with_bread=True):
    root = group("Folded kraft bread bag", loc, parent=parent)
    root.scale = (scale,) * 3
    box("Paper bag", (0, 0, .46), (.7, .39, .87), "kraft", .065, root)
    # Open, serrated mouth and folded side seams are geometry, not a texture.
    box("Open mouth", (0, 0, .91), (.59, .29, .035), "fold", .015, root)
    for y in (-.2, .2):
        vertices = []
        for i in range(15):
            x = -.35 + .7*i/14
            vertices.extend([(x, y, .81), (x, y, .98 if i % 2 else .93)])
        mesh("Zigzag paper lip", vertices, [(2*i, 2*i+1, 2*i+3, 2*i+2) for i in range(14)], "kraft", root)
    for x in (-.29, .29):
        tube("Folded seam", [(x, -.205, .1), (x*.9, -.207, .5), (x, -.205, .81)], .012, "fold", root)
    # Brand mark is a tiny sculpted bunny silhouette, never lettering.
    ball("Bunny stamp head", (0, -.204, .42), (.11, .012, .09), "fold", root)
    for x in (-.05, .05):
        ball("Bunny stamp ear", (x, -.205, .55), (.035, .012, .09), "fold", root)
    if with_bread:
        for x, tilt in ((-.17, -.15), (.15, .13)):
            bun = loaf(root, (x, .03, .91), .43, tilt)
            bun.rotation_euler.x = .85
    return root


def bunny(action, frame):
    phase = frame * math.tau / 8
    bob = .035 * (1-math.cos(phase*2)) if action == "run" else 0
    root = group("Courier pose", (0, 0, bob), (0, 0, math.radians(-12)))
    if action == "lean":
        root.rotation_euler.y = -.24 if frame == 0 else .24
        root.rotation_euler.z += .13 if frame == 0 else -.13
    if action == "jump":
        root.location.z = (0, .15, .04)[frame]
        root.rotation_euler.x = (-.13, -.22, .12)[frame]
    if action == "slide":
        root.rotation_euler.x = (-1.08, -1.18)[frame]
        root.location = (0, -.3, .12)
    if action == "crash":
        root.rotation_euler.x = (-.22, -.83, -1.50)[frame]
        root.rotation_euler.y = (.12, .3, .46)[frame]
        root.rotation_euler.z += (0, -.12, -.35)[frame]
        root.location = (0, -.22, (0, .08, .18)[frame])
    ball("Pear-shaped white body", (0, 0, .94), (.41, .33, .55), "fur", root)
    ball("Round head", (0, .065, 1.57), (.45, .38, .39), "fur", root)
    for side in (-1, 1):
        ear = group("Soft ear", (side*.21, .08, 1.82), parent=root)
        ear.rotation_euler = (.12 + .08*math.sin(phase+side) if action == "run" else .15,
                              side*(.12 + (.09 if action == "crash" else 0)), 0)
        if action == "slide":
            ear.rotation_euler.x = 1.9 + side*.08
        elif action == "crash":
            ear.rotation_euler.x = (.3, 1.15, 2.0)[frame] + side*.12
        ball("Long ear", (0, 0, .38), (.135, .105, .45), "fur", ear)
        # Warm pink is visible on the edge of the turned ears from behind.
        ball("Ear inset", (side*.04, -.075, .4), (.071, .026, .32), "pink", ear)
        leg = group("Hind leg", (side*.235, 0, .58), parent=root)
        swing = math.sin(phase + (math.pi if side == 1 else 0))*.75 if action in ("run", "lean") else 0
        if action == "jump":
            swing = (.3, -.85, .5)[frame]
        if action == "slide":
            swing = -.5
        leg.rotation_euler.x = swing
        ball("Haunch", (0, 0, -.13), (.19, .21, .28), "fur", leg)
        ball("Long bunny foot", (0, .10, -.37), (.19, .31, .13), "cream", leg)
        arm = group("Swinging forepaw", (side*.37, .015, 1.18), parent=root)
        arm.rotation_euler.x = -swing*.8 if action != "crash" else -1.0
        arm.rotation_euler.y = side*(.18 if action != "jump" else .5)
        ball("Paw", (0, .03, -.24), (.13, .14, .32), "fur", arm)
        tube("Delivery strap", [(side*.24, -.19, 1.36), (side*.3, -.35, 1.2),
                               (side*.27, -.36, .69)], .035, "fold", root)
    bread_bag(root, (0, -.48, .62), .9)
    ball("Cotton tail", (0, -.34, .53), (.19, .18, .18), "fur", root)
    # Face belongs on the forward side; a cheek/nose profile appears in the lean.
    for x in (-.22, .22):
        ball("Eye", (x, .387, 1.62), (.035, .025, .045), "dark", root)
    ball("Nose", (0, .442, 1.48), (.055, .025, .04), "pink", root)


def cart():
    for x in (-.67, .67):
        for y in (-.42, .48):
            cylinder("Wooden cart wheel", (x, y, .30), .28, .12, "wood", rotation=(0, math.pi/2, 0))
            cylinder("Butter hub", (x*1.08, y, .30), .10, .13, "butter", rotation=(0, math.pi/2, 0))
    box("Cart base", (0, 0, .57), (1.35, 1.3, .18), "wood")
    for x in (-.63, .63):
        box("Crate side", (x, 0, .93), (.10, 1.27, .65), "kraft")
    for z in (.71, .96):
        for y in (-.60, .60):
            box("Crate slat", (0, y, z), (1.3, .09, .20), "kraft", .025)
    for x in (-.42, 0, .42):
        loaf(loc=(x, 0, 1.13), scale=.57, rotation=.14)
    for x in (-.5, .5):
        tube("Delivery push handle", [(x, .45, .6), (x, .96, .94), (x, 1.06, 1.36)], .055, "wood")
    tube("Handle crossbar", [(-.5, 1.06, 1.36), (.5, 1.06, 1.36)], .055, "wood")


def sack(loc, size=1, rotation=0):
    root = group("Soft flour sack", loc, (0, 0, rotation))
    root.scale = (size,) * 3
    ball("Flour-filled sack", (0, 0, .35), (.42, .31, .42), "cream", root)
    ball("Gathered neck", (0, 0, .71), (.18, .15, .13), "cream", root)
    tube("Twine", [(-.15, -.03, .69), (0, -.15, .69), (.15, 0, .69), (0, .15, .69), (-.15, -.03, .69)], .022, "kraft", root)
    tube("Wheat stem", [(0, -.304, .2), (.02, -.323, .47)], .014, "kraft", root)
    for z in (.28, .36, .44):
        for side in (-1, 1):
            seed = ball("Wheat grain", (side*.065, -.31, z), (.045, .015, .072), "butter", root)
            seed.rotation_euler.y = side*.6


def awning(parent=None, loc=(0, 0, 0), scale=1, color="butter", poles=True):
    root = group("Striped shop awning", loc, parent=parent)
    root.scale = (scale,) * 3
    if poles:
        for x in (-.92, .92):
            cylinder("Awning post", (x, .20, .98), .045, 1.96, "wood", root)
            ball("Round post cap", (x, .20, 2), (.075, .075, .075), "butter", root)
    # A low, broad lintel reads as an overhead slide obstacle.
    for i in range(10):
        x0, x1 = -1.03+i*.206, -1.03+(i+1)*.206
        vertices = []
        for x in (x0, x1):
            for j in range(9):
                t = j/8
                vertices.append((x, .42-t*1.1, 1.92-.26*t-.08*t*t))
        cloth = mesh("Canvas stripe", vertices, [(j, j+1, j+10, j+9) for j in range(8)], color if i % 2 == 0 else "cream", root)
        solid = cloth.modifiers.new("Thick canvas", "SOLIDIFY")
        solid.thickness = .025
        box("Scalloped hem", ((x0+x1)/2, -.68, 1.48), (.206, .065, .24), color if i % 2 == 0 else "cream", .075, root)
    return root


def puddle():
    # Irregular closed shoreline; smooth, shallow water with warm dawn glints.
    random.seed(146)
    points = []
    for i in range(40):
        t = i*math.tau/40
        r = 1 + .09*math.sin(t*3) + .06*math.cos(t*5)
        points.append((math.cos(t)*.93*r, math.sin(t)*.62*r, .035))
    water = mesh("Rain puddle", [(0, 0, .035)] + points, [(0, i+1, (i+1) % 40+1) for i in range(40)], "water")
    material("water").node_tree.nodes.get("Principled BSDF").inputs["Roughness"].default_value = .22
    tube("Wet stone rim", points+[points[0]], .026, "rim")
    for y, width in ((-.15, .5), (.12, .3)):
        tube("Sky reflection", [(-width, y, .045), (0, y-.025, .045), (width*.45, y+.03, .045)], .018, "cream")


def coffee():
    cylinder("Takeaway cup", (0, 0, .51), .28, .78, "cream", top=.38)
    cylinder("Kraft heat sleeve", (0, 0, .49), .315, .31, "kraft", top=.35)
    cylinder("Coffee lid", (0, 0, .93), .405, .10, "wood")
    cylinder("Lid lip", (0, 0, .99), .35, .06, "fold")
    ball("Sip opening", (0, -.22, 1.025), (.09, .035, .009), "dark")
    for x in (-.13, .13):
        tube("Sculpted steam", [(x, 0, 1.12), (x-.055, 0, 1.26), (x+.035, 0, 1.42)], .027, "cream")


def road():
    random.seed(146)
    box("Continuous warm grout", (0, 0, -.11), (6.4, 12, .18), "grout", 0)
    # Periodic stone pattern: copies cross the render boundaries at y = +/-2.
    for row in range(-5, 6):
        for col in range(-4, 5):
            x = col*.78 + (row % 2)*.39
            y = row*.5
            idx = (row % 8)*9+col
            key = "stone"+str(idx % 5)
            colors = ["C8BDAC", "BEB4A6", "D0C3AF", "B9B0A3", "C5B9A7"]
            material(key, colors[idx % 5])
            box("Rounded paving stone", (x, y, -.007), (.74, .46, .10), key, .065)


def shop(side, variant):
    # Camera-space vertical repeat: y translation by 20/3 gives exactly 4 units
    # screen-up at this camera elevation. Neighbor copies preserve edge occlusion.
    palette = ("butter", "sage", "rose")
    color = palette[variant]
    period = 20/3
    for repeat in range(-2, 3):
        g = group("Periodic shop module", (0, repeat*period, 0))
        box("Sidewalk", (0, 0, -.07), (2.6, period+.02, .14), "stone", .015, g)
        # Road-facing curb stays on the inner edge; left and right are separate renders.
        inner = .96 if side == "left" else -.96
        for i in range(10):
            box("Curb block", (inner, -period/2+(i+.5)*period/10, .04), (.19, period/10-.025, .19), "cream", .025, g)
        x = -.16 if side == "left" else .16
        house = group("Little stone-street shop", (x, .10, 0), parent=g)
        box("Plaster shop walls", (0, 0, 1.04), (1.56, 2.65, 2.08), "plaster", .065, house)
        box("Foundation", (0, -.04, .16), (1.68, 2.7, .29), "cream", .04, house)
        for z in (.61, 1.12, 1.63):
            for sx in (-.72, .72):
                box("Corner stone", (sx, -1.335, z), (.19, .09, .20), "cream", .02, house)
        box("Display window surround", (-.26, -1.357, 1.12), (.72, .10, .91), "wood", .08, house)
        box("Morning glass", (-.26, -1.42, 1.12), (.59, .035, .77), "glass", .04, house)
        box("Window mullion", (-.26, -1.45, 1.12), (.055, .035, .77), "cream", .01, house)
        box("Door", (.42, -1.38, .68), (.38, .09, 1.15), color, .06, house)
        box("Door pane", (.42, -1.435, .89), (.23, .025, .50), "glass", .03, house)
        ball("Brass door knob", (.53, -1.46, .55), (.028, .025, .028), "butter", house)
        box("Window ledge", (-.26, -1.5, .69), (.88, .26, .09), "cream", .025, house)
        for bx in (-.44, -.16):
            loaf(house, (bx, -1.48, .74), .19, math.pi/2)
        awning(house, (0, -1.25, .55), .73, color, poles=False)
        # Rounded terracotta roof made of individual procedural tiles.
        for sx in (-1, 1):
            roof = box("Pitched roof", (sx*.43, 0, 2.19), (.99, 2.98, .14), "roof", .05, house)
            roof.rotation_euler.y = sx*.40
            for iy in range(9):
                tube("Roof tile roll", [(sx*.04, -1.36+iy*.34, 2.43), (sx*.86, -1.36+iy*.34, 2.10)], .042, "roof", house)
        box("Chimney", (.46, .65, 2.43), (.26, .32, .6), "cream", .04, house)
        box("Chimney cap", (.46, .65, 2.76), (.34, .4, .10), "wood", .03, house)
        # A planter and small courtyard vary the rhythm without visible signage.
        potx = -.53 if side == "left" else .53
        cylinder("Clay flowerpot", (potx, -1.96, .21), .19, .38, "roof", g, top=.25)
        for dx, dy, dz in ((0, 0, .55), (-.15, .03, .45), (.14, -.03, .48)):
            ball("Rounded herb leaves", (potx+dx, -1.96+dy, dz), (.19, .18, .23), "sage", g)
        box("Courtyard bench", (-x, 2.15, .34), (1.1, .42, .12), "wood", .045, g)
        for bx in (-.4, .4):
            box("Bench feet", (-x+bx, 2.15, .16), (.09, .30, .3), "wood", .02, g)


def setup(width, height, span, target=(0, 0, 1.2), transparent=True, top=False):
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    # Remove orphan meshes between frames; keep shared materials.
    for collection in (bpy.data.meshes, bpy.data.curves, bpy.data.cameras, bpy.data.lights):
        for block in list(collection):
            if block.users == 0:
                collection.remove(block)
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = args.samples
    # Debian's ARM build may omit OpenImageDenoise; CPU rendering still works.
    scene.cycles.use_denoising = bool(getattr(_cycles, "with_openimagedenoise", False))
    if not scene.cycles.use_denoising:
        scene.cycles.samples = max(args.samples, 64)
    scene.cycles.seed = 146
    scene.render.threads_mode = "FIXED"
    scene.render.threads = 8
    scene.render.resolution_x, scene.render.resolution_y = width, height
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
    camera.location = target + Vector((0, 0, 10) if top else (0, -8, 6))
    camera.rotation_euler = (target-camera.location).to_track_quat("-Z", "Y").to_euler()
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = span
    scene.camera = camera
    bpy.ops.object.light_add(type="SUN", location=(-3, -4, 8))
    sun = bpy.context.object
    sun.rotation_euler = (.4, -.5, -.4)
    sun.data.energy = 2.4
    sun.data.angle = .18
    sun.data.color = (1, .86, .68)
    return scene


def anchor(scene, point=(0, 0, 0)):
    bpy.context.view_layer.update()
    uv = world_to_camera_view(scene, scene.camera, Vector(point))
    return [round(uv.x*scene.render.resolution_x, 3), round((1-uv.y)*scene.render.resolution_y, 3)]


def sky():
    scene = setup(780, 960, 10, (0, 0, 0), transparent=False, top=True)
    # An emissive color field needs the sRGB transfer, not the clay scene's
    # highlight compression; preserve the intended peach-to-blue dawn palette.
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.exposure = 0
    # Generated world-space emission gradient: no external bitmap dependencies.
    m = bpy.data.materials.new("Procedural dawn gradient")
    m.use_nodes = True
    nodes, links = m.node_tree.nodes, m.node_tree.links
    nodes.clear()
    tex = nodes.new("ShaderNodeTexCoord")
    sep = nodes.new("ShaderNodeSeparateXYZ")
    ramp = nodes.new("ShaderNodeValToRGB")
    stops = [(0, "F6DFC0"), (.28, "F2D3B6"), (.58, "DBC8BB"), (1, "AFC1CB")]
    ramp.color_ramp.elements.remove(ramp.color_ramp.elements[1])
    for i, (pos, h) in enumerate(stops):
        el = ramp.color_ramp.elements[0] if i == 0 else ramp.color_ramp.elements.new(pos)
        el.position = pos
        el.color = (*[linear(int(h[j:j+2], 16)/255) for j in (0, 2, 4)], 1)
    emission = nodes.new("ShaderNodeEmission")
    out = nodes.new("ShaderNodeOutputMaterial")
    links.new(tex.outputs["Generated"], sep.inputs[0])
    links.new(sep.outputs["Y"], ramp.inputs[0])
    links.new(ramp.outputs[0], emission.inputs[0])
    links.new(emission.outputs[0], out.inputs[0])
    obj = box("Dawn color field", (0, 0, 0), (12, 12, .01), "cream", 0)
    obj.data.materials.clear()
    obj.data.materials.append(m)
    return scene


SPECS = []


def render_asset(name, count, width, height, span, build, target=(0, 0, 1.2), fps=0,
                 loop=False, top=False, tile=False, labels=None):
    spec = {"id": name, "frameSize": [width, height], "frameCount": count,
            "fps": fps, "loop": loop, "pixelRatio": 2,
            "renderer": {"blender": bpy.app.version_string, "engine": "Cycles CPU"}, "frames": []}
    if labels:
        spec["frameLabels"] = labels
    if tile:
        spec["repeatAxis"] = "y"
    for i in range(count):
        if SELECTED and name not in SELECTED:
            continue
        scene = setup(width, height, span, target, top=top)
        build(i)
        spec["frames"].append({"anchor": anchor(scene), "file": f"{name}-{i:02}.png"})
        scene.render.filepath = str(CACHE / f"{name}-{i:02}.png")
        bpy.ops.render.render(write_still=True)
    SPECS.append(spec)


for action, count, fps, loop, labels in (
    ("run", 8, 14, True, None),
    ("jump", 3, 0, False, ["takeoff", "airborne", "landing"]),
    ("slide", 2, 8, True, ["enter", "hold"]),
    ("lean", 2, 0, False, ["left", "right"]),
    ("crash", 3, 8, False, ["impact", "tumble", "rest"]),
):
    render_asset("bunny-"+action, count, 256, 320, 3.25, lambda i, a=action: bunny(a, i),
                 target=(0, 0, 1.2), fps=fps, loop=loop, labels=labels)
render_asset("bread-cart", 1, 320, 320, 2.9, lambda _: cart(), target=(0, 0, .85))
render_asset("flour-sacks", 1, 288, 288, 2.6,
             lambda _: [sack((-.40, 0, 0), 1, -.16), sack((.38, .12, 0), 1, .12), sack((0, .05, .66), .9, -.1)], target=(0, 0, .85))
render_asset("shop-awning", 1, 384, 384, 3.15, lambda _: awning(), target=(0, 0, 1.02))
render_asset("puddle", 1, 320, 192, 2.5, lambda _: puddle(), target=(0, 0, 0))
render_asset("loaf-spin", 6, 128, 128, 1.65,
             lambda i: loaf(loc=(0, 0, .18), rotation=i*math.tau/6), target=(0, 0, .43), fps=10, loop=True)
render_asset("paper-bag", 1, 192, 224, 1.8, lambda _: bread_bag(), target=(0, 0, .64))
render_asset("coffee-cup", 1, 192, 224, 1.8, lambda _: coffee(), target=(0, 0, .70))
render_asset("road-stone", 1, 768, 512, 6, lambda _: road(), target=(0, 0, 0), top=True, tile=True)
for side in ("left", "right"):
    render_asset("shops-"+side, 3, 256, 512, 4, lambda i, s=side: shop(s, i),
                 target=(0, 0, 0), tile=True, labels=["butter", "sage", "rose"])
if not SELECTED or "sky-dawn" in SELECTED:
    scene = sky()
    scene.render.filepath = str(CACHE / "sky-dawn-00.png")
    bpy.ops.render.render(write_still=True)
SPECS.append({"id": "sky-dawn", "frameSize": [780, 960], "frameCount": 1, "pixelRatio": 2,
              "fps": 0, "loop": False, "frames": [{"anchor": [390, 960], "file": "sky-dawn-00.png"}]})

# A partial render updates only selected metadata, retaining the other full-render entries.
metadata_path = CACHE / "renders.json"
if SELECTED and metadata_path.exists():
    previous = {s["id"]: s for s in json.loads(metadata_path.read_text())}
    for spec in SPECS:
        if spec["id"] in SELECTED:
            previous[spec["id"]] = spec
    SPECS = list(previous.values())
metadata_path.write_text(json.dumps(SPECS, indent=2) + "\n")
print("R2 rendering complete:", metadata_path)
