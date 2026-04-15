package de.taxiheringsdorf.kunden;

import android.os.Bundle;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Cache beim Start leeren — App lädt immer die neueste Version
        try {
            WebView webView = getBridge().getWebView();
            if (webView != null) {
                webView.clearCache(true);
                webView.getSettings().setCacheMode(android.webkit.WebSettings.LOAD_NO_CACHE);
            }
        } catch (Exception e) {
            // Ignorieren wenn WebView noch nicht bereit
        }
    }
}
