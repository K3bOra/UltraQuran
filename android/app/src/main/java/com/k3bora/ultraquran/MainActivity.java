package com.k3bora.ultraquran;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.GeolocationPermissions;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import java.lang.ref.WeakReference;

public class MainActivity extends Activity {
    static final String HOME = "https://k3bora.github.io/UltraQuran/";
    static final String HOST = "k3bora.github.io";
    private static final int REQ_LOCATION = 11;
    private static final int REQ_NOTIFY = 12;

    static WeakReference<MainActivity> current = new WeakReference<>(null);

    WebView web;
    private FrameLayout root;
    private View fullView;
    private WebChromeClient.CustomViewCallback fullCallback;
    private String geoOrigin;
    private GeolocationPermissions.Callback geoCallback;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        current = new WeakReference<>(this);
        getWindow().setStatusBarColor(Color.parseColor("#082423"));
        getWindow().setNavigationBarColor(Color.parseColor("#082423"));

        root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#0F3734"));
        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#0F3734"));
        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setGeolocationEnabled(true);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setUserAgentString(s.getUserAgentString() + " UltraQuranApp/" + BuildConfigLite.VERSION);
        web.addJavascriptInterface(new Bridge(this), "UltraQuranNative");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                if (HOST.equals(u.getHost()) && u.getPath() != null && u.getPath().startsWith("/UltraQuran")) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception ignored) { }
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
                if (hasLocation()) { callback.invoke(origin, true, false); return; }
                geoOrigin = origin; geoCallback = callback;
                requestPermissions(new String[]{Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.ACCESS_FINE_LOCATION}, REQ_LOCATION);
            }

            @Override
            public void onShowCustomView(View view, CustomViewCallback callback) {
                if (fullView != null) { callback.onCustomViewHidden(); return; }
                fullView = view; fullCallback = callback;
                root.addView(view, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
                web.setVisibility(View.GONE);
                getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
                getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            }

            @Override
            public void onHideCustomView() { exitFullscreen(); }
        });

        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQ_NOTIFY);
        }

        if (state != null) web.restoreState(state);
        else web.loadUrl(urlFor(getIntent()));
        AdhanScheduler.reschedule(this);
    }

    private String urlFor(Intent intent) {
        if (intent != null) {
            Uri data = intent.getData();
            if (data != null && HOST.equals(data.getHost())) return data.toString();
            String route = intent.getStringExtra("route");
            if (route != null) return HOME + route;
        }
        return HOME;
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        String route = intent.getStringExtra("route");
        if (route != null) web.evaluateJavascript("location.hash=" + Bridge.quote(route.replace("#", "").isEmpty() ? "#/" : route), null);
        else if (intent.getData() != null) web.loadUrl(urlFor(intent));
    }

    private boolean hasLocation() {
        return checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
            || checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] results) {
        if (code == REQ_LOCATION && geoCallback != null) {
            geoCallback.invoke(geoOrigin, hasLocation(), false);
            geoCallback = null;
        }
    }

    private void exitFullscreen() {
        if (fullView == null) return;
        root.removeView(fullView);
        fullView = null;
        web.setVisibility(View.VISIBLE);
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_VISIBLE);
        getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        if (fullCallback != null) { fullCallback.onCustomViewHidden(); fullCallback = null; }
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (fullView != null) { exitFullscreen(); return; }
        if (web.canGoBack()) { web.goBack(); return; }
        moveTaskToBack(true); // keep audio playing in the background
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    protected void onDestroy() {
        if (current.get() == this) current = new WeakReference<>(null);
        super.onDestroy();
    }

    /** Runs a JS command in the page (used by the playback notification buttons). */
    static void command(String cmd) {
        MainActivity a = current.get();
        if (a == null || a.web == null) return;
        a.runOnUiThread(() -> a.web.evaluateJavascript("window.__nativeCmd&&window.__nativeCmd(" + Bridge.quote(cmd) + ")", null));
    }
}
