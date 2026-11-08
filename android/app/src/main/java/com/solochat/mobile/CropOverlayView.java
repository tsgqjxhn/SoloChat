package com.solochat.mobile;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Rect;
import android.graphics.RectF;
import android.graphics.Region;
import android.view.MotionEvent;
import android.view.View;

/** 全屏截图上的可拖动裁剪框。 */
public class CropOverlayView extends View {
    private final Bitmap bmp;
    private final Paint dim = new Paint();
    private final Paint border = new Paint();
    private final RectF rect = new RectF();
    private float lastX, lastY;
    private final Rect dst = new Rect();

    public CropOverlayView(Context c, Bitmap b) {
        super(c);
        bmp = b;
        dim.setColor(0xAA000000);
        border.setColor(Color.WHITE);
        border.setStyle(Paint.Style.STROKE);
        border.setStrokeWidth(dp(2));
        border.setAntiAlias(true);
    }

    private float dp(float v) { return v * getResources().getDisplayMetrics().density; }

    @Override
    protected void onSizeChanged(int w, int h, int ow, int oh) {
        super.onSizeChanged(w, h, ow, oh);
        float bw = w * 0.82f, bh = h * 0.5f;
        rect.set((w - bw) / 2, (h - bh) / 2, (w + bw) / 2, (h + bh) / 2);
        fit();
    }

    private void fit() {
        int vw = getWidth(), vh = getHeight();
        float s = Math.min(vw / (float) bmp.getWidth(), vh / (float) bmp.getHeight());
        int dw = Math.round(bmp.getWidth() * s), dh = Math.round(bmp.getHeight() * s);
        dst.set((vw - dw) / 2, (vh - dh) / 2, (vw + dw) / 2, (vh + dh) / 2);
    }

    @Override
    protected void onDraw(Canvas c) {
        super.onDraw(c);
        if (getWidth() == 0) return;
        if (dst.isEmpty()) fit();
        c.drawBitmap(bmp, null, dst, null);
        c.save();
        c.clipRect(rect, Region.Op.DIFFERENCE);
        c.drawRect(0, 0, getWidth(), getHeight(), dim);
        c.restore();
        c.drawRect(rect, border);
    }

    @Override
    public boolean onTouchEvent(MotionEvent e) {
        switch (e.getActionMasked()) {
            case MotionEvent.ACTION_DOWN:
                lastX = e.getX(); lastY = e.getY();
                return true;
            case MotionEvent.ACTION_MOVE: {
                float dx = e.getX() - lastX, dy = e.getY() - lastY;
                lastX = e.getX(); lastY = e.getY();
                if (rect.contains(e.getX(), e.getY())) {
                    rect.offset(dx, dy);
                    float w = getWidth(), h = getHeight();
                    if (rect.left < 0) rect.offset(-rect.left, 0);
                    if (rect.top < 0) rect.offset(0, -rect.top);
                    if (rect.right > w) rect.offset(w - rect.right, 0);
                    if (rect.bottom > getHeight()) rect.offset(0, getHeight() - rect.bottom);
                    invalidate();
                }
                return true;
            }
        }
        return super.onTouchEvent(e);
    }

    /** 视口坐标 → 原图坐标。 */
    public Rect cropRect() {
        float s = Math.min(dst.width() / (float) bmp.getWidth(), dst.height() / (float) bmp.getHeight());
        int left = Math.round((rect.left - dst.left) / s);
        int top = Math.round((rect.top - dst.top) / s);
        int right = Math.round((rect.right - dst.left) / s);
        int bottom = Math.round((rect.bottom - dst.top) / s);
        left = Math.max(0, Math.min(bmp.getWidth() - 1, left));
        top = Math.max(0, Math.min(bmp.getHeight() - 1, top));
        right = Math.max(left + 1, Math.min(bmp.getWidth(), right));
        bottom = Math.max(top + 1, Math.min(bmp.getHeight(), bottom));
        return new Rect(left, top, right, bottom);
    }
}
