#!/usr/bin/env python3
"""يبني أيقونات ألترا قرآن (الموقع + أندرويد) من رسمة SVG واحدة: نجمة ثمانية وجواها مصحف مفتوح على رحل."""
import os, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
GOLD = "#D9B36C"

def svg(scale=1.0, round_mask=False):
    s = scale
    clip = '<clipPath id="c"><circle cx="256" cy="256" r="256"/></clipPath>' if round_mask else ''
    cp = ' clip-path="url(#c)"' if round_mask else ''
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
<defs>{clip}
<radialGradient id="bg" cx="50%" cy="46%" r="72%">
 <stop offset="0" stop-color="#17644E"/><stop offset=".55" stop-color="#0E4536"/><stop offset="1" stop-color="#04201A"/></radialGradient>
<linearGradient id="pg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#F0D395"/><stop offset="1" stop-color="#D2A85E"/></linearGradient>
<linearGradient id="cv" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#B98F4C"/><stop offset="1" stop-color="#8F6A33"/></linearGradient>
</defs>
<g{cp}>
<rect width="512" height="512" fill="url(#bg)"/>
<g transform="translate(256 256) scale({s}) translate(-256 -256)">
 <g fill="none" stroke="{GOLD}" stroke-width="10" stroke-linejoin="miter">
  <rect x="128" y="128" width="256" height="256"/>
  <rect x="128" y="128" width="256" height="256" transform="rotate(45 256 256)"/>
 </g>
 <g transform="translate(0 -22)">
  <!-- الرحل -->
  <g stroke="{GOLD}" stroke-width="13" stroke-linecap="round">
   <line x1="196" y1="296" x2="304" y2="364"/>
   <line x1="316" y1="296" x2="208" y2="364"/>
  </g>
  <!-- الجلدة -->
  <path d="M256 232 C224 214 190 208 156 212 L156 314 C190 310 224 314 256 330 C288 314 322 310 356 314 L356 212 C322 208 288 214 256 232 Z" fill="url(#cv)"/>
  <!-- الصفحات -->
  <path d="M251 224 C224 206 194 200 166 203 L166 302 C194 299 224 304 251 320 Z" fill="url(#pg)"/>
  <path d="M261 224 C288 206 318 200 346 203 L346 302 C318 299 288 304 261 320 Z" fill="url(#pg)"/>
  <!-- السطور -->
  <g fill="none" stroke="#0E4536" stroke-width="4.5" stroke-linecap="round" opacity=".55">
   <path d="M180 226 C202 223 222 227 239 238"/><path d="M180 246 C202 243 222 247 239 258"/>
   <path d="M180 266 C202 263 222 267 239 278"/><path d="M180 286 C200 283 218 286 232 294"/>
   <path d="M332 226 C310 223 290 227 273 238"/><path d="M332 246 C310 243 290 247 273 258"/>
   <path d="M332 266 C310 263 290 267 273 278"/><path d="M332 286 C312 283 294 286 280 294"/>
  </g>
 </g>
</g></g></svg>'''

def render(svgtxt, out, size):
    tmp = "/tmp/_uq_icon.svg"
    open(tmp, "w").write(svgtxt)
    subprocess.run(["rsvg-convert", "-w", str(size), "-h", str(size), "-o", out, tmp], check=True)

def main():
    d = os.path.join(ROOT, "docs", "icons")
    open(os.path.join(ROOT, "tools", "icon", "icon.svg"), "w").write(svg())
    render(svg(), f"{d}/icon-512.png", 512)
    render(svg(), f"{d}/icon-192.png", 192)
    render(svg(), f"{d}/apple-touch-icon.png", 180)
    render(svg(0.82), f"{d}/maskable-512.png", 512)
    res = os.path.join(ROOT, "android", "app", "src", "main", "res")
    for name, px in [("mdpi", 48), ("hdpi", 72), ("xhdpi", 96), ("xxhdpi", 144), ("xxxhdpi", 192)]:
        render(svg(), f"{res}/mipmap-{name}/ic_launcher.png", px)
        render(svg(1.0, True), f"{res}/mipmap-{name}/ic_launcher_round.png", px)
    # الأيقونات اللي مش محتاجة شفافية تتحفظ RGB زي الأول
    from PIL import Image
    for f in ["icon-512.png", "icon-192.png", "apple-touch-icon.png", "maskable-512.png"]:
        p = f"{d}/{f}"; Image.open(p).convert("RGB").save(p, optimize=True)

if __name__ == "__main__":
    main()
