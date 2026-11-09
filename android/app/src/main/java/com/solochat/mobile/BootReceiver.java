package com.solochat.mobile;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** 开机后恢复自动同步任务。 */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) {
            SyncJobService.schedulePeriodic(context);
        }
    }
}
