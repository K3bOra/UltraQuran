<div dir="rtl">

# نشر إصدارات Ultra Quran

المصدر الرسمي هو `K3bOra/UltraQuran`. النشر **يدوي فقط**؛ رفع الملفات على المستودع مش بينشر إصدار لوحده.

## قبل أول إصدار

المستودع بيبدأ **Private** لحد ما الصفحة والصور والنسخة يخلصوا. قبل تشغيل إجراء النشر لازم يتحوّل **Public** من
Settings ← General ← Danger Zone ← Change visibility، لأن:

- أمر التثبيت `wget … install.sh` بيقرا من `raw.githubusercontent.com`، وده مبيشتغلش على مستودع Private.
- البلجن المتسطب بيقرا `update.json` من فرع main عشان التحديث أونلاين (الزرار الأحمر).
- خطوة التحقق الأخيرة في الإجراء بتنزّل الملفات من الرابط العام زي أي مستخدم.

## كل إصدار

1. حط النسختين في `packages/` بأسمائهم الأصلية، واشيل القديم:
   `enigma2-plugin-extensions-ultraquran_<الإصدار>_all.ipk` و`…_all.deb`.
2. حدّث `release-notes.json` بنفس رقم الإصدار، بالإنجليزي في `notes` وبالعربي في `notes_ar`.
   الملاحظات العربية هي اللي بتظهر جوه البلجن في رسالة التحديث.
3. حدّث قسم «What's new — V…» في `README.md`، وزوّد الإصدار في أول `CHANGELOG.md`.
4. لو فيه صور جديدة حطها في `docs/screenshots/` بنفس الأسماء المكتوبة في [docs/screenshots/README.md](docs/screenshots/README.md).
5. جرّب محليًا:

   ```sh
   python3 -B scripts/prepare_release.py
   python3 -B scripts/check_page.py
   ```

6. من **Actions** اختار **Publish verified Ultra Quran release** وبعدين **Run workflow** على main.

## الإجراء بيعمل إيه

- يفحص الحزمتين من غير ما يسطبهم: اسم الحزمة، والرقم، و`Architecture: all`، وإن رقم `__init__.py` نفس رقم الحزمة،
  وإن `updater.py` بيشاور على المستودع ده، وإن مفيش ملفات `.pyc`، وإن كل ملفات البايثون سليمة.
- يتأكد إن كل الصور والروابط في الصفحة موجودة، وإن الصفحة والـ CHANGELOG فيهم الإصدار الجديد.
- يجهّز `update.json` بالرابط والحجم وبصمة SHA-256 لكل حزمة، ويجهّز `SHA256SUMS` وملاحظات الإصدار.
- يرفع مسودة، وينزّل المرفقات ويطابقها بايت ببايت، وبعدين ينشرها كـ Latest.
- ينزّل الحزم من الرابط العام ويجرب أمر التثبيت بوضع `--verify-only` على القناتين.
- في الآخر يحدّث `update.json` في main، فالبلجنات المتسطبة تشوف التحديث.

الإصدار المنشور عمره ما بيتبدّل. أي تعديل بعد النشر = رقم إصدار جديد.

## شكل update.json

```json
{
  "version": "0.9.3",
  "name": "Ultra Quran 0.9.3",
  "ipk": "https://github.com/K3bOra/UltraQuran/releases/download/v0.9.3/enigma2-plugin-extensions-ultraquran_0.9.3_all.ipk",
  "ipk_sha256": "…", "ipk_size": 0,
  "deb": "https://github.com/K3bOra/UltraQuran/releases/download/v0.9.3/enigma2-plugin-extensions-ultraquran_0.9.3_all.deb",
  "deb_sha256": "…", "deb_size": 0,
  "notes": ["…"],
  "notes_ar": ["…"]
}
```

ده نفس الشكل اللي `updater.py` جوه البلجن بيقراه، وأمر التثبيت بيقرا نفس الملف من أحدث إصدار.

فحوص الحزم والتوزيع مش بديل عن تجربة النسخة على أجهزة Enigma2 ودريم بوكس فعلية.

</div>
