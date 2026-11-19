package com.solochat.mobile;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** WebView ←→ Android 原生桥：http / mem / notify。只做最小集，不碰相册。 */
public class Bridge {
    private final Context ctx;
    private final WebView web;
    private final ExecutorService pool = Executors.newCachedThreadPool();
    private final Map<String, HttpURLConnection> inflight = new ConcurrentHashMap<>();
    private final Handler ui = new Handler(Looper.getMainLooper());

    public Bridge(Context ctx, WebView web) {
        this.ctx = ctx.getApplicationContext();
        this.web = web;
    }

    @JavascriptInterface
    public void post(String json) {
        try {
            JSONObject o = new JSONObject(json);
            String t = o.optString("t");
            if ("http".equals(t)) doHttp(o);
            else if ("http.abort".equals(t)) abort(o.optString("id"));
            else if ("mem".equals(t)) doMem(o);
            else if ("notify".equals(t)) doNotify(o);
            else if ("savefile".equals(t)) doSaveFile(o);
            else if ("cfg".equals(t)) doCfg(o);
            else if ("bubble".equals(t)) doBubble(o);
            else if ("secret".equals(t)) doSecret(o);
        } catch (Exception ignored) { }
    }

    private void push(JSONObject o) {
        final String s = o.toString();
        ui.post(() -> web.evaluateJavascript("window.__scBridgePush(" + JSONObject.quote(s) + ")", null));
    }

    private void abort(String id) {
        HttpURLConnection c = inflight.remove(id);
        if (c != null) c.disconnect();
    }

    private void doHttp(final JSONObject o) {
        final String id = o.optString("id");
        pool.execute(() -> {
            HttpURLConnection c = null;
            try {
                URL u = new URL(o.getString("url"));
                c = (HttpURLConnection) u.openConnection();
                c.setRequestMethod(o.optString("method", "POST"));
                c.setConnectTimeout(20000);
                c.setReadTimeout(300000);
                JSONObject h = o.optJSONObject("headers");
                if (h != null) {
                    Iterator<String> it = h.keys();
                    while (it.hasNext()) {
                        String k = it.next();
                        c.setRequestProperty(k, h.optString(k));
                    }
                }
                String body = o.optString("body", "");
                if (!"GET".equalsIgnoreCase(c.getRequestMethod())) {
                    c.setDoOutput(true);
                    byte[] b = body.getBytes(StandardCharsets.UTF_8);
                    c.setFixedLengthStreamingMode(b.length);
                    c.getOutputStream().write(b);
                }
                inflight.put(id, c);
                int code = c.getResponseCode();
                InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
                if (in != null) {
                    BufferedReader r = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8));
                    char[] buf = new char[2048];
                    int n;
                    while ((n = r.read(buf)) > 0) {
                        JSONObject ch = new JSONObject();
                        ch.put("t", "http.chunk");
                        ch.put("id", id);
                        ch.put("data", new String(buf, 0, n));
                        push(ch);
                    }
                    r.close();
                }
                JSONObject d = new JSONObject();
                d.put("t", "http.done");
                d.put("id", id);
                d.put("status", code);
                push(d);
            } catch (Exception e) {
                try {
                    JSONObject d = new JSONObject();
                    d.put("t", "http.error");
                    d.put("id", id);
                    d.put("message", String.valueOf(e.getMessage()));
                    push(d);
                } catch (Exception ignored) { }
            } finally {
                if (c != null) c.disconnect();
                inflight.remove(id);
            }
        });
    }

    /** 网页把主应用当前连接配置推给原生，截图问答复用同一套 Base/Key/模型。 */
    private void doCfg(JSONObject o) {
        try {
            String base = o.optString("base", "").trim();
            String key = o.optString("key", "").trim();
            String model = o.optString("model", "").trim();
            String popupModel = o.optString("popupModel", "").trim();
            if (key.isEmpty()) return;
            Prefs.get(ctx).edit()
                    .putString(Prefs.BASE, base)
                    .putString(Prefs.KEY, key)
                    .putString(Prefs.MODEL, model)
                    .putString(Prefs.POPUP_MODEL, popupModel)
                    .apply();
            android.util.Log.d("SOLO", "cfg synced base=" + base + " model=" + model);
        } catch (Exception ignored) { }
    }

    /** 密钥保险库：AES/GCM 加密后存本机；回包只带状态/值，不带明文日志。 */
    private void doSecret(final JSONObject o) {
        final String id = o.optString("id");
        pool.execute(() -> {
            try {
                String op = o.optString("op", "get");
                String name = o.optString("name", "");
                JSONObject d = new JSONObject();
                d.put("t", "secret.done");
                d.put("id", id);
                if ("set".equals(op)) {
                    VaultStore.set(ctx, name, o.optString("value", ""));
                    d.put("status", 0);
                } else if ("get".equals(op)) {
                    String v = VaultStore.get(ctx, name);
                    if (v == null) d.put("status", 404);
                    else { d.put("status", 0); d.put("data", v); }
                } else {
                    throw new Exception("未知 op");
                }
                push(d);
            } catch (Exception e) {
                try {
                    JSONObject d = new JSONObject();
                    d.put("t", "secret.error");
                    d.put("id", id);
                    d.put("message", String.valueOf(e.getMessage()));
                    push(d);
                } catch (Exception ignored) { }
            }
        });
    }

    /** WebView 启动回填用：返回原生侧已同步的连接配置（只给本应用 WebView 用）。 */
    @JavascriptInterface
    public String getCfg() {
        try {
            android.content.SharedPreferences sp = Prefs.get(ctx);
            JSONObject o = new JSONObject();
            o.put("base", sp.getString(Prefs.BASE, ""));
            o.put("key", sp.getString(Prefs.KEY, ""));
            o.put("model", sp.getString(Prefs.MODEL, ""));
            o.put("popupModel", sp.getString(Prefs.POPUP_MODEL, ""));
            return o.toString();
        } catch (Exception e) {
            return "{}";
        }
    }

    /** 网页「通用设置 → 悬浮球截屏提问」开关：存偏好并启动/停止悬浮球服务。 */
    private void doBubble(JSONObject o) {
        try {
            final boolean show = o.optBoolean("show", true);
            Prefs.get(ctx).edit().putBoolean(Prefs.BUBBLE, show).apply();
            if (show) {
                /* 未授予悬浮窗权限时先不启动，回 App 后由 MainActivity 引导授权再起 */
                if (!android.provider.Settings.canDrawOverlays(ctx)) {
                    android.widget.Toast.makeText(ctx, "请先允许「显示在其他应用上层」", android.widget.Toast.LENGTH_SHORT).show();
                    return;
                }
                Intent i = new Intent(ctx, BubbleService.class).setAction(BubbleService.ACTION_SHOW);
                if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(i); else ctx.startService(i);
            } else {
                ctx.stopService(new Intent(ctx, BubbleService.class));
            }
            android.util.Log.d("SOLO", "bubble switch show=" + show);
        } catch (Exception e) {
            android.util.Log.e("SOLO", "bubble switch: " + e);
        }
    }

    /** 网页下载兜底：把文本写入系统 Download/SoloChat（API 29+ 走 MediaStore，无需存储权限）。 */
    private void doSaveFile(final JSONObject o) {
        final String id = o.optString("id");
        final String name = o.optString("name", "solochat.txt");
        final String text = o.optString("text", "");
        final String mime = o.optString("mime", "text/plain");
        pool.execute(() -> {
            try {
                String path;
                if (Build.VERSION.SDK_INT >= 29) {
                    ContentValues cv = new ContentValues();
                    cv.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
                    cv.put(MediaStore.MediaColumns.MIME_TYPE, mime);
                    cv.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/SoloChat");
                    android.net.Uri u = ctx.getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv);
                    if (u == null) throw new Exception("无法创建下载文件");
                    try (OutputStream os = ctx.getContentResolver().openOutputStream(u)) {
                        if (os == null) throw new Exception("无法写入下载文件");
                        os.write(text.getBytes(StandardCharsets.UTF_8));
                    }
                    path = "下载/SoloChat/" + name;
                } else {
                    File dir = new File(ctx.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), "SoloChat");
                    if (!dir.exists()) dir.mkdirs();
                    File f = new File(dir, name);
                    try (FileOutputStream fo = new FileOutputStream(f)) {
                        fo.write(text.getBytes(StandardCharsets.UTF_8));
                    }
                    path = f.getAbsolutePath();
                }
                JSONObject d = new JSONObject();
                d.put("t", "save.done"); d.put("id", id); d.put("path", path);
                push(d);
            } catch (Exception e) {
                try {
                    JSONObject d = new JSONObject();
                    d.put("t", "save.error"); d.put("id", id); d.put("message", String.valueOf(e.getMessage()));
                    push(d);
                } catch (Exception ignored) { }
            }
        });
    }

    private void doMem(JSONObject o) {        String op = o.optString("op", "load");        File dir = new File(ctx.getFilesDir(), "memory");
        if (!dir.exists()) dir.mkdirs();
        try {
            if ("load".equals(op) || "list".equals(op)) {
                JSONArray files = new JSONArray();
                File[] fs = dir.listFiles((d, n) -> n.endsWith(".md"));
                if (fs != null) {
                    for (File f : fs) {
                        JSONObject j = new JSONObject();
                        j.put("name", f.getName());
                        j.put("text", readFile(f));
                        j.put("mtime", f.lastModified());
                        j.put("bytes", f.length());
                        files.put(j);
                    }
                }
                JSONObject d = new JSONObject();
                d.put("t", "mem.done");
                d.put("id", o.optString("id"));
                d.put("root", dir.getAbsolutePath());
                d.put("files", files);
                push(d);
                return;
            }
            if ("save".equals(op)) {
                String name = o.optString("name");
                if (!name.matches("^(USER|MEMORY|DREAMS)\\.md$")) throw new Exception("文件名只允许 USER/MEMORY/DREAMS.md");
                writeFile(new File(dir, name), o.optString("text"));
                SyncJobService.scheduleSoon(ctx); // 自动同步：写入后延迟合并，避免每句都传
                JSONObject d = new JSONObject();
                d.put("t", "mem.done");
                d.put("id", o.optString("id"));
                d.put("name", name);
                push(d);
                return;
            }
            throw new Exception("未知 op");
        } catch (Exception e) {
            try {
                JSONObject d = new JSONObject();
                d.put("t", "mem.error");
                d.put("id", o.optString("id"));
                d.put("message", String.valueOf(e.getMessage()));
                push(d);
            } catch (Exception ignored) { }
        }
    }

    private void doNotify(JSONObject o) {
        String title = o.optString("title", "SoloChat");
        String body = o.optString("body", "");
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel ch = new NotificationChannel("soul", "Soul 提醒", NotificationManager.IMPORTANCE_DEFAULT);
            nm.createNotificationChannel(ch);
        }
        Intent i = new Intent(ctx, MainActivity.class);
        i.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int flags = Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0;
        PendingIntent pi = PendingIntent.getActivity(ctx, 0, i, flags);
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(ctx, "soul") : new Notification.Builder(ctx);
        b.setSmallIcon(R.drawable.ic_stat).setContentTitle(title).setContentText(body).setContentIntent(pi).setAutoCancel(true);
        nm.notify((int) (System.currentTimeMillis() % 100000), b.build());
    }

    private static String readFile(File f) throws Exception {
        try (FileInputStream in = new FileInputStream(f)) {
            byte[] b = new byte[(int) f.length()];
            int off = 0;
            while (off < b.length) {
                int n = in.read(b, off, b.length - off);
                if (n < 0) break;
                off += n;
            }
            return new String(b, 0, off, StandardCharsets.UTF_8);
        }
    }

    private static void writeFile(File f, String text) throws Exception {
        try (FileOutputStream out = new FileOutputStream(f)) {
            out.write(text.getBytes(StandardCharsets.UTF_8));
        }
    }
}
