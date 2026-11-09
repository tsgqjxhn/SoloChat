package com.solochat.mobile;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.drawable.GradientDrawable;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.Image;
import android.media.ImageReader;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.os.Looper;
import android.util.DisplayMetrics;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.ImageButton;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import java.nio.ByteBuffer;

/** 悬浮球 + 截屏 + 裁剪 + 提问。截图只在内存里，绝不写相册。 */
public class BubbleService extends Service {
    public static final String ACTION_SHOW = "show";
    public static final String ACTION_HIDE = "hide";
    public static final String ACTION_CAPTURE = "capture";

    private WindowManager wm;
    private View bubble;
    private View gear;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private HandlerThread capThread;
    private Handler capHandler;
    private View overlay;

    @Override
    public void onCreate() {
        super.onCreate();
        wm = (WindowManager) getSystemService(WINDOW_SERVICE);
        capThread = new HandlerThread("cap");
        capThread.start();
        capHandler = new Handler(capThread.getLooper());
        if (Build.VERSION.SDK_INT >= 34) startForeground(1, notif(), ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        else startForeground(1, notif());
    }

    private Notification notif() {
        String ch = "bubble";
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && nm != null) {
            nm.createNotificationChannel(new NotificationChannel(ch, "悬浮球", NotificationManager.IMPORTANCE_LOW));
        }
        PendingIntent pi = PendingIntent.getActivity(this, 0,
                new Intent(this, MainActivity.class), Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0);
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, ch) : new Notification.Builder(this);
        PendingIntent sp = PendingIntent.getActivity(this, 1,
                new Intent(this, SettingsActivity.class), Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0);
        return b.setSmallIcon(R.drawable.ic_stat).setContentTitle("SoloChat 悬浮球")
                .setContentText("点悬浮球截屏提问；长按球或点「设置」")
                .setContentIntent(pi).setOngoing(true)
                .addAction(new Notification.Action.Builder(R.drawable.ic_stat, "设置", sp).build())
                .build();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        android.util.Log.d("SOLO", "onStartCommand " + (intent == null ? "null" : String.valueOf(intent.getAction()))
                + " code=" + CaptureBus.resultCode);
        if (intent != null && ACTION_CAPTURE.equals(intent.getAction())) {
            hideBubble();
            ui.postDelayed(this::capture, 450);
        } else if (intent != null && ACTION_HIDE.equals(intent.getAction())) {
            hideBubble();
        } else {
            showBubble();
        }
        return START_STICKY;
    }

    @Override
    public IBinder onBind(Intent i) { return null; }

    private WindowManager.LayoutParams overlayParams(boolean focusable) {
        int f = WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN;
        if (!focusable) f |= WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE;
        return new WindowManager.LayoutParams(
                WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.MATCH_PARENT,
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY, f, PixelFormat.TRANSLUCENT);
    }

    private void showBubble() {
        if (bubble != null) { bubble.setVisibility(View.VISIBLE); }
        if (gear != null) { gear.setVisibility(View.VISIBLE); }
        if (bubble != null) return;
        ImageView v = new ImageView(this);
        v.setImageResource(R.drawable.ic_bubble);
        v.setScaleType(ImageView.ScaleType.CENTER_INSIDE);
        v.setPadding(dp(13), dp(13), dp(13), dp(13));
        GradientDrawable bg = new GradientDrawable();
        bg.setShape(GradientDrawable.OVAL);
        bg.setColor(0xF22F6DF6);
        bg.setStroke(dp(2), 0x66FFFFFF);
        v.setBackground(bg);
        v.setElevation(dp(6));

        int size = dp(52);
        WindowManager.LayoutParams lp = new WindowManager.LayoutParams(
                size, size, WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE, PixelFormat.TRANSLUCENT);
        lp.gravity = Gravity.TOP | Gravity.START;
        lp.x = dp(12); lp.y = dp(180);
        v.setOnTouchListener(new View.OnTouchListener() {
            float sx, sy; int ox, oy; boolean moved, longFired; long downAt;
            final Runnable longPress = () -> {
                if (!moved && !longFired){
                    longFired = true;
                    startActivity(new Intent(BubbleService.this, SettingsActivity.class)
                            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
                }
            };
            @Override public boolean onTouch(View view, MotionEvent e) {
                switch (e.getActionMasked()) {
                    case MotionEvent.ACTION_DOWN:
                        sx = e.getRawX(); sy = e.getRawY(); ox = lp.x; oy = lp.y;
                        moved = false; longFired = false; downAt = System.currentTimeMillis();
                        ui.postDelayed(longPress, 650);
                        return true;
                    case MotionEvent.ACTION_MOVE:
                        int nx = ox + (int) (e.getRawX() - sx), ny = oy + (int) (e.getRawY() - sy);
                        if (Math.abs(nx - ox) + Math.abs(ny - oy) > dp(8)){ moved = true; ui.removeCallbacks(longPress); }
                        lp.x = nx; lp.y = ny;
                        try { wm.updateViewLayout(view, lp); } catch (Exception ignored) { }
                        return true;
                    case MotionEvent.ACTION_UP:
                        ui.removeCallbacks(longPress);
                        if (!moved && !longFired) requestProjection(); else snapEdge(lp);
                        return true;
                    case MotionEvent.ACTION_CANCEL:
                        ui.removeCallbacks(longPress);
                        return true;
                }
                return false;
            }
        });
        v.setOnLongClickListener(x -> {
            startActivity(new Intent(this, SettingsActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            return true;
        });
        bubble = v;
        wm.addView(bubble, lp);
        android.util.Log.d("SOLO", "bubble added " + lp.x + "," + lp.y + " size=" + size);
    }

    private void snapEdge(WindowManager.LayoutParams lp) {
        DisplayMetrics dm = getResources().getDisplayMetrics();
        if (lp.x + dp(52) > dm.widthPixels / 2) lp.x = dm.widthPixels - dp(60); else lp.x = dp(12);
        try { wm.updateViewLayout(bubble, lp); } catch (Exception ignored) { }
    }

    private void hideBubble() { if (bubble != null) bubble.setVisibility(View.GONE); if (gear != null) gear.setVisibility(View.GONE); }

    private void requestProjection() {
        android.util.Log.d("SOLO", "requestProjection");
        hideBubble();
        Intent i = new Intent(this, ProjectionRequestActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_NO_ANIMATION | Intent.FLAG_ACTIVITY_EXCLUDE_FROM_RECENTS);
        startActivity(i);
    }

    private void capture() {
        android.util.Log.d("SOLO", "capture start code=" + CaptureBus.resultCode);
        if (CaptureBus.resultCode == 0 || CaptureBus.data == null) {
            toast("没有拿到截屏授权");
            showBubble();
            return;
        }
        final MediaProjectionManager mpm = (MediaProjectionManager) getSystemService(MEDIA_PROJECTION_SERVICE);
        if (Build.VERSION.SDK_INT >= 34) {
            try { startForeground(2, notif(), ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION); }
            catch (Exception e) { android.util.Log.e("SOLO", "promote fgs: " + e); }
        }
        final MediaProjection mp;
        try {
            mp = mpm.getMediaProjection(CaptureBus.resultCode, CaptureBus.data);
        } catch (Exception e) {
            android.util.Log.e("SOLO", "getMediaProjection: " + e);
            toast("投屏授权失效，请再点一次悬浮球");
            showBubble();
            return;
        }
        if (mp == null) { toast("投屏授权失败"); showBubble(); return; }
        android.util.Log.d("SOLO", "projection ok");
        try {
            mp.registerCallback(new MediaProjection.Callback() {
                @Override public void onStop() { android.util.Log.d("SOLO", "projection stopped"); }
            }, capHandler);
        } catch (Exception e) { android.util.Log.e("SOLO", "registerCallback: " + e); }

        DisplayMetrics dm = new DisplayMetrics();
        wm.getDefaultDisplay().getRealMetrics(dm);
        final int w = dm.widthPixels, h = dm.heightPixels;
        final ImageReader reader = ImageReader.newInstance(w, h, PixelFormat.RGBA_8888, 2);
        final VirtualDisplay vd = mp.createVirtualDisplay("solo", w, h, dm.densityDpi,
                DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR, reader.getSurface(), null, capHandler);

        final Bitmap[] out = new Bitmap[1];
        reader.setOnImageAvailableListener(r -> {
            android.util.Log.d("SOLO", "image available");
            if (out[0] != null) return;
            Image img = null;
            try { img = r.acquireLatestImage(); } catch (Exception ignored) { }
            if (img == null) return;
            try {
                Image.Plane p = img.getPlanes()[0];
                ByteBuffer buf = p.getBuffer();
                int rowStride = p.getRowStride(), pixelStride = p.getPixelStride();
                int pad = rowStride - pixelStride * w;
                Bitmap raw = Bitmap.createBitmap(w + pad / pixelStride, h, Bitmap.Config.ARGB_8888);
                raw.copyPixelsFromBuffer(buf);
                out[0] = Bitmap.createBitmap(raw, 0, 0, w, h);
            } catch (Exception e) {
                out[0] = null;
            } finally {
                img.close();
            }
            reader.setOnImageAvailableListener(null, null);
            ui.postDelayed(() -> {
                try { vd.release(); } catch (Exception ignored) { }
                try { reader.close(); } catch (Exception ignored) { }
                try { mp.stop(); } catch (Exception ignored) { }
                if (Build.VERSION.SDK_INT >= 34) {
                    try { startForeground(1, notif(), ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE); } catch (Exception ignored) { }
                }
                CaptureBus.resultCode = 0; CaptureBus.data = null;
                if (out[0] == null) { toast("截屏失败"); showBubble(); }
                else showAsk(out[0]); // Android 0.3.1：点球直接截整屏，不再进裁剪
            }, 120);
        }, capHandler);
    }

    private void showCrop(final Bitmap shot) {
        removeOverlay();
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(0xCC000000);
        CropOverlayView cov = new CropOverlayView(this, shot);
        root.addView(cov, new FrameLayout.LayoutParams(-1, -1));

        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER);
        bar.setPadding(dp(12), dp(10), dp(12), dp(10));
        Button cancel = new Button(this); cancel.setText("取消");
        Button ok = new Button(this); ok.setText("就用这块");
        bar.addView(cancel, new LinearLayout.LayoutParams(0, -2, 1));
        bar.addView(ok, new LinearLayout.LayoutParams(0, -2, 1));
        FrameLayout.LayoutParams blp = new FrameLayout.LayoutParams(-1, -2, Gravity.BOTTOM);
        blp.setMargins(dp(16), 0, dp(16), dp(28));
        root.addView(bar, blp);

        cancel.setOnClickListener(v -> { removeOverlay(); showBubble(); });
        ok.setOnClickListener(v -> {
            android.graphics.Rect r = cov.cropRect();
            Bitmap crop;
            try { crop = Bitmap.createBitmap(shot, r.left, r.top, r.width(), r.height()); }
            catch (Exception e) { crop = shot; }
            removeOverlay();
            showAsk(crop);
        });
        overlay = root;
        wm.addView(root, overlayParams(true));
        android.util.Log.d("SOLO", "crop overlay added");
    }

    private void showAsk(final Bitmap crop) {
        removeOverlay();
        DisplayMetrics dm = new DisplayMetrics();
        wm.getDefaultDisplay().getRealMetrics(dm);
        int sheetH = dm.heightPixels / 2;

        FrameLayout root = new FrameLayout(this);
        GradientDrawable sheetBg = new GradientDrawable();
        sheetBg.setColor(0xFFFFFFFF);
        sheetBg.setCornerRadii(new float[]{dp(20), dp(20), dp(20), dp(20), 0, 0, 0, 0});
        root.setBackground(sheetBg);

        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(16), dp(12), dp(16), dp(12));

        LinearLayout titleRow = new LinearLayout(this);
        titleRow.setOrientation(LinearLayout.HORIZONTAL);
        titleRow.setGravity(Gravity.CENTER_VERTICAL);
        TextView title = new TextView(this);
        title.setText("截图已加入队列 · 未发送（不会存相册）");
        title.setTextColor(0xFF111111);
        title.setTextSize(13);
        titleRow.addView(title, new LinearLayout.LayoutParams(0, -2, 1));
        TextView cancel = new TextView(this);
        cancel.setText("取消");
        cancel.setTextColor(0xFF666666);
        cancel.setTextSize(13);
        cancel.setPadding(dp(10), dp(6), dp(4), dp(6));
        titleRow.addView(cancel);
        card.addView(titleRow);

        LinearLayout queueRow = new LinearLayout(this);
        queueRow.setOrientation(LinearLayout.HORIZONTAL);
        queueRow.setGravity(Gravity.CENTER_VERTICAL);
        queueRow.setPadding(0, dp(8), 0, 0);
        ImageView thumb = new ImageView(this);
        thumb.setImageBitmap(crop);
        thumb.setScaleType(ImageView.ScaleType.FIT_CENTER);
        GradientDrawable tb = new GradientDrawable();
        tb.setColor(0xFF222222);
        tb.setCornerRadius(dp(8));
        thumb.setBackground(tb);
        thumb.setClipToOutline(true);
        queueRow.addView(thumb, new LinearLayout.LayoutParams(dp(54), dp(96)));
        TextView qinfo = new TextView(this);
        qinfo.setText("整屏截图 · 待发送\n点锁固定弹窗，可滑动底层题目");
        qinfo.setTextSize(12);
        qinfo.setTextColor(0xFF666666);
        qinfo.setPadding(dp(10), 0, 0, 0);
        queueRow.addView(qinfo, new LinearLayout.LayoutParams(0, -2, 1));
        card.addView(queueRow);

        LinearLayout inputRow = new LinearLayout(this);
        inputRow.setOrientation(LinearLayout.HORIZONTAL);
        inputRow.setGravity(Gravity.CENTER_VERTICAL);
        inputRow.setPadding(0, dp(8), 0, 0);

        final EditText input = new EditText(this);
        input.setText(Prefs.prompt(this));
        input.setTextSize(15);
        input.setMinLines(1);
        input.setMaxLines(2);
        input.setTextColor(0xFF111111);
        inputRow.addView(input, new LinearLayout.LayoutParams(0, -2, 1));

        final boolean[] locked = {false};
        final ImageButton lock = new ImageButton(this);
        lock.setImageResource(R.drawable.ic_lock_open);
        lock.setBackgroundColor(android.graphics.Color.TRANSPARENT);
        lock.setPadding(dp(8), dp(8), dp(8), dp(8));
        lock.setContentDescription("固定弹窗；固定后可滑动底层题目");
        inputRow.addView(lock, new LinearLayout.LayoutParams(dp(42), dp(42)));

        Button send = new Button(this);
        send.setText("发送");
        inputRow.addView(send, new LinearLayout.LayoutParams(-2, -2));
        card.addView(inputRow);

        ScrollView sc = new ScrollView(this);
        sc.addView(card);
        root.addView(sc, new FrameLayout.LayoutParams(-1, -1));

        cancel.setOnClickListener(v -> { removeOverlay(); showBubble(); });
        lock.setOnClickListener(v -> {
            locked[0] = !locked[0];
            lock.setImageResource(locked[0] ? R.drawable.ic_lock : R.drawable.ic_lock_open);
            toast(locked[0] ? "已固定：可滑动底层题目" : "未固定：点题目会返回原应用");
        });
        root.setOnTouchListener((v, e) -> {
            if (e.getAction() == MotionEvent.ACTION_OUTSIDE && !locked[0]) {
                removeOverlay();
                showBubble();
            }
            return false;
        });
        send.setOnClickListener(v -> {
            String q = input.getText().toString().trim();
            if (q.isEmpty()) q = Prefs.prompt(this);
            send.setEnabled(false);
            send.setText("思考中…");
            final String prompt = q;
            Api.ask(this, crop, prompt, new Api.Cb() {
                @Override public void ok(String text) { ui.post(() -> showAnswer(text, crop)); }
                @Override public void fail(String msg) { ui.post(() -> { toast("失败：" + msg); send.setEnabled(true); send.setText("发送"); }); }
            });
        });

        overlay = root;
        WindowManager.LayoutParams lp = new WindowManager.LayoutParams(
                WindowManager.LayoutParams.MATCH_PARENT, sheetH,
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
                        | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL
                        | WindowManager.LayoutParams.FLAG_WATCH_OUTSIDE_TOUCH,
                PixelFormat.TRANSLUCENT);
        lp.gravity = Gravity.BOTTOM;
        lp.softInputMode = WindowManager.LayoutParams.SOFT_INPUT_ADJUST_PAN | WindowManager.LayoutParams.SOFT_INPUT_STATE_VISIBLE;
        wm.addView(root, lp);
        android.util.Log.d("SOLO", "ask sheet added");
    }

    private void showAnswer(final String text, final Bitmap crop) {
        removeOverlay();
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(0x66000000);

        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(16), dp(14), dp(16), dp(14));
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(0xFFFFFFFF);
        bg.setCornerRadius(dp(14));
        card.setBackground(bg);

        TextView title = new TextView(this);
        title.setText("回答");
        title.setTextColor(0xFF111111);
        title.setTextSize(14);
        card.addView(title);

        ScrollView sc = new ScrollView(this);
        TextView body = new TextView(this);
        body.setText(text);
        body.setTextSize(15);
        body.setTextColor(0xFF111111);
        body.setTextIsSelectable(true);
        sc.addView(body);
        card.addView(sc, new LinearLayout.LayoutParams(-1, dp(300)));

        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        Button copy = new Button(this); copy.setText("复制");
        Button close = new Button(this); close.setText("关闭");
        row.addView(copy, new LinearLayout.LayoutParams(0, -2, 1));
        row.addView(close, new LinearLayout.LayoutParams(0, -2, 1));
        card.addView(row);

        FrameLayout.LayoutParams clp = new FrameLayout.LayoutParams(-1, -2, Gravity.CENTER);
        clp.setMargins(dp(18), 0, dp(18), 0);
        root.addView(card, clp);

        copy.setOnClickListener(v -> {
            android.content.ClipboardManager cm = (android.content.ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
            cm.setPrimaryClip(android.content.ClipData.newPlainText("SoloChat", text));
            toast("已复制");
        });
        close.setOnClickListener(v -> { removeOverlay(); showBubble(); });

        overlay = root;
        wm.addView(root, overlayParams(true));
    }

    private void removeOverlay() {
        if (overlay != null) {
            try { wm.removeView(overlay); } catch (Exception ignored) { }
            overlay = null;
        }
    }

    private void toast(String s) { Toast.makeText(this, s, Toast.LENGTH_SHORT).show(); }

    private int dp(int v) { return (int) (v * getResources().getDisplayMetrics().density); }

    @Override
    public void onDestroy() {
        removeOverlay();
        if (bubble != null) { try { wm.removeView(bubble); } catch (Exception ignored) { } bubble = null; }
        if (gear != null) { try { wm.removeView(gear); } catch (Exception ignored) { } gear = null; }
        if (capThread != null) capThread.quitSafely();
        super.onDestroy();
    }
}
