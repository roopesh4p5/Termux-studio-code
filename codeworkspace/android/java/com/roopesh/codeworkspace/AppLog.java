package com.roopesh.codeworkspace;

import android.os.Environment;
import android.util.Log;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Diagnostic log on shared storage (Documents/TermuxStudioCode/app.log), so it can be read
 * from Termux while testing: Android does not let other apps read this app's logcat.
 * Writes happen on one background thread; the file rotates to app.log.1 at 1 MB.
 */
final class AppLog {
    private static final long MAX_BYTES = 1024 * 1024;
    private static final ExecutorService writer = Executors.newSingleThreadExecutor();
    private static final SimpleDateFormat TIME = new SimpleDateFormat("MM-dd HH:mm:ss.SSS", Locale.US);

    private AppLog() {
    }

    static File file() {
        return new File(Environment.getExternalStorageDirectory(), "Documents/TermuxStudioCode/app.log");
    }

    static void i(String tag, String msg) {
        write("I", tag, msg);
    }

    static void w(String tag, String msg) {
        write("W", tag, msg);
    }

    static void e(String tag, String msg, Throwable t) {
        write("E", tag, t == null ? msg : msg + "\n" + Log.getStackTraceString(t));
    }

    static void write(String level, String tag, String msg) {
        String line;
        synchronized (TIME) {
            line = TIME.format(new Date()) + " " + level + "/" + tag + ": " + msg + "\n";
        }
        writer.execute(() -> append(line));
    }

    /** Blocks until pending lines are written (used before a crash ends the process). */
    static void flush() {
        try {
            writer.submit(() -> { }).get();
        } catch (Exception ignored) {
        }
    }

    private static void append(String line) {
        try {
            File f = file();
            File dir = f.getParentFile();
            if (dir != null && !dir.isDirectory() && !dir.mkdirs()) return; // no storage access yet
            if (f.length() > MAX_BYTES) {
                File old = new File(dir, "app.log.1");
                old.delete();
                f.renameTo(old);
            }
            try (OutputStream out = new FileOutputStream(f, true)) {
                out.write(line.getBytes(StandardCharsets.UTF_8));
            }
        } catch (Exception e) {
            Log.w(MainActivity.TAG, "app log write failed", e);
        }
    }
}
