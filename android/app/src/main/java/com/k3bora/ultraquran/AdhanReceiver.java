package com.k3bora.ultraquran;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Fired by the exact alarm at prayer time: starts the adhan player. */
public class AdhanReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent intent) {
        if (intent.getStringExtra("name") == null) return;
        Intent s = new Intent(ctx, AdhanService.class)
            .putExtra("name", intent.getStringExtra("name"))
            .putExtra("url", intent.getStringExtra("url"))
            .putExtra("k", intent.getStringExtra("k"));
        try { ctx.startForegroundService(s); } catch (Exception ignored) { }
    }
}
