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
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;

public class MainActivity extends Activity {
    private WebView web;
    private boolean pageReady;
    private String shareText;
    private Uri shareUri;
    private boolean shareDelivering;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
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
        web.setWebViewClient(new WebViewClient() {
            @Override public void onPageFinished(WebView v, String url) {
                android.util.Log.d("SOLO", "onPageFinished " + url);
                web.postDelayed(() -> { pageReady = true; deliverShare(); }, 800);
            }
        });
        setContentView(web);
        web.loadUrl("file:///android_asset/index.html");
        /* 兜底：个别 ROM 的 onPageFinished 回调不到，2 秒后直接投递待分享内容 */
        web.postDelayed(() -> { pageReady = true; deliverShare(); }, 2000);

        if (Build.VERSION.SDK_INT >= 33
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 9);
        }
        ensureOverlay();
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
    protected void onResume() {
        super.onResume();
        if (Settings.canDrawOverlays(this)) { startBubble(); setBubbleVisible(false); }
        SyncJobService.schedulePeriodic(this);
    }

    @Override
    protected void onPause() {
        super.onPause();
        setBubbleVisible(true);
    }

    private void setBubbleVisible(boolean show) {
        try {
            Intent i = new Intent(this, BubbleService.class).setAction(show ? BubbleService.ACTION_SHOW : BubbleService.ACTION_HIDE);
            if (Build.VERSION.SDK_INT >= 26) startForegroundService(i); else startService(i);
        } catch (Exception ignored) { }
    }

    private void ensureOverlay() {
        if (!Settings.canDrawOverlays(this)) {
            Toast.makeText(this, "请允许「显示在其他应用上层」，悬浮截图要用", Toast.LENGTH_LONG).show();
            Intent i = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + getPackageName()));
            startActivity(i);
        }
    }

    private void startBubble() {
        Intent i = new Intent(this, BubbleService.class).setAction(BubbleService.ACTION_SHOW);
        if (Build.VERSION.SDK_INT >= 26) startForegroundService(i); else startService(i);
    }

    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) web.goBack(); else super.onBackPressed();
    }
}
