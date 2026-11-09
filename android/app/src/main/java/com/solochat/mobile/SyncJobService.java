package com.solochat.mobile;

import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.content.ComponentName;
import android.content.Context;

/** 后台记忆同步（JobScheduler，无需 WorkManager 依赖）。 */
public class SyncJobService extends JobService {
    static final int JOB_PERIODIC = 4101;
    static final int JOB_SOON = 4103;

    @Override
    public boolean onStartJob(final JobParameters params) {
        new Thread(() -> {
            try {
                Dav.sync(getApplicationContext());
            } catch (Exception e) {
                Dav.notifyDone(getApplicationContext(), "同步失败：" + e.getMessage());
            }
            jobFinished(params, false);
        }).start();
        return true;
    }

    @Override
    public boolean onStopJob(JobParameters params) { return false; }

    public static void schedulePeriodic(Context c) {
        try {
            JobScheduler js = (JobScheduler) c.getSystemService(Context.JOB_SCHEDULER_SERVICE);
            if (!Prefs.davAuto(c) || Prefs.davUrl(c).trim().isEmpty()) { js.cancel(JOB_PERIODIC); return; }
            JobInfo job = new JobInfo.Builder(JOB_PERIODIC, new ComponentName(c, SyncJobService.class))
                    .setPeriodic(24 * 3600 * 1000L)
                    .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                    .setPersisted(true)
                    .build();
            js.schedule(job);
            android.util.Log.d("SOLO", "periodic job scheduled");
        } catch (Exception e) { android.util.Log.d("SOLO", "periodic job fail: " + e); }
    }

    /** 记忆刚写入时延迟合并，避免每敲一句就同步。 */
    public static void scheduleSoon(Context c) {
        try {
            if (!Prefs.davAuto(c) || Prefs.davUrl(c).trim().isEmpty()) return;
            JobScheduler js = (JobScheduler) c.getSystemService(Context.JOB_SCHEDULER_SERVICE);
            JobInfo job = new JobInfo.Builder(JOB_SOON, new ComponentName(c, SyncJobService.class))
                    .setMinimumLatency(15000)
                    .setOverrideDeadline(120000)
                    .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                    .build();
            js.schedule(job);
        } catch (Exception ignored) { }
    }
}
