package com.k3bora.ultraquran;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Alarms are cleared on reboot / time changes; put them back. */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent intent) {
        AdhanScheduler.reschedule(ctx);
    }
}
