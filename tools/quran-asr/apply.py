"""Write identified surah titles into the website data (data/r/<reciter>.json).

Usage: python3 apply.py [site_dir]
Keeps a copy of every applied title in identified_titles.json so a rebuild of the
site data can apply them again.
"""
import json, os, sys
import importlib.util

HERE = os.path.dirname(os.path.abspath(__file__))
SITE = sys.argv[1] if len(sys.argv) > 1 else "/home/claude/uq-web/site"

_spec = importlib.util.spec_from_file_location("identify", os.path.join(os.path.dirname(os.path.abspath(__file__)), "identify.py"))
idf = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(idf)

generic = set()
for line in open(os.path.join(HERE, "jobs_all.jsonl"), encoding="utf-8"):
    generic.add(json.loads(line)["key"])

found = {}
for name in ("pilot_results.jsonl", "results.jsonl"):
    path = os.path.join(HERE, name)
    if not os.path.exists(path):
        continue
    for line in open(path, encoding="utf-8"):
        try:
            j = json.loads(line)
        except ValueError:
            continue
        if j.get("key") not in generic or j.get("error"):
            continue  # only titles that carry no surah information are replaced
        a = tuple(j["start"]) if j.get("start") else None
        b = tuple(j["end"]) if j.get("end") else None
        title = idf.title_for(a, b)  # same confidence rules for every run
        if title:
            found[j["key"]] = title

by_file = {}
for key, title in found.items():
    rid, rec, ch = key.split("/")
    by_file.setdefault(rid, []).append((int(rec), ch, title))

changed = 0
for rid, rows in by_file.items():
    path = os.path.join(SITE, "data", "r", f"{rid}.json")
    if not os.path.exists(path):
        continue
    d = json.load(open(path, encoding="utf-8"))
    for rec in d.get("recs", []):
        for rec_id, ch, title in rows:
            if rec.get("id") == rec_id and rec.get("titles") is not None:
                if rec["titles"].get(ch) != title:
                    rec["titles"][ch] = title
                    changed += 1
    with open(path, "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False, separators=(",", ":"))

json.dump(found, open(os.path.join(HERE, "identified_titles.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=0)
print(f"identified {len(found)} tracks, changed {changed} titles")
