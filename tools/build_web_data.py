"""Convert the Ultra Quran plugin data into small JSON files for the web app.

Usage: python3 -I tools/build_web_data.py <unpacked plugin dir> docs

Run it after every plugin update so the web app (docs/) gets the new catalog.
"""
import ast
import gzip
import json
import os
import re
import sys
import time

from PIL import Image

SRC, OUT = sys.argv[1], sys.argv[2]
DATA = os.path.join(SRC, "data")


def load(rel):
    with gzip.open(os.path.join(DATA, rel), "rt", encoding="utf-8") as f:
        return json.load(f)


def dump(rel, obj):
    path = os.path.join(OUT, "data", rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))


def const(name):
    src = open(os.path.join(SRC, "catalog.py"), encoding="utf-8").read()
    m = re.search(r"^%s = (\(|\{)" % name, src, re.M)
    start = m.end() - 1
    depth, i = 0, start
    while True:
        ch = src[i]
        if ch in "({":
            depth += 1
        elif ch in ")}":
            depth -= 1
            if depth == 0:
                break
        i += 1
    return ast.literal_eval(re.sub(r'\bu"', '"', src[start:i + 1]))


DUR_TAIL = re.compile(r"\s*[·•\-–|]\s*\d{1,2}:\d{2}(?::\d{2})?\s*$")

cat = load("catalog.json.gz")
bios = load("bios.json.gz")
videos = load("videos.json.gz")
portrait_dir = os.path.join(SRC, "portraits_src")
have_portrait = {int(f[:-4]) for f in os.listdir(portrait_dir) if f.endswith(".jpg")}

first_page = {}
for f in os.listdir(os.path.join(DATA, "tafsir")):
    for page, rows in load("tafsir/" + f).items():
        for surah, ayah, _ in rows:
            if ayah == 1:
                first_page[surah] = min(first_page.get(surah, 999), int(page))

dump("meta.json", {
    "chapters": cat["chapters"],
    "spages": [first_page[name] for name in cat["chapters"]],
    "jpages": [1, 22, 42, 62, 82, 102, 121, 142, 162, 182, 201, 222, 242, 262, 282,
               302, 322, 342, 362, 382, 402, 422, 442, 462, 482, 502, 522, 542, 562, 582],
    "durations": cat["durations"],
    "verses": list(const("SURA_VERSES")),
    "madani": sorted(const("MADANI_SURAS")),
    "ayat": load("ayat.json.gz"),
})


def recording(rec):
    out = {"id": rec[0], "name": rec[1], "ch": rec[3]}
    if isinstance(rec[2], dict):
        out["urls"] = rec[2]
    else:
        out["src"] = rec[2]
    if len(rec) >= 5 and isinstance(rec[4], dict):
        out["titles"] = {k: DUR_TAIL.sub("", v) for k, v in rec[4].items()}
    if len(rec) >= 6 and isinstance(rec[5], dict):
        out["dur"] = rec[5]
    return out


index = []
groups = [("q", cat["reciters"]), ("k", [cat["kishk"]]), ("m", cat["mubtahileen"])]
for group, people in groups:
    for person in people:
        pid, name, recs = person[0], person[1], person[2]
        vids = videos.get(str(pid), [])
        detail = {
            "id": pid, "name": name, "group": group,
            "bio": bios.get(str(pid)),
            "recs": [recording(r) for r in recs],
            "videos": [[v[0], v[1], v[2], v[3] if len(v) > 3 else ""] for v in vids],
        }
        dump("r/%d.json" % pid, detail)
        surahs = sum(len(r[3]) for r in recs)
        index.append([pid, name, group, len(recs), surahs, 1 if pid in have_portrait else 0, len(vids)])
dump("reciters.json", index)
meta = json.load(open(os.path.join(OUT, "data", "meta.json"), encoding="utf-8"))
meta["portraits"] = sorted(have_portrait)
meta["edmap"] = {str(r[0]): p[0] for _, people in groups for p in people for r in p[2]}
dump("meta.json", meta)
dump("radios.json", [[r[1], r[2]] for r in cat["radios"]])

# The receiver shows a QR code for an item's source page (Miraath al-Anbiya); on the site the page is a link.
# tools/source-links.json: QR image name -> the address it encodes (read once from the plugin's PNGs).
SCAN = "امسح الرمز لفتح صفحة المصدر على موقع ميراث الأنبياء."
SCAN2 = "امسح الرمز بالموبايل لفتح المرجع الأصلي."
WUDU_PICS = ["water", "hands-close", "rinse", "face", None, None, "feet", "check"]
# the plugin's tool and Ramadan cards open receiver screens; on the site they open the matching page
LINKS = {"ramadan_today": "#/prayer", "ramadan_khatma": "#/khatma", "prayers": "#/prayer", "search": "#/search",
         "memorize": "#/hifz", "zakat": "#/lib/33", "hadith": "#/lib/34", "hadith_search": "#/search?in=hadith"}
try:
    SOURCE_LINKS = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "source-links.json"), encoding="utf-8"))
except (IOError, ValueError):
    SOURCE_LINKS = {}


def link_sources(node):
    if isinstance(node, dict):
        qr = node.get("source_qr")
        if isinstance(qr, str) and qr.split(".")[0] in SOURCE_LINKS:
            node["src"] = SOURCE_LINKS[qr.split(".")[0]]
            del node["source_qr"]
            if isinstance(node.get("body"), str) and SCAN in node["body"]:
                node["body"] = node["body"].replace(SCAN, "").strip()
        url = node.get("source_url")
        if isinstance(url, str) and url.startswith("https://") and "src" not in node:
            node["src"] = url
            node.pop("source_qr", None)
        if isinstance(node.get("body"), str) and SCAN2 in node["body"]:
            node["body"] = node["body"].replace(SCAN2, "").strip()
        tool = node.get("utility") or node.get("action")
        if isinstance(tool, str) and tool in LINKS:
            node["link"] = LINKS[tool]
        for value in node.values():
            link_sources(value)
    elif isinstance(node, list):
        for value in node:
            link_sources(value)
    return node


for f in os.listdir(os.path.join(DATA, "lib")):
    # yt-<id>.json and 19.json (their index) become data/yt/ below; 16 (دولة التلاوة) has its own
    # auto-updated page on the site (#/tv, data/yt/dawla.json)
    if f.startswith("yt-") or f in ("16.json.gz", "19.json.gz"):
        continue
    doc = link_sources(load("lib/" + f))
    if f == "27.json.gz":
        for item in doc.get("items", []):
            if item.get("id") == "wudu" and len(item.get("steps", [])) == len(WUDU_PICS):
                for step, pic in zip(item["steps"], WUDU_PICS):
                    if pic:
                        step["picture"] = pic
                    else:
                        step.pop("picture", None)
    dump("lib/" + f.replace(".json.gz", ".json"), doc)


# ---- the plugin's YouTube library (319 sheikhs) -> data/yt/index.json + data/yt/s/<key>.json ----
# Rows on the site: [id, title, seconds, views, channel, group]. Rows already on the site (from
# tools/youtube/build_youtube.py, with view counts) stay first; the plugin's verified rows are added after.
def seconds(text):
    total = 0
    for part in str(text or "").split(":"):
        if not part.strip().isdigit():
            return 0
        total = total * 60 + int(part)
    return total


group_of = {row[0]: row[2] for row in index}
yt_dir = os.path.join(OUT, "data", "yt")
yt_index_path = os.path.join(yt_dir, "index.json")
try:
    yt_index = json.load(open(yt_index_path, encoding="utf-8"))
except (IOError, ValueError):
    yt_index = {"keys": {}}
keys = yt_index.setdefault("keys", {})
added = 0
for f in sorted(os.listdir(os.path.join(DATA, "lib"))):
    m = re.match(r"yt-(\d+)\.json\.gz$", f)
    if not m:
        continue
    pid = int(m.group(1))
    if pid not in group_of:
        continue
    key = "%s%d" % (group_of[pid], pid)
    path = os.path.join(yt_dir, "s", key + ".json")
    try:
        rows = json.load(open(path, encoding="utf-8"))
    except (IOError, ValueError):
        rows = []
    seen = {r[0] for r in rows}
    for item in load("lib/" + f):
        vid = item.get("youtube_id")
        if not vid or vid in seen:
            continue
        seen.add(vid)
        badge = item.get("badge") or ""
        channel = DUR_TAIL.sub("", badge).strip() if DUR_TAIL.search(badge) else ""
        rows.append([vid, item.get("title") or "", seconds(item.get("duration")), 0, channel,
                     item.get("group") or "تلاوات مختارة"])
        added += 1
    if not rows:
        continue
    dump("yt/s/%s.json" % key, rows)
    folders = []
    for r in rows:
        if r[5] and r[5] not in folders:
            folders.append(r[5])
    keys[key] = [len(rows), [r[0] for r in rows[:3]], folders]
yt_index["updated"] = time.strftime("%Y-%m-%d")
dump("yt/index.json", yt_index)
print("youtube folders", len(keys), "videos", sum(v[0] for v in keys.values()), "added from plugin", added)
for f in os.listdir(os.path.join(DATA, "tafsir")):
    dump("tafsir/" + f.replace(".json.gz", ".json"), load("tafsir/" + f))

# ---- the lessons with pictures (prayer & wudu, Hajj & Umrah): photos -> img/study, narration -> data/study-voices
st_dir = os.path.join(OUT, "img", "study")
os.makedirs(st_dir, exist_ok=True)
photo_dir = os.path.join(SRC, "art", "study-photos")
# the receiver's pictures carry its frame, blurred side bands and caption plates: the site takes the photo alone
STUDY_BOX = {
    "arafat": (90, 18, 633, 552), "tawaf": (90, 18, 633, 518), "water": (18, 50, 706, 518), "hands-close": (110, 165, 450, 420),
    "bow": (208, 18, 514, 552), "finish": (208, 18, 514, 552), "mat": (208, 18, 514, 552), "sit": (208, 18, 514, 552),
    "stand": (208, 18, 514, 552), "takbir": (208, 18, 514, 552), "check": (18, 88, 706, 481), "jamarat": (18, 88, 706, 481),
    "cut": (18, 30, 706, 503), "face": (18, 32, 692, 503), "feet": (18, 46, 706, 521), "rinse": (180, 70, 543, 552),
    "ihram": (106, 18, 616, 526), "kaaba": (18, 76, 706, 547), "mina": (18, 55, 706, 512), "muzdalifah": (18, 28, 706, 423),
    "prostrate": (181, 18, 541, 552), "route": (54, 18, 667, 518), "sai": (18, 21, 706, 547),
}
STUDY_FILE = {"hands-close": "hands"}
# wudu: the receiver shows one tap photo for three steps and a mouth-rinsing photo for wiping the head.
# On the site every step gets its own matching photo; a step with no fitting photo shows none rather than a wrong one.
for name, box in sorted(STUDY_BOX.items()) if os.path.isdir(photo_dir) else []:
    path = os.path.join(photo_dir, STUDY_FILE.get(name, name) + ".png")
    if os.path.isfile(path):
        im = Image.open(path).convert("RGB").crop(box)
        w = min(640, im.width)
        im.resize((w, round(im.height * w / im.width)), Image.LANCZOS).save(
            os.path.join(st_dir, name + ".webp"), "WEBP", quality=82, method=6)
for f in []:
    if f.endswith(".png"):
        im = Image.open(os.path.join(photo_dir, f)).convert("RGB")
        w = min(640, im.width)
        im.resize((w, round(im.height * w / im.width)), Image.LANCZOS).save(
            os.path.join(st_dir, f[:-4] + ".webp"), "WEBP", quality=80, method=6)
voice_dir = os.path.join(DATA, "study-voices")
if os.path.isdir(voice_dir):
    os.makedirs(os.path.join(OUT, "data", "study-voices"), exist_ok=True)
    for f in os.listdir(voice_dir):
        with open(os.path.join(voice_dir, f), "rb") as a, open(os.path.join(OUT, "data", "study-voices", f), "wb") as b:
            b.write(a.read())

# ---- hadith search index: one row per hadith [file, index, number, text without harakat] (loaded only when searching)
HARAKAT = re.compile("[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640]")
hrows = []
for f in sorted(os.listdir(os.path.join(DATA, "lib"))):
    m = re.match(r"(hadith-[a-z]+-\d+)\.json\.gz$", f)
    if m:
        for i, item in enumerate(load("lib/" + f).get("items", [])):
            hrows.append([m.group(1), i, str(item.get("source_number") or ""), " ".join(HARAKAT.sub("", item.get("body") or "").split())])
dump("hadith-index.json", hrows)
print("hadith search rows", len(hrows))

# portraits -> small webp
pdir = os.path.join(OUT, "img", "p")
os.makedirs(pdir, exist_ok=True)
for pid in have_portrait:
    im = Image.open(os.path.join(portrait_dir, "%d.jpg" % pid)).convert("RGB")
    w = 220
    h = round(im.height * w / im.width)
    im.resize((w, h), Image.LANCZOS).save(os.path.join(pdir, "%d.webp" % pid), "WEBP", quality=78, method=6)

# gallery posters of the encyclopedia (series, preachers, programmes) -> img/lp/<name>.webp
lp_src = os.path.join(SRC, "posters_src")
lp_dir = os.path.join(OUT, "img", "lp")
os.makedirs(lp_dir, exist_ok=True)
posters = 0
for f in sorted(os.listdir(lp_src)) if os.path.isdir(lp_src) else []:
    if not f.endswith(".jpg"):
        continue
    im = Image.open(os.path.join(lp_src, f)).convert("RGB")
    w = min(360, im.width)
    h = round(im.height * w / im.width)
    im.resize((w, h), Image.LANCZOS).save(os.path.join(lp_dir, f[:-4] + ".webp"), "WEBP", quality=80, method=6)
    posters += 1

print("people", len(index), "portraits", len(have_portrait), "radios", len(cat["radios"]), "posters", posters)

# ---- adhan recordings of the legends (short, standalone tracks only) ----
ADHAN = re.compile(r"(^|\s|-)(ال)?[أا]ذان")
SKIP = re.compile(r"صيغة|سنن|سورة|الكهف|البقرة|الرعد|الحجر|الزمر|القصص|القمر|يوسف|الصافات|الحجرات|الاسراء|ابراهيم|الحج |القصار|تلاوة")
adhans = []
seen = set()
for _, people in groups:
    for person in people:
        for rec in person[2]:
            if not (len(rec) >= 5 and isinstance(rec[4], dict) and isinstance(rec[2], dict)):
                continue
            durs = rec[5] if len(rec) >= 6 and isinstance(rec[5], dict) else {}
            for ch, title in rec[4].items():
                title = DUR_TAIL.sub("", title).strip(" -")
                dur = int(durs.get(ch) or 0)
                url = rec[2].get(ch) or rec[2].get(str(ch))
                if not url or url in seen or not ADHAN.search(title) or SKIP.search(title) or not (60 <= dur <= 330):
                    continue
                seen.add(url)
                adhans.append([person[0], person[1], title, url, dur, 1 if "فجر" in title else 0])
dump("adhan.json", adhans)
print("adhan recordings", len(adhans), "by", len({a[0] for a in adhans}), "sheikhs")
