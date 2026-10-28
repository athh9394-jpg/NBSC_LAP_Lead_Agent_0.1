package com.nbsc.laplead;

import android.app.Activity;
import android.app.DownloadManager;
import android.content.ContentValues;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebSettings;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.widget.Toast;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

public class MainActivity extends Activity {
    private WebView webView;
    private static final String APP_URL = "https://nbsc-lap-frontend-02.onrender.com";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);

        webView = new WebView(this);
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);

        webView.addJavascriptInterface(new DownloadBridge(), "LAPDownload");
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                if (url != null && url.startsWith(APP_URL)) {
                    installBlobDownloadHandler(view);
                }
            }
        });
        webView.setWebChromeClient(new WebChromeClient());
        webView.setDownloadListener(new DownloadListener() {
            @Override
            public void onDownloadStart(String url, String userAgent, String contentDisposition,
                                        String mimeType, long contentLength) {
                if (url == null || !(url.startsWith("https://") || url.startsWith("http://"))) {
                    Toast.makeText(MainActivity.this, "Download link is not supported", Toast.LENGTH_LONG).show();
                    return;
                }
                try {
                    DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
                    request.setMimeType(mimeType);
                    String cookies = CookieManager.getInstance().getCookie(url);
                    if (cookies != null) request.addRequestHeader("Cookie", cookies);
                    if (userAgent != null) request.addRequestHeader("User-Agent", userAgent);
                    request.setTitle("NBSC LAP Backup");
                    request.setDescription("Downloading backup file");
                    request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                    request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS,
                            safeFileName(contentDisposition, url));
                    DownloadManager manager = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
                    manager.enqueue(request);
                    Toast.makeText(MainActivity.this, "Download started. Check Downloads.", Toast.LENGTH_LONG).show();
                } catch (Exception e) {
                    Toast.makeText(MainActivity.this, "Download failed: " + e.getMessage(), Toast.LENGTH_LONG).show();
                }
            }
        });
        setContentView(webView);

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState);
        } else {
            webView.loadUrl(APP_URL);
        }
    }

    private String safeFileName(String contentDisposition, String url) {
        return "nbsc-lap-backup.json";
    }

    private void installBlobDownloadHandler(WebView view) {
        String script = "(function(){if(window.__lapDownloadHook)return;window.__lapDownloadHook=true;" +
            "document.addEventListener('click',function(e){var a=e.target.closest&&e.target.closest('a[download]');" +
            "if(!a)return;var href=a.href||'';if(!href.startsWith('blob:'))return;" +
            "e.preventDefault();e.stopImmediatePropagation();var name=a.download||'nbsc-lap-backup.json';" +
            "fetch(href).then(function(r){return r.blob()}).then(function(blob){" +
            "var reader=new FileReader();reader.onloadend=function(){var data=String(reader.result).split(',')[1];" +
            "window.LAPDownload.saveBase64(name,blob.type||'application/json',data)};reader.readAsDataURL(blob);" +
            "}).catch(function(){alert('Backup download failed. Please try again.');});},true);})();";
        view.evaluateJavascript(script, null);
    }

    private class DownloadBridge {
        @JavascriptInterface
        public void saveBase64(String fileName, String mimeType, String base64Data) {
            runOnUiThread(() -> {
                try {
                    byte[] bytes;
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        bytes = java.util.Base64.getDecoder().decode(base64Data);
                    } else {
                        bytes = android.util.Base64.decode(base64Data, android.util.Base64.DEFAULT);
                    }
                    String safeName = (fileName == null || fileName.trim().isEmpty())
                            ? "nbsc-lap-backup.json" : fileName.replaceAll("[^A-Za-z0-9._-]", "_");
                    if (!safeName.toLowerCase().endsWith(".json")) safeName += ".json";
                    String type = (mimeType == null || mimeType.isEmpty()) ? "application/json" : mimeType;

                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                        ContentValues values = new ContentValues();
                        values.put(MediaStore.Downloads.DISPLAY_NAME, safeName);
                        values.put(MediaStore.Downloads.MIME_TYPE, type);
                        values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
                        values.put(MediaStore.Downloads.IS_PENDING, 1);
                        Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                        if (uri == null) throw new Exception("Could not create download file");
                        try (OutputStream out = getContentResolver().openOutputStream(uri)) {
                            if (out == null) throw new Exception("Could not open download file");
                            out.write(bytes);
                        }
                        values.clear();
                        values.put(MediaStore.Downloads.IS_PENDING, 0);
                        getContentResolver().update(uri, values, null, null);
                    } else {
                        File dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                        if (!dir.exists() && !dir.mkdirs()) throw new Exception("Downloads folder unavailable");
                        File outFile = new File(dir, safeName);
                        try (FileOutputStream out = new FileOutputStream(outFile)) { out.write(bytes); }
                    }
                    Toast.makeText(MainActivity.this, "Backup saved in Downloads: " + safeName, Toast.LENGTH_LONG).show();
                } catch (Exception e) {
                    Toast.makeText(MainActivity.this, "Backup save failed: " + e.getMessage(), Toast.LENGTH_LONG).show();
                }
            });
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        if (webView != null) webView.saveState(outState);
        super.onSaveInstanceState(outState);
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.removeJavascriptInterface("LAPDownload");
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
