#!/usr/bin/env python3
"""بيانات المصحف التفاعلي: مكان كل كلمة في صفحات مصحف المدينة (خط مجمع الملك فهد QPC V1) من quran.com.

  python3 tools/build_qpc.py

بيكتب docs/data/qpc/<رقم الصفحة>.json بالشكل:
  {"v": ["2:6", "2:7", ...],            # الآيات اللي في الصفحة بالترتيب
   "w": [[سطر, رقم الآية في v, ترتيب الكلمة في الآية, رمز الخط, 1 لو ده رقم الآية], ...]}
الخط نفسه بيتحمّل من static.qurancdn.com/fonts/quran/hafs/v1/woff2/p<رقم الصفحة>.woff2
"""
import json, os, sys, time, urllib.request
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "docs", "data", "qpc")
API = "https://api.quran.com/api/v4/verses/by_page/{}?words=true&word_fields=code_v1,line_number&per_page=300"


def fetch(p):
    for i in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(API.format(p), headers={"User-Agent": "UltraQuran/1.0"}), timeout=40) as r:
                return json.loads(r.read())
        except Exception:
            time.sleep(2 + 3 * i)
    raise RuntimeError(f"page {p} failed")


def build(p):
    d = fetch(p)
    keys, words = [], []
    for v in d["verses"]:
        keys.append(v["verse_key"])
        vi = len(keys) - 1
        for w in v["words"]:
            words.append([w["line_number"], vi, w["position"], w["code_v1"], 1 if w["char_type_name"] == "end" else 0])
    with open(os.path.join(OUT, f"{p}.json"), "w", encoding="utf-8") as f:
        json.dump({"v": keys, "w": words}, f, ensure_ascii=False, separators=(",", ":"))
    return p, len(words)


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    pages = range(1, 605) if len(sys.argv) < 2 else [int(x) for x in sys.argv[1:]]
    with ThreadPoolExecutor(8) as ex:
        n = 0
        for p, c in ex.map(build, pages):
            n += c
    print("pages:", len(list(pages)), "words:", n)
    # verse -> page: {"2": [[first ayah on the page, page], ...]}
    m = {}
    for p in range(1, 605):
        for vk in json.load(open(os.path.join(OUT, f"{p}.json")))["v"]:
            s, a = map(int, vk.split(":"))
            lst = m.setdefault(str(s), [])
            if not lst or lst[-1][1] != p:
                lst.append([a, p])
    with open(os.path.join(OUT, "vpages.json"), "w") as f:
        json.dump(m, f, separators=(",", ":"))
