package de.taxiheringsdorf.app;

import android.content.Intent;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Button;
import android.widget.LinearLayout.LayoutParams;
import android.graphics.Color;
import androidx.appcompat.app.AppCompatActivity;

// v6.62.643: Patrick (12.05. 14:52): "wenn man zurueck geht, kommt man nicht in die App
// zurueck sondern auf die Homepage". Loesung: eigene Activity mit WebView, Toolbar mit
// Zurueck-Button schliesst die Activity (Stack-pop) statt Browser-Navigation.
public class DriverMapActivity extends AppCompatActivity {

    private WebView wv;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setLayoutParams(new LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT));

        // Toolbar mit Back-Button
        LinearLayout topbar = new LinearLayout(this);
        topbar.setOrientation(LinearLayout.HORIZONTAL);
        topbar.setBackgroundColor(Color.parseColor("#1e40af"));
        topbar.setPadding(24, 24, 24, 24);
        topbar.setGravity(android.view.Gravity.CENTER_VERTICAL);

        Button back = new Button(this);
        back.setText("← Zurueck");
        back.setTextColor(Color.WHITE);
        back.setBackgroundColor(Color.parseColor("#3b82f6"));
        back.setOnClickListener(v -> finish());
        topbar.addView(back);

        TextView title = new TextView(this);
        title.setText("  🗺️ Karte (Kollegen)");
        title.setTextColor(Color.WHITE);
        title.setTextSize(16);
        topbar.addView(title);

        root.addView(topbar, new LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT));

        // WebView
        wv = new WebView(this);
        WebSettings s = wv.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setBuiltInZoomControls(false);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setSupportZoom(true);
        wv.setWebViewClient(new WebViewClient());
        wv.setWebChromeClient(new WebChromeClient());

        // v6.62.644: Cache disablen damit Patches sofort gezogen werden — sonst lieferte
        // WebView die alte HTML aus dem Cache, kein neues Loading.
        s.setCacheMode(WebSettings.LOAD_NO_CACHE);
        String myVid = getSharedPreferences("driver", MODE_PRIVATE).getString("vehicleId", "");
        // Cache-Bust via Timestamp damit Strato/Cloudflare-Cache umgangen wird
        String url = "https://umwelt-taxi-insel-usedom.de/fahrer-map.html?myVehicle="
            + java.net.URLEncoder.encode(myVid) + "&nc=" + System.currentTimeMillis();
        wv.loadUrl(url);

        root.addView(wv, new LayoutParams(LayoutParams.MATCH_PARENT, 0, 1f));
        setContentView(root);
    }

    @Override
    public void onBackPressed() {
        // Wenn WebView Verlauf hat (z.B. Patrick hat sich tiefer geklickt) → erst dort zurueck
        if (wv != null && wv.canGoBack()) {
            wv.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        if (wv != null) {
            wv.stopLoading();
            wv.destroy();
            wv = null;
        }
        super.onDestroy();
    }
}
