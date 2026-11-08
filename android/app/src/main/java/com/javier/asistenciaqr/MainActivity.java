package com.javier.asistenciaqr;

import android.Manifest;
import android.app.Activity;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.os.Environment;
import android.os.ParcelFileDescriptor;
import android.print.PageRange;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.provider.MediaStore;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/** Asistencia QR: abre la app web y le da cámara, archivos, descargas e impresión. */
public class MainActivity extends Activity {
    private static final int REQ_CAMARA = 1, REQ_ARCHIVO = 2;
    private WebView web;
    private PermissionRequest permisoPendiente;
    private ValueCallback<Uri[]> archivoCallback;

    @Override
    protected void onCreate(Bundle estado) {
        super.onCreate(estado);
        getWindow().setStatusBarColor(Color.parseColor("#0B1B3F"));
        web = new WebView(this);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        web.addJavascriptInterface(new Puente(), "AndroidApp");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                Uri u = r.getUrl();
                String host = u.getHost() == null ? "" : u.getHost();
                if (host.endsWith("github.io")) return false;          // la app se queda dentro
                try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception ignored) { }
                return true;                                             // enlaces externos al navegador
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(PermissionRequest req) {
                runOnUiThread(() -> {
                    if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                        req.grant(req.getResources());
                    } else {
                        permisoPendiente = req;
                        requestPermissions(new String[]{Manifest.permission.CAMERA}, REQ_CAMARA);
                    }
                });
            }

            @Override
            public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams p) {
                if (archivoCallback != null) archivoCallback.onReceiveValue(null);
                archivoCallback = cb;
                try {
                    startActivityForResult(p.createIntent(), REQ_ARCHIVO);
                } catch (Exception e) {
                    archivoCallback = null;
                    return false;
                }
                return true;
            }
        });

        if (estado != null) web.restoreState(estado);
        else web.loadUrl(getString(R.string.app_url));
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] res) {
        if (code == REQ_CAMARA && permisoPendiente != null) {
            if (res.length > 0 && res[0] == PackageManager.PERMISSION_GRANTED) permisoPendiente.grant(permisoPendiente.getResources());
            else {
                permisoPendiente.deny();
                aviso("Sin permiso de cámara no se pueden escanear carnets");
            }
            permisoPendiente = null;
        }
    }

    @Override
    protected void onActivityResult(int code, int result, Intent data) {
        if (code == REQ_ARCHIVO && archivoCallback != null) {
            archivoCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result, data));
            archivoCallback = null;
        }
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    private void aviso(String t) { runOnUiThread(() -> Toast.makeText(this, t, Toast.LENGTH_LONG).show()); }

    /** Funciones que la página llama como window.AndroidApp.* */
    private class Puente {
        @JavascriptInterface
        public void guardarArchivo(String nombre, String contenido) {
            try {
                byte[] bytes = contenido.getBytes(StandardCharsets.UTF_8);
                if (Build.VERSION.SDK_INT >= 29) {
                    ContentValues cv = new ContentValues();
                    cv.put(MediaStore.Downloads.DISPLAY_NAME, nombre);
                    cv.put(MediaStore.Downloads.MIME_TYPE, "text/csv");
                    Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv);
                    try (OutputStream o = getContentResolver().openOutputStream(uri)) { o.write(bytes); }
                    aviso("Guardado en Descargas: " + nombre);
                } else {
                    File f = new File(getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), nombre);
                    try (OutputStream o = new FileOutputStream(f)) { o.write(bytes); }
                    aviso("Guardado en: " + f.getAbsolutePath());
                }
            } catch (Exception e) {
                aviso("No se pudo guardar: " + e.getMessage());
            }
        }

        @JavascriptInterface
        public void imprimir(String titulo) {
            runOnUiThread(() -> {
                PrintManager pm = (PrintManager) getSystemService(PRINT_SERVICE);
                PrintDocumentAdapter base = web.createPrintDocumentAdapter(titulo);
                PrintDocumentAdapter adaptador = new PrintDocumentAdapter() {
                    @Override public void onStart() { base.onStart(); }
                    @Override public void onLayout(PrintAttributes a, PrintAttributes b, CancellationSignal c, LayoutResultCallback cb, Bundle x) { base.onLayout(a, b, c, cb, x); }
                    @Override public void onWrite(PageRange[] p, ParcelFileDescriptor d, CancellationSignal c, WriteResultCallback cb) { base.onWrite(p, d, c, cb); }
                    @Override public void onFinish() {
                        base.onFinish();
                        web.evaluateJavascript("window.dispatchEvent(new Event('afterprint'))", null);
                    }
                };
                pm.print(titulo, adaptador, new PrintAttributes.Builder()
                        .setMediaSize(PrintAttributes.MediaSize.NA_LETTER).build());
            });
        }
    }
}
