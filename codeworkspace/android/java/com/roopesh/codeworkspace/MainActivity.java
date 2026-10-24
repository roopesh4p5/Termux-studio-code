package com.roopesh.codeworkspace;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.util.Log;
import android.webkit.ConsoleMessage;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/**
 * Hosts the web-based workspace UI. Assets are served from a private
 * https://app.local origin so ES modules, code splitting and localStorage work.
 */
public class MainActivity extends Activity {
    static final String TAG = "CodeWorkspace";
    static final String HOST = "app.local";
    static final String ORIGIN = "https://" + HOST + "/";

    private WebView webView;
    private Bridge bridge;

    private static final Map<String, String> MIME = new HashMap<>();
    static {
        MIME.put("html", "text/html");
        MIME.put("js", "text/javascript");
        MIME.put("mjs", "text/javascript");
        MIME.put("css", "text/css");
        MIME.put("json", "application/json");
        MIME.put("svg", "image/svg+xml");
        MIME.put("png", "image/png");
        MIME.put("jpg", "image/jpeg");
        MIME.put("jpeg", "image/jpeg");
        MIME.put("gif", "image/gif");
        MIME.put("webp", "image/webp");
        MIME.put("bmp", "image/bmp");
        MIME.put("ico", "image/x-icon");
        MIME.put("woff2", "font/woff2");
        MIME.put("ttf", "font/ttf");
    }

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WebView.setWebContentsDebuggingEnabled(true);

        webView = new WebView(this);
        webView.setBackgroundColor(Color.parseColor("#1E1E1E"));
        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setTextZoom(100);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        // The integrated terminal connects to ws://127.0.0.1 (ttyd running in Termux) from the
        // https://app.local page. All page content is bundled, so allowing this is safe.
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);

        bridge = new Bridge(this, webView);
        webView.addJavascriptInterface(bridge, "Native");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                if (!HOST.equals(u.getHost())) return null;
                return serve(u.getPath());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                if (HOST.equals(u.getHost())) return false;
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, u));
                } catch (Exception e) {
                    Log.w(TAG, "No handler for external link");
                }
                return true;
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage m) {
                Log.d(TAG, "js: " + m.message() + " @" + m.sourceId() + ":" + m.lineNumber());
                return true;
            }
        });

        setContentView(webView);
        webView.loadUrl(ORIGIN + "index.html");
    }

    /** Serves bundled assets, plus local image files under /__fs/ for Markdown preview. */
    private WebResourceResponse serve(String path) {
        if (path == null || path.equals("/") || path.isEmpty()) path = "/index.html";
        try {
            if (path.startsWith("/__fs/")) {
                String filePath = path.substring("/__fs".length());
                String mime = mimeFor(filePath);
                if (mime == null || !mime.startsWith("image/")) return notFound();
                InputStream in = new FileInputStream(new File(filePath));
                return withHeaders(new WebResourceResponse(mime, null, in));
            }
            String asset = "web" + path;
            String mime = mimeFor(asset);
            if (mime == null) mime = "application/octet-stream";
            InputStream in = getAssets().open(asset);
            String enc = mime.startsWith("text/") || mime.endsWith("json") ? "utf-8" : null;
            return withHeaders(new WebResourceResponse(mime, enc, in));
        } catch (IOException e) {
            return notFound();
        }
    }

    private static WebResourceResponse withHeaders(WebResourceResponse r) {
        Map<String, String> h = new HashMap<>();
        h.put("Cache-Control", "no-cache");
        h.put("Access-Control-Allow-Origin", ORIGIN.substring(0, ORIGIN.length() - 1));
        r.setResponseHeaders(h);
        return r;
    }

    private static WebResourceResponse notFound() {
        WebResourceResponse r = new WebResourceResponse("text/plain", "utf-8", null);
        r.setStatusCodeAndReasonPhrase(404, "Not Found");
        return r;
    }

    private static String mimeFor(String path) {
        int dot = path.lastIndexOf('.');
        if (dot < 0) return null;
        return MIME.get(path.substring(dot + 1).toLowerCase(Locale.ROOT));
    }

    void evalJs(String script) {
        webView.post(() -> webView.evaluateJavascript(script, null));
    }

    @Override
    public void onBackPressed() {
        webView.evaluateJavascript("window.__onBack ? window.__onBack() : false", value -> {
            if (!"true".equals(value)) moveTaskToBack(true);
        });
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) evalJs("window.__onResume && window.__onResume()");
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        evalJs("window.__onPermission && window.__onPermission(" + requestCode + ")");
    }

    @Override
    protected void onDestroy() {
        bridge.shutdown();
        webView.destroy();
        super.onDestroy();
    }
}
