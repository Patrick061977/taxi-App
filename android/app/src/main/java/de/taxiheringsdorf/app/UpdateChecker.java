package de.taxiheringsdorf.app;

import android.app.Activity;
import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.util.Log;
import android.view.View;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;
import androidx.annotation.NonNull;
import androidx.core.content.FileProvider;
import com.google.android.material.button.MaterialButton;
import com.google.firebase.database.DataSnapshot;
import com.google.firebase.database.DatabaseError;
import com.google.firebase.database.DatabaseReference;
import com.google.firebase.database.FirebaseDatabase;
import com.google.firebase.database.ValueEventListener;
import java.io.BufferedReader;
import java.io.File;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.HashMap;
import java.util.Map;

// v6.52.1: Update-Banner-Logik aus DriverDashboardActivity extrahiert,
// damit auch LoginActivity (und andere) den Update-Banner zeigen können.
// Patrick: 'das Update müsste auch runtergeladen werden können, wenn man
// nicht eingeloggt ist'.
public final class UpdateChecker {
    private static final String TAG = "UpdateChecker";
    // v6.60.4: Strato (DE-Hosting) als Primär-Quelle, GitHub als Fallback.
    // Patrick: 'kannst du das nicht zu strato laden und das wir es von da laden' —
    // S20-Download von GitHub-CDN war extrem langsam (Drosselung / Routing).
    // Strato liefert direkt aus DE-Rechenzentrum.
    private static final String STRATO_LATEST_JSON = "https://umwelt-taxi-insel-usedom.de/app/latest.json";
    private static final String GITHUB_RELEASES_API = "https://api.github.com/repos/Patrick061977/taxi-App/releases/latest";

    private UpdateChecker() {}

    // Prüft auf Update — bei Treffer: setzt Banner-Text, attached Click-Handler,
    // macht Banner sichtbar. Im UI-Thread aufzurufen geht NICHT — nutzt selbst Background-Thread.
    public static void checkAsync(Activity activity, LinearLayout banner, TextView bannerText, MaterialButton bannerBtn) {
        new Thread(() -> doCheck(activity, banner, bannerText, bannerBtn)).start();
    }

    private static String fetchJson(String urlStr) {
        try {
            URL url = new URL(urlStr);
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setConnectTimeout(5000);
            conn.setReadTimeout(5000);
            conn.setRequestMethod("GET");
            if (conn.getResponseCode() != 200) return null;
            BufferedReader br = new BufferedReader(new InputStreamReader(conn.getInputStream()));
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = br.readLine()) != null) sb.append(line);
            br.close();
            return sb.toString();
        } catch (Throwable t) {
            Log.w(TAG, "fetchJson fehlgeschlagen für " + urlStr + ": " + t.getMessage());
            return null;
        }
    }

    private static void doCheck(Activity activity, LinearLayout banner, TextView bannerText, MaterialButton bannerBtn) {
        try {
            // 1) Primär: Strato (schnell aus DE)
            String json = fetchJson(STRATO_LATEST_JSON);
            // 2) Fallback: GitHub
            if (json == null) {
                Log.i(TAG, "Strato-Mirror nicht erreichbar, fallback auf GitHub");
                json = fetchJson(GITHUB_RELEASES_API);
            }
            if (json == null) return;
            String latestTag = extractJsonField(json, "tag_name");
            if (latestTag == null) return;
            if (latestTag.startsWith("v")) latestTag = latestTag.substring(1);
            String currentVer = activity.getPackageManager().getPackageInfo(activity.getPackageName(), 0).versionName;
            if (compareVersions(latestTag, currentVer) <= 0) return;
            String dlUrl = extractJsonField(json, "browser_download_url");
            if (dlUrl == null) return;
            final String fLatest = latestTag;
            final String fUrl = dlUrl;

            // v6.62.201: Falls eine APK aus früherem Download bereits liegt UND neuer als installiert ist
            // → direkt 'Installieren'-Banner statt erneut laden. Schutz für den Fall, dass die Activity
            // während des Downloads zerstört wurde und der BroadcastReceiver den Banner-Wechsel verpasst hat.
            File pendingApk = new File(activity.getExternalFilesDir(null), "taxi-app-update.apk");
            if (pendingApk.exists() && pendingApk.length() > 0) {
                String apkVer = readApkVersion(activity, pendingApk);
                if (apkVer != null && compareVersions(apkVer, currentVer) > 0) {
                    final String fApkVer = apkVer;
                    final File fApk = pendingApk;
                    activity.runOnUiThread(() -> {
                        bannerText.setText("✓ v" + fApkVer + " bereit");
                        bannerBtn.setText("Installieren");
                        bannerBtn.setEnabled(true);
                        bannerBtn.setOnClickListener(_v -> launchInstallIntent(activity, fApk));
                        banner.setVisibility(View.VISIBLE);
                    });
                    return;
                } else {
                    // Liegende APK ist veraltet → wegwerfen damit startDownload neu lädt
                    try { pendingApk.delete(); } catch (Throwable _e) {}
                }
            }

            activity.runOnUiThread(() -> {
                // v6.53.1: 2-Schritt-UX — Patrick: 'Lade und Installieren in einem Button verwirrt.
                // Normalerweise lädt man erst herunter, dann installiert man'.
                // Schritt 1: Button 'Herunterladen' → startDownload
                // Schritt 2: nach Download-Complete → Button 'Installieren' → Install-Intent
                bannerText.setText("📥 Update v" + fLatest + " verfügbar");
                bannerBtn.setText("Herunterladen");
                bannerBtn.setEnabled(true);
                bannerBtn.setOnClickListener(v -> startDownload(activity, banner, bannerText, bannerBtn, fUrl, fLatest));
                banner.setVisibility(View.VISIBLE);
            });
        } catch (Throwable t) {
            Log.w(TAG, "Update-Check fehlgeschlagen: " + t.getMessage());
        }
    }

    // v6.62.201: Liest versionName aus einer APK-Datei via PackageManager — ohne sie zu installieren.
    private static String readApkVersion(Activity activity, File apk) {
        try {
            PackageManager pm = activity.getPackageManager();
            PackageInfo info = pm.getPackageArchiveInfo(apk.getAbsolutePath(), 0);
            return info != null ? info.versionName : null;
        } catch (Throwable t) {
            return null;
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

    // v6.53.1: 2-Schritt-Update — Schritt 1: Download starten, Button disabled,
    // Status-Text 'Lade…'. Bei Complete: Button 'Installieren' wird aktiv.
    private static void startDownload(Activity activity, LinearLayout banner, TextView bannerText, MaterialButton bannerBtn, String url, String version) {
        try {
            bannerText.setText("⏳ Lade v" + version + "…");
            bannerBtn.setText("Lädt…");
            bannerBtn.setEnabled(false);
            // v6.59.5: Alte APKs löschen — sonst hängt DownloadManager '-1', '-2'... an,
            // BroadcastReceiver greift dann auf den ORIGINAL-Pfad (alte Version) → INSTALL_FAILED_VERSION_DOWNGRADE.
            File dir = activity.getExternalFilesDir(null);
            if (dir != null) {
                File[] olds = dir.listFiles((d, name) -> name.startsWith("taxi-app-update") && name.endsWith(".apk"));
                if (olds != null) for (File o : olds) { try { o.delete(); } catch (Throwable _e) {} }
            }
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
                            bannerBtn.setText("Erneut versuchen");
                            bannerBtn.setEnabled(true);
                            bannerBtn.setOnClickListener(_v -> startDownload(activity, banner, bannerText, bannerBtn, url, version));
                        });
                        return;
                    }
                    // Schritt 2: Button wechselt zu 'Installieren' — User entscheidet wann
                    activity.runOnUiThread(() -> {
                        bannerText.setText("✓ v" + version + " bereit");
                        bannerBtn.setText("Installieren");
                        bannerBtn.setEnabled(true);
                        bannerBtn.setOnClickListener(_v -> launchInstallIntent(activity, apk));
                    });
                }
            };
            IntentFilter filter = new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE);
            // v6.62.201: RECEIVER_EXPORTED — DownloadManager.ACTION_DOWNLOAD_COMPLETE wird vom
            // System-Prozess (system_server, UID 1000) gesendet, nicht von uns selbst. Mit
            // RECEIVER_NOT_EXPORTED wird der Broadcast auf Android 13+ stillschweigend verworfen
            // → Banner blieb auf 'Lädt…' obwohl die APK längst lag. Genau Patricks Symptom auf S20 FE.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                activity.registerReceiver(onComplete, filter, Context.RECEIVER_EXPORTED);
            } else {
                activity.registerReceiver(onComplete, filter);
            }
        } catch (Throwable t) {
            Toast.makeText(activity, "Update-Fehler: " + t.getMessage(), Toast.LENGTH_LONG).show();
            banner.setVisibility(View.GONE);
        }
    }

    // v6.62.209: Profi-Update-Flow. Patrick: "erst Schicht beenden + abmelden,
    //   dann Update installieren — keine Geist-Schichten in Firebase".
    // 🔧 v6.62.770 (Patrick 16.05. 09:26): "Wieso beendet er nicht immer die
    //   Schicht jetzt wie vorhin automatisch, also dass er die Card bringt".
    //   Bug: Confirm-Dialog kam nur wenn Activity == DriverDashboardActivity.
    //   Wenn Patrick aus dem AdminDashboard installierte (gleicher Account, Tesla-
    //   Schicht parallel aktiv), wurde direkt installiert → Geist-Schicht in
    //   Firebase. Fix: SharedPrefs "driver"/vehicleId lesen, Firebase-Async-Check
    //   ob shift.status == 'active'. Funktioniert in JEDER Activity die UpdateChecker
    //   benutzt (DriverDashboard, AdminDashboard, LoginActivity).
    private static final String DB_INSTANCE_URL = "https://taxi-heringsdorf-default-rtdb.europe-west1.firebasedatabase.app";

    private static void launchInstallIntent(Activity activity, File apk) {
        SharedPreferences prefs = activity.getSharedPreferences("driver", Context.MODE_PRIVATE);
        String vehicleId = prefs.getString("vehicleId", null);
        if (vehicleId == null) {
            SharedPreferences fcmPrefs = activity.getSharedPreferences("fcm", Context.MODE_PRIVATE);
            vehicleId = fcmPrefs.getString("vehicleId", null);
        }
        if (vehicleId == null) {
            doInstallApk(activity, apk);
            return;
        }
        final String fVid = vehicleId;
        try {
            FirebaseDatabase.getInstance(DB_INSTANCE_URL)
                .getReference("vehicles/" + fVid + "/shift/status")
                .addListenerForSingleValueEvent(new ValueEventListener() {
                    @Override public void onDataChange(@NonNull DataSnapshot snap) {
                        String status = snap.getValue(String.class);
                        if ("active".equals(status)) {
                            activity.runOnUiThread(() -> showShiftEndDialog(activity, fVid, apk));
                        } else {
                            activity.runOnUiThread(() -> doInstallApk(activity, apk));
                        }
                    }
                    @Override public void onCancelled(@NonNull DatabaseError err) {
                        // Im Zweifel sicherheitshalber den Dialog zeigen
                        activity.runOnUiThread(() -> showShiftEndDialog(activity, fVid, apk));
                    }
                });
        } catch (Throwable t) {
            Log.w(TAG, "shift.status-Check fehlgeschlagen: " + t.getMessage());
            doInstallApk(activity, apk);
        }
    }

    private static void showShiftEndDialog(Activity activity, String vehicleId, File apk) {
        new androidx.appcompat.app.AlertDialog.Builder(activity)
            .setTitle("Update installieren")
            .setMessage("Die laufende Schicht wird zuerst sauber beendet, danach startet die Installation.\n\nWeiter?")
            .setCancelable(false)
            .setPositiveButton("Schicht beenden + Update", (d, w) -> {
                Toast.makeText(activity, "Schicht wird beendet…", Toast.LENGTH_SHORT).show();
                // Wenn DriverDashboard: bestehenden Pfad nutzen (kein doppeltes Schreiben)
                if (activity instanceof DriverDashboardActivity) {
                    ((DriverDashboardActivity) activity).cleanShutdownForUpdate(() -> doInstallApk(activity, apk));
                    return;
                }
                // Sonst (AdminDashboard, LoginActivity etc.) — Schicht direkt in Firebase beenden
                try {
                    DatabaseReference shiftRef = FirebaseDatabase.getInstance(DB_INSTANCE_URL)
                        .getReference("vehicles/" + vehicleId + "/shift");
                    Map<String, Object> updates = new HashMap<>();
                    updates.put("status", "ended");
                    updates.put("endedAt", System.currentTimeMillis());
                    updates.put("endedReason", "app_update");
                    shiftRef.updateChildren(updates);
                    FirebaseDatabase.getInstance(DB_INSTANCE_URL)
                        .getReference("vehicles/" + vehicleId + "/online").setValue(false);
                    Log.i(TAG, "🛑 Schicht beendet wegen App-Update (vehicle=" + vehicleId + ") — Activity=" + activity.getClass().getSimpleName());
                } catch (Throwable t) {
                    Log.w(TAG, "Schicht-Ende vor Update fehlgeschlagen: " + t.getMessage());
                }
                // 800ms warten damit Firebase committet, dann installieren
                new android.os.Handler(android.os.Looper.getMainLooper())
                    .postDelayed(() -> doInstallApk(activity, apk), 800);
            })
            .setNegativeButton("Abbrechen", null)
            .show();
    }

    static void doInstallApk(Activity activity, File apk) {
        try {
            Uri apkUri = FileProvider.getUriForFile(activity, activity.getPackageName() + ".fileprovider", apk);
            Intent install = new Intent(Intent.ACTION_VIEW);
            install.setDataAndType(apkUri, "application/vnd.android.package-archive");
            install.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            activity.startActivity(install);
        } catch (Throwable t) {
            Toast.makeText(activity, "Install-Intent: " + t.getMessage(), Toast.LENGTH_LONG).show();
        }
    }
}
