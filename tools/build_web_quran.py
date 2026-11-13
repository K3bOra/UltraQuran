"""Build docs/data/quran.json for ayah search.

Input: the two editions from https://api.alquran.cloud/v1/quran/quran-uthmani and
https://api.alquran.cloud/v1/quran/quran-simple-clean saved as JSON files.
Usage: python3 -I tools/build_web_quran.py quran-uthmani.json quran-simple-clean.json docs
Output rows: [surah, ayah, page, uthmani_text, normalized_text]
"""
import json
import os
import re
import sys

uth_path, clean_path, out_dir = sys.argv[1:4]
uth = json.load(open(uth_path, encoding="utf-8"))["data"]["surahs"]
clean = json.load(open(clean_path, encoding="utf-8"))["data"]["surahs"]

TASHKEEL = re.compile("[ؐ-ًؚ-ٰٟۖ-ۭـ]")


def norm(t):
    t = TASHKEEL.sub("", t)
    t = re.sub("[أإآٱ]", "ا", t).replace("ى", "ي").replace("ة", "ه").replace("ؤ", "و").replace("ئ", "ي")
    return re.sub(r"\s+", " ", t).strip()


BISM_CLEAN = "بسم الله الرحمن الرحيم "
rows = []
for su, sc in zip(uth, clean):
    n = su["number"]
    for au, ac in zip(su["ayahs"], sc["ayahs"]):
        tu, tc = au["text"], ac["text"]
        if n not in (1, 9) and au["numberInSurah"] == 1 and tc.startswith(BISM_CLEAN):
            tc = tc[len(BISM_CLEAN):]
            words = tu.split(" ")
            tu = " ".join(words[4:]) if len(words) > 4 else tu
        rows.append([n, au["numberInSurah"], au["page"], tu.strip(), norm(tc)])

os.makedirs(os.path.join(out_dir, "data"), exist_ok=True)
with open(os.path.join(out_dir, "data", "quran.json"), "w", encoding="utf-8") as f:
    json.dump(rows, f, ensure_ascii=False, separators=(",", ":"))
print(len(rows), "ayahs")
