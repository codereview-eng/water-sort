# Blender headless 渲染「塑料瓶」素材（对齐老板给的参考图：白瓶口环 + 细颈 + 直筒身 + 圆角底）
#
#   /Applications/Blender.app/Contents/MacOS/Blender --background --python blender-bottles.py -- \
#       --out assets/bottles --samples 72
#
# 产物（同相机、同画幅、透明背景，前端零偏移叠加）：
#   bottle-empty.png   空瓶（瓶身 + 白色瓶口环）
#   bottle-shade.png   满液明暗底图（白液体，前端 multiply 叠出立体感）
#   mask-l1..l4.png    直筒身自底向上第 1..4 层液体的形状遮罩
#
# 白描边不在这里烤：外轮廓白边交给前端 drop-shadow，这样描边粗细可随屏幕尺寸调，
# 也不必为「液体块也要白边」再渲一套。
import argparse
import math
import os
import sys

import bpy

# 瓶型参数（Q 版矮胖瓶：总高约原细长瓶一半，圆角底更大、颈/环相对更粗，显得更萌；
# 旧细长版参数留档：R_NECK .26 / R_RING .335 / BOTTOM_R .16 / Z 2.35/2.72/2.95/3.22 / RES 250x800）
R_BODY = 0.50          # 瓶身半径
R_NECK = 0.29          # 颈部半径
R_RING = 0.37          # 瓶口环外半径
BOTTOM_R = 0.22        # 底部圆角
Z_BODY_TOP = 1.10      # 直筒身顶（液体只装到这里）
Z_SHOULDER = 1.36      # 肩部结束/颈部开始
Z_NECK_TOP = 1.52      # 颈部顶（白环从这里往上）
Z_TOP = 1.70           # 瓶口顶
WALL = 0.035
CAP = 4
RES_X, RES_Y = 250, 400


def argv_after_dashes():
    return sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def set_input(node, names, value):
    for n in names:
        if n in node.inputs:
            node.inputs[n].default_value = value
            return True
    return False


def new_material(name, build):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    nt.links.new(build(nt).outputs[0], out.inputs['Surface'])
    return mat


def plastic_material():
    """瓶身：正面透明（透出液体与页面），掠射角给塑料高光与厚度。
    写实 Transmission 会把 world 折射进瓶内烤成灰底，把液体盖掉——这个坑踩过一次。"""
    def build(nt):
        mix = nt.nodes.new('ShaderNodeMixShader')
        transparent = nt.nodes.new('ShaderNodeBsdfTransparent')
        bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
        set_input(bsdf, ['Base Color'], (0.93, 0.96, 0.98, 1.0))
        set_input(bsdf, ['Roughness'], 0.10)
        set_input(bsdf, ['IOR'], 1.42)
        set_input(bsdf, ['Transmission Weight', 'Transmission'], 0.25)
        lw = nt.nodes.new('ShaderNodeLayerWeight')
        lw.inputs['Blend'].default_value = 0.30
        ramp = nt.nodes.new('ShaderNodeValToRGB')
        ramp.color_ramp.elements[0].position = 0.34
        ramp.color_ramp.elements[1].position = 0.88
        nt.links.new(lw.outputs['Facing'], ramp.inputs['Fac'])
        nt.links.new(ramp.outputs['Color'], mix.inputs['Fac'])
        nt.links.new(transparent.outputs[0], mix.inputs[1])
        nt.links.new(bsdf.outputs[0], mix.inputs[2])
        return mix
    return new_material('Plastic', build)


def ring_material():
    """瓶口环：参考图里是不透明的白色塑料圈，游戏里当作瓶子的识别特征。"""
    def build(nt):
        bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
        set_input(bsdf, ['Base Color'], (0.97, 0.98, 0.99, 1.0))
        set_input(bsdf, ['Roughness'], 0.34)
        return bsdf
    return new_material('Ring', build)


def liquid_material():
    def build(nt):
        bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
        set_input(bsdf, ['Base Color'], (0.93, 0.93, 0.93, 1.0))
        set_input(bsdf, ['Roughness'], 0.20)
        return bsdf
    return new_material('Liquid', build)


def emission_material():
    def build(nt):
        em = nt.nodes.new('ShaderNodeEmission')
        em.inputs['Color'].default_value = (1.0, 1.0, 1.0, 1.0)
        em.inputs['Strength'].default_value = 1.0
        return em
    return new_material('MaskWhite', build)


def revolved(name, profile, mat, solidify=None):
    import bmesh
    bm = bmesh.new()
    verts = [bm.verts.new((x, 0.0, z)) for (x, z) in profile]
    edges = [bm.edges.new((verts[i], verts[i + 1])) for i in range(len(verts) - 1)]
    bmesh.ops.spin(bm, geom=verts + edges, axis=(0, 0, 1), steps=96,
                   angle=2 * math.pi, cent=(0, 0, 0), use_merge=True)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    if solidify is None:
        bmesh.ops.holes_fill(bm, edges=bm.edges)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    if solidify is not None:
        mod = obj.modifiers.new('Solidify', 'SOLIDIFY')
        mod.thickness = solidify
        mod.offset = -1.0
    obj.data.materials.append(mat)
    for poly in obj.data.polygons:
        poly.use_smooth = True
    return obj


def bottle_profile():
    """自底向上：圆角底 → 直筒身 → 肩部收颈 → 颈 → 瓶口（开口）。"""
    p = [(0.0, 0.0)]
    steps = 12
    for i in range(1, steps + 1):                     # 底部圆角
        a = math.pi / 2 * i / steps
        p.append((R_BODY - BOTTOM_R + BOTTOM_R * math.sin(a), BOTTOM_R - BOTTOM_R * math.cos(a)))
    p.append((R_BODY, Z_BODY_TOP))                    # 直筒身
    for i in range(1, 13):                            # 肩部：平滑收到颈部
        f = i / 12.0
        z = Z_BODY_TOP + (Z_SHOULDER - Z_BODY_TOP) * f
        r = R_BODY + (R_NECK - R_BODY) * (0.5 - 0.5 * math.cos(math.pi * f))
        p.append((r, z))
    p.append((R_NECK, Z_NECK_TOP))                    # 颈
    return p


def ring_profile():
    """瓶口白环：一圈略微外扩的厚壁短筒（参考图里的白色瓶盖圈）。"""
    r_in = R_NECK - 0.01
    return [
        (r_in, Z_NECK_TOP - 0.02), (R_RING, Z_NECK_TOP - 0.02),
        (R_RING, Z_TOP), (r_in, Z_TOP), (r_in, Z_NECK_TOP - 0.02),
    ]


def make_liquid_layers(mat):
    """液体只装在直筒段：底部贴合圆角底，顶到 Z_BODY_TOP，等分 CAP 层。"""
    r = R_BODY - WALL - 0.008
    corner = max(BOTTOM_R - WALL, 0.02)
    top_z = Z_BODY_TOP - 0.02
    layer_h = top_z / CAP
    layers = []
    for k in range(CAP):
        z0, z1 = layer_h * k, layer_h * (k + 1)
        if k == 0:
            prof = [(0.0, 0.0)]
            for i in range(1, 13):                    # 跟瓶底同款圆角，避免多出鼓包
                a = math.pi / 2 * i / 12
                prof.append((r - corner + corner * math.sin(a), corner - corner * math.cos(a)))
            prof.append((r, z1))
            prof.append((0.0, z1))
            obj = revolved('Liquid_L1', prof, mat)
        else:
            overlap = 0.004
            bpy.ops.mesh.primitive_cylinder_add(vertices=96, radius=r,
                                                depth=(z1 - z0) + overlap,
                                                location=(0, 0, (z0 + z1) / 2 - overlap / 2))
            obj = bpy.context.active_object
            obj.name = 'Liquid_L%d' % (k + 1)
            obj.data.materials.append(mat)
            for poly in obj.data.polygons:
                poly.use_smooth = True
        layers.append(obj)
    return layers


def setup_world():
    world = bpy.data.worlds.new('W')
    bpy.context.scene.world = world
    world.use_nodes = True
    nt = world.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new('ShaderNodeOutputWorld')
    bg = nt.nodes.new('ShaderNodeBackground')
    bg.inputs['Color'].default_value = (0.42, 0.45, 0.50, 1)
    bg.inputs['Strength'].default_value = 1.05
    nt.links.new(bg.outputs['Background'], out.inputs['Surface'])


def setup_lights():
    for name, loc, rot, size, energy in (
        ('Key', (-2.4, -3.0, 3.6), (math.radians(55), 0, math.radians(-38)), 3.2, 420),
        ('Fill', (2.8, 2.0, 2.0), (math.radians(80), 0, math.radians(140)), 3.6, 180),
        ('Top', (0, -0.5, 5.0), (0, 0, 0), 2.2, 150),
    ):
        light = bpy.data.lights.new(name, 'AREA')
        light.size = size
        light.energy = energy
        obj = bpy.data.objects.new(name, light)
        obj.location = loc
        obj.rotation_euler = rot
        bpy.context.collection.objects.link(obj)


def setup_camera():
    cam_data = bpy.data.cameras.new('Cam')
    cam_data.type = 'ORTHO'
    cam_data.sensor_fit = 'VERTICAL'
    cam_data.ortho_scale = Z_TOP * 1.045
    cam = bpy.data.objects.new('Cam', cam_data)
    cam.location = (0, -7.0, Z_TOP / 2)
    cam.rotation_euler = (math.radians(90), 0, 0)
    bpy.context.collection.objects.link(cam)
    bpy.context.scene.camera = cam


def setup_render(samples):
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = samples
    scene.cycles.use_denoising = True
    scene.cycles.max_bounces = 20
    scene.cycles.transmission_bounces = 12
    scene.render.resolution_x = RES_X
    scene.render.resolution_y = RES_Y
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
    except Exception:                                  # noqa: BLE001
        scene.cycles.device = 'CPU'


def render_to(path):
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print('[bottles] wrote %s' % path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default='assets/bottles')
    ap.add_argument('--samples', type=int, default=72)
    args = ap.parse_args(argv_after_dashes())
    out = os.path.abspath(args.out)
    os.makedirs(out, exist_ok=True)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    setup_world()
    setup_lights()
    setup_camera()
    setup_render(args.samples)

    body = revolved('Bottle', bottle_profile(), plastic_material(), solidify=WALL)
    ring = revolved('Ring', ring_profile(), ring_material())
    liquid_mat = liquid_material()
    layers = make_liquid_layers(liquid_mat)

    for o in layers:
        o.hide_render = True
    render_to(os.path.join(out, 'bottle-empty.png'))

    for o in layers:
        o.hide_render = False
    render_to(os.path.join(out, 'bottle-shade.png'))

    mask_mat = emission_material()
    body.hide_render = True
    ring.hide_render = True
    bpy.context.scene.cycles.samples = 12
    for o in layers:
        o.data.materials.clear()
        o.data.materials.append(mask_mat)
    for k, obj in enumerate(layers):
        for o in layers:
            o.hide_render = True
        obj.hide_render = False
        render_to(os.path.join(out, 'mask-l%d.png' % (k + 1)))

    print('[bottles] done -> %s' % out)


main()
