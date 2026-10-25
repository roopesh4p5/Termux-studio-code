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
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.List;
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
    static final String TERMUX_HOME = "/data/data/com.termux/files/home";
    static final long MAX_TEXT_BYTES = 8L * 1024 * 1024;

    private final MainActivity activity;
    private final WebView webView;
    private final ExecutorService pool = Executors.newFixedThreadPool(4);
    private final SearchOps search = new SearchOps();
    private final TermuxAgent agent;
    private volatile String pendingOpen;

    Bridge(MainActivity activity, WebView webView) {
        this.activity = activity;
        this.webView = webView;
        this.agent = new TermuxAgent(token(), this::agentStart);
    }

    /** A folder or file to open, from "code <path>" in Termux; JS collects it via app.takePendingOpen. */
    void setPendingOpen(String path) {
        pendingOpen = path;
    }

    /** Reads a file for the Markdown preview's image requests, through the agent for Termux paths. */
    byte[] readForPreview(String path) throws Exception {
        if (TermuxAgent.isTermuxPath(path)) return Base64.decode((String) agent.call("fs.readB64", new JSONObject().put("path", path)), Base64.NO_WRAP);
        return readBytes(file(path));
    }

    void shutdown() {
        closeTerms();
        pool.shutdownNow();
    }

    /** Drops every terminal connection, e.g. when the page reloads (shells live on in tmux). */
    void closeTerms() {
        for (TermSocket t : terms.values()) t.close();
        terms.clear();
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

    /** Bridge calls slower than this are written to the app log (see AppLog). */
    private static final long SLOW_OP_MS = 1500;
    /** Failures that mean Termux integration is broken, worth logging (unlike e.g. ENOENT). */
    private static final List<String> LOGGED_CODES = Arrays.asList("EPERM", "ENOAGENT", "ENOGIT", "ENOTERMUX", "EIO");

    private String run(String op, String argsJson) {
        long started = System.currentTimeMillis();
        JSONObject args = null;
        try {
            args = argsJson == null || argsJson.isEmpty() ? new JSONObject() : new JSONObject(argsJson);
            Object value = dispatch(op, args);
            JSONObject out = new JSONObject();
            out.put("ok", value == null ? JSONObject.NULL : value);
            return out.toString();
        } catch (BridgeException e) {
            if (LOGGED_CODES.contains(e.code)) AppLog.w("bridge", op + " failed: " + e.code + " " + e.getMessage());
            return error(e.code, e.getMessage());
        } catch (ErrnoException e) {
            return error(OsConstants.errnoName(e.errno), e.getMessage());
        } catch (FileNotFoundException e) {
            return error("ENOENT", e.getMessage());
        } catch (SecurityException e) {
            return error("EACCES", e.getMessage());
        } catch (Throwable e) {
            Log.w(MainActivity.TAG, "bridge op failed: " + op, e);
            AppLog.e("bridge", op + " threw", e);
            return error("EIO", String.valueOf(e.getMessage()));
        } finally {
            long ms = System.currentTimeMillis() - started;
            if (ms > SLOW_OP_MS) {
                String what = op.equals("git.run") && args != null ? op + " " + args.optJSONArray("args") : op;
                AppLog.w("perf", "slow bridge call " + what + ": " + ms + " ms");
            }
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
        if (op.equals("search.cancel")) {
            search.cancel();
            agent.cancelSearch();
            return null;
        }
        // Git runs with Termux's git (see termux/agent.js), for projects anywhere.
        if (op.startsWith("git.")) return agent.call(op, a);
        if (op.startsWith("fs.") || op.startsWith("search.")) {
            boolean termux = TermuxAgent.isTermuxPath(a.optString("path", a.optString("root", a.optString("from", ""))));
            if (a.has("to") && TermuxAgent.isTermuxPath(a.getString("to")) != termux)
                throw new BridgeException("EXDEV", "Cannot move or copy between Termux storage and shared storage");
            if (termux) return agent.call(op, a);
        }
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
            case "fs.readText": return readText(a.getString("path"));
            case "fs.writeText": return writeBytes(a.getString("path"),
                    a.getString("text").getBytes(StandardCharsets.UTF_8));
            case "fs.stat": return stat(a.getString("path"));
            case "fs.exists": return new File(a.getString("path")).exists();
            case "fs.mkdir": mkdir(a.getString("path"), a.optBoolean("recursive")); return null;
            case "fs.delete": deleteRecursive(file(a.getString("path"))); return null;
            case "fs.rename": rename(a.getString("from"), a.getString("to"), a.optBoolean("overwrite")); return null;
            case "fs.copy": copy(file(a.getString("from")), new File(a.getString("to"))); return null;

            // ---- search ----
            case "fs.listFiles": return search.listFiles(a.getString("root"), stringList(a.optJSONArray("exclude")),
                    a.optInt("max", 50000));
            case "search.text": return search.searchText(a);
            case "search.replace": return search.replaceText(a);

            // ---- termux ----
            case "termux.run": return termuxRun(a.getString("cwd"), a.optString("command", ""));
            case "terminal.config": return terminalConfig();
            case "terminal.start": return terminalStart();
            case "terminal.kill": return terminalKill(a.getString("name"));
            case "terminal.keepAlive": TermService.setActive(activity, a.getBoolean("on")); return null;
            case "app.exit": return exitApp();
            case "app.takePendingOpen": {
                String p = pendingOpen;
                pendingOpen = null;
                return p;
            }
            case "termux.bootstrap": return termuxBootstrap();
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
        o.put("termuxHome", TERMUX_HOME);
        o.put("version", appVersion(activity));
        return o;
    }

    /** versionName from the manifest: the single source of the version shown in the UI. */
    static String appVersion(Context context) {
        try {
            return context.getPackageManager().getPackageInfo(context.getPackageName(), 0).versionName;
        } catch (PackageManager.NameNotFoundException e) {
            return "";
        }
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
        String[] names = dir.list();
        if (names == null) throw new BridgeException("EACCES", "Cannot read directory: " + path);
        JSONArray out = new JSONArray();
        for (String name : names) {
            // One stat per entry (File.isDirectory/length/lastModified would be three, slow on FUSE).
            StructStat st;
            try {
                st = Os.stat(path + "/" + name);
            } catch (ErrnoException e) {
                st = null; // e.g. a dangling symlink
            }
            boolean isDir = st != null && OsConstants.S_ISDIR(st.st_mode);
            JSONObject o = new JSONObject();
            o.put("name", name);
            o.put("dir", isDir);
            o.put("size", st == null || isDir ? 0 : st.st_size);
            o.put("mtime", st == null ? 0 : st.st_mtim.tv_sec * 1000 + st.st_mtim.tv_nsec / 1000000);
            out.put(o);
        }
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

    private JSONObject stat(String path) throws Exception {
        StructStat st = Os.stat(path);
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

    // -------------------------------------------------------------------- termux

    private boolean termuxInstalled() {
        try {
            activity.getPackageManager().getPackageInfo(TERMUX_PKG, 0);
            return true;
        } catch (PackageManager.NameNotFoundException e) {
            return false;
        }
    }

    static final int TERMINAL_PORT = 8771;

    /** Port + secret path for the ttyd terminal server. The token is generated once per install. */
    private JSONObject terminalConfig() throws JSONException {
        JSONObject o = new JSONObject();
        o.put("port", TERMINAL_PORT);
        o.put("token", token());
        return o;
    }

    /** Secret shared by the ttyd server and the file agent; generated once per install. */
    private String token() {
        SharedPreferences p = prefs();
        String token = p.getString("terminal-token", null);
        if (token == null) {
            byte[] raw = new byte[24];
            new java.security.SecureRandom().nextBytes(raw);
            token = Base64.encodeToString(raw, Base64.NO_WRAP | Base64.URL_SAFE | Base64.NO_PADDING);
            p.edit().putString("terminal-token", token).commit();
        }
        return token;
    }

    static final String TMUX = "tmux -L termux-studio -f $HOME/.termux-studio/tmux.conf";
    static final String TTYD_PATTERN = "^ttyd -i 127[.]0[.]0[.]1 -p " + TERMINAL_PORT;

    /**
     * Starts (or restarts) ttyd inside Termux as a background task, bound to localhost and
     * reachable only under the secret base path. Each WebSocket connection runs a shell in the
     * directory passed as the first ?arg=. When tmux is available the shell lives in the tmux
     * session named by the second arg, so it survives dropped connections; a third arg of
     * "attach" only reattaches, printing OSC 7770 when that session no longer exists.
     * Returns "ok" or "permission".
     */
    private String terminalStart() throws Exception {
        String token = token();
        String shell = "cd \"${1:-$HOME}\" 2>/dev/null; export TERMUX_HUSHLOGIN=1 TERMUX_STUDIO=1; T=\"" + TMUX + "\"; "
                + "if [ \"$3\" = attach ]; then "
                + "{ command -v tmux >/dev/null && $T has-session -t \"=$2\" 2>/dev/null && exec $T attach-session -t \"=$2\"; }; "
                + "printf \"\\033]7770;gone\\007\"; sleep 0.3; exit 0; fi; "
                + "if [ -n \"$2\" ] && command -v tmux >/dev/null; then exec $T new-session -A -s \"$2\"; fi; "
                + "exec " + TERMUX_PREFIX + "/bin/login";
        String script =
                "command -v ttyd >/dev/null 2>&1 || yes | pkg install -y ttyd >/dev/null 2>&1\n"
                + "command -v tmux >/dev/null 2>&1 || yes | pkg install -y tmux >/dev/null 2>&1\n"
                + bootstrapScript()
                + "pkill -f '" + TTYD_PATTERN + "' 2>/dev/null\n"
                + "sleep 0.2\n"
                + "exec ttyd -i 127.0.0.1 -p " + TERMINAL_PORT + " -W -a -b /" + token
                + " -t disableLeaveAlert=true bash -c '" + shell + "' termux-studio";
        return runInBackground(script);
    }

    // Anchored to the node process: pkill -f matches whole command lines, and the bash -c script
    // that runs pkill names agent.js too, so an unanchored pattern kills that script before it
    // reaches "exec node" and the agent never starts.
    static final String AGENT_PATTERN = "^node [^ ]*termux-studio/agent[.]js";

    /**
     * Files the app keeps in Termux: the file agent, the "code" command and the tmux config.
     * Rewritten on every start so they match this app version. An existing "code" that is not
     * ours (e.g. code-server) is left alone.
     */
    private String bootstrapScript() throws IOException {
        String agentJs = Base64.encodeToString(readAsset("termux/agent.js"), Base64.NO_WRAP);
        String codeSh = Base64.encodeToString(readAsset("termux/code.sh"), Base64.NO_WRAP);
        String code = TERMUX_PREFIX + "/bin/code";
        return "mkdir -p ~/.termux-studio\n"
                + "printf %s " + agentJs + " | base64 -d > ~/.termux-studio/agent.js\n"
                + "if [ ! -e " + code + " ] || grep -q 'Termux Studio Code' " + code + "; then "
                + "printf %s " + codeSh + " | base64 -d > " + code + " && chmod 755 " + code + "; fi\n"
                + "cat > ~/.termux-studio/tmux.conf <<'EOF'\n"
                + "set -g status off\n"
                // No alternate screen: output scrolls into xterm.js's own scrollback, so touch
                // scrolling and text selection work as without tmux.
                + "set -ga terminal-overrides ',xterm*:smcup@:rmcup@'\n"
                + "set -s escape-time 0\n"
                + "set -g set-titles on\n"
                + "set -g set-titles-string '#{pane_current_path}'\n"
                // Lets "code ." inside the integrated terminal reach the app (OSC 7771).
                + "set -g allow-passthrough on\n"
                + "set-environment -g TERMUX_STUDIO 1\n"
                + "EOF\n"
                + TMUX + " source-file ~/.termux-studio/tmux.conf 2>/dev/null\n";
    }

    private byte[] readAsset(String name) throws IOException {
        try (InputStream in = activity.getAssets().open(name)) {
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            byte[] buf = new byte[65536];
            int n;
            while ((n = in.read(buf)) > 0) bos.write(buf, 0, n);
            return bos.toByteArray();
        }
    }

    /** Starts (or restarts) the file agent in Termux. Returns "ok" or "permission". */
    private String agentStart() throws Exception {
        return runInBackground(bootstrapScript()
                + "command -v node >/dev/null 2>&1 || yes | pkg install -y nodejs >/dev/null 2>&1\n"
                + "pkill -f '" + AGENT_PATTERN + "' 2>/dev/null\n"
                + "exec node ~/.termux-studio/agent.js " + TermuxAgent.PORT + " " + token());
    }

    /** Keeps the "code" command and config in Termux current, without asking for permission. */
    private String termuxBootstrap() throws Exception {
        if (!termuxInstalled() || activity.checkSelfPermission("com.termux.permission.RUN_COMMAND") != PackageManager.PERMISSION_GRANTED)
            return "skipped";
        return runInBackground(bootstrapScript());
    }

    /** Ends a terminal's tmux session (the shell and everything running in it). */
    private String terminalKill(String name) throws Exception {
        if (!name.matches("[A-Za-z0-9_-]+")) throw new BridgeException("EINVAL", "Bad session name");
        return runInBackground(TMUX + " kill-session -t =" + name + " 2>/dev/null");
    }

    /** File > Exit: stops the terminal server and all its sessions, then ends the app process. */
    private String exitApp() {
        try {
            if (termuxInstalled()) {
                runInBackground(TMUX + " kill-server 2>/dev/null; pkill -f '" + TTYD_PATTERN + "' 2>/dev/null; pkill -f '" + AGENT_PATTERN + "' 2>/dev/null");
            }
        } catch (Exception e) {
            Log.w(MainActivity.TAG, "could not stop terminal server", e);
        }
        TermService.setActive(activity, false);
        activity.runOnUiThread(() -> {
            activity.finishAndRemoveTask();
            webView.postDelayed(() -> android.os.Process.killProcess(android.os.Process.myPid()), 500);
        });
        return "ok";
    }

    /** Runs a bash script as a Termux background task. Returns "ok" or "permission". */
    private String runInBackground(String script) throws Exception {
        if (!termuxInstalled()) throw new BridgeException("ENOTERMUX", "Termux is not installed");
        if (activity.checkSelfPermission("com.termux.permission.RUN_COMMAND") != PackageManager.PERMISSION_GRANTED) {
            activity.runOnUiThread(() -> activity.requestPermissions(
                    new String[]{"com.termux.permission.RUN_COMMAND"}, REQ_TERMUX));
            return "permission";
        }
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
