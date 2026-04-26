package de.taxiheringsdorf.app;

import android.app.Activity;
import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.net.Uri;
import android.os.Build;
import android.util.Log;
import android.view.View;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;
import androidx.core.content.FileProvider;
import com.google.android.material.button.MaterialButton;
import java.io.BufferedReader;
import java.io.File;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;

// v6.52.1: Update-Banner-Logik aus DriverDashboardActivity extrahiert,
// damit auch LoginActivity (und andere) den Update-Banner zeigen können.
// Patrick: 'das Update müsste auch runtergeladen werden können, wenn man
// nicht eingeloggt ist'.
public final class UpdateChecker {
    private static final String TAG = "UpdateChecker";
    private static final String RELEASES_API = "https://api.github.com/repos/Patrick061977/taxi-App/releases/latest";

    private UpdateChecker() {}

    // Prüft auf Update — bei Treffer: setzt Banner-Text, attached Click-Handler,
    // macht Banner sichtbar. Im UI-Thread aufzurufen geht NICHT — nutzt selbst Background-Thread.
    public static void checkAsync(Activity activity, LinearLayout banner, TextView bannerText, MaterialButton bannerBtn) {
        new Thread(() -> doCheck(activity, banner, bannerText, bannerBtn)).start();
    }

    private static void doCheck(Activity activity, LinearLayout banner, TextView bannerText, MaterialButton bannerBtn) {
        try {
            URL url = new URL(RELEASES_API);
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setConnectTimeout(8000);
            conn.setReadTimeout(8000);
            conn.setRequestMethod("GET");
            if (conn.getResponseCode() != 200) return;
            BufferedReader br = new BufferedReader(new InputStreamReader(conn.getInputStream()));
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = br.readLine()) != null) sb.append(line);
            br.close();
            String json = sb.toString();
            String latestTag = extractJsonField(json, "tag_name");
            if (latestTag == null) return;
            if (latestTag.startsWith("v")) latestTag = latestTag.substring(1);
            String currentVer = activity.getPackageManager().getPackageInfo(activity.getPackageName(), 0).versionName;
            if (compareVersions(latestTag, currentVer) <= 0) return;
            String dlUrl = extractJsonField(json, "browser_download_url");
            if (dlUrl == null) return;
            final String fLatest = latestTag;
            final String fUrl = dlUrl;
            activity.runOnUiThread(() -> {
                bannerText.setText("📥 Update v" + fLatest + " verfügbar");
                bannerBtn.setOnClickListener(v -> downloadAndInstall(activity, banner, bannerText, bannerBtn, fUrl, fLatest));
                banner.setVisibility(View.VISIBLE);
            });
        } catch (Throwable t) {
            Log.w(TAG, "Update-Check fehlgeschlagen: " + t.getMessage());
        }
    }

    private static String extractJsonField(String json, String field) {
        String key = "\"" + field + "\"";
        int idx = json.indexOf(key);
        if (idx < 0) return null;
        int colon = json.indexOf(":", idx);
        if (colon < 0) return null;
        int start = json.indexOf("\"", colon + 1);
        if (start < 0) return null;
        int end = json.indexOf("\"", start + 1);
        if (end < 0) return null;
        return json.substring(start + 1, end);
    }

    private static int compareVersions(String a, String b) {
        String[] aP = a.split("\\.");
        String[] bP = b.split("\\.");
        int n = Math.max(aP.length, bP.length);
        for (int i = 0; i < n; i++) {
            int ai = 0, bi = 0;
            try { ai = i < aP.length ? Integer.parseInt(aP[i]) : 0; } catch (Throwable _t) {}
            try { bi = i < bP.length ? Integer.parseInt(bP[i]) : 0; } catch (Throwable _t) {}
            if (ai != bi) return Integer.compare(ai, bi);
        }
        return 0;
    }

    private static void downloadAndInstall(Activity activity, LinearLayout banner, TextView bannerText, MaterialButton bannerBtn, String url, String version) {
        try {
            bannerText.setText("⏳ Lade v" + version + "…");
            bannerBtn.setEnabled(false);
            DownloadManager dm = (DownloadManager) activity.getSystemService(Context.DOWNLOAD_SERVICE);
            DownloadManager.Request req = new DownloadManager.Request(Uri.parse(url));
            req.setTitle("Funk Taxi App v" + version);
            req.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE);
            req.setDestinationInExternalFilesDir(activity, null, "taxi-app-update.apk");
            req.setMimeType("application/vnd.android.package-archive");
            long downloadId = dm.enqueue(req);
            BroadcastReceiver onComplete = new BroadcastReceiver() {
                @Override
                public void onReceive(Context ctx, Intent intent) {
                    long id = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1);
                    if (id != downloadId) return;
                    try { ctx.unregisterReceiver(this); } catch (Throwable _e) {}
                    File apk = new File(activity.getExternalFilesDir(null), "taxi-app-update.apk");
                    if (!apk.exists()) {
                        activity.runOnUiThread(() -> {
                            bannerText.setText("❌ Download-Fehler");
                            bannerBtn.setEnabled(true);
                        });
                        return;
                    }
                    Uri apkUri = FileProvider.getUriForFile(activity, activity.getPackageName() + ".fileprovider", apk);
                    Intent install = new Intent(Intent.ACTION_VIEW);
                    install.setDataAndType(apkUri, "application/vnd.android.package-archive");
                    install.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    try { activity.startActivity(install); }
                    catch (Throwable t) { Toast.makeText(ctx, "Install-Intent: " + t.getMessage(), Toast.LENGTH_LONG).show(); }
                }
            };
            IntentFilter filter = new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                activity.registerReceiver(onComplete, filter, Context.RECEIVER_NOT_EXPORTED);
            } else {
                activity.registerReceiver(onComplete, filter);
            }
        } catch (Throwable t) {
            Toast.makeText(activity, "Update-Fehler: " + t.getMessage(), Toast.LENGTH_LONG).show();
            banner.setVisibility(View.GONE);
        }
    }
}
