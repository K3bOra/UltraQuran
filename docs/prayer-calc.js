/* Prayer times — own implementation of the standard astronomical method
   (sun declination + equation of time, as used by PrayTimes / the Egyptian
   General Authority of Survey and others). Returns Date objects (absolute time). */
(function (root) {
  "use strict";
  const rad = (d) => (d * Math.PI) / 180, deg = (r) => (r * 180) / Math.PI;
  const sin = (d) => Math.sin(rad(d)), cos = (d) => Math.cos(rad(d)), tan = (d) => Math.tan(rad(d));
  const asin = (x) => deg(Math.asin(x)), acos = (x) => deg(Math.acos(x)), atan2 = (y, x) => deg(Math.atan2(y, x));
  const acot = (x) => deg(Math.atan(1 / x));
  const fix = (a, b) => { a = a - b * Math.floor(a / b); return a < 0 ? a + b : a; };
  const fixAngle = (a) => fix(a, 360), fixHour = (a) => fix(a, 24);

  // fajr / isha angles; isha may be minutes after maghrib; adj = minutes added per prayer
  const METHODS = {
    egypt:   { name: "الهيئة المصرية العامة للمساحة", fajr: 19.5, isha: 17.5 },
    mwl:     { name: "رابطة العالم الإسلامي", fajr: 18, isha: 17, adj: { dhuhr: 1 } },
    makkah:  { name: "أم القرى · مكة المكرمة", fajr: 18.5, ishaMin: 90 },
    karachi: { name: "جامعة العلوم الإسلامية · كراتشي", fajr: 18, isha: 18, adj: { dhuhr: 1 } },
    dubai:   { name: "الإمارات (دبي)", fajr: 18.2, isha: 18.2, adj: { sunrise: -3, dhuhr: 3, asr: 3, maghrib: 3 } },
    kuwait:  { name: "الكويت", fajr: 18, isha: 17.5 },
    qatar:   { name: "قطر", fajr: 18, ishaMin: 90 },
    algeria: { name: "الجزائر", fajr: 18, isha: 17, adj: { maghrib: 3 } },
    morocco: { name: "المغرب", fajr: 19, isha: 17, adj: { maghrib: 5 } },
    tunisia: { name: "تونس", fajr: 18, isha: 18 },
    turkey:  { name: "تركيا (ديانت)", fajr: 18, isha: 17, adj: { sunrise: -7, dhuhr: 5, asr: 4, maghrib: 7 } },
    isna:    { name: "أمريكا الشمالية (ISNA)", fajr: 15, isha: 15 },
  };

  function julian(y, m, d) {
    if (m <= 2) { y -= 1; m += 12; }
    const A = Math.floor(y / 100), B = 2 - A + Math.floor(A / 4);
    return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + d + B - 1524.5;
  }
  function sunPosition(jd) {
    const D = jd - 2451545.0;
    const g = fixAngle(357.529 + 0.98560028 * D), q = fixAngle(280.459 + 0.98564736 * D);
    const L = fixAngle(q + 1.915 * sin(g) + 0.02 * sin(2 * g));
    const e = 23.439 - 0.00000036 * D;
    const RA = atan2(cos(e) * sin(L), cos(L)) / 15;
    return { decl: asin(sin(e) * sin(L)), eqt: q / 15 - fixHour(RA) };
  }

  /**
   * times(date, lat, lng, methodKey, asrFactor) -> {fajr, sunrise, dhuhr, asr, maghrib, isha}
   * `date` picks the calendar day (y/m/d of the given Date in the city's own time zone, passed as ymd).
   */
  function times(ymd, lat, lng, methodKey = "egypt", asrFactor = 1, elevation = 0) {
    const M = METHODS[methodKey] || METHODS.egypt;
    const [y, m, d] = ymd;
    const jDate = julian(y, m, d) - lng / (15 * 24);
    const riseAngle = 0.833 + 0.0347 * Math.sqrt(Math.max(0, elevation));
    const midDay = (t) => fixHour(12 - sunPosition(jDate + t).eqt);
    const angleTime = (angle, t, ccw) => {
      const decl = sunPosition(jDate + t).decl;
      const noon = midDay(t);
      const T = acos((-sin(angle) - sin(decl) * sin(lat)) / (cos(decl) * cos(lat))) / 15;
      return noon + (ccw ? -T : T);
    };
    const asrTime = (f, t) => { const decl = sunPosition(jDate + t).decl; return angleTime(-acot(f + tan(Math.abs(lat - decl))), t); };

    let t = { fajr: 5, sunrise: 6, dhuhr: 12, asr: 13, sunset: 18, isha: 18 };
    for (let i = 0; i < 2; i++) {
      const p = {}; for (const k in t) p[k] = t[k] / 24;
      t = {
        fajr: angleTime(M.fajr, p.fajr, true),
        sunrise: angleTime(riseAngle, p.sunrise, true),
        dhuhr: midDay(p.dhuhr),
        asr: asrTime(asrFactor, p.asr),
        sunset: angleTime(riseAngle, p.sunset),
        isha: M.isha ? angleTime(M.isha, p.isha) : 18,
      };
    }
    // high latitudes: fall back to the "angle-based" portion of the night
    const night = 24 - t.sunset + t.sunrise;
    if (!isFinite(t.fajr) || t.sunrise - t.fajr > (M.fajr / 60) * night) t.fajr = t.sunrise - (M.fajr / 60) * night;
    if (M.isha && (!isFinite(t.isha) || t.isha - t.sunset > (M.isha / 60) * night)) t.isha = t.sunset + (M.isha / 60) * night;

    const out = { fajr: t.fajr, sunrise: t.sunrise, dhuhr: t.dhuhr, asr: t.asr, maghrib: t.sunset, isha: M.ishaMin ? t.sunset + M.ishaMin / 60 : t.isha };
    const base = Date.UTC(y, m - 1, d);
    const res = {};
    for (const k in out) {
      const hoursUTC = out[k] - lng / 15 + ((M.adj && M.adj[k]) || 0) / 60;
      // round to the nearest minute
      res[k] = new Date(Math.round((base + hoursUTC * 3600e3) / 60000) * 60000);
    }
    return res;
  }
  root.PrayerCalc = { times, METHODS };
  if (typeof module !== "undefined") module.exports = root.PrayerCalc;
})(typeof self !== "undefined" ? self : this);
