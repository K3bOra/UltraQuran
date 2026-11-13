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

for f in os.listdir(os.path.join(DATA, "lib")):
    dump("lib/" + f.replace(".json.gz", ".json"), load("lib/" + f))
for f in os.listdir(os.path.join(DATA, "tafsir")):
    dump("tafsir/" + f.replace(".json.gz", ".json"), load("tafsir/" + f))

# portraits -> small webp
pdir = os.path.join(OUT, "img", "p")
os.makedirs(pdir, exist_ok=True)
for pid in have_portrait:
    im = Image.open(os.path.join(portrait_dir, "%d.jpg" % pid)).convert("RGB")
    w = 220
    h = round(im.height * w / im.width)
    im.resize((w, h), Image.LANCZOS).save(os.path.join(pdir, "%d.webp" % pid), "WEBP", quality=78, method=6)

print("people", len(index), "portraits", len(have_portrait), "radios", len(cat["radios"]))

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
