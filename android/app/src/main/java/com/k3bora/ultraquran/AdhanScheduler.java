package com.k3bora.ultraquran;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONObject;

/** Turns the prayer list sent by the page into exact alarms (alarm-clock alarms survive Doze). */
final class AdhanScheduler {
    static final String PREFS = "adhan";
    static final String KEY = "plan";
    private static final String COUNT = "count";
    private static final int MAX = 160;   // ~30 days x 5 prayers
    private static final int TEST_CODE = 9999;

    private AdhanScheduler() { }

    static void reschedule(Context ctx) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        SharedPreferences p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        int old = p.getInt(COUNT, 0);
        for (int i = 0; i < old; i++) am.cancel(pending(ctx, i, null, null, null));
        int n = 0;
        try {
            String json = p.getString(KEY, null);
            if (json != null) {
                JSONArray items = new JSONObject(json).optJSONArray("items");
                long now = System.currentTimeMillis();
                for (int i = 0; items != null && i < items.length() && n < MAX; i++) {
                    JSONObject it = items.getJSONObject(i);
                    long t = it.getLong("t");
                    if (t <= now + 5000) continue;
                    PendingIntent pi = pending(ctx, n, it.optString("name"), it.optString("url"), it.optString("k"));
                    set(ctx, am, t, pi);
                    n++;
                }
            }
        } catch (Exception ignored) { }
        p.edit().putInt(COUNT, n).apply();
    }

    static void scheduleTest(Context ctx, String name, String url, int seconds) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        Intent i = new Intent(ctx, AdhanReceiver.class).putExtra("name", name).putExtra("url", url).putExtra("k", "test");
        PendingIntent pi = PendingIntent.getBroadcast(ctx, TEST_CODE, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        set(ctx, am, System.currentTimeMillis() + seconds * 1000L, pi);
    }

    private static void set(Context ctx, AlarmManager am, long t, PendingIntent pi) {
        boolean exact = Build.VERSION.SDK_INT < 31 || am.canScheduleExactAlarms();
        if (exact) {
            Intent show = new Intent(ctx, MainActivity.class).putExtra("route", "#/prayer");
            PendingIntent showPi = PendingIntent.getActivity(ctx, 0, show, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            am.setAlarmClock(new AlarmManager.AlarmClockInfo(t, showPi), pi);
        } else {
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, t, pi);
        }
    }

    private static PendingIntent pending(Context ctx, int code, String name, String url, String k) {
        Intent i = new Intent(ctx, AdhanReceiver.class);
        if (name != null) i.putExtra("name", name).putExtra("url", url).putExtra("k", k);
        return PendingIntent.getBroadcast(ctx, code, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
}
