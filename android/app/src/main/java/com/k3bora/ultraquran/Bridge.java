package com.k3bora.ultraquran;

import android.annotation.SuppressLint;
import android.app.AlarmManager;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import android.webkit.JavascriptInterface;

/** Methods the web page can call as window.UltraQuranNative.* */
public class Bridge {
    private final Context ctx;

    Bridge(Context ctx) { this.ctx = ctx.getApplicationContext(); }

    static String quote(String s) {
        if (s == null) return "null";
        StringBuilder b = new StringBuilder("\"");
        for (char c : s.toCharArray()) {
            if (c == '"' || c == '\\') b.append('\\').append(c);
            else if (c < 0x20 || c == 0x2028 || c == 0x2029) b.append(String.format("\\u%04x", (int) c));
            else b.append(c);
        }
        return b.append('"').toString();
    }

    @JavascriptInterface
    public String version() { return BuildConfigLite.VERSION; }

    /** JSON: {"items":[{"t":epochMillis,"k":"fajr","name":"الفجر","url":"https://..."}], "city":"..."} */
    @JavascriptInterface
    public void schedulePrayers(String json) {
        ctx.getSharedPreferences(AdhanScheduler.PREFS, Context.MODE_PRIVATE).edit().putString(AdhanScheduler.KEY, json).apply();
        AdhanScheduler.reschedule(ctx);
        AdhanCache.prefetch(ctx, json);
    }

    @JavascriptInterface
    public void clearPrayers() {
        ctx.getSharedPreferences(AdhanScheduler.PREFS, Context.MODE_PRIVATE).edit().remove(AdhanScheduler.KEY).apply();
        AdhanScheduler.reschedule(ctx);
    }

    /** Plays a test adhan through the native player in a few seconds (works with the screen locked). */
    @JavascriptInterface
    public void testAdhan(String name, String url, int seconds) {
        AdhanScheduler.scheduleTest(ctx, name, url, Math.max(3, seconds));
    }

    @JavascriptInterface
    public void stopAdhan() { ctx.stopService(new Intent(ctx, AdhanService.class)); }

    @JavascriptInterface
    public void playbackState(String title, String artist, boolean playing, boolean visible) {
        PlaybackService.update(ctx, title, artist, playing, visible);
    }

    @JavascriptInterface
    public boolean exactAlarms() {
        if (Build.VERSION.SDK_INT < 31) return true;
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        return am != null && am.canScheduleExactAlarms();
    }

    @JavascriptInterface
    public boolean batteryFree() {
        PowerManager pm = (PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
        return pm != null && pm.isIgnoringBatteryOptimizations(ctx.getPackageName());
    }

    @SuppressLint("BatteryLife")
    @JavascriptInterface
    public void openBatterySettings() {
        try {
            Intent i = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + ctx.getPackageName()));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(i);
        } catch (Exception e) {
            Intent i = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(i);
        }
    }

    @JavascriptInterface
    public void openNotificationSettings() {
        Intent i = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, ctx.getPackageName());
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        ctx.startActivity(i);
    }
}
