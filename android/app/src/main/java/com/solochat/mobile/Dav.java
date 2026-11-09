package com.solochat.mobile;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.util.Base64;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;

import javax.crypto.Cipher;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.PBEKeySpec;
import javax.crypto.spec.SecretKeySpec;

/** WebDAV 同步：合并 Markdown、可选 AES-GCM 加密、后台任务共用。 */
public class Dav {
    static final String[] NAMES = {"USER", "MEMORY", "DREAMS"};
    static final String MAGIC = "SCENC1";

    public static class Result {
        public int added;
        public String msg = "";
        public boolean uploaded;
    }

    public static File dir(Context c) {
        File d = new File(c.getFilesDir(), "memory");
        if (!d.exists()) d.mkdirs();
        return d;
    }

    public static String combined(Context c) {
        File d = dir(c);
        StringBuilder sb = new StringBuilder();
        for (String n : NAMES) {
            sb.append("# ").append(n).append(".md\n\n")
              .append(body(read(new File(d, n + ".md")))).append("\n\n");
        }
        return sb.toString();
    }

    public static void upload(Context c) throws Exception {
        byte[] data = combined(c).getBytes(StandardCharsets.UTF_8);
        String pass = Prefs.davSyncPass(c);
        boolean enc = Prefs.davEncrypt(c) && !pass.isEmpty();
        if (enc) data = encrypt(data, pass);
        HttpURLConnection conn = open(c, "PUT");
        conn.setDoOutput(true);
        conn.setFixedLengthStreamingMode(data.length);
        conn.setRequestProperty("Content-Type", enc ? "application/octet-stream" : "text/markdown; charset=utf-8");
        try (OutputStream os = conn.getOutputStream()) { os.write(data); }
        int code = conn.getResponseCode();
        if (code < 200 || code >= 300) throw new Exception("上传 HTTP " + code);
    }

    public static String downloadRaw(Context c) throws Exception {
        HttpURLConnection conn = open(c, "GET");
        int code = conn.getResponseCode();
        if (code == 404) return null;
        if (code < 200 || code >= 300) throw new Exception("下载 HTTP " + code);
        InputStream is = conn.getInputStream();
        ByteArrayOutputStream bo = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = is.read(buf)) > 0) bo.write(buf, 0, n);
        is.close();
        byte[] bytes = bo.toByteArray();
        if (isEncrypted(bytes)) {
            String pass = Prefs.davSyncPass(c);
            if (pass.isEmpty()) throw new Exception("远端是加密文件，请先填同步口令");
            bytes = decrypt(bytes, pass);
        }
        return new String(bytes, StandardCharsets.UTF_8);
    }

    /** 拉取远端 → 按文件合并（本地优先，MEMORY/DREAMS 取并集）→ 写回本地 → 再上传。 */
    public static Result sync(Context c) throws Exception {
        Result r = new Result();
        String remote = downloadRaw(c);
        Map<String, String> parts = split(remote == null ? "" : remote);
        File d = dir(c);
        List<String> notes = new ArrayList<>();
        for (String n : NAMES) {
            File f = new File(d, n + ".md");
            String local = read(f);
            String merged = merge(n, local, parts.get(n));
            if (!merged.equals(body(local))) {
                int before = countEntries(local);
                int after = countEntries("# " + n + ".md\n\n" + merged + "\n");
                int add = Math.max(0, after - before);
                if (add > 0) { r.added += add; notes.add(n + " +" + add); }
                write(f, "# " + n + ".md\n\n" + merged + "\n");
            }
        }
        upload(c);
        r.uploaded = true;
        r.msg = notes.isEmpty() ? "已同步（无新增）" : ("已同步 " + join(notes));
        notifyDone(c, r.msg);
        return r;
    }

    static String merge(String name, String localRaw, String remoteRaw) {
        String local = body(localRaw).trim();
        String remote = body(remoteRaw == null ? "" : remoteRaw).trim();
        if (remote.isEmpty()) return local;
        if (local.isEmpty()) return remote;
        if ("USER".equals(name)) return local; // 画像以本机为准，避免旧设备覆盖
        LinkedHashSet<String> lines = new LinkedHashSet<>();
        for (String l : local.split("\n")) if (!l.trim().isEmpty()) lines.add(l.trim());
        int base = lines.size();
        for (String l : remote.split("\n")) if (!l.trim().isEmpty()) lines.add(l.trim());
        StringBuilder sb = new StringBuilder();
        for (String l : lines) { if (sb.length() > 0) sb.append('\n'); sb.append(l); }
        return sb.toString();
    }

    static Map<String, String> split(String text) {
        Map<String, String> m = new LinkedHashMap<>();
        for (String n : NAMES) {
            java.util.regex.Matcher mt = java.util.regex.Pattern
                    .compile("#\\s*" + n + "\\.md\\s*([\\s\\S]*?)(?=#\\s*(?:USER|MEMORY|DREAMS)\\.md|$)",
                            java.util.regex.Pattern.CASE_INSENSITIVE)
                    .matcher(text == null ? "" : text);
            if (mt.find()) m.put(n, mt.group(1).trim());
        }
        return m;
    }

    static int countEntries(String text) {
        int n = 0;
        for (String l : body(text).split("\n")) if (l.trim().startsWith("- ")) n++;
        return n;
    }

    static String body(String s) {
        if (s == null) return "";
        return s.replaceFirst("(?i)^#\\s*(USER|MEMORY|DREAMS)\\.md\\s*", "").trim();
    }

    static String read(File f) {
        try (FileInputStream in = new FileInputStream(f)) {
            byte[] b = new byte[(int) f.length()];
            int off = 0, n;
            while (off < b.length && (n = in.read(b, off, b.length - off)) > 0) off += n;
            return new String(b, 0, off, StandardCharsets.UTF_8);
        } catch (Exception e) { return ""; }
    }

    static void write(File f, String text) {
        try (FileOutputStream out = new FileOutputStream(f)) {
            out.write(text.getBytes(StandardCharsets.UTF_8));
        } catch (Exception ignored) { }
    }

    static HttpURLConnection open(Context c, String method) throws Exception {
        String base = Prefs.davUrl(c).trim();
        if (base.isEmpty()) throw new Exception("先填 WebDAV 地址");
        if (!base.endsWith("/")) base += "/";
        String file = Prefs.davFile(c);
        HttpURLConnection conn = (HttpURLConnection) new URL(base + file).openConnection();
        conn.setRequestMethod(method);
        conn.setConnectTimeout(20000);
        conn.setReadTimeout(30000);
        String user = Prefs.davUser(c), pass = Prefs.davPass(c);
        if (!user.isEmpty() || !pass.isEmpty()) {
            String tok = Base64.encodeToString((user + ":" + pass).getBytes(StandardCharsets.UTF_8), Base64.NO_WRAP);
            conn.setRequestProperty("Authorization", "Basic " + tok);
        }
        return conn;
    }

    static boolean isEncrypted(byte[] b) {
        if (b == null || b.length < MAGIC.length()) return false;
        for (int i = 0; i < MAGIC.length(); i++) if (b[i] != (byte) MAGIC.charAt(i)) return false;
        return true;
    }

    static byte[] encrypt(byte[] data, String pass) throws Exception {
        byte[] salt = new byte[16], iv = new byte[12];
        new SecureRandom().nextBytes(salt);
        new SecureRandom().nextBytes(iv);
        SecretKeySpec key = key(pass, salt);
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.ENCRYPT_MODE, key, new GCMParameterSpec(128, iv));
        byte[] ct = c.doFinal(data);
        ByteArrayOutputStream bo = new ByteArrayOutputStream();
        bo.write(MAGIC.getBytes(StandardCharsets.US_ASCII));
        bo.write(salt); bo.write(iv); bo.write(ct);
        return bo.toByteArray();
    }

    static byte[] decrypt(byte[] data, String pass) throws Exception {
        int off = MAGIC.length();
        if (data.length < off + 16 + 12 + 16) throw new Exception("加密文件损坏");
        byte[] salt = new byte[16], iv = new byte[12];
        System.arraycopy(data, off, salt, 0, 16);
        System.arraycopy(data, off + 16, iv, 0, 12);
        byte[] ct = new byte[data.length - off - 28];
        System.arraycopy(data, off + 28, ct, 0, ct.length);
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.DECRYPT_MODE, key(pass, salt), new GCMParameterSpec(128, iv));
        return c.doFinal(ct);
    }

    static SecretKeySpec key(String pass, byte[] salt) throws Exception {
        SecretKeyFactory f = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256");
        byte[] raw = f.generateSecret(new PBEKeySpec(pass.toCharArray(), salt, 120000, 256)).getEncoded();
        return new SecretKeySpec(raw, "AES");
    }

    static String join(List<String> xs) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < xs.size(); i++) { if (i > 0) sb.append("、"); sb.append(xs.get(i)); }
        return sb.toString();
    }

    /** 同步结果通知（频道在 Notify.ensure 里建）。 */
    public static void notifyDone(Context c, String msg) {
        try {
            NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
            if (Build.VERSION.SDK_INT >= 26) {
                NotificationChannel ch = new NotificationChannel("solo_sync", "记忆同步", NotificationManager.IMPORTANCE_LOW);
                nm.createNotificationChannel(ch);
            }
            Intent i = new Intent(c, MainActivity.class);
            PendingIntent pi = PendingIntent.getActivity(c, 0, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
            android.app.Notification.Builder b = Build.VERSION.SDK_INT >= 26
                    ? new android.app.Notification.Builder(c, "solo_sync")
                    : new android.app.Notification.Builder(c);
            b.setSmallIcon(android.R.drawable.stat_notify_sync)
                    .setContentTitle("SoloChat 记忆同步")
                    .setContentText(msg)
                    .setContentIntent(pi)
                    .setAutoCancel(true);
            if (Build.VERSION.SDK_INT >= 21) b.setColor(0xFF2F6DF6);
            nm.notify(4102, b.build());
        } catch (Exception ignored) { }
    }
}
