# Blender headless 渲染「倒水水流」素材（白色液柱，前端按液体颜色着色）
#
#   /Applications/Blender.app/Contents/MacOS/Blender --background --python blender-pour.py -- \
#       --out assets/tubes --samples 48
#
# 产物：
#   pour-stream.png   竖直水柱（上细下粗、表面有高光、两端自然收口），可任意拉伸高度
#   pour-splash.png   落点水花（小水冠 + 溅珠）
#
# 与试管素材同一套灯光/世界，保证质感一致。
import argparse
import math
import os
import sys

import bpy

RES_X, RES_Y = 160, 520


def argv_after_dashes():
    return sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def liquid_material():
    mat = bpy.data.materials.new('PourLiquid')
    mat.use_nodes = True
    nt = mat.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    for name, val in (('Base Color', (0.95, 0.95, 0.95, 1.0)), ('Roughness', 0.12)):
        if name in bsdf.inputs:
            bsdf.inputs[name].default_value = val
    if 'Specular IOR Level' in bsdf.inputs:
        bsdf.inputs['Specular IOR Level'].default_value = 0.75
    nt.links.new(bsdf.outputs[0], out.inputs['Surface'])
    return mat


def setup_world():
    world = bpy.data.worlds.new('W')
    bpy.context.scene.world = world
    world.use_nodes = True
    nt = world.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new('ShaderNodeOutputWorld')
    bg = nt.nodes.new('ShaderNodeBackground')
    bg.inputs['Color'].default_value = (0.35, 0.40, 0.38, 1)
    bg.inputs['Strength'].default_value = 1.0
    nt.links.new(bg.outputs['Background'], out.inputs['Surface'])


def setup_lights():
    for name, loc, rot, size, energy in (
        ('Key', (-1.6, -2.4, 2.4), (math.radians(58), 0, math.radians(-38)), 2.5, 220),
        ('Fill', (2.0, 1.4, 1.0), (math.radians(80), 0, math.radians(140)), 3.0, 110),
    ):
        light = bpy.data.lights.new(name, 'AREA')
        light.size = size
        light.energy = energy
        obj = bpy.data.objects.new(name, light)
        obj.location = loc
        obj.rotation_euler = rot
        bpy.context.collection.objects.link(obj)


def setup_render(samples, res_x, res_y):
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = samples
    scene.cycles.use_denoising = True
    scene.render.resolution_x = res_x
    scene.render.resolution_y = res_y
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    scene.view_settings.view_transform = 'Standard'
    try:
        prefs = bpy.context.preferences.addons['cycles'].preferences
        prefs.compute_device_type = 'METAL'
        prefs.get_devices()
        for d in prefs.devices:
            d.use = True
        scene.cycles.device = 'GPU'
    except Exception:                              # noqa: BLE001
        scene.cycles.device = 'CPU'


def setup_camera(center_z, view_h, res_x, res_y):
    cam_data = bpy.data.cameras.new('Cam')
    cam_data.type = 'ORTHO'
    cam_data.sensor_fit = 'VERTICAL'
    cam_data.ortho_scale = view_h
    cam = bpy.data.objects.new('Cam', cam_data)
    cam.location = (0, -6.0, center_z)
    cam.rotation_euler = (math.radians(90), 0, 0)
    bpy.context.collection.objects.link(cam)
    bpy.context.scene.camera = cam


def revolved(name, profile, mat):
    import bmesh
    bm = bmesh.new()
    verts = [bm.verts.new((x, 0.0, z)) for (x, z) in profile]
    edges = [bm.edges.new((verts[i], verts[i + 1])) for i in range(len(verts) - 1)]
    bmesh.ops.spin(bm, geom=verts + edges, axis=(0, 0, 1), steps=64,
                   angle=2 * math.pi, cent=(0, 0, 0), use_merge=True)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.holes_fill(bm, edges=bm.edges)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(mat)
    for poly in obj.data.polygons:
        poly.use_smooth = True
    return obj


def render_to(path):
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print('[pour] wrote %s' % path)


def build_stream(mat):
    """竖直水柱：真实下落的水会因加速而变细，所以上粗下细 + 顶端收口。"""
    h = 3.0
    profile = [(0.0, h)]
    steps = 26
    for i in range(steps + 1):
        f = i / steps                     # 0=顶 1=底
        z = h - h * f
        r = 0.13 * (1.0 - 0.42 * f) * (1.0 - 0.55 * math.exp(-14 * (1 - f)))  # 顶端收口
        r += 0.006 * math.sin(f * 11.0)   # 轻微起伏，避免看着像塑料棍
        profile.append((max(r, 0.012), z))
    profile.append((0.0, 0.0))
    return revolved('Stream', profile, mat)


def build_splash(mat):
    """落点水冠：一圈外翻的薄壁 + 两颗溅珠。"""
    profile = [(0.0, 0.0)]
    steps = 20
    for i in range(steps + 1):
        f = i / steps
        r = 0.10 + 0.34 * f
        z = 0.30 * math.sin(f * math.pi * 0.62)
        profile.append((r, z))
    crown = revolved('Splash', profile, mat)
    for idx, (x, z, s) in enumerate(((-0.36, 0.30, 0.055), (0.30, 0.38, 0.045), (0.44, 0.20, 0.033))):
        bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=16, radius=s, location=(x, 0, z))
        drop = bpy.context.active_object
        drop.name = 'Drop%d' % idx
        drop.data.materials.append(mat)
        for poly in drop.data.polygons:
            poly.use_smooth = True
    return crown


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default='assets/tubes')
    ap.add_argument('--samples', type=int, default=48)
    args = ap.parse_args(argv_after_dashes())
    out = os.path.abspath(args.out)
    os.makedirs(out, exist_ok=True)

    # ---- 水柱 ----
    bpy.ops.wm.read_factory_settings(use_empty=True)
    setup_world()
    setup_lights()
    setup_render(args.samples, RES_X, RES_Y)
    mat = liquid_material()
    build_stream(mat)
    setup_camera(1.5, 3.15, RES_X, RES_Y)
    render_to(os.path.join(out, 'pour-stream.png'))

    # ---- 落点水花 ----
    bpy.ops.wm.read_factory_settings(use_empty=True)
    setup_world()
    setup_lights()
    setup_render(args.samples, 220, 140)
    mat = liquid_material()
    build_splash(mat)
    setup_camera(0.22, 0.62, 220, 140)
    render_to(os.path.join(out, 'pour-splash.png'))
    print('[pour] done -> %s' % out)


main()
