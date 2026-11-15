#!/usr/bin/env python3
"""يجمع فيديوهات يوتيوب لمكتبة ألترا قرآن المرئية.

  python3 tools/youtube/build_youtube.py dawla     # حلقات «دولة التلاوة» (بيشتغل تلقائي على GitHub)
  python3 tools/youtube/build_youtube.py sheikhs   # أحلى فيديوهات المشايخ والشعراوي وكشك والمبتهلين (يدوي)

بيكتب في docs/data/yt/. أي فيديو صاحبه مانع تشغيله خارج يوتيوب بيتشال تلقائي.
"""
import json, os, re, sys, time, urllib.parse, urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, "docs", "data", "yt")
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"

# «دولة التلاوة»: القناة الرسمية للبرنامج وقايمة الحلقات الكاملة
DAWLA_CHANNEL = "UC6TGOIKLo_Wuaqt7SdgVLWQ"
DAWLA_PLAYLIST = "PLzE-b-Ue0X-w6sHUVOM_Up16KRDDrfCkV"
SEASON2_FROM = "2026-07-01"   # أي حلقة اتنشرت بعد التاريخ ده تبع الموسم التاني
SEASON_START = {1: "2025-11-01", 2: SEASON2_FROM}


def get(url, tries=3):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "en-US,en;q=0.9",
                                                       "Cookie": "CONSENT=YES+1; SOCS=CAI"})
            with urllib.request.urlopen(req, timeout=40) as r:
                return r.status, r.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            if e.code in (401, 403, 404):
                return e.code, ""
            time.sleep(2 + i * 3)
        except Exception:
            time.sleep(2 + i * 3)
    return 0, ""


def initial_data(html):
    m = re.search(r"var ytInitialData = (\{.*?\});</script>", html, re.S)
    return json.loads(m.group(1)) if m else None


def to_sec(s):
    if not s:
        return 0
    n = 0
    for p in s.split(":"):
        n = n * 60 + (int(p) if p.isdigit() else 0)
    return n


def to_num(s):
    if not s:
        return 0
    m = re.search(r"([\d.,]+)\s*(K|M|B|thousand|million|billion)?", s.replace(",", ""), re.I)
    if not m:
        return 0
    mul = {"k": 1e3, "thousand": 1e3, "m": 1e6, "million": 1e6, "b": 1e9, "billion": 1e9}.get((m.group(2) or "").lower(), 1)
    return int(float(m.group(1)) * mul)


def videos(d):
    """كل الفيديوهات في صفحة يوتيوب (بحث / قناة / قايمة) بالشكلين القديم والجديد."""
    out = []

    def walk(o):
        if isinstance(o, list):
            for x in o:
                walk(x)
            return
        if not isinstance(o, dict):
            return
        if "videoRenderer" in o or "playlistVideoRenderer" in o:
            v = o.get("videoRenderer") or o["playlistVideoRenderer"]
            t = "".join(r.get("text", "") for r in v.get("title", {}).get("runs", [])) or v.get("title", {}).get("simpleText", "")
            vc = v.get("viewCountText", {})
            out.append({"id": v.get("videoId"), "t": t, "d": to_sec(v.get("lengthText", {}).get("simpleText")),
                        "v": to_num(vc.get("simpleText") or "".join(r.get("text", "") for r in vc.get("runs", []))),
                        "ago": v.get("publishedTimeText", {}).get("simpleText", "")})
            return
        if "richItemRenderer" in o:
            return walk(o["richItemRenderer"])
        l = o.get("lockupViewModel")
        if l and l.get("contentType") == "LOCKUP_CONTENT_TYPE_VIDEO":
            md = l.get("metadata", {}).get("lockupMetadataViewModel", {})
            rows = md.get("metadata", {}).get("contentMetadataViewModel", {}).get("metadataRows", [])
            parts = [p for r in rows for p in r.get("metadataParts", [])]
            views = next((p.get("accessibilityLabel") for p in parts if re.search(r"views?$", p.get("accessibilityLabel", ""))), "")
            dur = re.search(r'"text": ?"(\d[\d:]*)"', json.dumps(l.get("contentImage", {})))
            ago = next((p.get("text", {}).get("content", "") for p in parts if re.search(r"ago$", p.get("text", {}).get("content", ""))), "")
            out.append({"id": l.get("contentId"), "t": md.get("title", {}).get("content", ""), "d": to_sec(dur and dur.group(1)), "v": to_num(views), "ago": ago})
            return
        for v in o.values():
            walk(v)

    if d:
        walk(d)
    return [x for x in out if x["id"]]


def oembed(vid):
    """اسم القناة لو الفيديو مسموح يتشغل خارج يوتيوب، و None لو ممنوع."""
    code, body = get("https://www.youtube.com/oembed?format=json&url=" + urllib.parse.quote("https://www.youtube.com/watch?v=" + vid))
    if code != 200:
        return None
    try:
        return json.loads(body).get("author_name", "")
    except Exception:
        return None


EMOJI = re.compile("[\U0001F000-\U0001FAFF☀-➿️‍⭐⬆↔-⇿←-↓]")


def clean_title(t):
    t = EMOJI.sub("", t or "")
    t = re.sub(r"ᴴᴰ|\b(?:Full )?HD\b|جودة عالية|بجودة عالية|\(HD\)|\[HD\]", "", t, flags=re.I)
    parts = [p.strip(" -–|•") for p in re.split(r"\s[|׀｜]\s|\s-\s", t) if p.strip(" -–|•")]
    ar = [p for p in parts if re.search(r"[؀-ۿ]", p)]
    t = " · ".join(ar or parts)
    t = re.sub(r"\s+", " ", t).strip(" .-–|·")
    return t[:110]


def save(name, obj):
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, name), "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))


def load(name, default):
    try:
        return json.load(open(os.path.join(OUT, name), encoding="utf-8"))
    except Exception:
        return default


# ---------------------------------------------------------------- دولة التلاوة
AR_ORD = ["", "الأولى", "الثانية", "الثالثة", "الرابعة", "الخامسة", "السادسة", "السابعة", "الثامنة", "التاسعة", "العاشرة"]


def dawla_sub(t):
    """وصف قصير للحلقة من عنوانها، من غير اسم البرنامج ورقم الحلقة."""
    if not re.search(r"[\u0600-\u06FF]", t):
        return ""
    x = re.sub(r"برنامج|دولة التلاوة|الموسم الثاني|الموسم الأول|الحلقة الكاملة|حلقة كاملة|كاملة|Dawlet El Telawa", " ", t)
    x = re.sub(r"(في )?(ال)?حلقة\s*(ال)?(\d+|[\u0621-\u064A]+ ?(عشر|عشرة)?)(?=\s|$|\.|·)", " ", x)
    x = re.sub(r"[|·:.]+", " · ", x)
    x = re.sub(r"\s+", " ", x)
    x = re.sub(r"^(\s*·\s*)+|(\s*·\s*)+$", "", x).strip()
    x = re.sub(r"(\s*·\s*){2,}", " · ", x)
    return x if len(x) > 6 else ""


def feed_dates():
    """تواريخ النشر من خلاصات RSS بتاعة القايمة والقناة (آخر 15 فيديو في كل واحدة)."""
    out = {}
    for q in ("playlist_id=" + DAWLA_PLAYLIST, "channel_id=" + DAWLA_CHANNEL):
        _, xml = get("https://www.youtube.com/feeds/videos.xml?" + q)
        for vid, pub in re.findall(r"<yt:videoId>([^<]+)</yt:videoId>.*?<published>([^<]+)</published>", xml, re.S):
            out[vid] = pub[:10]
    return out


def ago_to_date(txt):
    m = re.search(r"(\d+)\s*(second|minute|hour|day|week|month|year)", txt or "")
    if not m:
        return ""
    days = int(m.group(1)) * {"second": 0, "minute": 0, "hour": 0, "day": 1, "week": 7, "month": 30, "year": 365}[m.group(2)]
    return datetime.fromtimestamp(time.time() - days * 86400, timezone.utc).strftime("%Y-%m-%d")


def build_dawla():
    old = load("dawla.json", {"seasons": []})
    known = {e["id"]: e for s in old.get("seasons", []) for e in s["eps"]}
    found = {}
    for url in ("https://www.youtube.com/playlist?list=" + DAWLA_PLAYLIST + "&hl=en",
                "https://www.youtube.com/channel/" + DAWLA_CHANNEL + "/videos?hl=en"):
        _, html = get(url)
        for v in videos(initial_data(html)):
            full = v["d"] >= 50 * 60 and ("دولة التلاوة" in v["t"] or "Dawlet" in v["t"] or "Telawa" in v["t"] or "State of" in v["t"])
            if (full or "list=" in url and v["d"] >= 50 * 60) and v["id"] not in found:
                found[v["id"]] = v
    if not found and known:
        print("dawla: youtube returned nothing, keeping the old file")
        return
    eps = dict(known)
    dates = feed_dates()
    seed = os.environ.get("DAWLA_SEED")
    if seed:
        dates.update(json.load(open(seed))["seed_dates"])
    for vid, v in found.items():
        if vid in eps:
            eps[vid]["d"] = v["d"] or eps[vid].get("d", 0)
            continue
        if not oembed(vid):
            continue
        date = dates.get(vid) or ago_to_date(v.get("ago")) or datetime.now(timezone.utc).strftime("%Y-%m-%d")
        eps[vid] = {"id": vid, "t": clean_title(v["t"]), "d": v["d"], "date": date}
    seasons = []
    for n in sorted(SEASON_START, reverse=True):
        lo = SEASON_START[n]
        hi = SEASON_START.get(n + 1, "9999")
        lst = sorted([e for e in eps.values() if lo <= e["date"] < hi], key=lambda e: (e["date"], e["id"]))
        for i, e in enumerate(lst, 1):
            final = "ختام" in e["t"] or "ليلة القدر" in e["t"]
            e["n"] = 0 if final else i
            e["label"] = "الحفل الختامي · ليلة القدر" if final else f"الحلقة {i}"
            e["sub"] = dawla_sub(e["t"])
        if lst:
            seasons.append({"n": n, "title": "الموسم " + ("الثاني" if n == 2 else "الأول"), "years": "2026" if n == 2 else "2025 – 2026", "eps": lst})
    data = {"title": "دولة التلاوة", "sub": "أكبر برنامج لاكتشاف المواهب في ترتيل وتجويد القرآن الكريم",
            "by": "وزارة الأوقاف المصرية والشركة المتحدة للخدمات الإعلامية",
            "channel": DAWLA_CHANNEL, "updated": datetime.now(timezone.utc).strftime("%Y-%m-%d"), "seasons": seasons}
    if json.dumps(seasons, sort_keys=True) == json.dumps(old.get("seasons", []), sort_keys=True):
        print("dawla: no new episodes")
        return
    save("dawla.json", data)
    print("dawla:", {s["title"]: len(s["eps"]) for s in seasons})


# ---------------------------------------------------------------- المشايخ
# [نوع، رقم في reciters.json أو المكتبة، اسم البحث، كلمة لازم تبقى في العنوان، عمليات بحث زيادة]
SHEIKHS = [
    ["q", 241, "الشيخ محمد رفعت", "محمد رفعت", ["محمد رفعت سورة", "محمد رفعت تلاوة"]],
    ["q", 51, "الشيخ عبد الباسط عبد الصمد", r"عبد ?الباسط", ["عبد الباسط عبد الصمد سورة", "عبد الباسط عبد الصمد تلاوة التلفزيون المصري", "عبد الباسط عبد الصمد قرآن الفجر"]],
    ["q", 112, "الشيخ محمد صديق المنشاوي", "المنشاوي|المنشاوى", ["المنشاوي سورة", "المنشاوي تلاوة التلفزيون المصري", "المنشاوي قرآن الفجر"]],
    ["q", 118, "الشيخ محمود خليل الحصري", "الحصري|الحصرى", ["الحصري سورة", "الحصري تلاوة التلفزيون المصري", "الحصري قرآن الفجر"]],
    ["q", 125, "الشيخ مصطفى إسماعيل", "مصطفى (إ|ا)سماعيل", ["مصطفى إسماعيل سورة", "مصطفى إسماعيل تلاوة التلفزيون المصري", "مصطفى إسماعيل قرآن الفجر"]],
    ["q", 121, "الشيخ محمود علي البنا", "محمود (علي|على) ?البن", ["محمود علي البنا سورة", "محمود علي البنا تلاوة"]],
    ["q", 106, "الشيخ محمد محمود الطبلاوي", "الطبلاوي|الطبلاوى", ["الطبلاوي سورة", "الطبلاوي تلاوة التلفزيون المصري"]],
    ["q", 9, "الشيخ أحمد نعينع", "نعينع", ["أحمد نعينع سورة", "أحمد نعينع تلاوة"]],
    ["q", 910, "الشيخ طه الفشني تلاوة", "طه الفشن", ["طه الفشني سورة"]],
    ["q", 909, "الشيخ عبد الفتاح الشعشاعي", "عبد ?الفتاح الشعشاع", ["الشعشاعي سورة"]],
    ["q", 908, "الشيخ أبو العينين شعيشع", "شعيشع", ["أبو العينين شعيشع سورة"]],
    ["q", 904, "الشيخ الشحات محمد أنور", "الشحات", []],
    ["q", 914, "الشيخ عبد العظيم زاهر", "عبد ?العظيم زاهر", []],
    ["q", 916, "الشيخ منصور الشامي الدمنهوري", "منصور الشام", []],
    ["q", 903, "الشيخ كامل يوسف البهتيمي تلاوة", "البهتيمي|البهتيمى", ["البهتيمي سورة"]],
    ["q", 902, "الشيخ السيد متولي عبد العال", "السيد متول", ["السيد متولي سورة"]],
    ["q", 901, "الشيخ السيد سعيد تلاوة", "السيد سعيد", ["السيد سعيد سورة"]],
    ["q", 906, "الشيخ راغب مصطفى غلوش", "غلوش", []],
    ["q", 905, "الشيخ محمد عبد العزيز حصان", "حصان", ["محمد عبد العزيز حصان سورة"]],
    ["q", 907, "الشيخ محمد الليثي", "محمد الليث", ["محمد الليثي سورة"]],
    ["q", 912, "الشيخ حمدي الزامل", "الزامل", []],
    ["q", 911, "الشيخ محمد عمران تلاوة", "محمد عمران", ["محمد عمران سورة"]],
    ["q", 915, "الشيخ عنتر سعيد مسلم", "عنتر", []],
    ["k", 950, "الشيخ عبد الحميد كشك خطبة", "كشك", ["الشيخ كشك خطبة نادرة", "الشيخ كشك قصة", "الشيخ كشك يبكي", "عبد الحميد كشك فيديو"]],
    ["s", 1, "الشيخ محمد متولي الشعراوي", "الشعراوي|الشعراوى", ["الشعراوي خواطر سورة", "الشعراوي تفسير", "الشعراوي يبكي", "الشعراوي لقاء نادر",
                                                              "الشعراوي من الألف إلى الياء", "الشيخ الشعراوي معجزة القرآن", "الشعراوي قصص الأنبياء"]],
    ["m", 951, "الشيخ سيد النقشبندي ابتهالات", "النقشبندي|النقشبندى", []],
    ["m", 952, "الشيخ نصر الدين طوبار ابتهال", "طوبار", []],
    ["m", 953, "الشيخ طه الفشني ابتهال", "طه الفشن|الفشني|الفشنى", []],
    ["m", 954, "الشيخ محمد عمران ابتهال", "محمد عمران", []],
    ["m", 955, "الشيخ محمد الطوخي ابتهال", "الطوخي|الطوخى", []],
    ["m", 956, "الشيخ محمد الفيومي ابتهال", "الفيومي|الفيومى", []],
    ["m", 957, "الشيخ كامل يوسف البهتيمي ابتهال", "البهتيمي|البهتيمى", []],
    ["m", 958, "الشيخ إسماعيل السمكري", "السمكري|السمكرى", []],
    ["m", 959, "الشيخ محمد الهلباوي", "الهلباوي|الهلباوى", []],
    ["m", 960, "الشيخ سعيد حافظ ابتهال", "سعيد حافظ", []],
    ["m", 961, "الشيخ علي محمود", "الشيخ (علي|على) محمود", []],
    ["m", 962, "الشيخ عبد الرحيم دويدار", "دويدار", []],
    ["m", 963, "الشيخ إبراهيم الإسكندراني", "(إ|ا)لاسكندراني|الإسكندراني", []],
    ["m", 964, "الشيخ ممدوح عبد الجليل", r"ممدوح عبد ?الجليل", []],
]
SUFFIX = {"q": ["تلاوة نادرة فيديو", "تلاوة خارجية حفلة", "فيديو نادر"], "k": ["", "خطبة كاملة", "فيديو"],
          "s": ["خواطر", "فيديو نادر", "حلقة كاملة"], "m": ["", "فيديو نادر", "ابتهالات قديمة"]}
CAP = {"q": 45, "k": 60, "s": 80, "m": 45}
# مقاطع ذكاء اصطناعي، تقليد، شورتس، حالات واتس، ريمكسات... كلها برا
BAD = re.compile(r"\bAI\b|ذكاء|اصطناعي|shorts|#short|حالات|ريمكس|remix|تقليد|يقلد|مقلد|تقلد|كاريوكي|ستوري|\bstory\b|status|بدون موسيقى|مباشر 24"
                 r"|طفل|الطفلة|صدى صوت|بصدى|يشبه|شبيه|مثل صوت|طبق الأصل|خليفة|بعد النقشبندي|يبدع في|منى الشاذلي|حلمي بكر"
                 r"|هجوم الجن|Horror|رعب|\+18", re.I)
# مقاطع عن الشيخ مش ليه، والمحتوى السياسي: برا المكتبة
ABOUT = re.compile(r"عبد ?الله الشريف|القصة و ?ما ?فيها|رد ناري|مصطفى محمود|عمر عبد الكافي|الجزيرة|Jazeera|وثائقي|قصة وفاة|وفاة الشيخ|جنازة"
                   r"|مبارك|السادات|عبد ?الناصر|القذافي|الملك فيصل|السيسي|الرئيس|رئيس مصر|الحكام|الطاغية|سفاح|معتقل|سجن|سجون|تعذيب"
                   r"|اليهود|إسرائيل|اسرائيل|فلسطين|الكنيسة|الإخوان|الاخوان|ممنوع|الممنوعة|الخطوط الحمراء|يتنبأ|مقـ|سجـ", re.I)
TILAWA = re.compile(r"سور|تلاو|قرآن|قران|ما تيسر|آي|الآية|مقام|محفل|حفل|المغرب|الفجر|السهرة|مرتل|مجود|ختمة")


def search(q):
    _, html = get("https://www.youtube.com/results?search_query=" + urllib.parse.quote(q) + "&sp=CAM%253D&hl=en&gl=EG")
    return videos(initial_data(html))


def build_sheikhs():
    out = {}
    for kind, pid, name, tok, extra in SHEIKHS:
        tre = re.compile(tok)
        seen = {}
        queries = [(name + " " + s).strip() for s in SUFFIX[kind]] + extra
        with ThreadPoolExecutor(4) as ex:
            for res in ex.map(search, queries):
                for v in res:
                    if v["id"] in seen or not tre.search(v["t"]) or BAD.search(v["t"]):
                        continue
                    if v["d"] < 180 or v["d"] > 3 * 3600:
                        continue
                    if kind == "q" and (re.search(r"أذان|اذان|ابتهال", v["t"]) or not TILAWA.search(v["t"])):
                        continue
                    if kind == "m" and re.search(r"سورة|تلاوة|تلاوه", v["t"]):
                        continue
                    if ABOUT.search(v["t"]):
                        continue
                    seen[v["id"]] = v
        lst = sorted(seen.values(), key=lambda v: -v["v"])[:CAP[kind]]
        with ThreadPoolExecutor(10) as ex:
            authors = list(ex.map(oembed, [v["id"] for v in lst]))
        rows = [[v["id"], clean_title(v["t"]), v["d"], v["v"], a] for v, a in zip(lst, authors) if a is not None]
        out[f"{kind}{pid}"] = rows
        print(kind, pid, name, len(rows), flush=True)
    old = sum(len(v) for v in load("sheikhs.json", {}).get("lists", {}).values())
    new = sum(len(v) for v in out.values())
    if old and new < old * 0.7:
        print(f"sheikhs: only {new} videos this time (was {old}), keeping the old file")
        return
    save("sheikhs.json", {"updated": datetime.now(timezone.utc).strftime("%Y-%m-%d"), "lists": out})


if __name__ == "__main__":
    what = sys.argv[1:] or ["dawla"]
    if "dawla" in what:
        build_dawla()
    if "sheikhs" in what:
        build_sheikhs()
