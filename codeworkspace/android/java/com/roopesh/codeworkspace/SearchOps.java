package com.roopesh.codeworkspace;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.regex.PatternSyntaxException;

/** Project-wide file listing, text search and replace. Runs on bridge worker threads. */
class SearchOps {
    private static final long MAX_SEARCH_BYTES = 2L * 1024 * 1024;
    private static final int MAX_PREVIEW = 240;

    /** Bumped on every new search so a running search can notice it was superseded. */
    private final AtomicInteger generation = new AtomicInteger();

    void cancel() {
        generation.incrementAndGet();
    }

    static boolean looksBinary(byte[] bytes, int len) {
        int n = Math.min(len, 8000);
        for (int i = 0; i < n; i++) if (bytes[i] == 0) return true;
        return false;
    }

    JSONArray listFiles(String root, List<String> exclude, int max) {
        JSONArray out = new JSONArray();
        Set<String> skip = new HashSet<>(exclude);
        File base = new File(root);
        int baseLen = base.getAbsolutePath().length() + 1;
        ArrayDeque<File> stack = new ArrayDeque<>();
        stack.push(base);
        while (!stack.isEmpty() && out.length() < max) {
            File[] children = stack.pop().listFiles();
            if (children == null) continue;
            for (File c : children) {
                if (skip.contains(c.getName())) continue;
                if (c.isDirectory()) stack.push(c);
                else out.put(c.getAbsolutePath().substring(baseLen));
            }
        }
        return out;
    }

    private static Pattern compile(JSONObject a) throws Bridge.BridgeException, JSONException {
        String query = a.getString("query");
        boolean regex = a.optBoolean("regex");
        boolean caseSensitive = a.optBoolean("caseSensitive");
        boolean wholeWord = a.optBoolean("wholeWord");
        String p = regex ? query : Pattern.quote(query);
        if (wholeWord) p = "\\b(?:" + p + ")\\b";
        int flags = Pattern.MULTILINE | (caseSensitive ? 0 : Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE);
        try {
            return Pattern.compile(p, flags);
        } catch (PatternSyntaxException e) {
            throw new Bridge.BridgeException("EREGEX", "Invalid regular expression: " + e.getDescription());
        }
    }

    private static Set<String> extSet(JSONObject a, String key) {
        String v = a.optString(key, "").trim();
        if (v.isEmpty()) return null;
        return new HashSet<>(Arrays.asList(v.split("\\s*,\\s*")));
    }

    /** Matches simple include/exclude globs: "*.js", "src/", "test" (substring of path). */
    private static boolean globMatch(Set<String> globs, String rel) {
        for (String g : globs) {
            if (g.isEmpty()) continue;
            if (g.startsWith("*.")) {
                if (rel.endsWith(g.substring(1))) return true;
            } else if (rel.contains(g)) {
                return true;
            }
        }
        return false;
    }

    private interface FileVisitor {
        /** @return false to stop walking */
        boolean visit(File f, String rel) throws IOException, JSONException;
    }

    private void walk(JSONObject a, int gen, FileVisitor visitor) throws Exception {
        File base = new File(a.getString("root"));
        int baseLen = base.getAbsolutePath().length() + 1;
        Set<String> skip = new HashSet<>();
        JSONArray ex = a.optJSONArray("exclude");
        if (ex == null) skip.addAll(Arrays.asList(".git", "node_modules"));
        else for (int i = 0; i < ex.length(); i++) skip.add(ex.getString(i));
        Set<String> include = extSet(a, "include");
        Set<String> excludeGlobs = extSet(a, "excludeGlobs");
        JSONArray only = a.optJSONArray("paths");

        if (only != null) {
            for (int i = 0; i < only.length(); i++) {
                String rel = only.getString(i);
                if (!visitor.visit(new File(base, rel), rel)) return;
            }
            return;
        }

        ArrayDeque<File> stack = new ArrayDeque<>();
        stack.push(base);
        while (!stack.isEmpty()) {
            if (generation.get() != gen) throw new Bridge.BridgeException("ECANCELED", "Search cancelled");
            File[] children = stack.pop().listFiles();
            if (children == null) continue;
            Arrays.sort(children, (x, y) -> y.getName().compareToIgnoreCase(x.getName()));
            for (File c : children) {
                if (skip.contains(c.getName())) continue;
                if (c.isDirectory()) {
                    stack.push(c);
                    continue;
                }
                String rel = c.getAbsolutePath().substring(baseLen);
                if (include != null && !globMatch(include, rel)) continue;
                if (excludeGlobs != null && globMatch(excludeGlobs, rel)) continue;
                if (c.length() > MAX_SEARCH_BYTES) continue;
                if (!visitor.visit(c, rel)) return;
            }
        }
    }

    private static String readTextOrNull(File f) throws IOException {
        byte[] bytes = Bridge.readBytes(f);
        if (looksBinary(bytes, bytes.length)) return null;
        return new String(bytes, StandardCharsets.UTF_8);
    }

    JSONObject searchText(JSONObject a) throws Exception {
        int gen = generation.incrementAndGet();
        Pattern pattern = compile(a);
        int maxResults = a.optInt("max", 2000);
        JSONArray files = new JSONArray();
        int[] total = {0};
        boolean[] truncated = {false};

        walk(a, gen, (f, rel) -> {
            String text = readTextOrNull(f);
            if (text == null) return true;
            Matcher m = pattern.matcher(text);
            JSONArray matches = null;
            int line = 0, lineStart = 0, scanned = 0;
            while (m.find()) {
                if (m.end() == m.start()) continue;
                // Advance line counter up to the match start.
                for (int i = scanned; i < m.start(); i++) {
                    if (text.charAt(i) == '\n') {
                        line++;
                        lineStart = i + 1;
                    }
                }
                scanned = m.start();
                int lineEnd = text.indexOf('\n', lineStart);
                if (lineEnd < 0) lineEnd = text.length();
                int col = m.start() - lineStart;
                int len = Math.min(m.end(), lineEnd) - m.start();

                // Trim long lines around the match for the preview.
                int from = Math.max(lineStart, m.start() - 60);
                int to = Math.min(lineEnd, Math.max(m.start() + len + 60, from + MAX_PREVIEW));
                JSONObject r = new JSONObject();
                r.put("line", line);
                r.put("col", col);
                r.put("len", len);
                r.put("preview", text.substring(from, to));
                r.put("previewCol", m.start() - from);
                r.put("leading", from > lineStart);
                if (matches == null) matches = new JSONArray();
                matches.put(r);
                if (++total[0] >= maxResults) {
                    truncated[0] = true;
                    break;
                }
            }
            if (matches != null) {
                JSONObject fo = new JSONObject();
                fo.put("path", rel);
                fo.put("matches", matches);
                files.put(fo);
            }
            return !truncated[0];
        });

        JSONObject out = new JSONObject();
        out.put("files", files);
        out.put("total", total[0]);
        out.put("truncated", truncated[0]);
        return out;
    }

    JSONObject replaceText(JSONObject a) throws Exception {
        int gen = generation.incrementAndGet();
        Pattern pattern = compile(a);
        String replacement = a.getString("replacement");
        if (!a.optBoolean("regex")) replacement = Matcher.quoteReplacement(replacement);
        final String repl = replacement;
        List<String> changed = new ArrayList<>();
        int[] count = {0};

        walk(a, gen, (f, rel) -> {
            if (!f.isFile()) return true;
            String text = readTextOrNull(f);
            if (text == null) return true;
            Matcher m = pattern.matcher(text);
            int n = 0;
            while (m.find()) n++;
            if (n == 0) return true;
            String out = m.reset().replaceAll(repl);
            try (OutputStream os = new FileOutputStream(f)) {
                os.write(out.getBytes(StandardCharsets.UTF_8));
            }
            count[0] += n;
            changed.add(rel);
            return true;
        });

        JSONObject out = new JSONObject();
        out.put("files", new JSONArray(changed));
        out.put("count", count[0]);
        return out;
    }
}
