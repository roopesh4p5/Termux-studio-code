package com.roopesh.codeworkspace;

import android.util.Base64;
import android.util.Log;

import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.DataInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;

/**
 * Minimal WebSocket client (RFC 6455) used to talk to ttyd on 127.0.0.1.
 * The WebView itself may not open connections to localhost (Local Network Access
 * restrictions), so the terminal's traffic is relayed through Java instead.
 *
 * Events are delivered to JS as window.__term(id, event, data):
 *   "open", "data" (base64 of terminal output bytes), "close", "error" (message).
 */
class TermSocket {
    private static final SecureRandom RANDOM = new SecureRandom();
    private static final int MAX_BATCH = 64 * 1024;

    private final MainActivity activity;
    private final String id;
    private Socket socket;
    private OutputStream out;
    private volatile boolean closed;

    TermSocket(MainActivity activity, String id) {
        this.activity = activity;
        this.id = id;
    }

    /** Connects and then blocks reading frames until the connection ends. Run on a worker thread. */
    void run(int port, String path) {
        try {
            socket = new Socket();
            socket.setTcpNoDelay(true);
            socket.connect(new InetSocketAddress("127.0.0.1", port), 3000);
            out = socket.getOutputStream();
            DataInputStream in = new DataInputStream(new BufferedInputStream(socket.getInputStream(), 65536));
            handshake(in, port, path);
            emit("open", null);
            readLoop(in);
        } catch (Exception e) {
            if (!closed) emit("error", String.valueOf(e.getMessage()));
        } finally {
            close();
            emit("close", null);
        }
    }

    private void handshake(DataInputStream in, int port, String path) throws IOException {
        byte[] keyBytes = new byte[16];
        RANDOM.nextBytes(keyBytes);
        String key = Base64.encodeToString(keyBytes, Base64.NO_WRAP);
        String req = "GET " + path + " HTTP/1.1\r\n"
                + "Host: 127.0.0.1:" + port + "\r\n"
                + "Upgrade: websocket\r\n"
                + "Connection: Upgrade\r\n"
                + "Sec-WebSocket-Key: " + key + "\r\n"
                + "Sec-WebSocket-Version: 13\r\n"
                + "Sec-WebSocket-Protocol: tty\r\n"
                + "\r\n";
        out.write(req.getBytes(StandardCharsets.US_ASCII));
        out.flush();
        String status = readLine(in);
        if (status == null || !status.contains(" 101 ")) {
            throw new IOException("Terminal server refused the connection (" + status + ")");
        }
        String line;
        while ((line = readLine(in)) != null && !line.isEmpty()) {
            // Headers are not needed beyond the 101 status.
        }
    }

    private static String readLine(InputStream in) throws IOException {
        StringBuilder sb = new StringBuilder();
        int c;
        while ((c = in.read()) != -1) {
            if (c == '\n') break;
            if (c != '\r') sb.append((char) c);
        }
        return c == -1 && sb.length() == 0 ? null : sb.toString();
    }

    private void readLoop(DataInputStream in) throws IOException {
        ByteArrayOutputStream message = new ByteArrayOutputStream();
        ByteArrayOutputStream batch = new ByteArrayOutputStream();
        while (!closed) {
            int b0 = in.read();
            if (b0 < 0) break;
            int b1 = in.readUnsignedByte();
            boolean fin = (b0 & 0x80) != 0;
            int opcode = b0 & 0x0f;
            long len = b1 & 0x7f;
            if (len == 126) len = in.readUnsignedShort();
            else if (len == 127) len = in.readLong();
            byte[] mask = null;
            if ((b1 & 0x80) != 0) {
                mask = new byte[4];
                in.readFully(mask);
            }
            byte[] payload = new byte[(int) len];
            in.readFully(payload);
            if (mask != null) for (int i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];

            if (opcode == 0x8) { // close
                sendFrame(0x8, new byte[0]);
                break;
            } else if (opcode == 0x9) { // ping
                sendFrame(0xA, payload);
                continue;
            } else if (opcode == 0xA) { // pong
                continue;
            }
            message.write(payload);
            if (!fin) continue;
            byte[] msg = message.toByteArray();
            message.reset();
            // ttyd: '0' + output bytes. Other server messages (title, preferences) are ignored.
            if (msg.length > 0 && msg[0] == '0') batch.write(msg, 1, msg.length - 1);
            // Coalesce bursts of output into one JS call; flush as soon as the socket goes quiet.
            if (batch.size() > 0 && (in.available() == 0 || batch.size() >= MAX_BATCH)) {
                emit("data", Base64.encodeToString(batch.toByteArray(), Base64.NO_WRAP));
                batch.reset();
            }
        }
        if (batch.size() > 0) emit("data", Base64.encodeToString(batch.toByteArray(), Base64.NO_WRAP));
    }

    /** Sends a text message (ttyd input is '0' + text, resize is '1' + JSON). */
    void send(String text) {
        try {
            sendFrame(0x2, text.getBytes(StandardCharsets.UTF_8));
        } catch (IOException e) {
            Log.w(MainActivity.TAG, "terminal send failed", e);
        }
    }

    private synchronized void sendFrame(int opcode, byte[] data) throws IOException {
        if (out == null || closed) return;
        ByteArrayOutputStream f = new ByteArrayOutputStream(data.length + 14);
        f.write(0x80 | opcode);
        int n = data.length;
        if (n < 126) {
            f.write(0x80 | n);
        } else if (n < 65536) {
            f.write(0x80 | 126);
            f.write(n >>> 8);
            f.write(n & 0xff);
        } else {
            f.write(0x80 | 127);
            for (int i = 7; i >= 0; i--) f.write((int) (((long) n >>> (8 * i)) & 0xff));
        }
        byte[] mask = new byte[4];
        RANDOM.nextBytes(mask);
        f.write(mask);
        for (int i = 0; i < n; i++) f.write(data[i] ^ mask[i & 3]);
        out.write(f.toByteArray());
        out.flush();
    }

    void close() {
        if (closed) return;
        closed = true;
        try {
            if (socket != null) socket.close();
        } catch (IOException ignored) {
        }
    }

    private void emit(String event, String data) {
        activity.evalJs("window.__term&&window.__term(" + JSONObject.quote(id) + "," + JSONObject.quote(event) + ","
                + (data == null ? "null" : JSONObject.quote(data)) + ")");
    }
}
