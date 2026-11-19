package com.solochat.mobile;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.util.Base64;
import android.view.Gravity;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

public class SettingsActivity extends Activity {
    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        /* NoActionBar 主题下没有系统返回键，显式给键盘留出空间 */
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        ScrollView sc = new ScrollView(this);
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        int p = dp(18);
        box.setPadding(p, p, p, p);
        sc.addView(box);

        /* 顶部显式关闭：不依赖系统返回手势 */
        LinearLayout topRow = new LinearLayout(this);
        topRow.setOrientation(LinearLayout.HORIZONTAL);
        topRow.setGravity(Gravity.END | Gravity.CENTER_VERTICAL);
        Button close = new Button(this);
        close.setText("✕ 关闭");
        close.setAllCaps(false);
        close.setTextSize(14);
        close.setContentDescription("关闭设置");
        close.setOnClickListener(v -> finish());
        topRow.addView(close, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        box.addView(topRow, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        box.addView(label("接口地址（Base URL，含 /v1）"));
        final EditText base = input(Prefs.base(this));
        base.setHint("https://api.openai.com/v1");
        box.addView(base);

        box.addView(label("API Key"));
        final EditText key = input(Prefs.key(this));
        key.setHint("sk-...");
        box.addView(key);

        box.addView(label("模型（要支持图片输入）"));
        final EditText model = input(Prefs.model(this));
        model.setHint("gpt-4o-mini / qwen-vl-max ...");
        box.addView(model);

        box.addView(label("默认提问"));
        final EditText prompt = input(Prefs.prompt(this));
        prompt.setMinLines(2);
        box.addView(prompt);

        box.addView(label("WebDAV 地址（可选；填目录，如 https://dav.example.com/dav/solo/）"));
        final EditText davUrl = input(Prefs.davUrl(this));
        davUrl.setHint("https://dav.example.com/dav/solo/");
        box.addView(davUrl);
        box.addView(label("WebDAV 用户名 / 密码"));
        final EditText davUser = input(Prefs.davUser(this));
        davUser.setHint("用户名");
        box.addView(davUser);
        final EditText davPass = input(Prefs.davPass(this));
        davPass.setHint("密码");
        box.addView(davPass);
        box.addView(label("远端文件名"));
        final EditText davFile = input(Prefs.davFile(this));
        davFile.setHint("solo-memory.md");
        box.addView(davFile);

        final android.widget.CheckBox autoSync = new android.widget.CheckBox(this);
        autoSync.setText("自动同步（打开 App、记忆写入后、每天一次）");
        autoSync.setChecked(Prefs.davAuto(this));
        box.addView(autoSync);

        final android.widget.CheckBox encSync = new android.widget.CheckBox(this);
        encSync.setText("加密远端文件（AES-GCM，口令只存在本机）");
        encSync.setChecked(Prefs.davEncrypt(this));
        box.addView(encSync);
        box.addView(label("同步口令（加密用；与 WebDAV 密码分开）"));
        final EditText syncPass = input(Prefs.davSyncPass(this));
        syncPass.setHint("留空则不加密");
        box.addView(syncPass);

        LinearLayout davRow = new LinearLayout(this);
        davRow.setOrientation(LinearLayout.HORIZONTAL);
        Button up = new Button(this); up.setText("上传记忆");
        Button down = new Button(this); down.setText("下载并合并");
        davRow.addView(up, new LinearLayout.LayoutParams(0, -2, 1));
        davRow.addView(down, new LinearLayout.LayoutParams(0, -2, 1));
        box.addView(davRow);

        Runnable grabAll = () -> {
            Prefs.get(this).edit()
                    .putString(Prefs.BASE, base.getText().toString().trim())
                    .putString(Prefs.KEY, key.getText().toString().trim())
                    .putString(Prefs.MODEL, model.getText().toString().trim())
                    .putString(Prefs.PROMPT, prompt.getText().toString().trim())
                    .putString(Prefs.DAV_URL, davUrl.getText().toString().trim())
                    .putString(Prefs.DAV_USER, davUser.getText().toString().trim())
                    .putString(Prefs.DAV_PASS, davPass.getText().toString())
                    .putString(Prefs.DAV_FILE, davFile.getText().toString().trim())
                    .putBoolean(Prefs.DAV_AUTO, autoSync.isChecked())
                    .putBoolean(Prefs.DAV_ENC, encSync.isChecked())
                    .putString(Prefs.DAV_SYNC_PASS, syncPass.getText().toString())
                    .apply();
            SyncJobService.schedulePeriodic(this);
        };
        up.setOnClickListener(v -> { grabAll.run(); davDo(true); });
        down.setOnClickListener(v -> { grabAll.run(); davDo(false); });

        Button save = new Button(this);
        save.setText("保存");
        save.setOnClickListener(v -> {
            Prefs.get(this).edit()
                    .putString(Prefs.BASE, base.getText().toString().trim())
                    .putString(Prefs.KEY, key.getText().toString().trim())
                    .putString(Prefs.MODEL, model.getText().toString().trim())
                    .putString(Prefs.PROMPT, prompt.getText().toString().trim())
                    .putString(Prefs.DAV_URL, davUrl.getText().toString().trim())
                    .putString(Prefs.DAV_USER, davUser.getText().toString().trim())
                    .putString(Prefs.DAV_PASS, davPass.getText().toString())
                    .putString(Prefs.DAV_FILE, davFile.getText().toString().trim())
                    .putBoolean(Prefs.DAV_AUTO, autoSync.isChecked())
                    .putBoolean(Prefs.DAV_ENC, encSync.isChecked())
                    .putString(Prefs.DAV_SYNC_PASS, syncPass.getText().toString())
                    .apply();
            SyncJobService.schedulePeriodic(this);
            Toast.makeText(this, "已保存", Toast.LENGTH_SHORT).show();
            finish();
        });
        box.addView(save, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        Button exp = new Button(this);
        exp.setText("导出记忆（USER/MEMORY/DREAMS → 一个 .md）");
        exp.setOnClickListener(v -> {
            Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
            i.addCategory(Intent.CATEGORY_OPENABLE);
            i.setType("text/markdown");
            i.putExtra(Intent.EXTRA_TITLE, "soul-memory.md");
            startActivityForResult(i, 8101);
        });
        box.addView(exp);

        Button imp = new Button(this);
        imp.setText("导入记忆（从 .md 合并）");
        imp.setOnClickListener(v -> {
            Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
            i.addCategory(Intent.CATEGORY_OPENABLE);
            i.setType("*/*");
            startActivityForResult(i, 8102);
        });
        box.addView(imp);

        TextView tip = new TextView(this);
        tip.setText("说明：截图只保留在内存里，点发送才直接传给你填的接口；不写相册、不经过中转服务器。");
        tip.setTextSize(12);
        tip.setPadding(0, dp(12), 0, 0);
        box.addView(tip);

        setContentView(sc);
        setTitle("悬浮截图设置");
    }

    private TextView label(String s) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextSize(13);
        t.setGravity(Gravity.START);
        t.setPadding(0, dp(12), 0, dp(4));
        return t;
    }

    private EditText input(String v) {
        EditText e = new EditText(this);
        e.setText(v);
        e.setTextSize(14);
        return e;
    }

    private int dp(int v) { return (int) (v * getResources().getDisplayMetrics().density); }

    private java.io.File memDir() {
        java.io.File d = new java.io.File(getFilesDir(), "memory");
        if (!d.exists()) d.mkdirs();
        return d;
    }

    /** WebDAV 上传 / 下载并合并（手动触发；自动同步走 SyncJobService）。 */
    private void davDo(final boolean upload) {
        new Thread(() -> {
            try {
                if (upload) {
                    Dav.upload(this);
                    runOnUiThread(() -> Toast.makeText(this, "已上传到 WebDAV", Toast.LENGTH_SHORT).show());
                } else {
                    Dav.Result r = Dav.sync(this);
                    runOnUiThread(() -> Toast.makeText(this, r.msg + "（重启 App 生效）", Toast.LENGTH_LONG).show());
                }
            } catch (Exception e) {
                runOnUiThread(() -> Toast.makeText(this, "同步失败：" + e.getMessage(), Toast.LENGTH_LONG).show());
            }
        }).start();
    }

    private String read(java.io.File f) {
        try (java.io.FileInputStream in = new java.io.FileInputStream(f)) {
            byte[] b = new byte[(int) f.length()];
            int off = 0, n;
            while (off < b.length && (n = in.read(b, off, b.length - off)) > 0) off += n;
            return new String(b, 0, off, java.nio.charset.StandardCharsets.UTF_8);
        } catch (Exception e) { return ""; }
    }

    private void write(java.io.File f, String text) {
        try (java.io.FileOutputStream out = new java.io.FileOutputStream(f)) {
            out.write(text.getBytes(java.nio.charset.StandardCharsets.UTF_8));
        } catch (Exception ignored) { }
    }

    private String body(String s) {
        return s.replaceFirst("(?i)^#\\s*(USER|MEMORY|DREAMS)\\.md\\s*", "").trim();
    }

    @Override
    protected void onActivityResult(int req, int code, Intent data) {
        super.onActivityResult(req, code, data);
        if (code != RESULT_OK || data == null || data.getData() == null) return;
        Uri u = data.getData();
        try {
            java.io.File dir = memDir();
            if (req == 8101) {
                String all = "# USER.md\n\n" + body(read(new java.io.File(dir, "USER.md"))) + "\n\n"
                        + "# MEMORY.md\n\n" + body(read(new java.io.File(dir, "MEMORY.md"))) + "\n\n"
                        + "# DREAMS.md\n\n" + body(read(new java.io.File(dir, "DREAMS.md"))) + "\n";
                java.io.OutputStream os = getContentResolver().openOutputStream(u);
                if (os != null) { os.write(all.getBytes(java.nio.charset.StandardCharsets.UTF_8)); os.close(); }
                Toast.makeText(this, "已导出", Toast.LENGTH_SHORT).show();
            } else if (req == 8102) {
                java.io.InputStream is = getContentResolver().openInputStream(u);
                java.io.ByteArrayOutputStream bo = new java.io.ByteArrayOutputStream();
                byte[] buf = new byte[8192]; int n;
                while ((n = is.read(buf)) > 0) bo.write(buf, 0, n);
                is.close();
                String t = new String(bo.toByteArray(), java.nio.charset.StandardCharsets.UTF_8);
                String[] names = {"USER", "MEMORY", "DREAMS"};
                for (String nm : names) {
                    java.util.regex.Matcher m = java.util.regex.Pattern
                            .compile("#\\s*" + nm + "\\.md\\s*([\\s\\S]*?)(?=#\\s*(?:USER|MEMORY|DREAMS)\\.md|$)", java.util.regex.Pattern.CASE_INSENSITIVE)
                            .matcher(t);
                    if (m.find()) write(new java.io.File(dir, nm + ".md"), "# " + nm + ".md\n\n" + m.group(1).trim() + "\n");
                }
                Toast.makeText(this, "已导入（重启 App 后生效）", Toast.LENGTH_LONG).show();
            }
        } catch (Exception e) {
            Toast.makeText(this, "失败：" + e.getMessage(), Toast.LENGTH_LONG).show();
        }
    }
}
