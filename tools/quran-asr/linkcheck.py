"""Check every recitation link in the site data; write broken ones to broken.jsonl."""
import json, glob, os, sys, threading, queue, time
import requests

SITE = "/home/claude/uq-web/site"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "broken.jsonl")

def audio_url(rec, ch):
    if rec.get("urls"):
        u = rec["urls"]
        return u.get(str(ch)) or u.get(ch) or "" if isinstance(u, dict) else ""
    src = rec["src"].replace("%%20", "%20")
    if "%03d" in src: return src.replace("%03d", str(ch).zfill(3))
    if "%d" in src: return src.replace("%d", str(ch))
    return src.rstrip("/") + "/" + str(ch).zfill(3) + ".mp3"

jobs = []
for f in sorted(glob.glob(f"{SITE}/data/r/*.json")):
    d = json.load(open(f, encoding="utf-8"))
    rid = os.path.basename(f)[:-5]
    for rec in d.get("recs", []):
        chs = list(rec["urls"].keys()) if isinstance(rec.get("urls"), dict) else rec.get("ch") or []
        for ch in chs:
            u = audio_url(rec, ch)
            if u: jobs.append((rid, d.get("name"), rec.get("id"), rec.get("name"), str(ch), u))
print("links:", len(jobs), flush=True)

q = queue.Queue(); [q.put(j) for j in jobs]
lock = threading.Lock(); bad = []; done = [0]
S = threading.local()

def check(u):
    s = getattr(S, "s", None)
    if s is None:
        s = S.s = requests.Session(); s.headers["User-Agent"] = "Mozilla/5.0 UltraQuran-linkcheck"
    for attempt in range(2):
        try:
            r = s.head(u, allow_redirects=True, timeout=25)
            if r.status_code in (403, 405, 501):
                r = s.get(u, headers={"Range": "bytes=0-1"}, allow_redirects=True, timeout=25, stream=True); r.close()
            if r.status_code < 400:
                return r.status_code
            if attempt: return r.status_code
        except Exception as e:
            if attempt: return type(e).__name__
        time.sleep(1)

def worker():
    while True:
        try: j = q.get_nowait()
        except queue.Empty: return
        st = check(j[5])
        with lock:
            done[0] += 1
            if not isinstance(st, int) or st >= 400:
                bad.append(j)
                with open(OUT, "a", encoding="utf-8") as f:
                    f.write(json.dumps({"rid": j[0], "reciter": j[1], "rec": j[2], "recname": j[3], "ch": j[4], "url": j[5], "status": st}, ensure_ascii=False) + "\n")
            if done[0] % 2000 == 0:
                print(done[0], "checked,", len(bad), "broken", flush=True)

if os.path.exists(OUT): os.unlink(OUT)
ts = [threading.Thread(target=worker) for _ in range(int(sys.argv[1]) if len(sys.argv) > 1 else 64)]
[t.start() for t in ts]; [t.join() for t in ts]
print("DONE", done[0], "checked,", len(bad), "broken", flush=True)
