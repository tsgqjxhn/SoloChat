package com.solochat.mobile;

import android.app.Activity;
import android.content.Intent;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.os.Bundle;

/** 透明 Activity：只为弹系统「开始投屏」授权，拿到 result 后交给服务截图。 */
public class ProjectionRequestActivity extends Activity {
    private static final int REQ = 7001;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        MediaProjectionManager mpm = (MediaProjectionManager) getSystemService(MEDIA_PROJECTION_SERVICE);
        if (mpm == null) { finish(); return; }
        startActivityForResult(mpm.createScreenCaptureIntent(), REQ);
    }

    @Override
    protected void onActivityResult(int req, int code, Intent data) {
        super.onActivityResult(req, code, data);
        if (req == REQ) {
            CaptureBus.resultCode = code;
            CaptureBus.data = data;
            Intent i = new Intent(this, BubbleService.class).setAction(BubbleService.ACTION_CAPTURE);
            startService(i);
        }
        finish();
    }
}
