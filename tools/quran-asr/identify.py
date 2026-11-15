"""Identify which surah / ayahs a recitation contains by listening to its start and end.

For each track: fetch the first and last few megabytes over HTTP range requests, decode a
window to 16 kHz mono, transcribe with a Quran-tuned Whisper model, and match the words
against the mushaf text (word trigram voting). Results are cached in results.jsonl.
"""
import json, os, re, subprocess, sys, tempfile, time, unicodedata
from collections import Counter, defaultdict

import requests
from faster_whisper import WhisperModel

SITE = "/home/claude/uq-web/site"
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "results.jsonl")

# ------------------------------------------------------------------ text
_DIAC = re.compile(r"[ؐ-ًؚ-ٰٟۖ-ۭـ]")
def norm(s):
    s = unicodedata.normalize("NFKC", s or "").replace("﻿", "")
    s = _DIAC.sub("", s)
    s = re.sub(r"[إأآٱ]", "ا", s)
    s = s.replace("ى", "ي").replace("ئ", "ي").replace("ؤ", "و").replace("ة", "ه").replace("ء", "")
    s = re.sub(r"[^ء-ي\s]", " ", s)
    return re.sub(r"\s+", " ", s).strip()

QURAN = json.load(open(os.path.join(SITE, "data/quran.json")))
META = json.load(open(os.path.join(SITE, "data/meta.json")))
NAMES = META["chapters"]
AYAH_WORDS = [norm(r[4]).split() for r in QURAN]
# global word stream with ayah index per word
STREAM, OWNER = [], []
for i, ws in enumerate(AYAH_WORDS):
    STREAM += ws; OWNER += [i] * len(ws)
TRI = defaultdict(list)
for k in range(len(STREAM) - 2):
    TRI[(STREAM[k], STREAM[k + 1], STREAM[k + 2])].append(OWNER[k])
VERSES = META["verses"]

STRIP = [norm(x) for x in ["اعوذ بالله من الشيطان الرجيم", "بسم الله الرحمن الرحيم", "صدق الله العظيم", "صدق الله مولانا العظيم"]]

def clean(text):
    t = " " + norm(text) + " "
    for p in STRIP:
        t = t.replace(" " + p + " ", " ")
    return t.split()

def locate(words):
    """Return (surah, first_ayah, last_ayah, votes) of the densest matching run."""
    votes = Counter()
    for k in range(len(words) - 2):
        hits = TRI.get((words[k], words[k + 1], words[k + 2]))
        if hits and len(hits) <= 12:  # ignore very common phrases
            for h in hits:
                votes[h] += 1.0 / len(hits)
    if not votes:
        return None
    # best surah by total votes, then its voted ayahs
    by_surah = Counter()
    for a, v in votes.items():
        by_surah[QURAN[a][0]] += v
    surah, _ = by_surah.most_common(1)[0]
    pts = sorted((QURAN[a][1], v) for a, v in votes.items() if QURAN[a][0] == surah and v >= 0.5)
    if not pts:
        return None
    # densest run of matched ayahs (gaps of at most 6), so stray matches don't stretch the range
    best, cur = [], [pts[0]]
    for p in pts[1:]:
        if p[0] - cur[-1][0] <= 6:
            cur.append(p)
        else:
            if sum(v for _, v in cur) > sum(v for _, v in best): best = cur
            cur = [p]
    if sum(v for _, v in cur) > sum(v for _, v in best): best = cur
    score = sum(v for _, v in best)
    return surah, best[0][0], best[-1][0], round(score, 1)

# ------------------------------------------------------------------ audio
S = requests.Session()
S.headers["User-Agent"] = "Mozilla/5.0 UltraQuran-indexer"

def fetch_range(url, start, length):
    r = S.get(url, headers={"Range": f"bytes={start}-{start + length - 1}"}, timeout=60, allow_redirects=True)
    r.raise_for_status()
    return r.content, r.headers.get("Content-Range", "")

def decode(chunk, skip, seconds):
    with tempfile.NamedTemporaryFile(suffix=".bin", delete=False) as f:
        f.write(chunk); src = f.name
    out = src + ".wav"
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-ss", str(skip), "-i", src, "-t", str(seconds),
                    "-ac", "1", "-ar", "16000", out], check=False)
    os.unlink(src)
    return out if os.path.exists(out) and os.path.getsize(out) > 32000 else None

MODEL = None
def transcribe(wav):
    global MODEL
    if MODEL is None:
        MODEL = WhisperModel(os.path.join(HERE, "model-base"), device="cpu", compute_type="int8", cpu_threads=2)
    import wave, numpy as np
    with wave.open(wav, "rb") as w:
        audio = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0
    segs, _ = MODEL.transcribe(audio, language="ar", beam_size=2, vad_filter=False, condition_on_previous_text=False, no_speech_threshold=0.9, log_prob_threshold=None, compression_ratio_threshold=None)
    return " ".join(s.text for s in segs)

def probe(url):
    head = 4_500_000
    first, cr = fetch_range(url, 0, head)
    total = int(cr.split("/")[-1]) if "/" in cr and cr.split("/")[-1].isdigit() else 0
    res = {}
    w = decode(first, 10, 200)
    if w:
        res["start_text"] = transcribe(w); os.unlink(w)
    if total > head * 2:
        tail, _ = fetch_range(url, total - head, head)
        w = decode(tail, 2, 200)
        if w:
            res["end_text"] = transcribe(w); os.unlink(w)
    return res

CONF = 5.0
def title_for(loc_a, loc_b):
    a = loc_a if loc_a and loc_a[3] >= CONF else None
    b = loc_b if loc_b and loc_b[3] >= CONF else None
    if not a and not b:
        return None
    if a and b and a[0] == b[0]:
        s, fa, lb = a[0], min(a[1], b[1]), max(a[2], b[2])
        if fa <= 2 and lb >= VERSES[s - 1] - 1:
            return f"سورة {NAMES[s - 1]}"
        return f"سورة {NAMES[s - 1]} · من الآية {fa} إلى {lb}"
    if a and b:
        return f"من سورة {NAMES[a[0] - 1]} إلى سورة {NAMES[b[0] - 1]}"
    x = a or b
    return f"سورة {NAMES[x[0] - 1]}"

def main(jobs_file, limit=None):
    done = set()
    if os.path.exists(OUT):
        for line in open(OUT):
            try: done.add(json.loads(line)["key"])
            except Exception: pass
    jobs = [json.loads(l) for l in open(jobs_file)]
    if limit: jobs = jobs[:int(limit)]
    for j in jobs:
        if j["key"] in done:
            continue
        t0 = time.time()
        try:
            r = probe(j["url"])
            la = locate(clean(r.get("start_text", "")))
            lb = locate(clean(r.get("end_text", "")))
            j.update(r, start=la, end=lb, title=title_for(la, lb), secs=round(time.time() - t0, 1))
        except Exception as e:
            j.update(error=f"{type(e).__name__}: {str(e)[:120]}", secs=round(time.time() - t0, 1))
        with open(OUT, "a") as f:
            f.write(json.dumps(j, ensure_ascii=False) + "\n")
        print(j["key"], j.get("title"), j.get("start"), j.get("end"), j.get("secs"), j.get("error", ""), flush=True)

if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else None)
