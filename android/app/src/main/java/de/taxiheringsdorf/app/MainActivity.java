package de.taxiheringsdorf.app;

import android.os.Bundle;
import android.webkit.WebView;
import android.webkit.WebSettings;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onResume() {
        super.onResume();
        // Cache deaktivieren — App lädt immer die neueste Version
        try {
            WebView webView = getBridge().getWebView();
            if (webView != null) {
                webView.getSettings().setCacheMode(WebSettings.LOAD_NO_CACHE);
            }
        } catch (Exception e) {
            // Ignorieren
        }
    }
}
