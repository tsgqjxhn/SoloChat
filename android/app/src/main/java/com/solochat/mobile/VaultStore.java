package com.solochat.mobile;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import java.nio.charset.StandardCharsets;
import java.security.Key;
import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** 密钥保险库：Android Keystore（AES/GCM）加密后落 SharedPreferences，明文不落盘、不进日志。 */
public class VaultStore {
    private static final String ALIAS = "solochat_vault";
    private static final String STORE = "solo_vault";
    private static final String TRANSFORM = "AES/GCM/NoPadding";
    private static final int TAG_BITS = 128;
    private static final int IV_LEN = 12;

    private static SecretKey key() throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        Key k = ks.getKey(ALIAS, null);
        if (k instanceof SecretKey) return (SecretKey) k;
        KeyGenerator kg = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        kg.init(new KeyGenParameterSpec.Builder(ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build());
        return kg.generateKey();
    }

    private static SharedPreferences sp(Context c) {
        return c.getSharedPreferences(STORE, Context.MODE_PRIVATE);
    }

    /** 写一项：空值即删除；否则存 Base64(iv + ciphertext)。 */
    public static synchronized void set(Context c, String name, String value) throws Exception {
        if (name == null || name.isEmpty()) throw new Exception("缺少名称");
        SharedPreferences p = sp(c);
        if (value == null || value.isEmpty()) {
            p.edit().remove(name).commit();
            return;
        }
        Cipher ci = Cipher.getInstance(TRANSFORM);
        ci.init(Cipher.ENCRYPT_MODE, key());
        byte[] iv = ci.getIV();
        byte[] ct = ci.doFinal(value.getBytes(StandardCharsets.UTF_8));
        byte[] all = new byte[iv.length + ct.length];
        System.arraycopy(iv, 0, all, 0, iv.length);
        System.arraycopy(ct, 0, all, iv.length, ct.length);
        p.edit().putString(name, Base64.encodeToString(all, Base64.NO_WRAP)).commit();
    }

    /** 读一项：不存在返回 null；解密失败清掉该项并返回 null。 */
    public static synchronized String get(Context c, String name) {
        if (name == null || name.isEmpty()) return null;
        SharedPreferences p = sp(c);
        String enc = p.getString(name, null);
        if (enc == null || enc.isEmpty()) return null;
        try {
            byte[] all = Base64.decode(enc, Base64.NO_WRAP);
            if (all.length <= IV_LEN) throw new Exception("payload too short");
            byte[] iv = new byte[IV_LEN];
            System.arraycopy(all, 0, iv, 0, IV_LEN);
            Cipher ci = Cipher.getInstance(TRANSFORM);
            ci.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(TAG_BITS, iv));
            byte[] pt = ci.doFinal(all, IV_LEN, all.length - IV_LEN);
            return new String(pt, StandardCharsets.UTF_8);
        } catch (Exception e) {
            p.edit().remove(name).commit();
            android.util.Log.w("SOLO", "vault entry unreadable, dropped"); // 只记事件，不带 key 名以外的内容
            return null;
        }
    }
}
