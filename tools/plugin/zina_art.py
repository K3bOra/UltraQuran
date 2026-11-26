# -*- coding: utf-8 -*-
"""زينة رمضان للبلجن: حبل الزينة والفوانيس صور PNG شفافة لكل مقاس شاشة.

python3 tools/plugin/zina_art.py <plugin dir>     (محتاج playwright و google-chrome)

الحبل متعلق فوق حافة الكارت الكبير في الرئيسية (y من 76 لـ 100 على شاشة 1080)، والفوانيس متعلقة في
الفراغات اللي بين الكروت اللي جواه، فمش بتغطي أي كلام. كل فانوس ليه 3 صور (ميلة شمال، نص، يمين).
"""
import asyncio
import os
import sys

from PIL import Image
from playwright.async_api import async_playwright

PLUGIN = sys.argv[1]
WIDTHS = (720, 1280, 1920, 2560, 3840)
ROPE = (53, 76, 1814, 26)              # x, y, w, h on the 1080p master
LAN = (30, 70)                         # one lantern picture (string + body), hung from its top middle
SPOTS = (65, 689, 1275, 1852)        # the gaps between the hero's inner cards
TOP = 80
COLORS = ["#c8432f", "#e9b949", "#1f8a5b", "#2f6fb0", "#efe0bc", "#b8336a", "#e07b2e"]
GLASS = ["#e0533f", "#2f9d6a", "#3b7fd0", "#e9b949"]
ANGLES = (-3.5, 0, 3.5)


def pixel(v, w):
    return (int(round(v)) * w + 960) // 1920


def rope_svg():
    x0, y0, w, h = ROPE
    pts = [x0 + 4] + list(SPOTS) + [x0 + w - 4]
    path, flags = "", ""
    for i in range(len(pts) - 1):
        a, b = pts[i], pts[i + 1]
        seg = b - a
        sag = 11 if seg > 100 else 1.5
        cx, cy = (a + b) / 2.0, TOP + sag * 2
        path += "M%.1f %d Q%.1f %.1f %.1f %d " % (a, TOP, cx, cy, b, TOP)
        k = int(seg // 19)
        for j in range(1, k):
            t = j / float(k)
            u = 1 - t
            x = u * u * a + 2 * u * t * cx + t * t * b
            y = u * u * TOP + 2 * u * t * cy + t * t * TOP
            import math
            ang = math.degrees(math.atan2(2 * u * (cy - TOP) + 2 * t * (TOP - cy), 2 * u * (cx - a) + 2 * t * (b - cx)))
            c = COLORS[(i * 3 + j) % len(COLORS)]
            flags += ('<g transform="translate(%.1f %.1f) rotate(%.2f)"><path d="M-6 0H6L0 12Z" fill="%s"/>'
                      '<path d="M-6 0H6L0 12Z" fill="url(#d)"/><path d="M-6 0H6" stroke="#ffffff66" stroke-width=".8"/></g>') % (x, y, ang, c)
    return ('<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d" viewBox="%d %d %d %d" style="overflow:hidden">'
            '<defs><pattern id="d" width="4" height="4" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r=".7" fill="#fff" opacity=".35"/></pattern>'
            '<filter id="s"><feDropShadow dx="0" dy="1.5" stdDeviation="1.2" flood-color="#000" flood-opacity=".55"/></filter></defs>'
            '<g filter="url(#s)"><path d="%s" fill="none" stroke="#d9b36c" stroke-width="1.4"/>%s</g></svg>') % (w, h, x0, y0, w, h, path, flags)


def lantern_svg(glass, angle, string):
    w, h = LAN
    return ('<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d" viewBox="0 0 %d %d">'
            '<defs><filter id="g" x="-50%%" y="-20%%" width="200%%" height="140%%"><feGaussianBlur stdDeviation="2.4" result="b"/>'
            '<feFlood flood-color="#f1b85a" flood-opacity=".75"/><feComposite in2="b" operator="in"/><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>'
            '<g transform="rotate(%.2f 15 0)"><line x1="15" y1="0" x2="15" y2="%d" stroke="#d9b36c" stroke-width="1"/>'
            '<g transform="translate(4.5 %d) scale(.8)" filter="url(#g)"><circle cx="13" cy="2.5" r="2.3" fill="none" stroke="#d9b36c" stroke-width="1.2"/>'
            '<path d="M5 13Q13 2 21 13Z" fill="#d9b36c"/><path d="M5 14H21L24 21V36L21 43H5L2 36V21Z" fill="%s" stroke="#e8c47c" stroke-width="1.1"/>'
            '<path d="M7 18H19L21 22V35L19 39H7L5 35V22Z" fill="#fff1c4" opacity=".55"/><path d="M13 19V38M5 28.5H21" stroke="#9a6e2e" stroke-width="1"/>'
            '<path d="M6 43H20L17 48H9Z" fill="#d9b36c"/><path d="M13 48L15 51.5 13 55 11 51.5Z" fill="#f3d58f"/></g></g></svg>') % (
        w, h, w, h, angle, string, string, glass)


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
        for width in WIDTHS:
            scale = width / 1920.0
            ctx = await browser.new_context(viewport={"width": 1920, "height": 200}, device_scale_factor=scale)
            page = await ctx.new_page()
            out = os.path.join(PLUGIN, "zina", str(width))
            if not os.path.isdir(out):
                os.makedirs(out)

            async def shot(svg, name, box):
                await page.set_content('<html><body style="margin:0;background:transparent">%s</body></html>' % svg)
                path = os.path.join(out, name + ".png")
                await page.locator("svg").screenshot(path=path, omit_background=True)
                size = (pixel(box[0] + box[2], width) - pixel(box[0], width), pixel(box[1] + box[3], width) - pixel(box[1], width))
                im = Image.open(path).convert("RGBA")
                if im.size != size:
                    im = im.resize(size, Image.LANCZOS)
                im.save(path, optimize=True)

            await shot(rope_svg(), "rope", ROPE)
            for i, spot in enumerate(SPOTS):
                string = (14, 22, 18, 12)[i]
                for f, ang in enumerate(ANGLES):
                    await shot(lantern_svg(GLASS[i % len(GLASS)], ang, string), "lan%d-%d" % (i, f), (spot - LAN[0] / 2.0, TOP, LAN[0], LAN[1]))
            await ctx.close()
            print(width, sorted(os.listdir(out)))
        await browser.close()


asyncio.run(main())
