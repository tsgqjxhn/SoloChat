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
import java.util.UUID;
import org.json.JSONArray;
import org.json.JSONObject;

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
    /** 复用的投屏 token/显示：只授权一次，之后点悬浮球直接从常驻 VirtualDisplay 取帧。 */
    private MediaProjection projection;
    private VirtualDisplay projectionDisplay;
    private ImageReader projectionReader;
    private boolean capturing;
    /** 当前截图问答会话；关闭即丢弃引用、下次截图新建；记录已落盘/写主应用。 */
    private PopupSession session;

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
        if (!Prefs.bubble(this)) {
            hideBubble();
            stopSelf();
            return START_NOT_STICKY;
        }
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
        android.util.Log.d("SOLO", "requestProjection hasToken=" + (projection != null));
        if (projection != null) {
            hideBubble();
            ui.postDelayed(this::capture, 450);
            return;
        }
        hideBubble();
        Intent i = new Intent(this, ProjectionRequestActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_NO_ANIMATION | Intent.FLAG_ACTIVITY_EXCLUDE_FROM_RECENTS);
        startActivity(i);
    }

    /** 截屏前把常驻通知提升为 mediaProjection 类型；失败只记录，不打断流程。 */
    private void promoteProjectionFgs() {
        if (Build.VERSION.SDK_INT >= 34) {
            try { startForeground(2, notif(), ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION); }
            catch (Exception e) { android.util.Log.e("SOLO", "promote fgs: " + e); }
        }
    }

    /** 只在没有可用 token 时降回 specialUse，避免持有投屏时被系统停掉。 */
    private void demoteFgs() {
        if (projection != null) return;
        if (Build.VERSION.SDK_INT >= 34) {
            try { startForeground(1, notif(), ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE); }
            catch (Exception e) { android.util.Log.e("SOLO", "demote fgs: " + e); }
        }
    }

    private void releaseProjection() {
        VirtualDisplay vd = projectionDisplay;
        projectionDisplay = null;
        if (vd != null) { try { vd.release(); } catch (Exception ignored) { } }
        ImageReader r = projectionReader;
        projectionReader = null;
        if (r != null) { try { r.close(); } catch (Exception ignored) { } }
        MediaProjection mp = projection;
        projection = null;
        if (mp != null) {
            try { mp.stop(); } catch (Exception e) { android.util.Log.d("SOLO", "projection stop: " + e); }
        }
        demoteFgs();
    }

    private boolean ensureProjection() {
        if (projection != null && projectionDisplay != null && projectionReader != null) return true;

        if (projection == null) {
            if (CaptureBus.resultCode == 0 || CaptureBus.data == null) return false;
            MediaProjectionManager mpm = (MediaProjectionManager) getSystemService(MEDIA_PROJECTION_SERVICE);
            promoteProjectionFgs();
            final MediaProjection mp;
            try {
                mp = mpm.getMediaProjection(CaptureBus.resultCode, CaptureBus.data);
            } catch (Exception e) {
                android.util.Log.e("SOLO", "getMediaProjection: " + e);
                CaptureBus.resultCode = 0; CaptureBus.data = null;
                demoteFgs();
                return false;
            }
            if (mp == null) {
                CaptureBus.resultCode = 0; CaptureBus.data = null;
                demoteFgs();
                return false;
            }
            projection = mp;
            try {
                mp.registerCallback(new MediaProjection.Callback() {
                    @Override public void onStop() {
                        android.util.Log.d("SOLO", "projection stopped");
                        ui.post(() -> { if (projection == mp) releaseProjection(); });
                    }
                }, capHandler);
            } catch (Exception e) { android.util.Log.e("SOLO", "registerCallback: " + e); }
            CaptureBus.resultCode = 0; CaptureBus.data = null;
            android.util.Log.d("SOLO", "projection ok");
        }

        if (projectionDisplay == null || projectionReader == null) {
            DisplayMetrics dm = new DisplayMetrics();
            wm.getDefaultDisplay().getRealMetrics(dm);
            try {
                ImageReader reader = ImageReader.newInstance(dm.widthPixels, dm.heightPixels, PixelFormat.RGBA_8888, 3);
                VirtualDisplay vd = projection.createVirtualDisplay("solo", dm.widthPixels, dm.heightPixels,
                        dm.densityDpi, DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
                        reader.getSurface(), null, capHandler);
                if (vd == null) {
                    try { reader.close(); } catch (Exception ignored) { }
                    releaseProjection();
                    return false;
                }
                projectionReader = reader;
                projectionDisplay = vd;
                android.util.Log.d("SOLO", "projection display ready");
            } catch (Exception e) {
                android.util.Log.e("SOLO", "createVirtualDisplay: " + e);
                releaseProjection();
                return false;
            }
        }
        return true;
    }

    /** 丢弃点击前积压的旧帧，避免截到悬浮球或上一次画面。 */
    private void drainReader() {
        ImageReader r = projectionReader;
        if (r == null) return;
        try {
            Image old;
            while ((old = r.acquireLatestImage()) != null) old.close();
        } catch (Exception ignored) { }
    }

    private void capture() {
        if (capturing) return;
        if (!ensureProjection()) {
            toast("投屏授权失效，请再点一次悬浮球");
            showBubble();
            return;
        }
        capturing = true;
        drainReader();
        hideBubble();
        capHandler.postDelayed(this::grabFrame, 500);
    }

    private void grabFrame() {
        if (!capturing) return;
        ImageReader r = projectionReader;
        if (r == null) { capturing = false; ui.post(() -> { toast("截屏已停止"); showBubble(); }); return; }
        Image img = null;
        for (int i = 0; i < 25 && img == null; i++) {
            try { img = r.acquireLatestImage(); } catch (Exception ignored) { }
            if (img == null) {
                try { Thread.sleep(80); } catch (InterruptedException ignored) { }
            }
        }
        if (img == null) {
            capturing = false;
            ui.post(() -> { toast("截屏超时，请再试一次"); showBubble(); });
            return;
        }

        Bitmap shot = null;
        try {
            Image.Plane p = img.getPlanes()[0];
            ByteBuffer buf = p.getBuffer();
            int rowStride = p.getRowStride(), pixelStride = p.getPixelStride();
            int pad = rowStride - pixelStride * img.getWidth();
            Bitmap raw = Bitmap.createBitmap(img.getWidth() + pad / pixelStride, img.getHeight(), Bitmap.Config.ARGB_8888);
            raw.copyPixelsFromBuffer(buf);
            shot = Bitmap.createBitmap(raw, 0, 0, img.getWidth(), img.getHeight());
        } catch (Exception e) {
            android.util.Log.e("SOLO", "grab frame: " + e);
        } finally {
            img.close();
        }

        capturing = false;
        final Bitmap out = shot;
        ui.post(() -> {
            if (out == null) { toast("截屏失败"); showBubble(); }
            else startAsk(out);
        });
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
            startAsk(crop);
        });
        overlay = root;
        wm.addView(root, overlayParams(true));
        android.util.Log.d("SOLO", "crop overlay added");
    }

    private static class PopupSession {
        final String id = UUID.randomUUID().toString();
        Bitmap shot;
        final JSONArray history = new JSONArray();
    }

    private void startAsk(Bitmap crop) {
        session = new PopupSession();
        session.shot = crop;
        showAsk(crop, false);
    }

    private void showAsk(final Bitmap crop, final boolean continuation) {
        removeOverlay();
        if (!continuation || session == null || session.shot == null) {
            session = new PopupSession();
            session.shot = crop;
        }
        final PopupSession ss = session;
        final Bitmap shot = ss.shot;
        DisplayMetrics dm = new DisplayMetrics();
        wm.getDefaultDisplay().getRealMetrics(dm);
        int sheetH = dm.heightPixels / 2;

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(0x00000000);

        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(20), dp(12), dp(20), dp(16));
        GradientDrawable sheetBg = new GradientDrawable();
        sheetBg.setColor(0xFFFFFFFF);
        sheetBg.setCornerRadii(new float[]{dp(20), dp(20), dp(20), dp(20), 0, 0, 0, 0});
        card.setBackground(sheetBg);
        card.setElevation(dp(10));

        final boolean[] locked = {false};
        final ImageButton lock = new ImageButton(this);
        lock.setImageResource(R.drawable.ic_lock_open);
        lock.setBackgroundColor(android.graphics.Color.TRANSPARENT);
        lock.setPadding(dp(6), dp(6), dp(6), dp(6));
        lock.setContentDescription("固定弹窗；固定后可滑动底层题目");

        // 顶部一行：左锁定 / 右取消（不再有拖拽条和标题）
        LinearLayout topRow = new LinearLayout(this);
        topRow.setOrientation(LinearLayout.HORIZONTAL);
        topRow.setGravity(Gravity.CENTER_VERTICAL);
        topRow.addView(lock, new LinearLayout.LayoutParams(dp(36), dp(36)));
        topRow.addView(new View(this), new LinearLayout.LayoutParams(0, dp(1), 1));
        TextView cancel = new TextView(this);
        cancel.setText("取消");
        cancel.setTextColor(0xFF2F6DF6);
        cancel.setTextSize(14);
        cancel.setPadding(dp(10), dp(6), dp(2), dp(6));
        topRow.addView(cancel);
        card.addView(topRow, new LinearLayout.LayoutParams(-1, -2));

        // 主内容行：小缩略图 + 输入框（发送按钮在输入框右侧）
        LinearLayout mainRow = new LinearLayout(this);
        mainRow.setOrientation(LinearLayout.HORIZONTAL);
        mainRow.setGravity(Gravity.TOP);
        mainRow.setPadding(0, dp(4), 0, 0);

        ImageView thumb = new ImageView(this);
        thumb.setImageBitmap(shot);
        thumb.setScaleType(ImageView.ScaleType.CENTER_CROP);
        GradientDrawable tb = new GradientDrawable();
        tb.setColor(0xFF222222);
        tb.setCornerRadius(dp(8));
        thumb.setBackground(tb);
        thumb.setClipToOutline(true);
        LinearLayout.LayoutParams tlp = new LinearLayout.LayoutParams(dp(44), dp(60));
        tlp.rightMargin = dp(10);
        mainRow.addView(thumb, tlp);

        LinearLayout inputBox = new LinearLayout(this);
        inputBox.setOrientation(LinearLayout.HORIZONTAL);
        inputBox.setGravity(Gravity.BOTTOM);
        inputBox.setPadding(dp(10), dp(2), dp(2), dp(2));
        GradientDrawable ib = new GradientDrawable();
        ib.setColor(0xFFF4F5F7);
        ib.setCornerRadius(dp(14));
        inputBox.setBackground(ib);

        final EditText input = new EditText(this);
        input.setText("");
        input.setHint("补充说明（选填）");
        input.setHintTextColor(0xFF9AA0A6);
        input.setTextSize(15);
        input.setMinLines(1);
        input.setMaxLines(5);
        input.setTextColor(0xFF111111);
        input.setBackgroundColor(android.graphics.Color.TRANSPARENT);
        input.setPadding(dp(2), dp(8), dp(8), dp(8));
        inputBox.addView(input, new LinearLayout.LayoutParams(0, -2, 1));

        final Button send = new Button(this);
        send.setText("发送");
        send.setTextSize(14);
        send.setTextColor(android.graphics.Color.WHITE);
        send.setAllCaps(false);
        send.setGravity(Gravity.CENTER);
        send.setPadding(0, 0, 0, 0);
        send.setMinWidth(0); send.setMinimumWidth(0);
        send.setMinHeight(0); send.setMinimumHeight(0);
        GradientDrawable sb = new GradientDrawable();
        sb.setColor(0xFF2F6DF6);
        sb.setCornerRadius(dp(12));
        send.setBackground(sb);
        LinearLayout.LayoutParams slp = new LinearLayout.LayoutParams(dp(56), dp(40));
        slp.leftMargin = dp(4);
        inputBox.addView(send, slp);

        mainRow.addView(inputBox, new LinearLayout.LayoutParams(0, -2, 1));
        card.addView(mainRow, new LinearLayout.LayoutParams(-1, -2));

        root.addView(card, new FrameLayout.LayoutParams(-1, -2, Gravity.BOTTOM));

        cancel.setOnClickListener(v -> { session = null; removeOverlay(); showBubble(); });
        lock.setOnClickListener(v -> {
            locked[0] = !locked[0];
            lock.setImageResource(locked[0] ? R.drawable.ic_lock : R.drawable.ic_lock_open);
            toast(locked[0] ? "已分屏：可滑动底层题目" : "未分屏：点弹窗外会关闭");
        });
        root.setOnTouchListener((v, e) -> {
            if (e.getAction() == MotionEvent.ACTION_OUTSIDE && !locked[0]) {
                session = null;
                removeOverlay();
                showBubble();
            }
            return false;
        });
        send.setOnClickListener(v -> {
            android.util.Log.d("SOLO", "sheet send clicked keyLen=" + Prefs.key(this).length());
            if (Prefs.key(this).isEmpty()) {
                toast("还没配置 API Key，先填连接配置");
                startActivity(new Intent(this, SettingsActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
                return;
            }
            String q = input.getText().toString().trim();
            if (q.isEmpty()) q = Prefs.prompt(this);
            send.setEnabled(false);
            send.setText("…");
            final String prompt = q;
            final JSONArray history = new JSONArray();
            for (int i = 0; i < ss.history.length(); i++) {
                JSONObject h = ss.history.optJSONObject(i);
                if (h != null) history.put(h);
            }
            Api.askTurn(this, shot, prompt, history, new Api.Cb() {
                @Override public void ok(String text) {
                    ui.post(() -> {
                        recordPopupTurn(ss, prompt, text);
                        showAnswer(text, ss);
                    });
                }
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

    /** 把这一轮问答写进原生历史（只存文本，截图不落盘），并同步到主应用会话记录。 */
    private void recordPopupTurn(PopupSession s, String prompt, String answer) {
        if (s == null) return;
        try {
            s.history.put(new JSONObject().put("role", "user").put("content", prompt));
            s.history.put(new JSONObject().put("role", "assistant").put("content", answer));
            persistPopupSession(s);
            MainActivity.recordPopup(s.id, "user", prompt);
            MainActivity.recordPopup(s.id, "assistant", answer);
        } catch (Exception e) {
            android.util.Log.e("SOLO", "record popup: " + e);
        }
    }

    private void persistPopupSession(PopupSession s) {
        try {
            android.content.SharedPreferences sp = getSharedPreferences("solo_popup", MODE_PRIVATE);
            JSONArray old = new JSONArray();
            try { old = new JSONArray(sp.getString("sessions", "[]")); } catch (Exception ignored) { }
            JSONArray out = new JSONArray();
            for (int i = 0; i < old.length(); i++) {
                JSONObject o = old.optJSONObject(i);
                if (o != null && !s.id.equals(o.optString("id"))) out.put(o);
            }
            out.put(new JSONObject().put("id", s.id).put("updated", System.currentTimeMillis()).put("messages", s.history));
            while (out.length() > 40) out.remove(0);
            sp.edit().putString("sessions", out.toString()).apply();
        } catch (Exception ignored) { }
    }

    private void showAnswer(final String text, final PopupSession ss) {
        removeOverlay();
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(0x00000000);

        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(20), dp(14), dp(20), dp(16));
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(0xFFFFFFFF);
        bg.setCornerRadius(dp(20));
        card.setBackground(bg);

        /* 顶部留白：不再显示「回答 / 关闭」 */
        View topSpace = new View(this);
        card.addView(topSpace, new LinearLayout.LayoutParams(1, dp(4)));

        ScrollView sc = new ScrollView(this);
        TextView body = new TextView(this);
        body.setText(Md.render(text));
        body.setTextSize(15);
        body.setTextColor(0xFF222222);
        body.setLineSpacing(dp(4), 1f);
        body.setTextIsSelectable(true);
        body.setMovementMethod(android.text.method.LinkMovementMethod.getInstance());
        DisplayMetrics dm = new DisplayMetrics();
        wm.getDefaultDisplay().getRealMetrics(dm);
        final int sheetH = dm.heightPixels / 2;
        final int maxBodyH = (int) (dm.heightPixels * 0.35f); // 半屏内给正文的上限
        sc.addView(body);
        sc.addOnLayoutChangeListener((v, left, top, right, bottom, oldLeft, oldTop, oldRight, oldBottom) -> {
            if (v.getHeight() > maxBodyH && v.getLayoutParams().height != maxBodyH) {
                v.getLayoutParams().height = maxBodyH;
                v.requestLayout();
            }
        });
        LinearLayout.LayoutParams scp = new LinearLayout.LayoutParams(-1, -2);
        scp.topMargin = dp(8);
        card.addView(sc, scp);

        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);

        Button cont = new Button(this);
        cont.setText("继续对话");
        cont.setAllCaps(false);
        cont.setTextColor(0xFF2F6DF6);
        cont.setTextSize(13);
        GradientDrawable cb = new GradientDrawable();
        cb.setColor(0xFFF4F5F7);
        cb.setCornerRadius(dp(12));
        cont.setBackground(cb);

        final boolean[] locked = {false};
        final ImageButton lock = new ImageButton(this);
        lock.setImageResource(R.drawable.ic_lock_open);
        lock.setBackgroundColor(android.graphics.Color.TRANSPARENT);
        lock.setPadding(dp(4), dp(4), dp(4), dp(4));
        lock.setContentDescription("分屏；开启后可滑动底层题目");

        Button close = new Button(this);
        close.setText("关闭");
        close.setAllCaps(false);
        close.setTextColor(android.graphics.Color.WHITE);
        close.setTextSize(14);
        GradientDrawable db = new GradientDrawable();
        db.setColor(0xFF2F6DF6);
        db.setCornerRadius(dp(12));
        close.setBackground(db);

        LinearLayout.LayoutParams clp1 = new LinearLayout.LayoutParams(0, dp(46), 1);
        clp1.rightMargin = dp(4);
        row.addView(cont, clp1);
        LinearLayout.LayoutParams clp2 = new LinearLayout.LayoutParams(dp(46), dp(46));
        clp2.leftMargin = dp(4); clp2.rightMargin = dp(4);
        row.addView(lock, clp2);
        LinearLayout.LayoutParams clp3 = new LinearLayout.LayoutParams(0, dp(46), 1);
        clp3.leftMargin = dp(4);
        row.addView(close, clp3);
        LinearLayout.LayoutParams rlp = new LinearLayout.LayoutParams(-1, -2);
        rlp.topMargin = dp(10);
        card.addView(row, rlp);

        FrameLayout.LayoutParams flp = new FrameLayout.LayoutParams(-1, -2, Gravity.BOTTOM);
        flp.setMargins(dp(12), 0, dp(12), dp(18));
        root.addView(card, flp);

        cont.setOnClickListener(v -> { showAsk(ss == null ? null : ss.shot, true); });
        lock.setOnClickListener(v -> {
            locked[0] = !locked[0];
            lock.setImageResource(locked[0] ? R.drawable.ic_lock : R.drawable.ic_lock_open);
            toast(locked[0] ? "已分屏：可滑动底层题目" : "未分屏：点弹窗外会关闭");
        });
        root.setOnTouchListener((v, e) -> {
            if (e.getAction() == MotionEvent.ACTION_OUTSIDE && !locked[0]) {
                session = null;
                removeOverlay();
                showBubble();
            }
            return false;
        });
        close.setOnClickListener(v -> { session = null; removeOverlay(); showBubble(); });

        overlay = root;
        WindowManager.LayoutParams lp = new WindowManager.LayoutParams(
                WindowManager.LayoutParams.MATCH_PARENT, sheetH,
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
                        | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL
                        | WindowManager.LayoutParams.FLAG_WATCH_OUTSIDE_TOUCH,
                PixelFormat.TRANSLUCENT);
        lp.gravity = Gravity.BOTTOM;
        wm.addView(root, lp);
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
        MediaProjection mp = projection;
        projection = null;
        if (mp != null) { try { mp.stop(); } catch (Exception ignored) { } }
        if (capThread != null) capThread.quitSafely();
        super.onDestroy();
    }
}
