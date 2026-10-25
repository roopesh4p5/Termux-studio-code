package com.roopesh.codeworkspace;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.ConnectException;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * Client for the file agent (termux/agent.js) that runs inside Termux. Termux's private
 * storage (its home directory) is unreadable to this app, so fs.* and search.* operations on
 * those paths are forwarded to the agent, which answers in the bridge's own result format.
 * The agent is started on first use.
 */
class TermuxAgent {
    static final int PORT = 8772;
    private static final String[] PREFIXES = {"/data/data/com.termux/", "/data/user/0/com.termux/"};

    interface Starter {
        /** Launches the agent in Termux; returns "ok" or "permission". */
        String start() throws Exception;
    }

    private final String token;
    private final Starter starter;
    private final Object startLock = new Object();
    private volatile boolean used;

    TermuxAgent(String token, Starter starter) {
        this.token = token;
        this.starter = starter;
    }

    static boolean isTermuxPath(String path) {
        if (path == null) return false;
        for (String p : PREFIXES) if (path.startsWith(p) || path.equals(p.substring(0, p.length() - 1))) return true;
        return false;
    }

    Object call(String op, JSONObject args) throws Exception {
        String body = new JSONObject().put("op", op).put("args", args).toString();
        String resp;
        try {
            resp = post(body, 120000);
        } catch (ConnectException e) {
            ensureStarted();
            resp = post(body, 120000);
        }
        used = true;
        return unwrap(resp);
    }

    /** Cancels a running search, without starting the agent just for that. */
    void cancelSearch() {
        if (!used) return;
        try {
            post("{\"op\":\"search.cancel\",\"args\":{}}", 2000);
        } catch (Exception ignored) {
        }
    }

    private static Object unwrap(String resp) throws Exception {
        JSONObject o = new JSONObject(resp);
        if (o.has("err")) throw new Bridge.BridgeException(o.optString("code", "EIO"), o.getString("err"));
        return o.opt("ok");
    }

    private void ensureStarted() throws Exception {
        synchronized (startLock) {
            if (ping()) return;
            if ("permission".equals(starter.start())) {
                throw new Bridge.BridgeException("EPERM",
                        "Allow Termux Studio Code to run commands in Termux (permission prompt), then try again.");
            }
            // First start may install nodejs; give it time.
            for (int i = 0; i < 120; i++) {
                Thread.sleep(i < 10 ? 200 : 500);
                if (ping()) return;
            }
            throw new Bridge.BridgeException("ENOAGENT",
                    "Could not reach the Termux file service. Check that Termux is running and nodejs is installed (pkg install nodejs).");
        }
    }

    private boolean ping() {
        try {
            return Boolean.TRUE.equals(unwrap(post("{\"op\":\"agent.ping\",\"args\":{}}", 2000)));
        } catch (Exception e) {
            return false;
        }
    }

    private String post(String body, int readTimeout) throws IOException, JSONException {
        // Connections are not disconnected so keep-alive can reuse them for the next call.
        HttpURLConnection conn = (HttpURLConnection) new URL("http://127.0.0.1:" + PORT + "/" + token).openConnection();
        conn.setConnectTimeout(2000);
        conn.setReadTimeout(readTimeout);
        conn.setRequestMethod("POST");
        conn.setRequestProperty("Content-Type", "application/json");
        byte[] data = body.getBytes(StandardCharsets.UTF_8);
        conn.setDoOutput(true);
        conn.setFixedLengthStreamingMode(data.length);
        try (OutputStream out = conn.getOutputStream()) {
            out.write(data);
        }
        if (conn.getResponseCode() != 200) throw new ConnectException("agent answered " + conn.getResponseCode());
        try (InputStream in = conn.getInputStream()) {
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            byte[] buf = new byte[65536];
            int n;
            while ((n = in.read(buf)) > 0) bos.write(buf, 0, n);
            return new String(bos.toByteArray(), StandardCharsets.UTF_8);
        }
    }
}
