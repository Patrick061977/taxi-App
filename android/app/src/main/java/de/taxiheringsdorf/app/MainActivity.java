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
        // v6.63.509: WebView-Cache leeren + Reload erzwingen damit neue index.html-
        // Deployments sofort sichtbar sind (Firebase CDN cached 1h mit max-age=3600).
        // clearCache allein reicht nicht — WebView hat schon aus Cache geladen wenn
        // onCreate() fertig ist. post(reload()) läuft nach aktuellem Load-Zyklus.
        WebView wv = getBridge().getWebView();
        if (wv != null) {
            wv.clearCache(true);
            wv.post(() -> wv.reload());
        }
    }
}
