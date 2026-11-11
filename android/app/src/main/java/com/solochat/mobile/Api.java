package com.solochat.mobile;

import android.content.Context;
import android.graphics.Bitmap;
import android.util.Base64;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/** 一次性的视觉问答调用（非流式；图片只在内存里 base64，不落盘、不进相册）。 */
public class Api {
    public interface Cb { void ok(String text); void fail(String msg); }

    public static void ask(Context ctx, Bitmap bmp, String prompt, Cb cb) {
        askTurn(ctx, bmp, prompt, null, cb);
    }

    /** 带历史的截图追问：history 为 [{role,content}]，当前 prompt 重新附截图。 */
    public static void askTurn(Context ctx, Bitmap bmp, String prompt, JSONArray history, Cb cb) {
        new Thread(() -> {
            try {
                String key = Prefs.key(ctx);
                android.util.Log.d("SOLO", "ask base=" + Prefs.base(ctx) + " model=" + Prefs.model(ctx) + " keyLen=" + key.length());
                if (key.isEmpty()) throw new Exception("还没填 API Key（长按悬浮球 → 设置）");
                Bitmap scaled = scale(bmp, 1600);
                ByteArrayOutputStream bo = new ByteArrayOutputStream();
                scaled.compress(Bitmap.CompressFormat.JPEG, 85, bo);
                String b64 = Base64.encodeToString(bo.toByteArray(), Base64.NO_WRAP);
                android.util.Log.d("SOLO", "ask b64=" + b64.length() + " bytes=" + bo.size());

                JSONObject img = new JSONObject().put("url", "data:image/jpeg;base64," + b64);
                JSONArray content = new JSONArray()
                        .put(new JSONObject().put("type", "text").put("text", prompt))
                        .put(new JSONObject().put("type", "image_url").put("image_url", img));
                JSONArray msgs = new JSONArray();
                if (history != null) {
                    for (int i = 0; i < history.length(); i++) {
                        JSONObject h = history.optJSONObject(i);
                        if (h == null) continue;
                        String role = h.optString("role", "user");
                        String text = h.optString("content", "");
                        if (text.isEmpty()) continue;
                        msgs.put(new JSONObject().put("role", role).put("content", text));
                    }
                }
                msgs.put(new JSONObject().put("role", "user").put("content", content));
                JSONObject body = new JSONObject()
                        .put("model", Prefs.model(ctx))
                        .put("messages", msgs)
                        .put("max_tokens", 1200)
                        .put("temperature", 0.2);

                HttpURLConnection c = (HttpURLConnection) new URL(chatUrl(ctx)).openConnection();
                c.setRequestMethod("POST");
                c.setConnectTimeout(20000);
                c.setReadTimeout(120000);
                c.setDoOutput(true);
                c.setRequestProperty("Content-Type", "application/json");
                c.setRequestProperty("Authorization", "Bearer " + key);
                byte[] payload = body.toString().getBytes(StandardCharsets.UTF_8);
                android.util.Log.d("SOLO", "ask payload=" + payload.length + " hasImg=" + body.toString().contains("data:image/jpeg;base64,"));
                c.setFixedLengthStreamingMode(payload.length);
                try (OutputStream os = c.getOutputStream()) { os.write(payload); }

                int code = c.getResponseCode();
                android.util.Log.d("SOLO", "ask http " + code);
                InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
                StringBuilder sb = new StringBuilder();
                if (in != null) {
                    BufferedReader r = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8));
                    String line;
                    while ((line = r.readLine()) != null) sb.append(line);
                    r.close();
                }
                if (code < 200 || code >= 300) throw new Exception("HTTP " + code + " " + sb.toString().substring(0, Math.min(200, sb.length())));
                JSONObject j = new JSONObject(sb.toString());
                String text = j.getJSONArray("choices").getJSONObject(0).getJSONObject("message").optString("content");
                if (text == null || text.trim().isEmpty()) throw new Exception("模型返回空内容");
                cb.ok(text.trim());
            } catch (Exception e) {
                android.util.Log.e("SOLO", "ask fail: " + e);
                cb.fail(String.valueOf(e.getMessage()));
            }
        }).start();
    }

    /** 归一化 Base URL：去尾斜杠/误粘的 /chat/completions；没有版本段就补 /v1，避免 /v1/v1/... 或漏 /v1。 */
    private static String chatUrl(Context ctx) {
        String base = String.valueOf(Prefs.base(ctx) == null ? "" : Prefs.base(ctx)).trim();
        base = base.replaceAll("/+$", "").replaceAll("(?i)/chat/completions(?:\\?.*)?$", "");
        if (!base.matches("(?i).*/v\\d+(?:beta|alpha)?$")) base += "/v1";
        return base + "/chat/completions";
    }

    private static Bitmap scale(Bitmap b, int max) {
        int w = b.getWidth(), h = b.getHeight();
        if (w <= max && h <= max) return b;
        float s = Math.min(max / (float) w, max / (float) h);
        return Bitmap.createScaledBitmap(b, Math.round(w * s), Math.round(h * s), true);
    }
}
