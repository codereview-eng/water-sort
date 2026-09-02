#!/usr/bin/env python3
"""把 assetgen 的 song/music 产物转成能过 publish_game 资产闸的 CG 配乐。

用法：  python3 scripts/cg-bgm.py <bgmN> <源文件.ogg|.mp3> [...更多成对参数]
例：    python3 scripts/cg-bgm.py bgm15 /path/a.ogg bgm16 /path/b.ogg

为什么要有这个脚本（2026-09-01 实证）：
  publish_game 的资产闸拒过一整批 4 条配乐，两条硬指标是手工 ffmpeg 很容易踩的：
    1. 实测码率 > 72k 即 RED。写 `-b:a 64k` 不够——Opus VBR 会 overshoot 到 77–87k，
       必须按实测回调码率，并且「re-encode, do not relabel」。
    2. 前导静音 > 0.5s 即 RED。song 路由出的曲子普遍自带 0.7–1.3s 静音开头。
  把这两步固化在这里，后续每批配乐只跑这个脚本，闸就不会因为同一个原因再红。
"""
import os
import re
import subprocess
import sys

OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                       "color-mines", "cg")
DUR = 8.0                    # CG 段配乐统一 8 秒（cg0 例外由调用方自己处理）
BITRATE_CEIL = 64000         # 目标实测码率上限；闸的硬顶是 72k，这里留余量
FADE_TAIL = 1.2

# 前导静音（2026-09-01 第二次踩坑后重写）
#   第一版用 `-ss` 预先 seek + silencedetect(-50dB) 自测，结果自测报 0.00s、
#   发布闸却测出 0.52/0.53/1.17s —— 三条被拒。两个原因叠加：
#     a) `-ss` 在 Ogg/Opus 上是页边界吸附的快速 seek，并不精确切到第一声；
#     b) -50dB 太宽松：极轻的 pp 弦乐起音在更严阈值下仍算静音。
#   现在改成 **解码后 silenceremove 滤镜**（与 seek 精度无关），
#   并用 -60dB 严阈值校验、且把自设上限压到 0.25s 给闸留余量。
#   判据：自测口径必须比闸更严，否则「自测绿」毫无意义。
# 阈值标定（2026-09-01，用闸自己的读数反标，两次独立命中）：
#   同一个 bgm23.opus，闸报前导 0.64s；本机 silencedetect 逐档扫描得
#     -60dB→0.00s  -55dB→0.08s  -50dB→0.10s  **-45dB→0.641s**  -40dB→0.76s
#   ⇒ 闸的判定阈值就是 -45dB。用 -50/-60dB 自测会一路假绿（实测被拒两轮）。
#   教训：自测阈值必须**与门禁同档**反标出来，不能凭直觉选「更严的数字」——
#   -60dB 看着更严，实际上只测「绝对静音」，对弱起音乐完全测不到。
VERIFY_DB = "-45dB"
LEAD_SILENCE_MAX = 0.25      # 自设上限（闸是 0.5s，留一倍余量）
FADE_HEAD = 0.03             # 切进音乐后加 30ms 淡入，避免咔哒声


def run(cmd):
    return subprocess.run(cmd, capture_output=True, text=True)


def lead_silence(path, db=VERIFY_DB):
    """量前导静音：silencedetect 报告 start≈0 的那一段，其 end 即静音时长。
    阈值必须与 SILENCE_TRIM_DB 同档或更严——用宽阈值自测会得到假绿。"""
    r = run(["ffmpeg", "-v", "info", "-i", path,
             "-af", f"silencedetect=noise={db}:d=0.05", "-f", "null", "-"])
    starts = [float(x) for x in re.findall(r"silence_start: (-?[\d.]+)", r.stderr)]
    ends = [float(x) for x in re.findall(r"silence_end: ([\d.]+)", r.stderr)]
    if starts and abs(starts[0]) < 0.05 and ends:
        return ends[0]
    return 0.0


def measured(path):
    r = run(["ffprobe", "-v", "error", "-show_entries", "format=duration,size",
             "-of", "default=nw=1:nk=1", path])
    dur, size = [float(x) for x in r.stdout.split()]
    return size * 8.0 / dur, int(size), dur


def build(name, src):
    lead = lead_silence(src)
    dst = os.path.join(OUT_DIR, name + ".opus")
    # 用 atrim 按检测到的偏移做**采样级**精确切：
    #   * 不用 `-ss`（Ogg/Opus 上是页边界吸附的快速 seek，切不准）；
    #   * 不用 silenceremove（实测对这批素材不生效，输出仍留 0.54–0.74s）；
    #   * atrim 的起点直接取自同一个 -45dB 检测器 ⇒ 自测与实际切点同源，不会再自欺。
    #     多切 20ms 余量，避免边界样本仍在阈值下。
    # 外层自校正：切一次可能不够——弱起音乐（pp 渐入）切掉静音后，紧接着的乐句
    # 本身仍在阈值下。所以按**输出实测残余**继续深切直到收敛。
    # 这是实证需要的：bgm28 切一次后仍剩 0.53s，闸照样红。
    start = lead + 0.02 if lead > 0.01 else 0.0
    kbps = size = dur = 0
    after = 99.0
    for _ in range(6):
        afilter = (f"atrim=start={start:.3f}:end={start + DUR:.3f},"
                   f"asetpts=N/SR/TB,"
                   f"afade=t=in:st=0:d={FADE_HEAD},"
                   f"afade=t=out:st={DUR - FADE_TAIL:.2f}:d={FADE_TAIL}")
        br = 48000
        for _ in range(5):
            cmd = ["ffmpeg", "-y", "-v", "error", "-i", src,
                   "-af", afilter,
                   "-c:a", "libopus", "-ac", "2", "-vbr", "constrained",
                   "-b:a", str(br), "-application", "audio", dst]
            r = run(cmd)
            if r.returncode != 0:
                return name, None, f"ffmpeg 失败: {r.stderr.strip()[:160]}"
            kbps, size, dur = measured(dst)
            if kbps <= BITRATE_CEIL:
                break
            br = int(br * BITRATE_CEIL / kbps * 0.95)
        after = lead_silence(dst)
        if after <= LEAD_SILENCE_MAX:
            break
        start += after + 0.03          # 按残余继续深切
    ok = kbps <= BITRATE_CEIL and after <= LEAD_SILENCE_MAX
    return name, (lead, after, kbps, size, dur), None if ok else "仍未达标"


def main(argv):
    if len(argv) < 2 or len(argv) % 2 != 0:
        print(__doc__)
        return 2
    pairs = [(argv[i], argv[i + 1]) for i in range(0, len(argv), 2)]
    rows, bad = [], False
    for name, src in pairs:
        if not os.path.exists(src):
            print(f"{name}: 源文件不存在 {src}")
            bad = True
            continue
        n, m, err = build(name, src)
        if m is None:
            print(f"{n}: RED {err}")
            bad = True
            continue
        rows.append((n,) + m + (err,))
        if err:
            bad = True
    # 关键：RED 也要打印实测数字。第一版只打印一句「仍未达标」，
    # 结果排查时完全看不到 lead/kbps 到底是多少——门禁失败必须能说出为什么。
    if rows:
        print(f"{'file':<8} {'lead_in':>8} {'lead_out':>9} {'kbps':>7} {'bytes':>7} {'dur':>5}  verdict")
        for n, lb, la, k, sz, d, err in rows:
            print(f"{n:<8} {lb:>7.2f}s {la:>8.2f}s {k/1000:>7.1f} {sz:>7} {d:>5.2f}  "
                  f"{'RED ' + err if err else 'OK'}")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
