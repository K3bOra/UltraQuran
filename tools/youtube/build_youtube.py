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


def oembed_full(vid):
    """(القناة، العنوان الأصلي) لو الفيديو مسموح يتشغل خارج يوتيوب، و None لو ممنوع."""
    code, body = get("https://www.youtube.com/oembed?format=json&url=" + urllib.parse.quote("https://www.youtube.com/watch?v=" + vid))
    if code != 200:
        return None
    try:
        j = json.loads(body)
        return j.get("author_name", ""), j.get("title", "")
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
    ["q", 913, "الشيخ محمود صديق المنشاوي", "محمود صديق المنشاو", []],
    ["q", 278, "الشيخ أحمد عيسى المعصراوي", "المعصراوي|المعصراوى", []],
    ["q", 111, "الشيخ محمد جبريل", "محمد جبريل", ["محمد جبريل دعاء ختم القرآن", "محمد جبريل تراويح عمرو بن العاص"]],
    ["q", 39, "الشيخ صابر عبد الحكم", "صابر عبد ?الحكم", []],
    ["q", 277, "الشيخ محمود عبد الحكم", "محمود عبد ?الحكم", []],
    ["q", 11, "الشيخ الحسيني العزازي", "العزازي|العزازى", []],
    ["q", 15, "الشيخ العشري عمران", "العشري عمران|العشرى عمران", []],
    ["q", 151, "الشيخ محمود الشيمي", "الشيمي|الشيمى", []],
    ["q", 152, "الشيخ ياسر سلامة", "ياسر سلامة", []],
    ["q", 36, "الشيخ سيد رمضان", "سيد رمضان", []],
    ["q", 37, "الشيخ شعبان الصياد", "شعبان الصياد", []],
    ["q", 287, "الشيخ عبد الرحمن الشحات", "عبد ?الرحمن الشحات", []],
    ["q", 126, "الشيخ مصطفى اللاهوني", "اللاهوني|اللاهونى", []],
    ["q", 253, "الشيخ إسلام صبحي", "(إ|ا)سلام صبحي|(إ|ا)سلام صبحى", []],
    ["q", 267, "الشيخ عبدالله كامل", "عبد ?الله كامل", []],
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
SUFFIX = {"q": ["تلاوة نادرة فيديو", "تلاوة خارجية حفلة", "فيديو نادر", "سورة", "تلاوة", "محفل", "قرآن الفجر", "تلاوة مسجد", "مجود"],
          "k": ["", "خطبة كاملة", "فيديو", "خطبة الجمعة", "قصة", "درس", "خطب مؤثرة", "يوم القيامة", "الصحابة"],
          "s": ["خواطر", "فيديو نادر", "حلقة كاملة", "خواطر سورة", "تفسير", "لقاء", "قصة", "الشعراوي يتحدث عن", "خاطرة"],
          "m": ["", "فيديو نادر", "ابتهالات قديمة", "ابتهال", "تواشيح", "ابتهالات رمضان", "ابتهالات الفجر"]}
CAP = {"q": 120, "k": 200, "s": 250, "m": 100}
PLAYLISTS = {"q": 5, "k": 6, "s": 8, "m": 4}   # كام قايمة تشغيل كاملة نجيبها لكل شيخ


# كل شيخ حاجته متقسمة فولدرات جوه صفحته
GROUPS = {
    "q": [("نوادر ومحافل", r"نادر|نوادر|حفل|محفل|خارجي|خارجى|مسجد|عام \d|19\d\d|20[01]\d|مأتم|السهرة|سهرة|قرآن الفجر|قران الفجر|قرآن المغرب|قران المغرب|الإذاعة|الاذاعة|التلفزيون|ماسبيرو"),
          ("مصاحف وسور كاملة", r"مرتل|مُرتَّل|مجود|كاملة|كامله|ختمة"),
          ("تلاوات مختارة", r"")],
    "s": [("تفسير وخواطر", r"تفسير|خواطر|خاطرة|سورة|الآي|آية|الاية"),
          ("قصص وعبر", r"قصة|قصص|عبرة|حكاية"),
          ("لقاءات وأحاديث", r"لقاء|حوار|حديث|برنامج|الألف إلى الياء|يتحدث|يرد|سؤال|أسئلة"),
          ("دروس ومواعظ", r"")],
    "k": [("قصص", r"قصة|قصص|حكاية"), ("دروس", r"درس|دروس|محاضرة"), ("خطب", r"")],
    "m": [("تواشيح", r"تواشيح|توشيح|موشح|بطانة|بطانته"), ("ابتهالات", r"")],
}


def group_of(kind, v):
    if kind == "m" and v["d"] >= 20 * 60:
        return "مجموعات وسهرات"
    for name, rx in GROUPS[kind]:
        if not rx or re.search(rx, v["t"]):
            return name
    return GROUPS[kind][-1][0]


def playlists_for(q):
    _, html = get("https://www.youtube.com/results?search_query=" + urllib.parse.quote(q) + "&sp=EgIQAw%253D%253D&hl=en&gl=EG")
    out = []

    def walk(o):
        if isinstance(o, list):
            for x in o:
                walk(x)
            return
        if not isinstance(o, dict):
            return
        l = o.get("lockupViewModel")
        if l and l.get("contentType") != "LOCKUP_CONTENT_TYPE_VIDEO" and str(l.get("contentId", "")).startswith("PL"):
            n = re.search(r'"text": ?"([\d,]+) videos?"', json.dumps(l.get("contentImage", {})))
            out.append((l["contentId"], l.get("metadata", {}).get("lockupMetadataViewModel", {}).get("title", {}).get("content", ""),
                        int(n.group(1).replace(",", "")) if n else 0))
            return
        pr = o.get("playlistRenderer")
        if pr:
            out.append((pr.get("playlistId"), pr.get("title", {}).get("simpleText", ""), int(str(pr.get("videoCount", "0")).replace(",", "") or 0)))
            return
        for v in o.values():
            walk(v)

    walk(initial_data(html))
    return out


def playlist_videos(pid):
    _, html = get("https://www.youtube.com/playlist?list=" + pid + "&hl=en")
    d = initial_data(html)
    vids = videos(d)
    # views live in videoInfo for playlist items
    info = {}

    def walk(o):
        if isinstance(o, list):
            for x in o:
                walk(x)
            return
        if not isinstance(o, dict):
            return
        v = o.get("playlistVideoRenderer")
        if v:
            txt = "".join(r.get("text", "") for r in v.get("videoInfo", {}).get("runs", []))
            info[v.get("videoId")] = to_num(txt.split("•")[0]) if "view" in txt else 0
            return
        for x in o.values():
            walk(x)

    walk(d)
    for v in vids:
        v["v"] = v["v"] or info.get(v["id"], 0)
    return vids
# مقاطع ذكاء اصطناعي، تقليد، شورتس، حالات واتس، ريمكسات... كلها برا
BAD = re.compile(r"\bAI\b|ذكاء|اصطناعي|shorts|#short|حالات|ريمكس|remix|تقليد|يقلد|مقلد|تقلد|كاريوكي|ستوري|\bstory\b|status|بدون موسيقى|مباشر 24"
                 r"|طفل|الطفلة|صدى صوت|بصدى|يشبه|شبيه|مثل صوت|طبق الأصل|خليفة|بعد النقشبندي|يبدع في|منى الشاذلي|حلمي بكر"
                 r"|هجوم الجن|Horror|رعب|\+18", re.I)
# مقاطع عن الشيخ مش ليه، والمحتوى السياسي: برا المكتبة
ABOUT = re.compile(r"عبد ?الله الشريف|القصة و ?ما ?فيها|رد ناري|مصطفى محمود|عمر عبد الكافي|الجزيرة|Jazeera|وثائقي|قصة وفاة|وفاة الشيخ|جنازة"
                   r"|مبارك|السادات|عبد ?الناصر|القذافي|الملك فيصل|السيسي|الرئيس|رئيس مصر|الحكام|الطاغية|سفاح|معتقل|سجن|سجون|تعذيب"
                   r"|اليهود|إسرائيل|اسرائيل|فلسطين|الكنيسة|الإخوان|الاخوان|ممنوع|الممنوعة|الخطوط الحمراء|يتنبأ|مقـ|سجـ", re.I)
ABOUT_EN = re.compile(r"Nasser|Gaddafi|Qaddafi|Sadat|Mubarak|Banned|Imprison|Prison|Israel|Jews|Zion|Shia|Rulers|سياسي|السياسية|فياجيرة|فياجرا|البحيري|البحيرى|البجيرى|الشيعة|شيعي|الحويني|ابن عثيمين|بن عثيمين", re.I)


def keep_row(tre, title, author, from_playlist):
    """فيديو من قايمة تشغيل من غير اسم الشيخ في عنوانه: بس لو جاي من قناة الشيخ نفسه."""
    if ABOUT.search(title) or ABOUT_EN.search(title) or BAD.search(title):
        return False
    if tre.pattern.startswith("الشعراوي") and re.search(r"كشك", title):
        return False
    if tre.pattern == "كشك" and re.search(r"الشعراوي|الشعراوى", title):
        return False
    return bool(tre.search(title) or tre.search(author or ""))


TILAWA = re.compile(r"سور|تلاو|قرآن|قران|ما تيسر|آي|الآية|مقام|محفل|حفل|المغرب|الفجر|السهرة|مرتل|مجود|ختمة")


def search(q):
    _, html = get("https://www.youtube.com/results?search_query=" + urllib.parse.quote(q) + "&sp=CAM%253D&hl=en&gl=EG")
    return videos(initial_data(html))


def build_sheikhs():
    only = set(filter(None, os.environ.get("ONLY", "").split(",")))
    out = {} if not only else load_sheikhs()
    for kind, pid, name, tok, extra in SHEIKHS:
        if only and f"{kind}{pid}" not in only:
            continue
        tre = re.compile(tok)
        others = [re.compile(t) for k2, p2, n2, t, e2 in SHEIKHS if t != tok and p2 != pid]
        seen = {}
        queries = [(name + " " + s).strip() for s in SUFFIX[kind]] + extra
        base = re.sub(r"\s+(تلاوة|ابتهالات|ابتهال|خطبة)$", "", name)
        pls = {}
        for q in (base, base + (" تلاوات نادرة" if kind == "q" else " فيديو")):
            for plid, ptitle, n in playlists_for(q):
                if plid and tre.search(ptitle) and not ABOUT.search(ptitle) and not BAD.search(ptitle) and n >= 3:
                    pls[plid] = (ptitle, n)
        top = sorted(pls, key=lambda k: -pls[k][1])[:PLAYLISTS[kind]]
        with ThreadPoolExecutor(4) as ex:
            batches = list(ex.map(search, queries))
            # a playlist about the sheikh: its items count even when the title skips his name
            batches += [[dict(v, pl=1) for v in r] for r in ex.map(playlist_videos, top)]
        for res in batches:
                for v in res:
                    if v["id"] in seen or BAD.search(v["t"]):
                        continue
                    if not tre.search(v["t"]):
                        # playlist items may skip his name, but never take one that names another sheikh
                        if not v.get("pl") or any(o.search(v["t"]) for o in others):
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
        rows = [[v["id"], clean_title(v["t"]), v["d"], v["v"], a, group_of(kind, v)] for v, a in zip(lst, authors)
                if a is not None and keep_row(tre, v["t"], a, v.get("pl"))]
        out[f"{kind}{pid}"] = rows
        print(kind, pid, name, len(rows), "playlists:", len(top), flush=True)
    old = sum(v[0] for v in load("index.json", {}).get("keys", {}).values())
    new = sum(len(v) for v in out.values())
    if old and new < old * 0.7 and not only:
        print(f"sheikhs: only {new} videos this time (was {old}), keeping the old files")
        return
    save_sheikhs(out)


def load_sheikhs():
    idx = load("index.json", {}).get("keys", {})
    return {k: load(f"s/{k}.json", []) for k in idx}


def save_sheikhs(lists):
    """فهرس صغير لكل الفولدرات + ملف لكل شيخ، عشان كل صفحة تحمّل شيخها بس."""
    os.makedirs(os.path.join(OUT, "s"), exist_ok=True)
    keys = {}
    for k, rows in lists.items():
        if not rows:
            continue
        old_rows = load(f"s/{k}.json", [])
        have = {r[0] for r in rows}
        rows = rows + [r for r in old_rows if r[0] not in have]      # never lose videos found before
        save(f"s/{k}.json", rows)
        groups = list(dict.fromkeys(r[5] for r in rows if len(r) > 5 and r[5]))
        keys[k] = [len(rows), [r[0] for r in rows[:3]], groups]
    # other folders (the plugin's rows, the preachers) stay as they are
    old = load("index.json", {}).get("keys", {})
    for k, v in old.items():
        keys.setdefault(k, v)
    save("index.json", {"updated": datetime.now(timezone.utc).strftime("%Y-%m-%d"), "keys": keys})


# ---------------------------------------------------------------- الدعاة (المرئيات الإسلامية)
# [مفتاح، اسم البحث، كلمة لازم تبقى في العنوان أو اسم القناة، فولدره في المكتبة، صورة المعرض]
PREACHERS = [
    ["p1", "د. طارق السويدان", "طارق السويدان|Suwaidan", "9/1", "l9-1"],
    ["p2", "فهد الكندري", "فهد الكندري|فهد الكندرى|Fahad Al.?Kandari", "9/2", "l9-2"],
    ["p3", "د. عمر عبد الكافي", "عمر عبد ?الكافي|عبد ?الكافي", "9/3", "l9-3"],
    ["p4", "الشيخ نبيل العوضي", "نبيل العوضي|نبيل العوضى|Nabil Al.?Awadi", "9/4", "l9-4"],
    ["p5", "د. محمد راتب النابلسي", "النابلسي|النابلسى|محمد راتب|Nabulsi", "9/5", "l9-5"],
    ["p6", "د. زغلول النجار", "زغلول النجار|زغلول النجّار|Zaghloul", "9/6", "l9-6"],
    ["p7", "الشيخ محمد العريفي", "العريفي", "9/7", "l9-7"],
    ["p8", "الشيخ محمد حسان", "محمد حسان|محمد حسّان", "9/8", "l9-8"],
    ["p9", "الشيخ محمود المصري", "محمود المصري|محمود المصرى", "9/9", "l9-9"],
    ["p10", "الشيخ أحمد ديدات", "ديدات", "9/10", "l9-10"],
    ["p11", "الشيخ منصور السالمي", "السالمي|نايف الصحفي", "9/11", "l9-11"],
    ["p14", "د. علي الشبيلي", "الشبيلي", "9/14", "l9-14"],
    # more preachers (Egyptian first) who are only on YouTube in the site
    ["p20", "الشيخ مصطفى حسني", "مصطفى حسني|مصطفى حسنى", "", ""],
    ["p21", "الشيخ خالد الجندي", "خالد الجندي|خالد الجندى", "", ""],
    ["p22", "د. علي جمعة", "(علي|على) جمعة", "", ""],
    ["p23", "الشيخ رمضان عبد المعز", "رمضان عبد ?المعز", "", ""],
    ["p24", "د. مبروك عطية", "مبروك عطية|مبروك عطيه", "", ""],
    ["p25", "د. أحمد عمر هاشم", "(أ|ا)حمد عمر هاشم", "", ""],
    ["p26", "الشيخ محمد الغزالي", "الشيخ محمد الغزالي|الشيخ محمد الغزالى|الإمام محمد الغزالي|الامام محمد الغزالي", "", ""],
    ["p27", "د. عمرو خالد", "عمرو خالد", "", ""],
    ["p29", "د. عمرو الورداني", "الورداني|الوردانى", "", ""],
    ["p30", "الحبيب علي الجفري", "(علي|على) الجفري|(علي|على) الجفرى|الحبيب الجفري|Al.?Jifri", "", ""],
    ["p31", "الشيخ صالح المغامسي", "المغامسي|المغامسى", "", ""],
    ["p32", "الشيخ بدر المشاري", "المشاري|المشارى", "", ""],
    ["p33", "د. ذاكر نايك", "ذاكر نايك|Zakir Naik", "", ""],
]
# people with the same name, and rude call-in clips cut from TV shows
PREACH_EXCLUDE = {
    "p22": r"الزير|Grade|Primary|Lecture One|الصف",
    "p24": r"اشتم|شتم|اتنيل|جاحد|تموت|متص|يهين|إهانة|بهدل|يحرج|يا حمار|غبي|غبية",
    "p30": r"محمد (علي |على )?الجفري|السيد محمد|السيد/ محمد",
}
PREACH_SUFFIX = ["", "درس", "محاضرة", "خطبة", "خطبة الجمعة", "برنامج", "الحلقة", "مواعظ", "قصص", "تفسير", "السيرة النبوية",
                 "قصص الأنبياء", "رمضان", "الآخرة", "التوبة", "الصحابة"]
PREACH_GROUPS = [("خطب الجمعة", r"خطبة|خطب|خطبه|الجمعة"),
                 ("برامج وحلقات", r"برنامج|الحلقة|حلقة|ح \d|الجزء"),
                 ("دروس ومحاضرات", r"درس|دروس|محاضرة|محاضره|شرح|تفسير|سلسلة"),
                 ("مقاطع ومواعظ", r"")]
# no politics, trials or quarrels in the library
POLITICS = re.compile(r"محكمة|المحكمة|شهادة|القضية|قضية|اعتقال|معتقل|سجن|السيسي|مرسي|الرئيس|الإخوان|الاخوان|ثورة|الثورة|رابعة|انقلاب|داعش"
                      r"|يرد على|رد على|يهاجم|هجوم|فضيحة|فضائح|الحويني|الشيعة|شيعي|اليهود|يهود|إسرائيل|اسرائيل|السياسة|سياسي|مناظرة مع شيعي"
                      r"|\bJews?\b|Jewish|Israel|Zion|Crusade|الحجاب إثم|خلع الحجاب|الوطن|الجيش|الشرطة|الانتخابات|انتخابات|البرلمان", re.I)
# family news, gossip, click-bait and charms: not lessons
GOSSIP = re.compile(r"مسلسل|Drama|دراما|محمود عبد ?العزيز|بصوت القارئ|القارئ|تلاوة|تلاوه|Surah|مكتوبة|بحيري|البحيري|طلاق الشيخ|زواج الشيخ|زوجة الشيخ|زوجته|ابن الشيخ|إبن الشيخ|ابنه|بنت الشيخ|ابنة|والدة|والده|اتصال|جلب|حبيب|سحر|عشق|غرام|صدمة|صادم|قبل الحذف"
                    r"|لن تصدق|مفاج|عاجل|يكشف|يفضح|كشف حقيقة|حقيقة الشيخ|على الهواء|مذيع|تريند|ترند|مرض الشيخ|وفاة|جنازة|أموال|ثروة"
                    r"|معاوية|الجمل|صفين|كربلاء|الحسين|يبكي على|ينهار|تحدي|مقلب|ضحك|مضحك|نكت", re.I)
# channels of the preachers themselves and of the Islamic TV stations they appear on
TRUSTED = re.compile(r"الرسمية|الرسمي|Official|قناة الرحمة|Al Rahma|قناة الناس|Al Nas|اقرأ|Iqraa|المجد|Almajd|الرسالة|Alresalah|الفجر|طيبة|"
                     r"دار الإفتاء|الأزهر|Azhar|CBC|سي بي سي|الحياة|DMC|صدى البلد|ON|"
                     r"السويدان|الكندري|عبد ?الكافي|العوضي|النابلسي|زغلول|العريفي|محمد حسان|محمود المصري|ديدات|السالمي|الشبيلي|"
                     r"مصطفى حسني|خالد الجندي|علي جمعة|عبد ?المعز|مبروك عطية|عمر هاشم|الغزالي|عمرو خالد|هداية|الورداني|الجفري|المغامسي|المشاري|Zakir|ذاكر", re.I)
PREACH_CAP = 400
# films and shows that share a preacher's family name, and videos made against him
MOVIE = re.compile(r"\bmovie\b|\bfilm\b|فيلم|افلام|أفلام|starring|بطولة|برومو|\btrailer\b|اعلان|إعلان|كليب|أغنية|اغنية|غناء|كوميدي|comedy|مسرحية|كرتون", re.I)
CRITIC = r"(?:رد|الرد|ردود|مناصحة|نقد|ينتقد|انتقاد|أخطاء|اخطاء|أكاذيب|اكاذيب|كذب|تكذيب|ضلالات|بدع|يفضح|حقيقة|شبهات|افتراءات|الأخ وحيد|الاخ وحيد)\S*\s+(?:\S+\s+){0,3}"


def build_preachers():
    only = set(filter(None, os.environ.get("ONLY", "").split(",")))
    idx = load("index.json", {"keys": {}})
    keys = idx.setdefault("keys", {})
    for key, name, tok, path, poster in PREACHERS:
        if only and key not in only:
            continue
        tre = re.compile(tok)
        excl = re.compile(PREACH_EXCLUDE[key]) if key in PREACH_EXCLUDE else None
        others = [re.compile(t) for k2, n2, t, p2, l2 in PREACHERS if k2 != key]
        base = re.sub(r"^(الشيخ د\.|الشيخ|د\.|الأستاذ)\s+", "", name)
        queries = [(base + " " + x).strip() for x in PREACH_SUFFIX]
        pls = {}
        for q in (base, base + " سلسلة", base + " برنامج", base + " دروس"):
            for plid, ptitle, n in playlists_for(q):
                if plid and tre.search(ptitle) and not POLITICS.search(ptitle) and not BAD.search(ptitle) and n >= 3:
                    pls[plid] = (ptitle, n)
        top = sorted(pls, key=lambda k: -pls[k][1])[:12]
        with ThreadPoolExecutor(3) as ex:
            batches = list(ex.map(search, queries))
            batches += [[dict(v, pl=1) for v in r] for r in ex.map(playlist_videos, top)]
        seen = {}
        for res in batches:
            for v in res:
                if v["id"] in seen or BAD.search(v["t"]) or POLITICS.search(v["t"]) or GOSSIP.search(v["t"]) or (excl and excl.search(v["t"])):
                    continue
                if any(o.search(v["t"]) for o in others) and not tre.search(v["t"]):
                    continue
                if v["d"] < 120 or v["d"] > 4 * 3600:
                    continue
                seen[v["id"]] = v
        lst = sorted(seen.values(), key=lambda v: -v["v"])[:PREACH_CAP + 60]
        rows, series = finish_preacher(key, [(v["id"], v["t"], v["d"], v["v"]) for v in lst])
        if not rows:
            print(key, name, "nothing found")
            continue
        save(f"s/{key}.json", rows)
        keys[key] = preacher_entry(key, rows, series)
        print(key, name, len(rows), "playlists:", len(top), flush=True)
    idx["updated"] = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    save("index.json", idx)


# ---- what each preacher is known for (shown under his name) ----
PREACH_ABOUT = {
    "p1": "التاريخ الإسلامي والقيادة والسيرة", "p2": "رحلات إيمانية وبرامج للشباب",
    "p3": "الرقائق والسيرة والدار الآخرة", "p4": "قصص الأنبياء والصحابة والمواعظ",
    "p5": "التفسير وأسماء الله الحسنى والإيمان", "p6": "الإعجاز العلمي في القرآن والسنة",
    "p7": "المواعظ والسيرة وقصص الصحابة", "p8": "التفسير وخطب الجمعة والسيرة",
    "p9": "قصص الصحابة والتابعين والرقائق", "p10": "مقارنة الأديان والمناظرات",
    "p11": "المواعظ والقصص المؤثرة", "p14": "الرقائق وقصص القرآن",
    "p20": "تزكية النفس وبرامج رمضان", "p21": "التفسير والفقه والفتاوى",
    "p22": "الفقه والتزكية والفتاوى", "p23": "الفتاوى والرقائق وقصص القرآن",
    "p24": "الفقه والأسرة والفتاوى", "p25": "الحديث والسيرة النبوية",
    "p26": "الفكر الإسلامي والدعوة", "p27": "قصص الأنبياء والسيرة والأخلاق",
    "p29": "الفتاوى والأسرة وقضايا الشباب", "p30": "التزكية والمحبة والسيرة",
    "p31": "التفسير والسيرة والتأملات القرآنية", "p32": "المواعظ والقصص والدار الآخرة",
    "p33": "مقارنة الأديان والرد على الشبهات",
}

def _n(t):
    t = re.sub("[\u064B-\u0652\u0640]", "", t)
    t = re.sub("[أإٱ]", "ا", t)
    return t.replace("ة", "ه").replace("ى", "ي").replace("ـ", "")

_PROPHETS = "ادم|نوح|ابراهيم|موسي|عيسي|يوسف|يونس|ايوب|سليمان|داود|هود|صالح|لوط|شعيب|زكريا|يحيي|اسماعيل|ادريس|الياس|يعقوب|اسحاق"
# first match wins, so the narrow topics come before the wide ones
TOPICS = [
    ("خطب الجمعة", r"خطبه|خطب الجمعه|\bخطب\b"),
    ("مقارنة الأديان", r"المسيح عيسي|المسيحي|النصار|النصراني|الانجيل|الاناجيل|الكتاب المقدس|\bالقس|القسيس|البابا|مناظر|الثالوث|الصلب|التوراه|ملحد|الحاد|الالحاد|بوذ|هندوس|\bBible|Jesus|Christ|atheis|Hindu|debate"),
    ("الإعجاز العلمي", r"اعجاز|الاعجاز|العلم الحديث|الكون|الفلك|النجوم|الجبال|البحار|الاجنه|الجنين|Miracle|scien"),
    ("قصص الأنبياء", r"قصص الانبياء|الانبياء|نبي الله|سيدنا (" + _PROPHETS + r")|قصه (" + _PROPHETS + r")|\b(" + _PROPHETS + r") عليه السلام|ذو القرنين|اهل الكهف|اصحاب الكهف|الخضر"),
    ("الصحابة وآل البيت", r"الصحابه|الصحابي|صحابي|ابو بكر|ابي بكر|الصديق|عمر بن الخطاب|الفاروق|عثمان بن عفان|علي بن ابي طالب|خالد بن الوليد|ابو عبيده|سعد بن|بلال بن|عائشه|خديجه|فاطمه الزهراء|زينب بنت|امهات المؤمنين|ال البيت|التابعين|عمر بن عبد العزيز|ابو هريره|حمزه|مصعب|سلمان الفارسي|Companion|Abu Bakr|Umar ibn|Uthman|Khalid ibn"),
    ("السيرة النبوية", r"السيره|سيره الرسول|سيره النبي|سيره المصطفي|المصطفي|الرسول|رسول الله|النبي محمد|ﷺ|صلي الله عليه وسلم|غزوه|بدر|الخندق|الهجره|المولد النبوي|الاسراء|المعراج|Seerah|Prophet Muhammad"),
    ("التاريخ الإسلامي", r"التاريخ|تاريخ|الاندلس|فتح |الفتوحات|الخلافه|صلاح الدين|القدس|الاقصي|العثماني|المماليك|القسطنطينيه|اليرموك|القادسيه|حطين|المغول|التتار|قطز|الفاتح|History|Conquest|Andalus"),
    ("الدار الآخرة", r"القبر|الموت|الميت|يوم القيامه|القيامه|الجنه|النار|جهنم|الاخره|الآخره|الحساب|الصراط|الميزان|علامات الساعه|قيام الساعه|الدجال|الحشر|المحشر|البرزخ|سكرات|حسن الخاتمه|سوء الخاتمه|الشفاعه|الحوض|Paradise|Hell|Hereafter|grave|Judgment"),
    ("رمضان والصيام", r"رمضان|الصيام|الصوم|صائم|العشر الاواخر|ليله القدر|الافطار|السحور|الاعتكاف|Ramadan"),
    ("القرآن وتفسيره", r"تفسير|التفسير|تدبر|سوره|آيه|آيات|الآيه|قوله تعالي|القران|القرآن|خواطر قرانيه|Quran"),
    ("العبادات", r"الصلاه|صلاه|الوضوء|الحج|العمره|الزكاه|الطهاره|الغسل|الاستخاره|قيام الليل|السنن|الاضحيه|عرفه|ذي الحجه|الاذان|السجود|الخشوع في"),
    ("فتاوى وأحكام", r"\bحكم\b|احكام|يجوز|فتوي|فتاوي|حلال|حرام|سؤال|السائل|سائل|متصل|متصله|الفقه|فقه|شرعا|ما رايك|اسال"),
    ("الأسرة والمرأة والتربية", r"الزوج|الزوجه|الزواج|زواج|طلاق|الاسره|المراه|النساء|البنات|\bالام\b|الاب\b|الابناء|الاولاد|الاطفال|تربيه|البيت|الحجاب|الوالدين|بر الوالدين|العائله|الحماه|الخطوبه|marriage|wife|husband|parents"),
    ("العقيدة والإيمان", r"اسماء الله|الحسني|التوحيد|العقيده|الايمان|الشرك|القدر|الغيب|الملائكه|\bالجن\b|معرفه الله|صفات الله|اليقين بالله|وجود الله|Allah"),
    ("الرقائق والتزكية", r"التوبه|توبه|الذنوب|ذنوب|المعاصي|معصيه|القلب|القلوب|الاخلاص|التوكل|الصبر|الرضا|الاستغفار|الدعاء|دعاء|ذكر الله|الذكر|البكاء|الحزن|الهم|الفرج|الابتلاء|البلاء|النفس|نفسك|اليقين|حب الله|محبه الله|القرب من الله|السكينه|الطمانينه|الخوف|الرجاء|حسن الظن|الشكر|الغفله|الدنيا|زهد|ربنا|الله"),
    ("الأخلاق والحياة", r"الاخلاق|اخلاق|الصدق|الكذب|الامانه|الغيبه|النميمه|الحسد|الحقد|الظلم|الرزق|المال|الغني|الفقر|الجار|الصداقه|الشباب|النجاح|العمل|الوقت|السعاده|التفاؤل|الامل|الغضب|الكبر|التواضع|الحياء|الادب|الناس|life|success"),
]
_TOPICS = [(n, re.compile(rx, re.I)) for n, rx in TOPICS]
TOPIC_ORDER = [n for n, _ in TOPICS] + ["مترجمة ومدبلجة بالعربي", "محاضرات بالإنجليزية", "مواعظ متنوعة"]

def _fz(rx):
    """regex مكتوب بالحروف الموحدة → يقبل الهمزات والتاء المربوطة والألف المقصورة."""
    return rx.replace("ا", "[اأإٱ]").replace("ه", "[هة]").replace("ي", "[يى]")


_HONOR = re.compile(_fz(r"(?:لفضيله|فضيله|للشيخ|الشيخ|شيخ|للدكتور|الدكتور|دكتور|الداعيه|الامام|الاستاذ|العلامه|الحبيب|د\s*[./]|أ\.د|ا\.د|\bمع\b|\bDr\.?|Sheikh|\bد\b)\s*"), re.I)
_EPISODE = re.compile(_fz(r"(?:الحلقه|حلقه|الحلقات|Episode|\bEps?\b|لقاء|الجزء|جزء|\bج\b|\bPart|المجلس|الدرس|درس)\s*[:#\-]?\s*[\d٠-٩]*|[\d٠-٩]+\s*(?:هـ|م\b)?|\bح\s*[\d٠-٩]+|والاخيره|الاخيره|الاولي|الثانيه|الثالثه|الرابعه|الخامسه"), re.I)
_SPLIT = re.compile(r"\s*(?:·|\|\||[|•–—«»\"“”{}\[\]()]|\s-\s|-(?=\S)|(?<=\S)-)\s*")
_GENERIC = set(map(_n, "برنامج سلسلة قصة قصه قصص رقم حلقة حلقات الحلقة مقطع مقاطع روعة جميل جميلة اسمع شاهد استمع لايف مباشر بث فيديو كلمة كلمه موعظة موعظه خاطرة خاطره الله يا الله سبحان الله ماشاء الله مؤثرة التفسير تفسير خطبة الجمعة خطبه الجمعه خطبة جمعة مترجم محاضرة محاضره درس دروس مقطع رائع مؤثر جديد كامل كاملة كاملة رمضان مهم جدا English Subtitle حصريا قناة الرحمة القناة الرسمية HD لا تفوتك قصة مؤثرة روائع".split(" ") + ["خطبة الجمعة", "قناة الرحمة", "القناة الرسمية", "English Subtitle", "مقطع مؤثر", "مقطع رائع"]))
# names that are not a program: sermons, dates, TV hosts, other preachers, filler phrases
_NOTPROG = re.compile(_fz(r"^(?:و|بن|ابن|ابو|ال)\s|خطب|بتاريخ|بعنوان|يناير|فبراير|مارس|ابريل|مايو|يونيو|يوليو|اغسطس|سبتمبر|اكتوبر|نوفمبر|ديسمبر"
                          r"|محرم|صفر|ربيع|جمادي|رجب|شعبان|شوال|القعده|الحجه|رحمه الله|تعالي|والله اعلم|رائع|مؤثر|الكامل|كامله|مترجم|مدبلج|بالعربي|dmc|قناه|\bTV\b|تي في"
                          r"|الليثي|اديب|لميس|الدمرداش|خيري رمضان|الابراشي|ابو عمار|^الرسول$|^الحديث$|يرويها|^اقرا$|^الحلقه|^حلقه")
                      + "|" + "|".join(_fz(_n(t)) for k, n, t, p, l in PREACHERS), re.I)
_PROGRAM = re.compile(r"(?:برنامج|سلسله|سلسلة)\s+[\"«“']?([^·|()\"«»“”{}\[\]\d٠-٩\-–]{2,40})")
_PSTOP = re.compile(_fz(r"\s(?:مع|لفضيله|للشيخ|الشيخ|للدكتور|الدكتور|د\s*[./]|الحلقه|حلقه|رمضان|الجزء|من|في)\b.*$"))
_AR_DIG = str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")


def _ep_no(t):
    m = re.search(r"(?:الحلقة|الحلقه|حلقة|حلقه|Episode|\bEps?\b|لقاء|الجزء|\bح)\s*[:#\-]?\s*([\d٠-٩]+)", t, re.I)
    return int(m.group(1).translate(_AR_DIG)) if m else 10 ** 6


def _labels(title, tre, chan):
    """أسماء البرامج والسلاسل اللي ممكن الفيديو يكون منها."""
    t = tre.sub(" ", re.sub("[\u064B-\u0652\u0640]", "", title))
    out = {}
    def put(lab):
        lab = re.sub("[\u064B-\u0652\u0640]", "", lab)
        lab = re.sub(r"[!؟?.,:،…#_*/\\+=~]+", " ", lab)
        lab = re.sub(r"\s+", " ", lab).strip()
        lab = re.sub(r"^(?:في|فى|من برنامج|من سلسلة|برنامج|سلسلة|سلسله|المحاضرة|محاضرة|محاضره)\s+", "", lab)
        lab = re.sub(_fz(r"\s*(?:الموسم\s*)?(?:الاول|الثاني|الثالث|الرابع|الخامس)$"), "", lab)
        lab = re.sub(r"^\S\s+|\s+\S$", "", lab).strip()
        k = _n(lab)
        if (3 <= len(lab) <= 30 and k not in _GENERIC and k != _n(chan or "") and re.search(r"[؀-ۿ]{3}", lab)
                and not _NOTPROG.search(k)):
            out.setdefault(k, lab)
    for m in re.finditer(_fz(r"(?:برنامج|سلسله)\s+[\"«“']?([^·|()\"«»“”{}\[\]\d٠-٩\-–]{2,40})"), t):
        put(_PSTOP.sub("", m.group(1)))
    for seg in _SPLIT.split(t):
        put(_EPISODE.sub(" ", _HONOR.sub(" ", seg)))
    return out


def classify_preacher(key, rows):
    """بيقسم فيديوهات الداعية: برامجه وسلاسله كل واحدة في فولدر، والباقي على حسب الموضوع."""
    tok, name = next((t, n) for k, n, t, p, l in PREACHERS if k == key)
    # his name (every part of it) is never a folder name
    words = [w for w in re.sub(r"^(الشيخ|د\.|الحبيب)\s+", "", name).split() if len(w) > 2]
    tre = re.compile(tok + "".join("|" + _fz(_n(w)) for w in words), re.I)
    raw = [_labels(r[1], tre, r[4]) for r in rows]
    labs = [set(d) for d in raw]
    freq, shown = {}, {}
    for d in raw:
        for k, l in d.items():
            freq[k] = freq.get(k, 0) + 1
            shown.setdefault(k, {}).setdefault(l, 0)
            shown[k][l] += 1
    # a program is a name that comes back in 5 titles or more (but not in almost all of them)
    progs = sorted([l for l, c in freq.items() if c >= 5 and c <= 0.7 * len(rows)], key=lambda l: -freq[l])
    # drop a name that is only part of a longer program name
    keep = []
    for l in progs:
        if not any(l != o and (l in o or o in l) and freq[o] >= freq[l] * 0.8 for o in keep):
            keep.append(l)
    progs = keep[:10]
    name_of = {k: max(shown[k], key=shown[k].get) for k in progs}
    for r, ls in zip(rows, labs):
        hit = [l for l in progs if l in ls]
        if hit:
            r[5] = name_of[hit[0]]
            continue
        t = _n(tre.sub(" ", r[1]))
        if not re.search(r"[؀-ۿ]", r[1]):
            r[5] = "محاضرات بالإنجليزية"
            continue
        if re.search("مدبلج|بالعربي|مترجم", t):
            r[5] = "مترجمة ومدبلجة بالعربي"
            continue
        r[5] = next((n for n, rx in _TOPICS if rx.search(t)), "مواعظ متنوعة")
    # tiny topic folders go to the mixed one
    series = set(name_of.values())
    cnt = {}
    for r in rows:
        cnt[r[5]] = cnt.get(r[5], 0) + 1
    for r in rows:
        if cnt[r[5]] < 4:
            r[5] = "مواعظ متنوعة"
    cnt = {}
    for r in rows:
        cnt[r[5]] = cnt.get(r[5], 0) + 1
    order = sorted(cnt, key=lambda g: (0, -cnt[g]) if g in series else (1, TOPIC_ORDER.index(g)))
    pos = {g: i for i, g in enumerate(order)}
    # programs in episode order, topics by views
    rows.sort(key=lambda r: (pos[r[5]], _ep_no(r[1]) if r[5] in series else 0, -r[3]))
    return rows, [g for g in order if g in series]


def finish_preacher(key, items):
    """items = [(id, title, seconds, views)] → الصفوف بعد الفلترة والتقسيم."""
    tok = next(t for k, n, t, p, l in PREACHERS if k == key)
    tre = re.compile(tok, re.I)
    excl = re.compile(PREACH_EXCLUDE[key]) if key in PREACH_EXCLUDE else None
    critic = re.compile(CRITIC + "(?:" + tok + ")", re.I)
    with ThreadPoolExecutor(12) as ex:
        info = list(ex.map(oembed_full, [x[0] for x in items]))
    good = []
    for (vid, t0, d, v), inf in zip(items, info):
        if not inf:
            continue
        a, t = inf[0] or "", inf[1] or t0
        if re.search(r"français|francais|\bfrench\b|\bVF\b|en français", t, re.I):
            continue
        if any(rx.search(t) for rx in (BAD, POLITICS, GOSSIP, MOVIE, critic)) or POLITICS.search(a) or MOVIE.search(a):
            continue
        if excl and (excl.search(t) or excl.search(a)):
            continue
        if not (tre.search(t) or tre.search(a)):
            continue
        good.append((vid, t, d, v, a))
    # the preacher's own channel and the Islamic stations first, then the rest by views
    good.sort(key=lambda x: (0 if TRUSTED.search(x[4]) else 1, -x[3]))
    rows = [[vid, clean_title(t), d, v, a, ""] for vid, t, d, v, a in good[:PREACH_CAP]]
    return classify_preacher(key, rows) if rows else (rows, [])


def preacher_entry(key, rows, series):
    name, path, poster = next((n, p, l) for k, n, t, p, l in PREACHERS if k == key)
    groups = list(dict.fromkeys(r[5] for r in rows))
    by_views = sorted(rows, key=lambda r: -r[3])
    # [count, top 3, folders, name, library folder, poster, what he talks about, folders that are programs]
    return [len(rows), [r[0] for r in by_views[:3]], groups, name, path, poster, PREACH_ABOUT.get(key, ""), series]


def regroup_preachers():
    """من غير بحث جديد: يرجّع العناوين الأصلية، ويفلتر تاني، ويقسم الفيديوهات فولدرات."""
    only = set(filter(None, os.environ.get("ONLY", "").split(",")))
    idx = load("index.json", {"keys": {}})
    keys = idx.setdefault("keys", {})
    for key, name, tok, path, poster in PREACHERS:
        if (only and key not in only) or key not in keys:
            continue
        old = load(f"s/{key}.json", [])
        rows, series = finish_preacher(key, [(r[0], r[1], r[2], r[3]) for r in old])
        save(f"s/{key}.json", rows)
        keys[key] = preacher_entry(key, rows, series)
        print(key, name, len(old), "->", len(rows), "|", " / ".join(f"{g}:{sum(1 for r in rows if r[5] == g)}" for g in keys[key][2]), flush=True)
    save("index.json", idx)


if __name__ == "__main__":
    what = sys.argv[1:] or ["dawla"]
    if "dawla" in what:
        build_dawla()
    if "sheikhs" in what:
        build_sheikhs()
    if "preachers" in what:
        build_preachers()
    if "regroup" in what:
        regroup_preachers()
