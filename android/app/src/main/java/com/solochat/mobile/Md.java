package com.solochat.mobile;

import android.graphics.Color;
import android.text.SpannableStringBuilder;
import android.text.Spanned;
import android.text.style.BackgroundColorSpan;
import android.text.style.ForegroundColorSpan;
import android.text.style.RelativeSizeSpan;
import android.text.style.StyleSpan;
import android.text.style.TypefaceSpan;
import android.text.style.URLSpan;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 极简 Markdown → Spannable：标题、粗体、斜体、行内代码、代码块、列表、引用和链接。
 * 不联网、不加载图片；图片只显示 alt 文本。用于悬浮截图回答弹窗，避免直接显示 ** 和 ```。
 */
public final class Md {
    private static final Pattern HEADING = Pattern.compile("^(#{1,6})\\s+(.*)$");
    private static final Pattern UL = Pattern.compile("^\\s*[-*+]\\s+(.*)$");
    private static final Pattern OL = Pattern.compile("^\\s*(\\d+)[.)]\\s+(.*)$");
    private static final Pattern IMAGE = Pattern.compile("!\\[([^\\]]*)\\]\\(([^)]+)\\)");
    private static final Pattern LINK = Pattern.compile("\\[([^\\]]+)\\]\\((https?://[^)\\s]+)\\)");
    private static final Pattern HR = Pattern.compile("^(?:-{3,}|\\*{3,}|_{3,})\\s*$");

    private Md() { }

    public static CharSequence render(String source) {
        String text = source == null ? "" : source.replace("\r\n", "\n").replace('\r', '\n');
        String[] lines = text.split("\n", -1);
        SpannableStringBuilder out = new SpannableStringBuilder();
        StringBuilder code = new StringBuilder();
        boolean inCode = false;

        for (String line : lines) {
            String t = line.trim();
            if (t.startsWith("```")) {
                if (inCode) {
                    appendCode(out, code.toString());
                    code.setLength(0);
                    inCode = false;
                } else {
                    inCode = true;
                }
                continue;
            }
            if (inCode) {
                code.append(line).append('\n');
                continue;
            }
            if (t.isEmpty()) {
                if (out.length() > 0) out.append('\n');
                continue;
            }

            Matcher hm = HEADING.matcher(line);
            if (hm.matches()) {
                int level = hm.group(1).length();
                int start = out.length();
                inline(out, hm.group(2).trim());
                int end = out.length();
                out.setSpan(new StyleSpan(android.graphics.Typeface.BOLD), start, end, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
                out.setSpan(new RelativeSizeSpan(level <= 2 ? 1.22f : 1.10f), start, end, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
                out.append('\n');
                continue;
            }
            if (HR.matcher(t).matches()) {
                out.append("────────────\n");
                continue;
            }
            if (t.startsWith(">")) {
                int start = out.length();
                out.append("▎ ");
                inline(out, t.substring(1).trim());
                int end = out.length();
                out.setSpan(new ForegroundColorSpan(0xFF6B7280), start, end, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
                out.setSpan(new StyleSpan(android.graphics.Typeface.ITALIC), start, end, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
                out.append('\n');
                continue;
            }
            Matcher um = UL.matcher(line);
            if (um.matches()) {
                out.append("• ");
                inline(out, um.group(1));
                out.append('\n');
                continue;
            }
            Matcher om = OL.matcher(line);
            if (om.matches()) {
                out.append(om.group(1)).append(". ");
                inline(out, om.group(2));
                out.append('\n');
                continue;
            }
            inline(out, line);
            out.append('\n');
        }
        if (inCode) appendCode(out, code.toString());
        // 去掉文末多余空行，但保留一个换行
        while (out.length() > 1 && out.charAt(out.length() - 1) == '\n' && out.charAt(out.length() - 2) == '\n') {
            out.delete(out.length() - 1, out.length());
        }
        return out;
    }

    private static void appendCode(SpannableStringBuilder out, String text) {
        if (text == null || text.isEmpty()) return;
        int start = out.length();
        out.append(text);
        int end = out.length();
        out.setSpan(new TypefaceSpan("monospace"), start, end, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        out.setSpan(new BackgroundColorSpan(0xFFF1F3F5), start, end, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        out.setSpan(new ForegroundColorSpan(0xFF1F2328), start, end, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        out.setSpan(new RelativeSizeSpan(0.92f), start, end, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        out.append('\n');
    }

    private static void inline(SpannableStringBuilder out, String s) {
        if (s == null) return;
        int i = 0;
        while (i < s.length()) {
            char c = s.charAt(i);

            if (c == '!' && i + 1 < s.length() && s.charAt(i + 1) == '[') {
                Matcher m = IMAGE.matcher(s);
                m.region(i, s.length());
                if (m.lookingAt()) {
                    String alt = m.group(1);
                    out.append("[图片" + (alt.isEmpty() ? "" : "：" + alt) + "]");
                    i = m.end();
                    continue;
                }
            }
            if (c == '[') {
                Matcher m = LINK.matcher(s);
                m.region(i, s.length());
                if (m.lookingAt()) {
                    int start = out.length();
                    out.append(m.group(1));
                    int end = out.length();
                    out.setSpan(new URLSpan(m.group(2)), start, end, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
                    out.setSpan(new ForegroundColorSpan(0xFF2F6DF6), start, end, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
                    i = m.end();
                    continue;
                }
            }
            if (c == '`') {
                int end = s.indexOf('`', i + 1);
                if (end > i + 1) {
                    int start = out.length();
                    out.append(s, i + 1, end);
                    int stop = out.length();
                    out.setSpan(new TypefaceSpan("monospace"), start, stop, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
                    out.setSpan(new BackgroundColorSpan(0xFFF1F3F5), start, stop, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
                    out.setSpan(new ForegroundColorSpan(0xFF374151), start, stop, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
                    i = end + 1;
                    continue;
                }
            }
            if (c == '*' && i + 1 < s.length() && s.charAt(i + 1) == '*') {
                int end = s.indexOf("**", i + 2);
                if (end > i + 2) {
                    int start = out.length();
                    inline(out, s.substring(i + 2, end));
                    int stop = out.length();
                    out.setSpan(new StyleSpan(android.graphics.Typeface.BOLD), start, stop, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
                    i = end + 2;
                    continue;
                }
            }
            if (c == '*' || c == '_') {
                int end = s.indexOf(c, i + 1);
                if (end > i + 1) {
                    int start = out.length();
                    inline(out, s.substring(i + 1, end));
                    int stop = out.length();
                    out.setSpan(new StyleSpan(android.graphics.Typeface.ITALIC), start, stop, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
                    i = end + 1;
                    continue;
                }
            }
            if (c == '~' && i + 1 < s.length() && s.charAt(i + 1) == '~') {
                int end = s.indexOf("~~", i + 2);
                if (end > i + 2) {
                    int start = out.length();
                    inline(out, s.substring(i + 2, end));
                    int stop = out.length();
                    out.setSpan(new android.text.style.StrikethroughSpan(), start, stop, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
                    i = end + 2;
                    continue;
                }
            }
            out.append(c);
            i++;
        }
    }
}
