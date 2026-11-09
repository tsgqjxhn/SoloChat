package com.solochat.mobile;

import android.content.Context;
import android.content.SharedPreferences;

/** 悬浮截图用的模型配置（只存 App 私有目录；不上传、不进相册）。 */
public class Prefs {
    public static final String NAME = "solo";
    public static final String BASE = "base";
    public static final String KEY = "key";
    public static final String MODEL = "model";
    public static final String PROMPT = "prompt";
    public static final String DAV_URL = "davUrl";
    public static final String DAV_USER = "davUser";
    public static final String DAV_PASS = "davPass";
    public static final String DAV_FILE = "davFile";
    public static final String DAV_AUTO = "davAuto";
    public static final String DAV_ENC = "davEnc";
    public static final String DAV_SYNC_PASS = "davSyncPass";

    public static String davUrl(Context c) { return get(c).getString(DAV_URL, ""); }
    public static String davUser(Context c) { return get(c).getString(DAV_USER, ""); }
    public static String davPass(Context c) { return get(c).getString(DAV_PASS, ""); }
    public static String davFile(Context c) {
        String s = get(c).getString(DAV_FILE, "");
        return s.isEmpty() ? "solo-memory.md" : s;
    }
    public static boolean davAuto(Context c) { return get(c).getBoolean(DAV_AUTO, false); }
    public static boolean davEncrypt(Context c) { return get(c).getBoolean(DAV_ENC, false); }
    public static String davSyncPass(Context c) { return get(c).getString(DAV_SYNC_PASS, ""); }

    public static SharedPreferences get(Context c) {
        return c.getSharedPreferences(NAME, Context.MODE_PRIVATE);
    }

    public static String base(Context c) {
        String s = get(c).getString(BASE, "");
        if (s.isEmpty()) s = "https://api.openai.com/v1";
        return s.endsWith("/") ? s.substring(0, s.length() - 1) : s;
    }

    public static String key(Context c) { return get(c).getString(KEY, ""); }

    public static String model(Context c) {
        String s = get(c).getString(MODEL, "");
        return s.isEmpty() ? "gpt-4o-mini" : s;
    }

    public static String prompt(Context c) {
        String s = get(c).getString(PROMPT, "");
        return s.isEmpty() ? "请看我截的这块屏幕，直接回答或解释它，用中文。" : s;
    }
}
