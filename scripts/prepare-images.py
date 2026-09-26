#!/usr/bin/env python3
r"""
prepare-images.py —— 把你下载的原图统一成页面能用的成品

做三件事：读原图（支持 jpg/png/webp/avif）→ 按固定比例居中裁切 → 压成 JPEG 写进部署目录

用法（在 interestip 目录下跑）：
    python scripts/prepare-images.py                    # 从 D:\interestip-images 读，写到 web-preview\assets
    python scripts/prepare-images.py --inbox "D:\\图" --dry-run    # 只看结果不写文件
    python scripts/prepare-images.py --force            # 已存在的成品也重做

成品放哪（重要）：Cloudflare Pages 发布的是 web-preview 目录，
所以成品必须写进 web-preview\assets\，放项目根目录的 assets\ 是发布不出去的。

需要 Pillow：pip install Pillow
"""

import argparse
import os
import sys
from pathlib import Path

# Windows 控制台默认是 GBK，遇到生僻字符会直接抛 UnicodeEncodeError，这里兜一下
try:
    sys.stdout.reconfigure(errors="replace")
    sys.stderr.reconfigure(errors="replace")
except Exception:
    pass

try:
    from PIL import Image, ImageOps
except ImportError:
    print("缺 Pillow。装一个：pip install Pillow")
    sys.exit(1)

ROOT = Path(__file__).resolve().parent.parent
SRC_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".avif"}

# 卡片里显示约 230px 宽，给 2 倍屏留余量
PLACE_WIDTH, PLACE_RATIO = 560, 16 / 10
HERO_WIDTH, HERO_RATIO = 1400, 16 / 9
QUALITY = 80


def fit_crop(im, ratio, width):
    """按目标宽高比居中裁切，再缩放到目标宽度。

    允许放大：卡片在页面上只有 220px 宽（手机单列约 360px），放到 560px 是 2 倍密度，
    小幅放大（<1.5 倍）肉眼看不出差别。原图特别小的时候会在输出里标出来。"""
    w, h = im.size
    if w / h > ratio:  # 太宽 → 裁两边
        nw = int(h * ratio)
        left = (w - nw) // 2
        im = im.crop((left, 0, left + nw, h))
    else:  # 太高 → 裁上下
        nh = int(w / ratio)
        top = int((h - nh) * 0.42)  # 稍微偏上，天空/建筑顶部不容易被切掉
        im = im.crop((0, top, w, top + nh))
    return im.resize((width, max(1, int(width / ratio))), Image.LANCZOS)


def find_source(inbox: Path, stem: str, sub: str | None):
    base = inbox / sub if sub else inbox
    if not base.is_dir():
        return None
    for ext in SRC_EXTS:
        p = base / (stem + ext)
        if p.is_file():
            return p
    return None


def convert(src: Path, dst: Path, ratio: float, width: int, dry: bool):
    with Image.open(src) as im:
        src_size = im.size
        # 空白图/纯色图（典型是 logo 的 SVG 渲染结果）直接拒收：
        # 灰度标准差 < 8 说明整张图几乎是同一个颜色，放进卡片就是一块白。
        gray = im.convert("L")
        px = list(gray.getdata())
        mean = sum(px) / len(px)
        var = sum((p - mean) ** 2 for p in px) / len(px)
        if var ** 0.5 < 8:
            raise ValueError("近乎纯色/空白图（可能是 logo），已跳过")
        out = fit_crop(im.convert("RGB"), ratio, width)
    if not dry:
        dst.parent.mkdir(parents=True, exist_ok=True)
        out.save(dst, "JPEG", quality=QUALITY, optimize=True, progressive=True)
    return src_size, out.size, (dst.stat().st_size if (not dry and dst.exists()) else 0)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--inbox", default=r"D:\interestip-images", help="原图所在目录（默认 D:\\interestip-images）")
    ap.add_argument("--out", default=str(ROOT / "web-preview" / "assets"), help="成品输出目录")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--force", action="store_true", help="已存在的成品也重做")
    args = ap.parse_args()

    inbox, outdir = Path(args.inbox), Path(args.out)
    if not inbox.is_dir():
        print(f"找不到原图目录：{inbox}")
        print("先建好它，把下载的图放进去（hero 放根目录，地点小图放 places 子目录）。")
        return 1

    print(f"原图目录：{inbox}")
    print(f"成品目录：{outdir}{'   （dry-run，不写文件）' if args.dry_run else ''}\n")

    jobs = []
    for h in ["hero-seoul", "hero-nyc"]:
        s = find_source(inbox, h, None)
        if s:
            jobs.append((s, outdir / f"{h}.jpg", HERO_RATIO, HERO_WIDTH, f"hero {h}"))
    places_dir = inbox / "places"
    if places_dir.is_dir():
        for f in sorted(places_dir.iterdir()):
            if f.is_file() and f.suffix.lower() in SRC_EXTS:
                jobs.append((f, outdir / "places" / f"{f.stem}.jpg", PLACE_RATIO, PLACE_WIDTH, f"place {f.stem}"))

    if not jobs:
        print("没找到任何原图。")
        return 1

    total_before = total_after = 0
    done = skipped = failed = 0
    for src, dst, ratio, width, label in jobs:
        if dst.exists() and not args.force:
            skipped += 1
            continue
        try:
            before = src.stat().st_size
            ssize, osize, after = convert(src, dst, ratio, width, args.dry_run)
            total_before += before
            if not args.dry_run:
                total_after += after
            done += 1
            up = ssize[0] / width
            flag = ""
            if up < 0.5:
                flag = "  [太小] 原图不到目标的一半，建议换张大点的"
            elif up < 0.85:
                flag = f"  [放大 {1 / up:.1f}x]"
            print(
                f"  [OK] {label:<22} {src.suffix[1:]:<4} {ssize[0]}x{ssize[1]} {before//1024:>5} KB"
                f"  ->  {osize[0]}x{osize[1]} {after//1024:>4} KB{flag}"
            )
        except Exception as e:
            failed += 1
            print(f"  [!!] {label:<22} {src.name} error: {e}")

    print(f"\n完成 {done} 张" + (f"，跳过已存在 {skipped} 张" if skipped else "") + (f"，失败 {failed} 张" if failed else ""))
    if total_after and not args.dry_run:
        print(f"总体积：{total_before//1024} KB → {total_after//1024} KB")
    elif total_before:
        print(f"原图总体积：{total_before//1024} KB（dry-run 未统计成品体积）")
    if args.dry_run:
        print("（dry-run：没有真的写文件）")
    else:
        print(f"成品已写入 {outdir}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
