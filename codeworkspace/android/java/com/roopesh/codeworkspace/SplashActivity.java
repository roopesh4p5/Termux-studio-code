package com.roopesh.codeworkspace;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

/** Branded launch screen shown briefly before the workspace opens. */
public class SplashActivity extends Activity {
    private static final long SPLASH_MS = 1800;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#1E1E1E"));

        LinearLayout center = new LinearLayout(this);
        center.setOrientation(LinearLayout.VERTICAL);
        center.setGravity(Gravity.CENTER_HORIZONTAL);

        TextView logo = text("</>", 64, "#3794FF", Typeface.MONOSPACE, Typeface.BOLD);
        TextView title = text("Termux Studio Code", 30, "#E8E8E8", Typeface.SANS_SERIF, Typeface.BOLD);
        TextView tagline = text("A focused code workspace for your tablet", 15, "#9DA1A6",
                Typeface.SANS_SERIF, Typeface.NORMAL);
        tagline.setPadding(0, dp(8), 0, 0);
        center.addView(logo);
        center.addView(title);
        center.addView(tagline);

        FrameLayout.LayoutParams centerLp = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.CENTER);
        root.addView(center, centerLp);

        LinearLayout footer = new LinearLayout(this);
        footer.setOrientation(LinearLayout.VERTICAL);
        footer.setGravity(Gravity.CENTER_HORIZONTAL);
        TextView dev = text("Developed by Roopesh", 17, "#E8E8E8", Typeface.SANS_SERIF, Typeface.BOLD);
        TextView ver = text("Version 0.2.1", 13, "#6E7681", Typeface.SANS_SERIF, Typeface.NORMAL);
        ver.setPadding(0, dp(4), 0, 0);
        footer.addView(dev);
        footer.addView(ver);
        FrameLayout.LayoutParams footerLp = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT,
                Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL);
        footerLp.bottomMargin = dp(48);
        root.addView(footer, footerLp);

        setContentView(root);

        for (View v : new View[]{center, footer}) {
            v.setAlpha(0f);
            v.setTranslationY(dp(12));
            v.animate().alpha(1f).translationY(0).setDuration(600).start();
        }

        new Handler(Looper.getMainLooper()).postDelayed(() -> {
            startActivity(new Intent(this, MainActivity.class));
            overridePendingTransition(android.R.anim.fade_in, android.R.anim.fade_out);
            finish();
        }, SPLASH_MS);
    }

    private TextView text(String s, int sp, String color, Typeface face, int style) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextSize(sp);
        t.setTextColor(Color.parseColor(color));
        t.setTypeface(face, style);
        t.setGravity(Gravity.CENTER);
        return t;
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }
}
