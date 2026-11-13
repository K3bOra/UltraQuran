package com.k3bora.ultraquran;

import android.content.Context;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.LinkedHashSet;
import java.util.Set;

/** Keeps the chosen adhan recordings on the phone so the adhan plays even without internet. */
final class AdhanCache {
    private AdhanCache() { }

    static File fileFor(Context ctx, String url) {
        return new File(new File(ctx.getFilesDir(), "adhan"), sha1(url) + ".mp3");
    }

    static void prefetch(Context ctx, String json) {
        final Context app = ctx.getApplicationContext();
        new Thread(() -> {
            try {
                Set<String> urls = new LinkedHashSet<>();
                JSONArray items = new JSONObject(json).optJSONArray("items");
                for (int i = 0; items != null && i < items.length(); i++) {
                    String u = items.getJSONObject(i).optString("url");
                    if (u != null && u.startsWith("https://")) urls.add(u);
                }
                File dir = new File(app.getFilesDir(), "adhan");
                if (!dir.exists()) dir.mkdirs();
                Set<String> keep = new LinkedHashSet<>();
                for (String u : urls) {
                    File f = fileFor(app, u);
                    keep.add(f.getName());
                    if (!f.exists() || f.length() < 10000) download(u, f);
                }
                File[] all = dir.listFiles();
                if (all != null) for (File f : all) if (!keep.contains(f.getName())) f.delete();
            } catch (Exception ignored) { }
        }, "adhan-cache").start();
    }

    private static void download(String url, File out) {
        File tmp = new File(out.getPath() + ".part");
        HttpURLConnection c = null;
        try {
            String u = url;
            for (int hop = 0; hop < 6; hop++) {
                c = (HttpURLConnection) new URL(u).openConnection();
                c.setInstanceFollowRedirects(false);
                c.setConnectTimeout(20000);
                c.setReadTimeout(30000);
                c.setRequestProperty("User-Agent", "UltraQuranApp");
                int code = c.getResponseCode();
                if (code >= 300 && code < 400 && c.getHeaderField("Location") != null) {
                    u = new URL(new URL(u), c.getHeaderField("Location")).toString();
                    c.disconnect();
                    continue;
                }
                if (code != 200) return;
                try (InputStream in = c.getInputStream(); FileOutputStream fo = new FileOutputStream(tmp)) {
                    byte[] buf = new byte[32768];
                    int r;
                    while ((r = in.read(buf)) > 0) fo.write(buf, 0, r);
                }
                if (tmp.length() > 10000) tmp.renameTo(out);
                return;
            }
        } catch (Exception ignored) {
        } finally {
            if (c != null) c.disconnect();
            if (tmp.exists()) tmp.delete();
        }
    }

    private static String sha1(String s) {
        try {
            byte[] d = MessageDigest.getInstance("SHA-1").digest(s.getBytes("UTF-8"));
            StringBuilder b = new StringBuilder();
            for (byte x : d) b.append(String.format("%02x", x));
            return b.toString();
        } catch (Exception e) {
            return Integer.toHexString(s.hashCode());
        }
    }
}
