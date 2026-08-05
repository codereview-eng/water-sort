# Blender headless 渲染试管素材（玻璃折射 + 分层液体遮罩）
#
# 用法:
#   /Applications/Blender.app/Contents/MacOS/Blender --background --python blender-tubes.py -- \
#       --out assets/tubes --samples 128
#
# 产物（全部同相机、同画幅、透明背景，前端可直接绝对定位叠加，无需算偏移）:
#   tube-empty.png    空玻璃试管（含厚度/高光/圆底/管口）
#   tube-shade.png    满液体状态的明暗底图（白色液体，供前端 multiply 叠出立体感）
#   mask-l1..l4.png   自底向上第 1..4 层液体的形状遮罩（白色 + alpha）
#
# 设计要点：层遮罩单独渲染时隐藏玻璃，形状干净；玻璃质感由 tube-empty/tube-shade 提供。
import argparse
import math
import os
import sys

import bpy

# ---------------- 参数 ----------------
R_OUT = 0.50          # 试管外半径
WALL = 0.035          # 壁厚
H_TUBE = 1.75         # 直壁高度（不含底部圆弧）
CAP = 4               # 容量层数
# 画幅贴合试管比例（直径 1.0 : 全高 2.25，四周留 ~6% 边距），避免上下大片空白
RES_X, RES_Y = 260, 562


def argv_after_dashes():
    return sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def new_material(name, build):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    shader = build(nt)
    nt.links.new(shader.outputs[0], out.inputs['Surface'])
    return mat


def set_input(node, names, value):
    """Principled 的输入名跨版本改过（Transmission → Transmission Weight），逐个试。"""
    for n in names:
        if n in node.inputs:
            node.inputs[n].default_value = value
            return True
    return False


def glass_material():
    """网页素材要的玻璃 ≠ 渲染写实玻璃。

    写实玻璃(Transmission=1)会把 world 背景折射进管壁内部烤进 PNG——贴到网页上就是
    一根不透明的灰管子,把下面的液体整个盖住(实测踩过)。Blender 5.x 已无
    film_transparent_glass 可用。所以这里按素材需求建材质:
      · 正对镜头的面 → Transparent BSDF(alpha 0,透出网页背景与液体色块)
      · 掠射角的管壁/边缘 → 玻璃高光与厚度暗边(素材真正要保留的信息)
    用 Layer Weight 的 Facing 做混合。
    """
    def build(nt):
        mix = nt.nodes.new('ShaderNodeMixShader')
        transparent = nt.nodes.new('ShaderNodeBsdfTransparent')
        bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
        set_input(bsdf, ['Base Color'], (0.86, 0.92, 0.90, 1.0))
        set_input(bsdf, ['Roughness'], 0.06)
        set_input(bsdf, ['Metallic'], 0.0)
        set_input(bsdf, ['IOR'], 1.46)
        set_input(bsdf, ['Transmission Weight', 'Transmission'], 0.35)
        lw = nt.nodes.new('ShaderNodeLayerWeight')
        lw.inputs['Blend'].default_value = 0.34          # 越小=只有很边缘才显形
        ramp = nt.nodes.new('ShaderNodeValToRGB')        # 收紧过渡,中间保持干净透明
        ramp.color_ramp.elements[0].position = 0.30
        ramp.color_ramp.elements[1].position = 0.86
        nt.links.new(lw.outputs['Facing'], ramp.inputs['Fac'])
        nt.links.new(ramp.outputs['Color'], mix.inputs['Fac'])
        nt.links.new(transparent.outputs[0], mix.inputs[1])
        nt.links.new(bsdf.outputs[0], mix.inputs[2])
        return mix
    return new_material('Glass', build)


def liquid_material():
    def build(nt):
        bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
        set_input(bsdf, ['Base Color'], (0.92, 0.92, 0.92, 1.0))
        set_input(bsdf, ['Roughness'], 0.18)
        set_input(bsdf, ['Specular IOR Level', 'Specular'], 0.6)
        return bsdf
    return new_material('Liquid', build)


def emission_material():
    def build(nt):
        em = nt.nodes.new('ShaderNodeEmission')
        em.inputs['Color'].default_value = (1.0, 1.0, 1.0, 1.0)
        em.inputs['Strength'].default_value = 1.0
        return em
    return new_material('MaskWhite', build)


def make_tube_glass():
    """外壁 = 圆底 + 直壁 的旋转体，加 Solidify 得到玻璃厚度。"""
    import bmesh
    bm = bmesh.new()
    profile = []
    # 底部四分之一圆弧（从底心到侧壁）
    steps = 16
    for i in range(steps + 1):
        a = math.pi / 2 * i / steps
        profile.append((R_OUT * math.sin(a), 0.0, R_OUT - R_OUT * math.cos(a)))
    # 直壁
    profile.append((R_OUT, 0.0, R_OUT + H_TUBE))
    verts = [bm.verts.new(p) for p in profile]
    edges = [bm.edges.new((verts[i], verts[i + 1])) for i in range(len(verts) - 1)]
    bmesh.ops.spin(bm, geom=verts + edges, axis=(0, 0, 1), steps=96,
                   angle=2 * math.pi, cent=(0, 0, 0), use_merge=True)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    mesh = bpy.data.meshes.new('TubeGlass')
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new('TubeGlass', mesh)
    bpy.context.collection.objects.link(obj)
    mod = obj.modifiers.new('Solidify', 'SOLIDIFY')
    mod.thickness = WALL
    mod.offset = -1.0          # 向内加厚，外形尺寸保持
    obj.data.materials.append(glass_material())
    for p in obj.data.polygons:
        p.use_smooth = True
    return obj


def revolved_solid(name, profile, mat):
    """把 (x,z) 轮廓绕 Z 轴旋一圈成实体（与玻璃同一种造型方式，保证曲面完全贴合）。"""
    import bmesh
    bm = bmesh.new()
    verts = [bm.verts.new((x, 0.0, z)) for (x, z) in profile]
    edges = [bm.edges.new((verts[i], verts[i + 1])) for i in range(len(verts) - 1)]
    bmesh.ops.spin(bm, geom=verts + edges, axis=(0, 0, 1), steps=96,
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


def make_liquid_layers():
    """内腔按容量等分成 CAP 层。

    第 1 层必须用「下半球 + 直壁」的旋转体，不能拿整颗球去凑：球顶会凸出第 1 层顶面，
    在遮罩里表现为一圈多余的鼓包，叠到界面上就是每层之间凭空多一道弧（实测踩过）。
    """
    r_liq = R_OUT - WALL - 0.008
    center_z = R_OUT                       # 底部圆弧的球心高度（与玻璃同心）
    bottom_z = center_z - r_liq            # 液体最低点
    top_z = R_OUT + H_TUBE - 0.10          # 内腔可用顶（管口留一点空）
    layer_h = (top_z - bottom_z) / CAP
    mat = liquid_material()
    layers = []
    for k in range(CAP):
        z0 = bottom_z + layer_h * k
        z1 = z0 + layer_h
        if k == 0:
            profile = [(0.0, bottom_z)]
            steps = 20
            for i in range(1, steps + 1):   # 下半球圆弧：从底心转到赤道
                a = math.pi / 2 * i / steps
                profile.append((r_liq * math.sin(a), center_z - r_liq * math.cos(a)))
            profile.append((r_liq, z1))     # 直壁段
            profile.append((0.0, z1))       # 封顶
            obj = revolved_solid('Liquid_L1', profile, mat)
        else:
            overlap = 0.004                 # 层间微重叠，避免渲染出白缝
            bpy.ops.mesh.primitive_cylinder_add(
                vertices=96, radius=r_liq, depth=(z1 - z0) + overlap,
                location=(0, 0, (z0 + z1) / 2 - overlap / 2))
            obj = bpy.context.active_object
            obj.name = 'Liquid_L%d' % (k + 1)
            obj.data.materials.append(mat)
            for poly in obj.data.polygons:
                poly.use_smooth = True
        layers.append([obj])
    return layers, mat


def setup_world():
    world = bpy.data.worlds.new('W')
    bpy.context.scene.world = world
    world.use_nodes = True
    nt = world.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new('ShaderNodeOutputWorld')
    grad = nt.nodes.new('ShaderNodeTexGradient')
    grad.gradient_type = 'LINEAR'
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].color = (0.05, 0.06, 0.06, 1)
    ramp.color_ramp.elements[1].color = (0.55, 0.60, 0.58, 1)
    tex = nt.nodes.new('ShaderNodeTexCoord')
    bg = nt.nodes.new('ShaderNodeBackground')
    bg.inputs['Strength'].default_value = 1.1
    nt.links.new(tex.outputs['Generated'], grad.inputs['Vector'])
    nt.links.new(grad.outputs['Color'], ramp.inputs['Fac'])
    nt.links.new(ramp.outputs['Color'], bg.inputs['Color'])
    nt.links.new(bg.outputs['Background'], out.inputs['Surface'])


def setup_lights():
    def area(name, loc, rot, size, energy):
        light = bpy.data.lights.new(name, 'AREA')
        light.size = size
        light.energy = energy
        obj = bpy.data.objects.new(name, light)
        obj.location = loc
        obj.rotation_euler = rot
        bpy.context.collection.objects.link(obj)
        return obj
    # 主光（左上前）、补光（右后）、顶光
    area('Key', (-2.2, -2.6, 3.2), (math.radians(55), 0, math.radians(-40)), 3.0, 320)
    area('Fill', (2.6, 1.8, 1.6), (math.radians(80), 0, math.radians(140)), 3.5, 140)
    area('Top', (0, -0.4, 4.2), (0, 0, 0), 2.0, 120)


def setup_camera():
    cam_data = bpy.data.cameras.new('Cam')
    cam_data.type = 'ORTHO'
    cam_data.sensor_fit = 'VERTICAL'      # 显式钉死:ortho_scale 作用于垂直方向
    tube_h = R_OUT + H_TUBE               # 试管全高(含底部圆弧)
    view_h = tube_h * 1.075               # 上下各留一点边距
    cam_data.ortho_scale = view_h
    cam = bpy.data.objects.new('Cam', cam_data)
    cam.location = (0, -6.0, tube_h / 2)
    cam.rotation_euler = (math.radians(90), 0, 0)
    bpy.context.collection.objects.link(cam)
    bpy.context.scene.camera = cam
    return cam


def setup_render(samples):
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = samples
    scene.cycles.use_denoising = True
    scene.cycles.max_bounces = 24
    scene.cycles.transmission_bounces = 16
    scene.cycles.transparent_max_bounces = 24
    scene.render.resolution_x = RES_X
    scene.render.resolution_y = RES_Y
    scene.render.film_transparent = True
    # 关键:让「透过玻璃看到的背景」也透明,否则玻璃内部会糊上一层 world 灰底,
    # 贴到网页上就是试管里有灰雾、透不出页面背景。
    for attr in ('film_transparent_glass', 'film_transparent_roughness'):
        if hasattr(scene.cycles, attr):
            setattr(scene.cycles, attr, True if attr == 'film_transparent_glass' else 0.15)
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    scene.view_settings.view_transform = 'Standard'
    # Metal GPU 有就用，没有就 CPU（渲染这几张图 CPU 也够）
    try:
        prefs = bpy.context.preferences.addons['cycles'].preferences
        prefs.compute_device_type = 'METAL'
        prefs.get_devices()
        for d in prefs.devices:
            d.use = True
        scene.cycles.device = 'GPU'
    except Exception as exc:                     # noqa: BLE001
        print('[tubes] GPU 不可用，回落 CPU：%s' % exc)
        scene.cycles.device = 'CPU'


def render_to(path):
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print('[tubes] wrote %s' % path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default='assets/tubes')
    ap.add_argument('--samples', type=int, default=128)
    args = ap.parse_args(argv_after_dashes())
    out = os.path.abspath(args.out)
    os.makedirs(out, exist_ok=True)

    clear_scene()
    setup_world()
    setup_lights()
    setup_camera()
    setup_render(args.samples)

    glass = make_tube_glass()
    layers, liquid_mat = make_liquid_layers()
    flat = [o for grp in layers for o in grp]

    # 1) 空玻璃管
    for o in flat:
        o.hide_render = True
    render_to(os.path.join(out, 'tube-empty.png'))

    # 2) 满液体的明暗底图（白液体 + 玻璃折射）
    for o in flat:
        o.hide_render = False
    render_to(os.path.join(out, 'tube-shade.png'))

    # 3) 每层的形状遮罩：只留该层，换自发光白，隐藏玻璃（形状干净、边缘不被折射拉扯）
    mask_mat = emission_material()
    glass.hide_render = True
    bpy.context.scene.cycles.samples = 12      # 纯自发光遮罩,不需要高采样
    for o in flat:
        o.data.materials.clear()
        o.data.materials.append(mask_mat)
    for k, grp in enumerate(layers):
        for o in flat:
            o.hide_render = True
        for o in grp:
            o.hide_render = False
        render_to(os.path.join(out, 'mask-l%d.png' % (k + 1)))

    print('[tubes] done -> %s' % out)


main()
