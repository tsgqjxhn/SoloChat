package com.solochat.mobile;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.util.Base64;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.ArrayDeque;

public class MainActivity extends Activity {
    private static MainActivity current;
    private static final ArrayDeque<String> popupQueue = new ArrayDeque<>();
    private WebView web;
    private boolean pageReady;
    private String shareText;
    private Uri shareUri;
    private boolean shareDelivering;
    private ValueCallback<Uri[]> fileCb;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        current = this;
        web = new WebView(this);
        WebView.setWebContentsDebuggingEnabled(true); // 调试期：可用 adb forward 看 DOM/console
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        s.setTextZoom(100);
        web.addJavascriptInterface(new Bridge(this, web), "AndroidBridge");
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams params) {
                if (fileCb != null) fileCb.onReceiveValue(null);
                fileCb = cb;
                Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType("*/*");
                try { startActivityForResult(i, 7002); } catch (Exception e) { fileCb = null; return false; }
                return true;
            }
        });
        web.setWebViewClient(new WebViewClient() {
            @Override public void onPageFinished(WebView v, String url) {
                android.util.Log.d("SOLO", "onPageFinished " + url);
                web.postDelayed(() -> { pageReady = true; deliverShare(); flushPopupQueue(); }, 800);
            }
        });
        setContentView(web);
        web.loadUrl("file:///android_asset/index.html");
        /* 兜底：个别 ROM 的 onPageFinished 回调不到，2 秒后直接投递待分享内容 */
        web.postDelayed(() -> { pageReady = true; deliverShare(); }, 2000);

        if (Build.VERSION.SDK_INT >= 33 && !Prefs.notifAsked(this)
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            Prefs.get(this).edit().putBoolean(Prefs.NOTIF_ASKED, true).apply(); // 只问一次；拒绝后不再每次启动弹
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 9);
        }
        if (Prefs.bubble(this)) ensureOverlay();
        handleIntent(getIntent());
        SyncJobService.schedulePeriodic(this);
        if (Prefs.davAuto(this) && !Prefs.davUrl(this).trim().isEmpty()) {
            new Thread(() -> { try { Dav.sync(getApplicationContext()); } catch (Exception ignored) { } }).start();
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIntent(intent);
    }

    /** 接收其他 App 分享的文字/图片；文字填输入框，图片放进附件栏。 */
    private void handleIntent(Intent i) {
        if (i == null) return;
        if (!Intent.ACTION_SEND.equals(i.getAction())) return;
        String type = String.valueOf(i.getType());
        if (type.startsWith("text/")) {
            String t = i.getStringExtra(Intent.EXTRA_TEXT);
            if (t != null && !t.trim().isEmpty()) shareText = t;
        } else if (type.startsWith("image/")) {
            Uri u = i.getParcelableExtra(Intent.EXTRA_STREAM);
            android.util.Log.d("SOLO", "share image uri=" + u);
            if (u != null) shareUri = u;
        }
        deliverShare();
    }

    private void deliverShare() {
        android.util.Log.d("SOLO", "deliverShare ready=" + pageReady + " txt=" + (shareText != null) + " uri=" + (shareUri != null));
        if (!pageReady || shareDelivering) return;
        if (shareText == null && shareUri == null) return;
        final String txt = shareText;
        final Uri uri = shareUri;
        shareText = null; shareUri = null;
        if (txt != null) {
            try {
                JSONObject o = new JSONObject();
                o.put("text", txt);
                web.evaluateJavascript("window.__scShare&&__scShare(" + o.toString() + ")", null);
            } catch (Exception ignored) { }
        }
        if (uri != null) {
            shareDelivering = true;
            new Thread(() -> {
                final String data = imageDataUrl(uri);
                android.util.Log.d("SOLO", "share decoded len=" + (data == null ? -1 : data.length()));
                runOnUiThread(() -> {
                    try {
                        if (data != null) {
                            JSONObject o = new JSONObject();
                            o.put("dataUrl", data);
                            o.put("name", "share.jpg");
                            web.evaluateJavascript("window.__scShare&&__scShare(" + o.toString() + ")", null);
                            android.util.Log.d("SOLO", "share evaluated");
                        }
                    } catch (Exception ignored) { }
                    shareDelivering = false;
                });
            }).start();
        }
    }

    private String imageDataUrl(Uri u) {
        try {
            BitmapFactory.Options o = new BitmapFactory.Options();
            o.inJustDecodeBounds = true;
            InputStream is = getContentResolver().openInputStream(u);
            BitmapFactory.decodeStream(is, null, o);
            if (is != null) is.close();
            int sample = 1;
            while (o.outWidth / sample > 1600 || o.outHeight / sample > 1600) sample *= 2;
            BitmapFactory.Options o2 = new BitmapFactory.Options();
            o2.inSampleSize = sample;
            is = getContentResolver().openInputStream(u);
            Bitmap bm = BitmapFactory.decodeStream(is, null, o2);
            if (is != null) is.close();
            if (bm == null) return null;
            ByteArrayOutputStream bo = new ByteArrayOutputStream();
            bm.compress(Bitmap.CompressFormat.JPEG, 85, bo);
            bm.recycle();
            return "data:image/jpeg;base64," + Base64.encodeToString(bo.toByteArray(), Base64.NO_WRAP);
        } catch (Exception e) { android.util.Log.d("SOLO", "share image decode fail: " + e); return null; }
    }

    @Override
    protected void onActivityResult(int req, int code, Intent data) {
        super.onActivityResult(req, code, data);
        if (req == 7002) {
            Uri u = (code == RESULT_OK && data != null) ? data.getData() : null;
            if (fileCb != null) fileCb.onReceiveValue(u == null ? null : new Uri[]{u});
            fileCb = null;
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (Prefs.bubble(this)) {
            if (!Settings.canDrawOverlays(this)) ensureOverlay();
            else { startBubble(); setBubbleVisible(false); }
        } else {
            stopBubble();
        }
        SyncJobService.schedulePeriodic(this);
    }

    @Override
    protected void onPause() {
        super.onPause();
        /* 没有悬浮窗权限就不能起服务：addView 会抛 BadTokenException 直接崩进程。 */
        if (Prefs.bubble(this) && Settings.canDrawOverlays(this)) setBubbleVisible(true);
        else stopBubble();
    }

    private void stopBubble() {
        try { stopService(new Intent(this, BubbleService.class)); } catch (Exception ignored) { }
    }

    private void setBubbleVisible(boolean show) {
        if (show && !Settings.canDrawOverlays(this)) {
            toastOverlayMissing();
            stopBubble();
            return;
        }
        try {
            Intent i = new Intent(this, BubbleService.class).setAction(show ? BubbleService.ACTION_SHOW : BubbleService.ACTION_HIDE);
            if (Build.VERSION.SDK_INT >= 26) startForegroundService(i); else startService(i);
        } catch (Exception ignored) { }
    }

    /** 缺少悬浮窗权限时只提示一次，避免每次 onPause 都弹。 */
    private void toastOverlayMissing() {
        if (Prefs.overlayAsked(this)) return;
        Prefs.markOverlayAsked(this);
        Toast.makeText(this, "未授予「显示在其他应用上层」，悬浮球暂不显示", Toast.LENGTH_LONG).show();
    }

    private void ensureOverlay() {
        if (!Settings.canDrawOverlays(this)) {
            Toast.makeText(this, "请允许「显示在其他应用上层」，悬浮截图要用", Toast.LENGTH_LONG).show();
            Intent i = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + getPackageName()));
            startActivity(i);
        }
    }

    private void startBubble() {
        if (!Settings.canDrawOverlays(this)) {
            toastOverlayMissing();
            return;
        }
        Intent i = new Intent(this, BubbleService.class).setAction(BubbleService.ACTION_SHOW);
        if (Build.VERSION.SDK_INT >= 26) startForegroundService(i); else startService(i);
    }

    @Override
    protected void onDestroy() {
        if (current == this) current = null;
        super.onDestroy();
    }

    /** 悬浮截图问答写入主应用的对话记录；WebView 未就绪时先排队。 */
    public static void recordPopup(String sessionId, String role, String text) {
        try {
            org.json.JSONObject o = new org.json.JSONObject();
            o.put("session", sessionId == null ? "" : sessionId);
            o.put("role", role == null ? "user" : role);
            o.put("text", text == null ? "" : text);
            o.put("ts", System.currentTimeMillis());
            String call = "window.__scPopupRecord&&window.__scPopupRecord(" + o.toString() + ")";
            MainActivity a = current;
            if (a == null || a.web == null || !a.pageReady) {
                synchronized (popupQueue) {
                    if (popupQueue.size() >= 80) popupQueue.removeFirst();
                    popupQueue.addLast(call);
                }
                return;
            }
            a.runOnUiThread(() -> {
                try { a.web.evaluateJavascript(call, null); } catch (Exception ignored) { }
            });
        } catch (Exception ignored) { }
    }

    private void flushPopupQueue() {
        if (!pageReady || web == null) return;
        for (;;) {
            String call;
            synchronized (popupQueue) { call = popupQueue.pollFirst(); }
            if (call == null) break;
            try { web.evaluateJavascript(call, null); } catch (Exception ignored) { }
        }
    }

    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) web.goBack(); else super.onBackPressed();
    }
}
