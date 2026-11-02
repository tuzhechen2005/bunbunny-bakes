"""D-ART2: original, reproducible clay sprite geometry. Docker Blender / Cycles CPU."""
import argparse
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view

ROOT = Path(__file__).resolve().parent
CACHE = ROOT / ".cache"
CACHE.mkdir(exist_ok=True)
parser = argparse.ArgumentParser()
parser.add_argument("--only", default="")
parser.add_argument("--samples", type=int, default=128)
args = parser.parse_args(sys.argv[sys.argv.index("--")+1:] if "--" in sys.argv else [])
SELECTED = set(filter(None, args.only.split(",")))
ELEVATION = math.radians(55)
SIN, COS = math.sin(ELEVATION), math.cos(ELEVATION)
PPM = 112
ART_REVISION = "D-ART2-clay-1"
PALETTE = {
    "cream": "F8EEDB", "flour": "FFF9ED", "pink": "E8B3A0", "butter": "E5B95F",
    "crust": "B86E32", "bread": "E5AA56", "score": "FADE9D", "kraft": "BD8A53",
    "fold": "99683D", "wood": "80573E", "dark": "46392F", "sage": "9CA981",
    "stone": "C1B6A6", "grout": "9D9388", "rose": "CF9580", "glass": "AFC8C3",
    "rim": "CCDAD0", "roof": "BD8062", "plaster": "E6D5B9", "leaf": "6E8760",
    "soil": "9C8066", "tile": "E2CFB1", "mouse": "B4A598", "ant": "784D36",
    "shell": "426A55", "iron": "6C7772", "fire": "F4B85C",
    "ice": "75BBCD", "ice_dark": "397B96", "ice_light": "D0F0ED",
    "piping": "C57FA0", "piping_dark": "874C6D", "torch": "D69339",
    "copper": "AF563C", "berry": "D9604A", "mint": "6F9D82",
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
        bsdf.inputs["Roughness"].default_value = .82
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
    scene.world.node_tree.nodes["Background"].inputs[1].default_value = .35
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
    sun.data.energy, sun.data.angle = 2.2, .3
    sun.data.color = (1, .86, .68)
    # Two broad grazing lights trace the silhouette without a painted black stroke.
    for loc, energy, color, size in [((2, 3, 3.5), 220, (.72, .86, 1), 2.0),
                                    ((-3, 1, 2.8), 150, (1, .82, .59), 1.7)]:
        bpy.ops.object.light_add(type="AREA", location=loc)
        rim = bpy.context.object
        rim.name = "Clay silhouette rim"
        rim.data.energy, rim.data.color, rim.data.shape, rim.data.size = energy, color, "DISK", size
        rim.rotation_euler = (Vector((0, 0, .5))-rim.location).to_track_quat("-Z", "Y").to_euler()
    return scene


def projected(scene, point):
    bpy.context.view_layer.update()
    uv = world_to_camera_view(scene, scene.camera, Vector(point))
    return [round(uv.x*scene.render.resolution_x/2, 4),
            round((1-uv.y)*scene.render.resolution_y/2, 4)]


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
             (x, y, z+1.02*size), (x+dx, y+dy, z+.65*size), (x, y, z+.32*size)], .042*size, mat)


def tower(kind, tier):
    color = {"pin": "bread", "sifter": "glass", "whisk": "mint", "oven": "berry",
             "freezer": "ice", "piping": "piping", "torch": "torch"}[kind]
    tower_base(tier, color)
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
    elif kind == "oven":
        box("Rounded enamel oven", (0, .03, .69), (1.05, .82, .88), "berry", .16)
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


    elif kind == "freezer":
        box("Rounded icebox", (0, .02, .79), (1.02, .79, 1.05), "ice_dark", .16)
        box("Puffy freezer door", (0, -.405, .79), (.91, .13, .92), "ice", .13)
        box("Ivory top cap", (0, .02, 1.31), (1.05, .82, .13), "ice_light", .065)
        tube("Freezer pull", [(.30, -.51, .64), (.30, -.55, .84), (.30, -.51, 1.04)], .045, "cream")
        snowflake((-.12, -.49, .85), .23, .027)
        for x in (-.29, -.12, .05):
            box("Freezer vent", (x, -.49, .42), (.075, .025, .035), "ice_dark", .017)
        if tier > 0:
            for side in (-1, 1):
                box("Insulated side trim", (side*.50, .02, .80), (.12, .72, 1.02), "ice_light", .05)
            cylinder("Cold reservoir", (0, .05, 1.49), .29, .25, "ice")
            ring("Reservoir collar", (0, .05, 1.59), .29, .035, "cream")
        if tier == 2:
            for x in (-.36, .36):
                crystal = box("Crown ice block", (x, .03, 1.58), (.24, .27, .40), "ice_light", .055)
                crystal.rotation_euler.y = x*.6
            ball("Frozen reservoir pearl", (0, .05, 1.68), (.18, .18, .19), "ice_light")
    elif kind == "piping":
        cylinder("Bag holder", (0, 0, .36), .40, .23, "piping_dark", top=.47)
        ring("Holder rim", (0, 0, .48), .45, .045, "butter")
        # A plump tapered fabric bag, with raised folded seams and a star nozzle.
        cylinder("Piping bag taper", (0, 0, .85), .19, .68, "piping", top=.39)
        ball("Soft bag shoulder", (0, 0, 1.15), (.39, .31, .24), "piping")
        for x in (-.20, 0, .20):
            tube("Bag folded seam", [(x*.45, -.15, .58), (x*.9, -.27, .94), (x, -.25, 1.20)], .018, "pink")
        cylinder("Twisted bag neck", (0, 0, 1.39), .12, .21, "cream", top=.19)
        ring("Gold bag tie", (0, 0, 1.32), .12, .035, "butter")
        tube("Bag tie bow", [(0, -.12, 1.33), (-.19, -.14, 1.40), (-.14, -.15, 1.25),
                             (0, -.12, 1.33), (.19, -.14, 1.40), (.14, -.15, 1.25)], .035, "butter")
        cylinder("Front star piping nozzle", (0, -.43, .50), .16, .34, "rim", (math.pi/2, 0, 0), top=.08)
        for a in range(6):
            t = a*math.tau/6
            ball("Nozzle tooth", (.08*math.cos(t), -.61, .50+.08*math.sin(t)), (.025, .03, .025), "cream")
        if tier > 0:
            for x in (-.40, .40):
                tube("Bag pressure arm", [(x, 0, .40), (x, 0, .90), (x*.55, 0, 1.15)], .055, "butter")
            cream_swirl((.38, -.26, .32), .15)
        if tier == 2:
            ring("Bag crown band", (0, 0, 1.12), .36, .04, "butter")
            for x in (-.43, .43):
                cylinder("Extra precision nozzle", (x, -.25, .61), .09, .24, "butter", (math.pi/2, 0, 0), top=.045)
            cream_swirl((-.38, -.25, .32), .15)
    elif kind == "torch":
        cylinder("Caramel fuel tank", (0, .04, .69), .32, .77, "torch")
        ball("Rounded fuel shoulder", (0, .04, 1.04), (.32, .32, .20), "torch")
        ring("Fuel tank lower collar", (0, .04, .39), .33, .035, "copper")
        cylinder("Tank neck", (0, .04, 1.19), .12, .20, "iron")
        box("Torch trigger grip", (.02, .04, 1.34), (.22, .26, .26), "copper", .065)
        cylinder("Torch barrel", (.25, .04, 1.38), .13, .52, "iron", (0, math.pi/2, 0))
        cylinder("Brass burner lip", (.53, .04, 1.38), .17, .10, "butter", (0, math.pi/2, 0))
        ball("Caramel flame", (.71, .04, 1.39), (.20, .11, .13), "fire")
        ball("Cream flame heart", (.61, -.015, 1.39), (.11, .075, .085), "flour")
        cylinder("Gauge frame", (0, -.30, .85), .16, .06, "copper", (math.pi/2, 0, 0))
        cylinder("Gauge face", (0, -.34, .85), .125, .025, "cream", (math.pi/2, 0, 0))
        tube("Gauge needle", [(0, -.36, .85), (.06, -.36, .92)], .014, "dark", False)
        tube("Torch hose", [(-.14, .04, 1.30), (-.46, .04, 1.12), (-.46, -.05, .57), (-.25, -.15, .47)], .048, "copper")
        if tier > 0:
            for z in (.53, .98):
                ring("Reinforced tank band", (0, .04, z), .325, .035, "cream")
            cylinder("Pilot regulator", (-.20, .04, 1.35), .10, .15, "butter")
        if tier == 2:
            cylinder("Reserve caramel capsule", (-.44, .12, .73), .14, .66, "copper")
            ball("Reserve rounded top", (-.44, .12, 1.06), (.14, .14, .12), "butter")
            cylinder("Second burner", (.25, .31, 1.49), .10, .48, "butter", (0, math.pi/2, 0))
            ball("Second caramel flame", (.61, .31, 1.50), (.19, .09, .10), "fire")

    # Broad readable detailing: tier studs, joints, and hand-moulded seams.
    if kind == "pin":
        for x in (-.30, -.10, .10, .30):
            tube("Barrel wood grain", [(x, -.13, .83), (x+.025, 0, .895), (x, .13, .83)], .012, "score")
        for side in (-1, 1):
            ball("Axle cap", (side*.47, -.16, .58), (.06, .03, .06), "butter")
        if tier > 0:
            for x in (-.28, 0, .28):
                ball("Reinforced barrel stud", (x, -.20, .69), (.035, .018, .035), "butter")
    elif kind == "sifter":
        for x in (-.22, 0, .22):
            ball("Flour resting in sieve", (x, 0, .87+tier*.10), (.13, .21, .065), "flour")
        for z in (.46, .63):
            tube("Sifter raised seam", [(-.27, -.34, z), (0, -.435, z), (.27, -.34, z)], .018, "rim")
    elif kind == "whisk":
        cream_swirl((0, 0, .56), .26)
        for side in (-1, 1):
            tube("Bowl side handle", [(side*.37, 0, .44), (side*.54, 0, .47), (side*.48, 0, .32)], .04, "cream")
    elif kind == "oven":
        for i in range(7):
            a = math.pi*i/6
            brick = box("Cream oven arch brick", (.38*math.cos(a), -.43, .68+.32*math.sin(a)), (.15, .09, .15), "cream", .035)
            brick.rotation_euler.y = -a+math.pi/2
        for x in (-.29, 0, .29):
            box("Roof vent", (x, .04, 1.14), (.12, .27, .025), "copper", .012)


def snowflake(center, radius, thickness):
    x, y, z = center
    for i in range(3):
        a = i*math.pi/3
        dx, dz = radius*math.cos(a), radius*math.sin(a)
        tube("Raised snowflake arm", [(x-dx, y, z-dz), (x+dx, y, z+dz)], thickness, "ice_light", False)
    for i in range(6):
        a = i*math.pi/3
        px, pz = x+radius*.64*math.cos(a), z+radius*.64*math.sin(a)
        for side in (-1, 1):
            t = a+side*.85
            tube("Snowflake fork", [(px, y, pz), (px+radius*.34*math.cos(t), y, pz+radius*.34*math.sin(t))], thickness*.75, "ice_light", False)


def cream_swirl(center, size):
    x, y, z = center
    tube("Piped cream swirl", [(x+size*(1-t/42)*math.cos(t*.42),
          y+size*(1-t/42)*math.sin(t*.42), z+t*size/44) for t in range(42)], size*.14, "flour")


def pest(kind, frame):
    phase = .25+frame*math.tau/6
    bob = .035*math.cos(2*phase)
    if kind in ("ant", "beetle"):
        for side in (-1, 1):
            for j in range(3):
                x = (j-1)*.25
                p = phase+j*math.pi+(0 if side == -1 else math.pi)
                swing, lift = .17*math.sin(p), .10*max(0, math.cos(p))
                tube("Chunky stepping insect leg", [(x, side*.16, .29), (x-.07, side*.34, .20+lift*.4),
                     (x+swing, side*.48, .055+lift)], .044, "ant" if kind == "ant" else "shell")
                ball("Round insect foot", (x+swing, side*.48, .055+lift), (.070, .055, .047), "crust" if kind == "ant" else "butter")
        if kind == "ant":
            ball("Plump ant abdomen", (-.34, 0, .34+bob), (.34, .28, .28), "ant")
            ball("Ant waist", (0, 0, .32+bob), (.19, .18, .18), "crust")
            ball("Big curious ant head", (.33, 0, .40+bob), (.31, .28, .27), "ant")
            for x in (-.46, -.29):
                tube("Abdomen moulded band", [(x, -.23, .43+bob), (x, 0, .62+bob), (x, .23, .43+bob)], .022, "crust")
        else:
            ball("Armored beetle body", (-.17, 0, .33+bob), (.43, .34, .30), "shell")
            for side in (-1, 1):
                ball("Puffy jade wing case", (-.18, side*.16, .44+bob), (.39, .19, .23), "mint")
                for j in range(3):
                    ball("Golden shell spot", (-.40+j*.20, side*.25, .56+bob), (.047, .035, .025), "butter")
            tube("Wing case seam", [(-.55, 0, .46+bob), (-.15, 0, .67+bob), (.20, 0, .47+bob)], .025, "shell")
            ball("Big beetle head", (.33, 0, .39+bob), (.28, .28, .25), "shell")
        for side in (-1, 1):
            tube("Inquisitive antenna", [(.40, side*.13, .59+bob), (.54, side*.22, .77+bob),
                 (.65, side*(.25+.025*math.sin(phase)), .72+bob)], .027, "dark")
            ball("Antenna clay tip", (.65, side*(.25+.025*math.sin(phase)), .72+bob), (.045, .045, .045), "crust" if kind == "ant" else "butter")
            ball("Cream insect eye surround", (.51, side*.205, .48+bob), (.095, .065, .11), "cream")
            ball("Big cocoa insect eye", (.55, side*.235, .49+bob), (.052, .04, .065), "dark")
            ball("Eye glint", (.57, side*.25, .52+bob), (.018, .013, .020), "flour")
            ball("Rosy insect cheek", (.54, side*.20, .37+bob), (.065, .035, .035), "pink")
        tube("Insect smile", [(.595, -.11, .36+bob), (.63, 0, .33+bob), (.595, .11, .36+bob)], .018, "dark")
    elif kind in ("mouse", "boss"):
        boss = kind == "boss"
        size = 1.22 if boss else 1
        start = set(bpy.data.objects)
        tube("Curled pink tail", [(-.38, 0, .23), (-.67, .06, .17), (-.74, .28, .12),
             (-.58, .40+.06*math.sin(phase), .13)], .038, "pink")
        for side in (-1, 1):
            for j in (-1, 1):
                p = phase+(0 if j*side == 1 else math.pi)
                swing, lift = math.sin(p)*.16, max(0, math.cos(p))*.095
                ball("Scampering leg", (j*.23+swing*.4, side*.24, .16+lift*.4), (.095, .085, .12), "mouse")
                ball("Big scampering paw", (j*.23+swing, side*.27, .065+lift), (.13, .095, .060), "pink")
                for toe in (-1, 1):
                    ball("Paw toe", (j*.23+swing+.08, side*.27+toe*.035, .07+lift), (.045, .023, .026), "cream")
        ball("Round mouse body", (-.16, 0, .36+bob), (.42, .31 if boss else .28, .31), "mouse")
        ball("Big mouse head", (.27, 0, .43+bob), (.32, .27, .28), "mouse")
        ball("Cream mouse muzzle", (.49, 0, .33+bob), (.20, .17, .15), "cream")
        ball("Pink button nose", (.665, 0, .36+bob), (.065, .072, .059), "pink")
        for side in (-1, 1):
            ball("Huge round mouse ear", (.14, side*.22, .66+bob), (.18, .115, .20), "mouse")
            ball("Velvet ear inside", (.20, side*.23, .69+bob), (.12, .080, .14), "pink")
            ball("Cocoa mouse eye", (.42, side*.208, .50+bob), (.063, .042, .073), "dark")
            ball("Mouse eye highlight", (.44, side*.235, .53+bob), (.022, .015, .022), "flour")
            ball("Mouse rosy cheek", (.46, side*.22, .39+bob), (.075, .026, .042), "pink")
            for j in (-1, 1):
                tube("Soft mouse whisker", [(.51, side*.13, .33+bob), (.53+j*.09, side*.35, .34+bob+j*.045)], .013, "cream", False)
        if boss:
            # Bespoke chef regalia grows with the body; the hat remains on the head.
            ball("Chef cocoa apron", (-.12, -.268, .35+bob), (.32, .075, .23), "copper")
            tube("Chef apron cream trim", [(-.39, -.29, .26+bob), (-.12, -.35, .20+bob), (.11, -.29, .26+bob)], .023, "cream")
            for x in (-.20, -.04):
                ball("Apron brass button", (x, -.34, .43+bob), (.032, .018, .032), "butter")
            cylinder("Little chef hat band", (.18, 0, .84+bob), .19, .14, "cream")
            for x, y, z in ((.04, 0, .97), (.18, -.10, 1.00), (.31, 0, .98), (.18, .10, 1.02), (.17, 0, 1.11)):
                ball("Puffy chef hat crown", (x, y, z+bob), (.15, .14, .13), "flour")
            tube("Chef neckerchief", [(.18, -.26, .43+bob), (.08, -.32, .49+bob), (-.01, -.27, .56+bob)], .055, "berry")
        for obj in set(bpy.data.objects)-start:
            obj.location *= size
            obj.scale *= size
    else:
        z = .53+.065*math.sin(phase)
        ball("Plump flying sparrow", (-.10, 0, z), (.34, .23, .26), "kraft")
        ball("Cream sparrow breast", (.08, -.06, z-.08), (.27, .20, .20), "cream")
        ball("Big chestnut head", (.27, 0, z+.17), (.27, .23, .25), "wood")
        ball("Golden rounded beak", (.53, 0, z+.11), (.16, .095, .085), "butter")
        for side in (-1, 1):
            ball("Sparrow cheek", (.34, side*.19, z+.10), (.15, .06, .13), "cream")
            wing_z = z+.08+.25*math.sin(phase)
            wing_y = side*(.28+.09*math.cos(phase))
            wing = ball("Broad flapping wing", (-.18, wing_y, wing_z), (.30, .34, .095), "wood")
            wing.rotation_euler.x = side*.65*math.sin(phase)
            for j in range(3):
                feather = ball("Layered wing feather", (-.37+j*.13, wing_y+side*.17, wing_z-.02), (.080, .20, .055), "kraft")
                feather.rotation_euler.x = wing.rotation_euler.x
            ball("Large sparrow eye", (.40, side*.19, z+.23), (.055, .035, .063), "dark")
            ball("Sparrow eye glint", (.42, side*.215, z+.25), (.020, .013, .020), "flour")
            tube("Tucked bird foot", [(-.02, side*.10, z-.18), (.12, side*.14, z-.31)], .029, "roof")
        for side in (-1, 0, 1):
            tail = ball("Tail feather", (-.50, side*.075, z+.06), (.22, .07, .045), "wood")
            tail.rotation_euler.y = -.23


def item_fx(kind, frame):
    p = frame/3
    if kind == "bomb":
        radius = (.22, .40, .49, .50)[frame]
        for i in range(8):
            a = i*math.tau/8
            r = (.13, .17, .14, .075)[frame]
            ball("Caramel bomb burst", (radius*math.cos(a), radius*math.sin(a), .18+.05*math.sin(i)), (r, r, r*1.15), "fire" if i % 2 else "copper")
        if frame < 3:
            ball("Flour explosion core", (0, 0, .20), (.24-p*.09,)*3, "score")
        for i in range(5):
            a = i*math.tau/5+.3
            ball("Golden bomb crumb", ((radius+.12)*math.cos(a), (radius+.12)*math.sin(a), .2), (.035, .035, .055), "butter")
    elif kind == "freeze":
        r = .22+p*.33
        ring("Frost shockwave", (0, 0, .07), r, .035 if frame < 3 else .016, "ice")
        for i in range(6):
            a = i*math.tau/6
            x, y = r*math.cos(a), r*math.sin(a)
            shard = box("Rounded frost crystal", (x, y, .17), (.12-p*.04, .12-p*.04, .30-p*.13), "ice_light", .035)
            shard.rotation_euler = (.20*math.cos(a), .20*math.sin(a), a)
        if frame < 3:
            snowflake((0, -.03, .25), .22-p*.05, .03)
    else:
        for lane in range(3):
            y = (lane-1)*.19
            start = -.48+p*.12
            end = .22+p*.29
            tube("Butter slide swoosh", [(start, y, .07), (-.03, y-.045, .10), (end, y+.025, .09)], .06*(1-p*.4), "butter" if lane != 1 else "cream")
            ball("Slide trailing droplet", (start-.10, y, .08), (.055*(1-p*.45), .05, .035), "score")
        if frame < 3:
            butter = box("Sliding butter pat", (.14+p*.26, -.02, .19), (.29, .32, .16), "butter", .055)
            butter.rotation_euler.z = -.18+p*.36
            box("Butter pat highlight", (.14+p*.26, -.02, .275), (.20, .24, .025), "score", .012)


def projectile(kind):
    if kind == "pin":
        pin((0, 0, .16), .46, True)
        for x in (-.13, -.04, .06, .14):
            tube("Projectile maple groove", [(x, -.07, .22), (x+.015, 0, .255), (x, .07, .22)], .008, "score")
        for side in (-1, 1):
            ball("Projectile handle cap", (side*.36, 0, .16), (.035, .05, .05), "butter")
    elif kind == "whisk":
        for i in range(3):
            ring("Whisk cream spiral", (0, 0, .10+i*.04), .13+i*.07, .038, "cream" if i % 2 else "butter")
        ball("Whipped center", (0, 0, .18), (.1, .10, .09), "flour")
        cream_swirl((0, 0, .19), .13)
        for i in range(3):
            a = i*math.tau/3
            ball("Whisk flung cream pearl", (.31*math.cos(a), .31*math.sin(a), .11), (.035,)*3, "flour")
    else:
        for i in range(4):
            ball("Baked heat trail", (-.25+i*.12, 0, .15), (.13+i*.02, .07+i*.026, .06+i*.025), "roof" if i < 2 else "fire")
        ball("Golden ember core", (.18, -.035, .20), (.10, .065, .07), "score")
        tube("Heat curl", [(-.34, .06, .19), (-.20, .16, .22), (-.03, .10, .21)], .023, "butter")
        for x, y in ((-.34, -.12), (-.19, .18), (-.08, -.17)):
            ball("Ember crumb", (x, y, .15), (.034, .026, .025), "fire")


def puff(frame):
    phase = frame/3
    for i in range(7):
        a = i*math.tau/7
        distance = .09+phase*.32
        radius = .13*(1-phase*.50)
        ball("Flour impact puff", (distance*math.cos(a), distance*math.sin(a), .13+phase*.1),
             (radius, radius, radius), "flour" if i % 2 else "cream")
    for i in range(5):
        a = i*math.tau/5+.3
        d = .23+phase*.25
        ball("Impact dough crumb", (d*math.cos(a), d*math.sin(a), .24), (.038*(1-phase*.55),)*3, "score")
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



def render_asset(name, count, width, height, build, fps=0, loop=False):
    if SELECTED and name not in SELECTED:
        return
    ppm = 56 if name == "slot" else PPM
    spec = {"id": name, "frameSize": [width, height], "frameCount": count,
            "supersample": 2, "pixelsPerMetre": ppm, "fps": fps, "loop": loop,
            "renderer": {"blender": bpy.app.version_string, "engine": "Cycles CPU",
                         "samples": args.samples, "supersample": 2, "downsample": "Lanczos3"},
            "artRevision": ART_REVISION, "frames": []}
    if name.startswith("pest-"):
        spec["facing"] = {"mode": "rotate", "defaultDirection": "right", "radians": "atan2(dy, dx)",
                          "pivot": "frame.anchor", "shadow": "baked; rotates with sprite"}
    for frame in range(count):
        scene = setup(width, height, max(width, height)/ppm,
                      target=(0, 0, .55 if name.startswith("tower-") else .25))
        before = set(bpy.data.objects)
        build(frame)
        # More of each frame is useful art; camera and ground anchor stay fixed.
        scale = 1.16 if name.startswith("tower-") else 1.24 if name.startswith("proj-") else 1.08 if name.startswith("fx-") else 1
        for obj in set(bpy.data.objects)-before:
            obj.location *= scale
            obj.scale *= scale
        soft_shadow(name)
        file = f"{name}-{frame:02d}.png"
        scene.render.filepath = str(CACHE / file)
        bpy.ops.render.render(write_still=True)
        spec["frames"].append({"file": file, "anchor": projected(scene, (0, 0, 0))})
    metadata = CACHE / "renders.json"
    previous = {s["id"]: s for s in json.loads(metadata.read_text())
                if s.get("artRevision") == ART_REVISION and not s["id"].startswith("map-")} if metadata.exists() else {}
    previous[name] = spec
    metadata.write_text(json.dumps(list(previous.values()), indent=2)+"\n")
    print(f"COMPLETE {name}: {count} frames at {width}x{height}", flush=True)


for kind in ("pin", "sifter", "whisk", "oven", "freezer", "piping", "torch"):
    for tier in range(3):
        render_asset(f"tower-{kind}-{tier}", 1, 256, 288, lambda f, k=kind, t=tier: tower(k, t))
for kind in ("ant", "mouse", "sparrow", "beetle", "boss"):
    render_asset(f"pest-{kind}", 6, 224, 224, lambda f, k=kind: pest(k, f), fps=12 if kind == "sparrow" else 10, loop=True)
for kind in ("pin", "whisk", "oven"):
    render_asset(f"proj-{kind}", 1, 128, 128, lambda f, k=kind: projectile(k))
render_asset("fx-hit", 4, 160, 160, puff, fps=16)
for kind in ("bomb", "freeze", "slide"):
    render_asset(f"fx-{kind}", 4, 160, 160, lambda f, k=kind: item_fx(k, f), fps=16)
render_asset("slot", 1, 80, 80, lambda f: slot())
print("D-ART2 rendering complete:", CACHE / "renders.json", flush=True)
