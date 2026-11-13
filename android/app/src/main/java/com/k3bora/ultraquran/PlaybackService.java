package com.k3bora.ultraquran;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

/**
 * Keeps the app alive while the page plays audio in the background (recitations, radio),
 * and shows a notification with previous / play-pause / next / stop.
 */
public class PlaybackService extends Service {
    private static final String CHANNEL = "playback";
    private static final int NOTE_ID = 7002;
    private static boolean running;
    private PowerManager.WakeLock lock;

    static void update(Context ctx, String title, String artist, boolean playing, boolean visible) {
        Context app = ctx.getApplicationContext();
        if (!visible) {
            if (running) app.stopService(new Intent(app, PlaybackService.class));
            return;
        }
        Intent i = new Intent(app, PlaybackService.class).setAction("update")
            .putExtra("title", title).putExtra("artist", artist).putExtra("playing", playing);
        try {
            if (running) app.startService(i);
            else if (playing) app.startForegroundService(i);
        } catch (Exception ignored) { }
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }

    @Override
    public void onCreate() {
        super.onCreate();
        running = true;
        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        if (pm != null) { lock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "UltraQuran:playback"); lock.setReferenceCounted(false); }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : null;
        if (action != null && !"update".equals(action)) {
            MainActivity.command(action);
            if ("stop".equals(action)) { stopSelf(); return START_NOT_STICKY; }
            return START_NOT_STICKY;
        }
        String title = intent != null ? intent.getStringExtra("title") : "";
        String artist = intent != null ? intent.getStringExtra("artist") : "";
        boolean playing = intent != null && intent.getBooleanExtra("playing", false);
        Notification n = note(title, artist, playing);
        if (Build.VERSION.SDK_INT >= 29) startForeground(NOTE_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        else startForeground(NOTE_ID, n);
        if (lock != null) { if (playing) lock.acquire(6 * 60 * 60 * 1000L); else if (lock.isHeld()) lock.release(); }
        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        running = false;
        if (lock != null && lock.isHeld()) lock.release();
        stopForeground(true);
        super.onDestroy();
    }

    private PendingIntent cmd(String action, int code) {
        Intent i = new Intent(this, PlaybackService.class).setAction(action);
        return PendingIntent.getService(this, code, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private Notification note(String title, String artist, boolean playing) {
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (nm != null && nm.getNotificationChannel(CHANNEL) == null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "التشغيل", NotificationManager.IMPORTANCE_LOW);
            ch.setShowBadge(false);
            nm.createNotificationChannel(ch);
        }
        Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        PendingIntent openPi = PendingIntent.getActivity(this, 3, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder b = new Notification.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat)
            .setColor(0xFFD9B36C)
            .setContentTitle(title == null ? "" : title)
            .setContentText(artist == null ? "" : artist)
            .setContentIntent(openPi)
            .setOngoing(playing)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setStyle(new Notification.MediaStyle().setShowActionsInCompactView(0, 1, 2))
            .addAction(new Notification.Action.Builder(null, "السابق", cmd("prev", 10)).build())
            .addAction(new Notification.Action.Builder(null, playing ? "إيقاف مؤقت" : "تشغيل", cmd("toggle", 11)).build())
            .addAction(new Notification.Action.Builder(null, "التالي", cmd("next", 12)).build())
            .addAction(new Notification.Action.Builder(null, "إغلاق", cmd("stop", 13)).build());
        return b.build();
    }
}
