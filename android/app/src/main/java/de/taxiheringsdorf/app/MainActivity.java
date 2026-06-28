package de.taxiheringsdorf.app;

import android.os.Bundle;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // v6.40.0: eigenes Plugin für Foreground-Service registrieren
        registerPlugin(ShiftForegroundPlugin.class);
        // v6.40.1: Plugin für APK-Update (Versionsabfrage + externer Download-Link)
        registerPlugin(AppUpdatePlugin.class);
        // v6.40.31: Plugin für SMS-Versand über Fahrer-SIM (Tracking-Link an Kunden)
        registerPlugin(SmsSenderPlugin.class);
        // v6.41.91: Crashlytics-Brücke — JS kann Custom Keys/User/Log/Error setzen
        registerPlugin(CrashlyticsPlugin.class);
        // v6.41.95: Akku-Optimierung — Whitelist-Status prüfen + Whitelist anfordern
        registerPlugin(BatteryOptimizationPlugin.class);
        // v6.41.96: FCM — Token-Abruf für Push-Notifications bei neuen Aufträgen
        registerPlugin(FCMPlugin.class);
        super.onCreate(savedInstanceState);
        // v6.63.508: WebView-HTTP-Cache beim Start leeren → neue index.html-Deployments
        // sind sofort sichtbar ohne 1h CDN-Cache-Wartezeit (Firebase max-age=3600).
        WebView wv = getBridge().getWebView();
        if (wv != null) wv.clearCache(true);
    }
}
