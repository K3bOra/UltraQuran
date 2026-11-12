# Ultra Quran — Change Log
# الترا قرآن — سجل الإصدارات

For the authoritative current version and download metadata, see [update.json](https://github.com/K3bOra/UltraQuran/releases/latest/download/update.json).

لمعرفة الإصدار الحالي وبيانات التحميل الرسمية، راجع [update.json](https://github.com/K3bOra/UltraQuran/releases/latest/download/update.json).

## V0.9.3
### الجديد في V0.9.3

- Video player bar: the bars beside the poster now end level with the bottom of the poster at the screen edge, with a tighter gap between the upper panels and the lower bars.<br>شريط مشغّل الفيديو: البارات اللي جنب البوستر نزلت وبقت آخرها على نفس مستوى آخر البوستر عند حافة الشاشة، والمسافة بين القطع اللي فوق والبارين اللي تحت بقت أقل.

[Release and downloads](https://github.com/K3bOra/UltraQuran/releases/tag/v0.9.3)<br>
[تفاصيل الإصدار والتحميل](https://github.com/K3bOra/UltraQuran/releases/tag/v0.9.3)

## V0.9.2
### الجديد في V0.9.2

- New "Royal Emerald" Mushaf frame: raised gold with metallic light and shade, a braided gold rope, an emerald band with ruby-set gold roses, gold sunburst corners and ruby cartouches.<br>إطار المصحف «الزمرد الملكي»: ذهب بارز بإضاءة وضل زي المعدن، وحبل ذهب مجدول، وشريط زمردي عليه ورود ذهب مرصّعة بالياقوت، وشمسة ذهب في الأركان وخرطوشة ياقوتي فوق وتحت.
- New "now playing" mark: a gold dot beside the surah name with two sound waves.<br>علامة «شغال دلوقتي» الجديدة: نقطة ذهب جنب اسم السورة وموجتين صوت.

## V0.9.1
### الجديد في V0.9.1

- DreamOS: exteplayer3 (ServiceApp 5002) is tried right after the DreamOS player when installed.<br>على الدريم: لو exteplayer3 موجود بيتجرب بعد مشغّل الدريم على طول.
- Choose the first player yourself with `/etc/enigma2/ultra-quran-player.txt` (`exteplayer3`, `dreamos` or `gstreamer`).<br>اختار المشغّل الأول بنفسك من ملف `/etc/enigma2/ultra-quran-player.txt`.

## V0.9.0
### الجديد في V0.9.0

- Audio playback files and output selection aligned with the DreamOS edition of Ultra Audio; `snd-pcm-oss` is loaded once when no sound device exists.<br>ملفات تشغيل الصوت واختيار المخرج بقت نفس نسخة الدريم من Ultra Audio، ولو مفيش كارت صوت بيتحمّل `snd-pcm-oss` مرة واحدة.
- DreamOS ignores "stop" events in the first 3 seconds of playback, like Ultra Stalker.<br>على الدريم أي رسالة «وقف» في أول 3 ثواني بيتم تجاهلها زي Ultra Stalker.

## V0.8.9
### الجديد في V0.8.9

- DreamOS review: detection, default player (8193), text measuring margin and a full Python 2.7 pass.<br>مراجعة نسخة الدريم: التعرف على DreamOS، والمشغّل الافتراضي 8193، وهامش قياس الكلام، ومراجعة كاملة لـ Python 2.7.

## V0.8.8
### الجديد في V0.8.8

- Saturated red, green, yellow and blue remote-key colours on every screen.<br>ألوان أزرار الريموت تحت بقت متشبعة في كل الشاشات.

## V0.8.7 · V0.8.6
### الجديد في V0.8.7 وV0.8.6

- One shared emerald-glass background with gold stars behind every screen; artwork reduced from 31 MB to 20 MB.<br>خلفية واحدة مشتركة (زجاج أخضر بنقشة نجوم ذهبي) تحت كل الشاشات، والصور بقت 20 ميجا بدل 31.

## V0.8.5
### الجديد في V0.8.5

- Faster audio and video start: final stream addresses are resolved in the background while you browse, and playback starts after one second of ready audio.<br>الصوت والفيديو بيبدأوا أسرع: الرابط النهائي بيتجهز في الخلفية وإنت لسه واقف على المادة، والتشغيل بيبدأ بعد ثانية صوت جاهزة.

## V0.8.1 – V0.8.3
### الجديد من V0.8.1 لـ V0.8.3

- Full biography panel on the yellow / INFO key, with complete Arabic Wikipedia biographies for 92 sheikhs and automatic download for the rest.<br>زرار «السيرة الذاتية» (الأصفر أو INFO)، و92 شيخ بسيرة كاملة جاهزة من ويكيبيديا العربية، والباقيين الرسيفر بيجيبهم لوحده.

## Earlier versions
### الإصدارات الأقدم

The complete Arabic history since V0.5.0 «الزمرّد الملكي» ships inside the plugin in `README.md`.

السجل الكامل بالعربي من أول V0.5.0 «الزمرّد الملكي» موجود جوه البلجن في ملف `README.md`.
