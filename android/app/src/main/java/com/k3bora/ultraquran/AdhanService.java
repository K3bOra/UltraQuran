package com.k3bora.ultraquran;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

import java.io.File;

/** Plays the adhan with the screen locked and the app closed, with a "stop" button in the notification. */
public class AdhanService extends Service {
    static final String CHANNEL = "adhan";
    private static final int NOTE_ID = 7001;
    private MediaPlayer player;

    @Override
    public IBinder onBind(Intent intent) { return null; }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && "stop".equals(intent.getAction())) { stopSelf(); return START_NOT_STICKY; }
        String name = intent != null ? intent.getStringExtra("name") : null;
        String url = intent != null ? intent.getStringExtra("url") : null;
        boolean test = intent != null && "test".equals(intent.getStringExtra("k"));
        if (name == null) name = "";
        Notification n = note(this, test ? "تجربة الأذان" : "حان الآن موعد أذان " + name, test ? "ألترا قرآن" : "ألترا قرآن · " + name);
        if (Build.VERSION.SDK_INT >= 29) startForeground(NOTE_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        else startForeground(NOTE_ID, n);
        play(url);
        return START_NOT_STICKY;
    }

    private void play(String url) {
        release();
        if (url == null || url.isEmpty()) { stopSelf(); return; }
        try {
            player = new MediaPlayer();
            player.setAudioAttributes(new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ALARM)
                .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build());
            player.setWakeMode(this, PowerManager.PARTIAL_WAKE_LOCK);
            File f = AdhanCache.fileFor(this, url);
            if (f.exists() && f.length() > 10000) player.setDataSource(f.getPath());
            else player.setDataSource(url);
            player.setOnPreparedListener(MediaPlayer::start);
            player.setOnCompletionListener(mp -> stopSelf());
            player.setOnErrorListener((mp, what, extra) -> { stopSelf(); return true; });
            player.prepareAsync();
        } catch (Exception e) {
            stopSelf();
        }
    }

    private void release() {
        if (player != null) {
            try { player.stop(); } catch (Exception ignored) { }
            player.release();
            player = null;
        }
    }

    @Override
    public void onDestroy() {
        release();
        stopForeground(true);
        super.onDestroy();
    }

    static void channel(Context ctx) {
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null || nm.getNotificationChannel(CHANNEL) != null) return;
        NotificationChannel ch = new NotificationChannel(CHANNEL, "الأذان", NotificationManager.IMPORTANCE_HIGH);
        ch.setDescription("الأذان في مواعيد الصلاة");
        ch.setSound(null, null);
        ch.enableVibration(true);
        ch.setVibrationPattern(new long[]{0, 400, 200, 400});
        ch.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        nm.createNotificationChannel(ch);
    }

    private static Notification note(Context ctx, String title, String text) {
        channel(ctx);
        Intent open = new Intent(ctx, MainActivity.class).putExtra("route", "#/prayer").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        PendingIntent openPi = PendingIntent.getActivity(ctx, 1, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Intent stop = new Intent(ctx, AdhanService.class).setAction("stop");
        PendingIntent stopPi = PendingIntent.getService(ctx, 2, stop, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        return new Notification.Builder(ctx, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat)
            .setColor(0xFFD9B36C)
            .setContentTitle(title)
            .setContentText(text)
            .setCategory(Notification.CATEGORY_ALARM)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setContentIntent(openPi)
            .setDeleteIntent(stopPi)
            .setOngoing(true)
            .addAction(new Notification.Action.Builder(null, "إيقاف الأذان", stopPi).build())
            .build();
    }
}
