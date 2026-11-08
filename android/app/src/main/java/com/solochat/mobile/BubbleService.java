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
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import java.nio.ByteBuffer;

/** 悬浮球 + 截屏 + 裁剪 + 提问。截图只在内存里，绝不写相册。 */
public class BubbleService extends Service {
    public static final String ACTION_SHOW = "show";
    public static final String ACTION_CAPTURE = "capture";

    private WindowManager wm;
    private View bubble;
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
        return b.setSmallIcon(R.drawable.ic_stat).setContentTitle("SoloChat 悬浮球")
                .setContentText("点悬浮球截屏提问；长按进设置")
                .setContentIntent(pi).setOngoing(true).build();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        android.util.Log.d("SOLO", "onStartCommand " + (intent == null ? "null" : String.valueOf(intent.getAction()))
                + " code=" + CaptureBus.resultCode);
        if (intent != null && ACTION_CAPTURE.equals(intent.getAction())) {
            hideBubble();
            ui.postDelayed(this::capture, 450);
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
        if (bubble != null) { bubble.setVisibility(View.VISIBLE); return; }
        TextView v = new TextView(this);
        v.setText("S");
        v.setTextColor(Color.WHITE);
        v.setTextSize(20);
        v.setGravity(Gravity.CENTER);
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
            float sx, sy; int ox, oy; boolean moved;
            @Override public boolean onTouch(View view, MotionEvent e) {
                switch (e.getActionMasked()) {
                    case MotionEvent.ACTION_DOWN:
                        sx = e.getRawX(); sy = e.getRawY(); ox = lp.x; oy = lp.y; moved = false;
                        return true;
                    case MotionEvent.ACTION_MOVE:
                        int nx = ox + (int) (e.getRawX() - sx), ny = oy + (int) (e.getRawY() - sy);
                        if (Math.abs(nx - ox) + Math.abs(ny - oy) > dp(8)) moved = true;
                        lp.x = nx; lp.y = ny;
                        try { wm.updateViewLayout(view, lp); } catch (Exception ignored) { }
                        return true;
                    case MotionEvent.ACTION_UP:
                        android.util.Log.d("SOLO", "bubble up moved=" + moved);
                        if (!moved) requestProjection(); else snapEdge(lp);
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

    private void hideBubble() { if (bubble != null) bubble.setVisibility(View.GONE); }

    private void requestProjection() {
        android.util.Log.d("SOLO", "requestProjection");
        hideBubble();
        startActivity(new Intent(this, ProjectionRequestActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
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
                else showCrop(out[0]);
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
        title.setText("问这张截图（不会存相册）");
        title.setTextColor(0xFF111111);
        title.setTextSize(14);
        card.addView(title);

        final EditText input = new EditText(this);
        input.setText(Prefs.prompt(this));
        input.setTextSize(15);
        input.setMinLines(2);
        input.setTextColor(0xFF111111);
        card.addView(input);

        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        Button cancel = new Button(this); cancel.setText("取消");
        Button set = new Button(this); set.setText("设置");
        Button send = new Button(this); send.setText("发送");
        row.addView(cancel, new LinearLayout.LayoutParams(0, -2, 1));
        row.addView(set, new LinearLayout.LayoutParams(0, -2, 1));
        row.addView(send, new LinearLayout.LayoutParams(0, -2, 1));
        card.addView(row);

        FrameLayout.LayoutParams clp = new FrameLayout.LayoutParams(-1, -2, Gravity.CENTER);
        clp.setMargins(dp(18), 0, dp(18), 0);
        root.addView(card, clp);

        cancel.setOnClickListener(v -> { removeOverlay(); showBubble(); });
        set.setOnClickListener(v -> startActivity(new Intent(this, SettingsActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)));
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
        wm.addView(root, overlayParams(true));
        android.util.Log.d("SOLO", "ask overlay added");
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
        if (capThread != null) capThread.quitSafely();
        super.onDestroy();
    }
}
