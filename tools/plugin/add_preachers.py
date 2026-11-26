# -*- coding: utf-8 -*-
"""يضيف دعاة يوتيوب (نفس بيانات الموقع) لقسم المرئيات الإسلامية في البلجن.

python3 tools/plugin/add_preachers.py <plugin dir> docs [9.json.gz بتاع نسخة 1.5]

- data/lib/9.json.gz: الدعاة الـ 25 الأول بنفس ترتيب الموقع، وبعدهم باقي البرامج والسلاسل.
- كل داعية: فولدرات برامجه وسلاسله، وبعدها فولدرات المواضيع، وبعدها حلقات المكتبة القديمة (لو ليه).
- الدعاة الجداد ليهم بوستر l9-pN (الغلاف المرسوم) في posters_src و posters_ready.
"""
import collections
import gzip
import json
import os
import re
import sys

plugin, docs = sys.argv[1], sys.argv[2]
lib_path = os.path.join(plugin, "data", "lib", "9.json.gz")
# always start from the 1.5 list, so running it again never adds the preachers twice
src = json.load(gzip.open(sys.argv[3] if len(sys.argv) > 3 else lib_path, "rt", encoding="utf-8"))
if any(str(x.get("poster", "")).startswith("l9-p") for x in src["items"]):
    sys.exit("this 9.json.gz already has the preachers: pass the 1.5 file as the third argument")
original = src["items"]
idx = json.load(open(os.path.join(docs, "data", "yt", "index.json"), encoding="utf-8"))["keys"]
pkeys = sorted((k for k in idx if k[0] == "p"), key=lambda k: int(k[1:]))


def dur(sec):
    sec = int(sec or 0)
    h, r = divmod(sec, 3600)
    m, s = divmod(r, 60)
    return "%d:%02d:%02d" % (h, m, s) if h else "%d:%02d" % (m, s)


def n_word(n, one, many, few=None):
    """3 to 10 take the plural (5 حلقات), the rest the singular (11 حلقة)."""
    return "%d %s" % (n, (few or many) if 3 <= n <= 10 else one if n == 1 or n > 10 else many)


def folders_for(key, owner, name):
    rows = json.load(open(os.path.join(docs, "data", "yt", "s", key + ".json"), encoding="utf-8"))
    meta = idx[key]
    series = set(meta[7] if len(meta) > 7 else [])
    groups = list(collections.OrderedDict((r[5], 1) for r in rows))
    out = []
    for g in groups:
        kids = []
        for vid, title, sec, views, chan, _ in (r for r in rows if r[5] == g):
            d = dur(sec)
            kids.append({"title": title, "subtitle": name, "youtube_id": vid, "video": True, "owner": owner,
                         "badge": "%s · %s" % (chan, d) if chan else d, "duration": d,
                         "body": "%s\nالمصدر: %s (يوتيوب)" % (title, chan or name), "group": g})
        is_s = g in series
        out.append({"title": g,
                    "badge": ("برنامج · %s" % n_word(len(kids), "حلقة", "حلقة", "حلقات")) if is_s else n_word(len(kids), "فيديو", "فيديو", "فيديوهات"),
                    "subtitle": "%s · %s" % (name, "برامج وسلاسل" if is_s else "حسب الموضوع"),
                    "body": ("حلقات برنامج «%s» لـ%s مرتبة من الأولى، من قناة الشيخ الرسمية والقنوات الإسلامية على يوتيوب."
                             if is_s else "فيديوهات %s عن «%s» من قناة الشيخ الرسمية والقنوات الإسلامية على يوتيوب.") % (g, name)
                             if is_s else "فيديوهات %s عن «%s» من قناة الشيخ الرسمية والقنوات الإسلامية على يوتيوب." % (name, g),
                    "children": kids})
    return out, len(rows), len(groups)


by_index = {}
for k in pkeys:
    m = re.match(r"^9/(\d+)$", idx[k][4] or "")
    if m:
        by_index[int(m.group(1))] = k

items = []
for k in pkeys:
    meta = idx[k]
    name, about = meta[3], meta[6] if len(meta) > 6 else ""
    m = re.match(r"^9/(\d+)$", meta[4] or "")
    if m:
        old = json.loads(json.dumps(original[int(m.group(1))]))
        owners = collections.Counter(c.get("owner") for c in old.get("children", []) if isinstance(c.get("owner"), int))
        owner = owners.most_common(1)[0][0] if owners else old["title"]
        yt, n, g = folders_for(k, owner, old["title"])
        lib_n = len(old.get("children", []))
        old["children"] = yt + old.get("children", [])
        old["badge"] = "%d مرئية · %s" % (lib_n + n, about)
        old["subtitle"] = "%d فيديو يوتيوب في %d قسم + %d حلقة من المكتبة" % (n, g, lib_n)
        items.append(old)
    else:
        yt, n, g = folders_for(k, name, name)
        items.append({"title": name, "badge": "%d فيديو · %s" % (n, about), "subtitle": "%d فيديو في %d قسم · %s" % (n, g, about),
                      "body": "مرئيات %s من قناته الرسمية والقنوات الإسلامية على يوتيوب، متقسمة على برامجه ومواضيعه: %s."
                              % (name, about), "children": yt, "poster": "l9-" + k})
items += [x for i, x in enumerate(original) if i not in by_index]
out = {"title": src["title"], "sub": "%d داعية وعالِم · برامج وسلاسل" % len(pkeys), "items": items}
with gzip.open(lib_path, "wt", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
total = sum(idx[k][0] for k in pkeys)
print("preachers", len(pkeys), "videos", total, "root items", len(items), "size", os.path.getsize(lib_path))
