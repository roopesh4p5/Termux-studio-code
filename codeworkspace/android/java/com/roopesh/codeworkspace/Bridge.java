package com.roopesh.codeworkspace;

import android.Manifest;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.Settings;
import android.system.ErrnoException;
import android.system.Os;
import android.system.OsConstants;
import android.system.StructStat;
import android.util.Base64;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileNotFoundException;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * JavaScript interface exposed as window.Native.
 * Every operation goes through {@link #dispatch}; JS may call it synchronously
 * ({@link #sync}) for cheap filesystem calls or asynchronously ({@link #call})
 * for anything that may take time. Results are JSON: {"ok":value} or {"err":msg,"code":code}.
 */
public class Bridge {
    static final int REQ_STORAGE = 1;
    static final int REQ_TERMUX = 2;
    static final String TERMUX_PKG = "com.termux";
    static final String TERMUX_PREFIX = "/data/data/com.termux/files/usr";
    static final long MAX_TEXT_BYTES = 8L * 1024 * 1024;

    private final MainActivity activity;
    private final WebView webView;
    private final ExecutorService pool = Executors.newFixedThreadPool(4);
    private final SearchOps search = new SearchOps();

    Bridge(MainActivity activity, WebView webView) {
        this.activity = activity;
        this.webView = webView;
    }

    void shutdown() {
        for (TermSocket t : terms.values()) t.close();
        pool.shutdownNow();
    }

    static class BridgeException extends Exception {
        final String code;

        BridgeException(String code, String message) {
            super(message);
            this.code = code;
        }
    }

    // ---- terminal sockets (relayed through Java; see TermSocket) ----

    private final java.util.Map<String, TermSocket> terms = new java.util.concurrent.ConcurrentHashMap<>();

    @JavascriptInterface
    public void termOpen(String id, int port, String path) {
        TermSocket t = new TermSocket(activity, id);
        terms.put(id, t);
        new Thread(() -> {
            try {
                t.run(port, path);
            } finally {
                terms.remove(id);
            }
        }, "term-" + id).start();
    }

    @JavascriptInterface
    public void termSend(String id, String text) {
        TermSocket t = terms.get(id);
        if (t != null) t.send(text);
    }

    @JavascriptInterface
    public void termClose(String id) {
        TermSocket t = terms.remove(id);
        if (t != null) t.close();
    }

    @JavascriptInterface
    public String sync(String op, String argsJson) {
        return run(op, argsJson);
    }

    @JavascriptInterface
    public void call(String id, String op, String argsJson) {
        pool.execute(() -> {
            String result = run(op, argsJson);
            activity.evalJs("window.__nativeResolve(" + JSONObject.quote(id) + "," + result + ")");
        });
    }

    private String run(String op, String argsJson) {
        try {
            JSONObject args = argsJson == null || argsJson.isEmpty() ? new JSONObject() : new JSONObject(argsJson);
            Object value = dispatch(op, args);
            JSONObject out = new JSONObject();
            out.put("ok", value == null ? JSONObject.NULL : value);
            return out.toString();
        } catch (BridgeException e) {
            return error(e.code, e.getMessage());
        } catch (ErrnoException e) {
            return error(OsConstants.errnoName(e.errno), e.getMessage());
        } catch (FileNotFoundException e) {
            return error("ENOENT", e.getMessage());
        } catch (SecurityException e) {
            return error("EACCES", e.getMessage());
        } catch (Throwable e) {
            Log.w(MainActivity.TAG, "bridge op failed: " + op, e);
            return error("EIO", String.valueOf(e.getMessage()));
        }
    }

    private static String error(String code, String msg) {
        try {
            JSONObject out = new JSONObject();
            out.put("err", msg == null ? code : msg);
            out.put("code", code == null ? "EIO" : code);
            return out.toString();
        } catch (JSONException e) {
            return "{\"err\":\"error\",\"code\":\"EIO\"}";
        }
    }

    private Object dispatch(String op, JSONObject a) throws Exception {
        switch (op) {
            // ---- platform ----
            case "platform": return platform();
            case "storage.request": requestStorage(); return null;
            case "clipboard.set": setClipboard(a.getString("text")); return null;
            case "app.openUrl":
                activity.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(a.getString("url"))));
                return null;
            case "secret.get": return prefs().getString(a.getString("key"), null);
            case "secret.set": {
                SharedPreferences.Editor ed = prefs().edit();
                if (a.isNull("value")) ed.remove(a.getString("key"));
                else ed.putString(a.getString("key"), a.getString("value"));
                ed.apply();
                return null;
            }

            // ---- filesystem ----
            case "fs.list": return list(a.getString("path"));
            case "fs.readdir": return readdir(a.getString("path"));
            case "fs.readText": return readText(a.getString("path"));
            case "fs.writeText": return writeBytes(a.getString("path"),
                    a.getString("text").getBytes(StandardCharsets.UTF_8));
            case "fs.readB64": return Base64.encodeToString(readBytes(file(a.getString("path"))), Base64.NO_WRAP);
            case "fs.writeB64": return writeBytes(a.getString("path"),
                    Base64.decode(a.getString("data"), Base64.NO_WRAP));
            case "fs.stat": return stat(a.getString("path"), false);
            case "fs.lstat": return stat(a.getString("path"), true);
            case "fs.exists": return new File(a.getString("path")).exists();
            case "fs.mkdir": mkdir(a.getString("path"), a.optBoolean("recursive")); return null;
            case "fs.rmdir": rmdir(a.getString("path")); return null;
            case "fs.unlink": Os.remove(a.getString("path")); return null;
            case "fs.delete": deleteRecursive(file(a.getString("path"))); return null;
            case "fs.rename": rename(a.getString("from"), a.getString("to"), a.optBoolean("overwrite")); return null;
            case "fs.copy": copy(file(a.getString("from")), new File(a.getString("to"))); return null;
            case "fs.readlink": return Os.readlink(a.getString("path"));
            case "fs.symlink": Os.symlink(a.getString("target"), a.getString("path")); return null;
            case "fs.chmod":
                try { Os.chmod(a.getString("path"), a.getInt("mode")); } catch (ErrnoException ignored) { }
                return null;

            // ---- search ----
            case "fs.listFiles": return search.listFiles(a.getString("root"), stringList(a.optJSONArray("exclude")),
                    a.optInt("max", 50000));
            case "search.text": return search.searchText(a);
            case "search.replace": return search.replaceText(a);
            case "search.cancel": search.cancel(); return null;

            // ---- network (used by git) ----
            case "http.request": return http(a);

            // ---- termux ----
            case "termux.status": return termuxStatus();
            case "termux.run": return termuxRun(a.getString("cwd"), a.optString("command", ""));
            case "terminal.config": return terminalConfig();
            case "terminal.start": return terminalStart();
            case "clipboard.get": return getClipboard();
            default:
                throw new BridgeException("ENOSYS", "Unknown operation: " + op);
        }
    }

    // ------------------------------------------------------------------ platform

    private JSONObject platform() throws JSONException {
        JSONObject o = new JSONObject();
        o.put("sdk", Build.VERSION.SDK_INT);
        o.put("model", Build.MODEL);
        o.put("storageGranted", storageGranted());
        o.put("externalRoot", Environment.getExternalStorageDirectory().getAbsolutePath());
        o.put("termuxInstalled", termuxInstalled());
        return o;
    }

    private boolean storageGranted() {
        if (Build.VERSION.SDK_INT >= 30) return Environment.isExternalStorageManager();
        return activity.checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE)
                == PackageManager.PERMISSION_GRANTED;
    }

    private void requestStorage() {
        activity.runOnUiThread(() -> {
            if (Build.VERSION.SDK_INT >= 30) {
                try {
                    activity.startActivity(new Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION,
                            Uri.parse("package:" + activity.getPackageName())));
                } catch (Exception e) {
                    activity.startActivity(new Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION));
                }
            } else {
                activity.requestPermissions(new String[]{
                        Manifest.permission.READ_EXTERNAL_STORAGE,
                        Manifest.permission.WRITE_EXTERNAL_STORAGE}, REQ_STORAGE);
            }
        });
    }

    private void setClipboard(String text) {
        activity.runOnUiThread(() -> {
            ClipboardManager cm = (ClipboardManager) activity.getSystemService(Context.CLIPBOARD_SERVICE);
            cm.setPrimaryClip(ClipData.newPlainText("text", text));
        });
    }

    private SharedPreferences prefs() {
        return activity.getSharedPreferences("secrets", Context.MODE_PRIVATE);
    }

    private static List<String> stringList(JSONArray arr) throws JSONException {
        if (arr == null) return Arrays.asList(".git", "node_modules");
        String[] out = new String[arr.length()];
        for (int i = 0; i < arr.length(); i++) out[i] = arr.getString(i);
        return Arrays.asList(out);
    }

    // ---------------------------------------------------------------- filesystem

    private static File file(String path) throws BridgeException {
        File f = new File(path);
        if (!f.exists()) throw new BridgeException("ENOENT", "No such file or directory: " + path);
        return f;
    }

    private JSONArray list(String path) throws Exception {
        File dir = file(path);
        if (!dir.isDirectory()) throw new BridgeException("ENOTDIR", "Not a directory: " + path);
        File[] children = dir.listFiles();
        if (children == null) throw new BridgeException("EACCES", "Cannot read directory: " + path);
        JSONArray out = new JSONArray();
        for (File c : children) {
            JSONObject o = new JSONObject();
            o.put("name", c.getName());
            o.put("dir", c.isDirectory());
            o.put("size", c.length());
            o.put("mtime", c.lastModified());
            out.put(o);
        }
        return out;
    }

    private JSONArray readdir(String path) throws Exception {
        File dir = file(path);
        if (!dir.isDirectory()) throw new BridgeException("ENOTDIR", "Not a directory: " + path);
        String[] names = dir.list();
        if (names == null) throw new BridgeException("EACCES", "Cannot read directory: " + path);
        JSONArray out = new JSONArray();
        for (String n : names) out.put(n);
        return out;
    }

    static byte[] readBytes(File f) throws IOException {
        try (InputStream in = new FileInputStream(f)) {
            ByteArrayOutputStream bos = new ByteArrayOutputStream((int) Math.max(32, f.length()));
            byte[] buf = new byte[65536];
            int n;
            while ((n = in.read(buf)) > 0) bos.write(buf, 0, n);
            return bos.toByteArray();
        }
    }

    private JSONObject readText(String path) throws Exception {
        File f = file(path);
        if (f.isDirectory()) throw new BridgeException("EISDIR", "Is a directory: " + path);
        if (f.length() > MAX_TEXT_BYTES)
            throw new BridgeException("ETOOBIG", "File is too large to open (" + (f.length() / 1024 / 1024) + " MB)");
        byte[] bytes = readBytes(f);
        if (SearchOps.looksBinary(bytes, bytes.length))
            throw new BridgeException("EBINARY", "File appears to be binary");
        JSONObject o = new JSONObject();
        o.put("text", new String(bytes, StandardCharsets.UTF_8));
        o.put("mtime", f.lastModified());
        o.put("size", f.length());
        return o;
    }

    private JSONObject writeBytes(String path, byte[] data) throws Exception {
        File f = new File(path);
        File parent = f.getParentFile();
        if (parent != null && !parent.exists())
            throw new BridgeException("ENOENT", "Parent directory does not exist: " + parent);
        try (OutputStream out = new FileOutputStream(f)) {
            out.write(data);
        }
        JSONObject o = new JSONObject();
        o.put("mtime", f.lastModified());
        return o;
    }

    private JSONObject stat(String path, boolean link) throws Exception {
        StructStat st = link ? Os.lstat(path) : Os.stat(path);
        JSONObject o = new JSONObject();
        o.put("mode", st.st_mode);
        o.put("size", st.st_size);
        o.put("ino", st.st_ino);
        o.put("dev", st.st_dev);
        o.put("uid", st.st_uid);
        o.put("gid", st.st_gid);
        o.put("mtimeSec", st.st_mtim.tv_sec);
        o.put("mtimeNsec", st.st_mtim.tv_nsec);
        o.put("ctimeSec", st.st_ctim.tv_sec);
        o.put("ctimeNsec", st.st_ctim.tv_nsec);
        o.put("mtimeMs", new File(path).lastModified());
        o.put("isDir", OsConstants.S_ISDIR(st.st_mode));
        return o;
    }

    private void mkdir(String path, boolean recursive) throws Exception {
        File f = new File(path);
        if (f.exists()) {
            if (recursive && f.isDirectory()) return;
            throw new BridgeException("EEXIST", "Already exists: " + path);
        }
        boolean ok = recursive ? f.mkdirs() : f.mkdir();
        if (!ok) {
            File parent = f.getParentFile();
            if (parent != null && !parent.exists()) throw new BridgeException("ENOENT", "No such directory: " + parent);
            throw new BridgeException("EACCES", "Cannot create directory: " + path);
        }
    }

    private void rmdir(String path) throws Exception {
        File f = file(path);
        if (!f.isDirectory()) throw new BridgeException("ENOTDIR", "Not a directory: " + path);
        String[] names = f.list();
        if (names != null && names.length > 0) throw new BridgeException("ENOTEMPTY", "Directory not empty: " + path);
        if (!f.delete()) throw new BridgeException("EACCES", "Cannot remove directory: " + path);
    }

    private void rename(String from, String to, boolean overwrite) throws Exception {
        File src = file(from);
        File dst = new File(to);
        if (dst.exists() && !overwrite && !src.getCanonicalPath().equalsIgnoreCase(dst.getCanonicalPath()))
            throw new BridgeException("EEXIST", "Destination already exists: " + to);
        Os.rename(src.getAbsolutePath(), dst.getAbsolutePath());
    }

    private void copy(File src, File dst) throws Exception {
        if (dst.exists()) throw new BridgeException("EEXIST", "Destination already exists: " + dst);
        if (src.isDirectory()) {
            if (!dst.mkdirs()) throw new BridgeException("EACCES", "Cannot create directory: " + dst);
            File[] children = src.listFiles();
            if (children != null) for (File c : children) copy(c, new File(dst, c.getName()));
        } else {
            try (InputStream in = new FileInputStream(src); OutputStream out = new FileOutputStream(dst)) {
                byte[] buf = new byte[65536];
                int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            }
        }
    }

    private void deleteRecursive(File f) throws Exception {
        // Do not follow symlinks into other trees.
        boolean isLink = OsConstants.S_ISLNK(Os.lstat(f.getAbsolutePath()).st_mode);
        if (f.isDirectory() && !isLink) {
            File[] children = f.listFiles();
            if (children != null) for (File c : children) deleteRecursive(c);
        }
        if (!f.delete()) throw new BridgeException("EACCES", "Cannot delete: " + f);
    }

    // ------------------------------------------------------------------- network

    private JSONObject http(JSONObject a) throws Exception {
        HttpURLConnection conn = (HttpURLConnection) new URL(a.getString("url")).openConnection();
        conn.setInstanceFollowRedirects(true);
        conn.setConnectTimeout(20000);
        conn.setReadTimeout(120000);
        String method = a.optString("method", "GET");
        conn.setRequestMethod(method);
        JSONObject headers = a.optJSONObject("headers");
        if (headers != null) {
            for (java.util.Iterator<String> it = headers.keys(); it.hasNext(); ) {
                String k = it.next();
                conn.setRequestProperty(k, headers.getString(k));
            }
        }
        String body = a.optString("body", "");
        if (!body.isEmpty()) {
            byte[] data = Base64.decode(body, Base64.NO_WRAP);
            conn.setDoOutput(true);
            conn.setFixedLengthStreamingMode(data.length);
            try (OutputStream out = conn.getOutputStream()) {
                out.write(data);
            }
        }
        int status = conn.getResponseCode();
        InputStream in = status >= 400 ? conn.getErrorStream() : conn.getInputStream();
        byte[] resp = new byte[0];
        if (in != null) {
            try (InputStream s = in) {
                ByteArrayOutputStream bos = new ByteArrayOutputStream();
                byte[] buf = new byte[65536];
                int n;
                while ((n = s.read(buf)) > 0) bos.write(buf, 0, n);
                resp = bos.toByteArray();
            }
        }
        JSONObject o = new JSONObject();
        o.put("url", conn.getURL().toString());
        o.put("status", status);
        o.put("statusText", conn.getResponseMessage() == null ? "" : conn.getResponseMessage());
        JSONObject rh = new JSONObject();
        for (Map.Entry<String, List<String>> e : conn.getHeaderFields().entrySet()) {
            if (e.getKey() == null) continue;
            rh.put(e.getKey().toLowerCase(), android.text.TextUtils.join(", ", e.getValue()));
        }
        o.put("headers", rh);
        o.put("body", Base64.encodeToString(resp, Base64.NO_WRAP));
        conn.disconnect();
        return o;
    }

    // -------------------------------------------------------------------- termux

    private boolean termuxInstalled() {
        try {
            activity.getPackageManager().getPackageInfo(TERMUX_PKG, 0);
            return true;
        } catch (PackageManager.NameNotFoundException e) {
            return false;
        }
    }

    private JSONObject termuxStatus() throws JSONException {
        JSONObject o = new JSONObject();
        o.put("installed", termuxInstalled());
        o.put("permission", activity.checkSelfPermission("com.termux.permission.RUN_COMMAND")
                == PackageManager.PERMISSION_GRANTED);
        return o;
    }

    static final int TERMINAL_PORT = 8771;

    /** Port + secret path for the ttyd terminal server. The token is generated once per install. */
    private JSONObject terminalConfig() throws JSONException {
        SharedPreferences p = prefs();
        String token = p.getString("terminal-token", null);
        if (token == null) {
            byte[] raw = new byte[24];
            new java.security.SecureRandom().nextBytes(raw);
            token = Base64.encodeToString(raw, Base64.NO_WRAP | Base64.URL_SAFE | Base64.NO_PADDING);
            p.edit().putString("terminal-token", token).apply();
        }
        JSONObject o = new JSONObject();
        o.put("port", TERMINAL_PORT);
        o.put("token", token);
        return o;
    }

    /**
     * Starts (or restarts) ttyd inside Termux as a background task, bound to localhost and
     * reachable only under the secret base path. Each WebSocket connection gets its own
     * login shell in the directory passed as ?arg=. Returns "ok" or "permission".
     */
    private String terminalStart() throws Exception {
        if (!termuxInstalled()) throw new BridgeException("ENOTERMUX", "Termux is not installed");
        if (activity.checkSelfPermission("com.termux.permission.RUN_COMMAND") != PackageManager.PERMISSION_GRANTED) {
            activity.runOnUiThread(() -> activity.requestPermissions(
                    new String[]{"com.termux.permission.RUN_COMMAND"}, REQ_TERMUX));
            return "permission";
        }
        String token = terminalConfig().getString("token");
        String shell = "cd \"${1:-$HOME}\" 2>/dev/null; export TERMUX_HUSHLOGIN=1; exec " + TERMUX_PREFIX + "/bin/login";
        String script =
                "command -v ttyd >/dev/null 2>&1 || yes | pkg install -y ttyd >/dev/null 2>&1\n"
                + "pkill -f '^ttyd -i 127[.]0[.]0[.]1 -p " + TERMINAL_PORT + "' 2>/dev/null\n"
                + "sleep 0.2\n"
                + "exec ttyd -i 127.0.0.1 -p " + TERMINAL_PORT + " -W -a -b /" + token
                + " -t disableLeaveAlert=true bash -c '" + shell + "' termux-studio";
        Intent i = new Intent();
        i.setClassName(TERMUX_PKG, "com.termux.app.RunCommandService");
        i.setAction("com.termux.RUN_COMMAND");
        i.putExtra("com.termux.RUN_COMMAND_PATH", TERMUX_PREFIX + "/bin/bash");
        i.putExtra("com.termux.RUN_COMMAND_ARGUMENTS", new String[]{"-c", script});
        i.putExtra("com.termux.RUN_COMMAND_BACKGROUND", true);
        activity.startForegroundService(i);
        return "ok";
    }

    private String getClipboard() throws Exception {
        final String[] out = {""};
        final java.util.concurrent.CountDownLatch latch = new java.util.concurrent.CountDownLatch(1);
        activity.runOnUiThread(() -> {
            try {
                ClipboardManager cm = (ClipboardManager) activity.getSystemService(Context.CLIPBOARD_SERVICE);
                ClipData clip = cm.getPrimaryClip();
                if (clip != null && clip.getItemCount() > 0) {
                    CharSequence t = clip.getItemAt(0).coerceToText(activity);
                    out[0] = t == null ? "" : t.toString();
                }
            } finally {
                latch.countDown();
            }
        });
        latch.await(2, java.util.concurrent.TimeUnit.SECONDS);
        return out[0];
    }

    /**
     * Opens a new Termux session in {@code cwd}, optionally running {@code command} first.
     * Returns "ok", "permission" (permission was requested), "fallback" (Termux opened
     * without a session; cd command copied to clipboard) or throws when Termux is missing.
     */
    private String termuxRun(String cwd, String command) throws Exception {
        if (!termuxInstalled()) throw new BridgeException("ENOTERMUX", "Termux is not installed");
        if (activity.checkSelfPermission("com.termux.permission.RUN_COMMAND") != PackageManager.PERMISSION_GRANTED) {
            activity.runOnUiThread(() -> activity.requestPermissions(
                    new String[]{"com.termux.permission.RUN_COMMAND"}, REQ_TERMUX));
            return "permission";
        }
        String script = command.isEmpty()
                ? "exec " + TERMUX_PREFIX + "/bin/login"
                : command + "\necho\necho \"[exit code $?]\"\nexec " + TERMUX_PREFIX + "/bin/login";
        Intent i = new Intent();
        i.setClassName(TERMUX_PKG, "com.termux.app.RunCommandService");
        i.setAction("com.termux.RUN_COMMAND");
        i.putExtra("com.termux.RUN_COMMAND_PATH", TERMUX_PREFIX + "/bin/bash");
        i.putExtra("com.termux.RUN_COMMAND_ARGUMENTS", new String[]{"-c", script});
        i.putExtra("com.termux.RUN_COMMAND_WORKDIR", cwd);
        i.putExtra("com.termux.RUN_COMMAND_BACKGROUND", false);
        i.putExtra("com.termux.RUN_COMMAND_SESSION_ACTION", "0");
        try {
            activity.startForegroundService(i);
            return "ok";
        } catch (Exception e) {
            Log.w(MainActivity.TAG, "RUN_COMMAND failed, falling back to launching Termux", e);
            setClipboard("cd '" + cwd.replace("'", "'\\''") + "'");
            Intent launch = activity.getPackageManager().getLaunchIntentForPackage(TERMUX_PKG);
            if (launch != null) activity.startActivity(launch);
            return "fallback";
        }
    }
}
