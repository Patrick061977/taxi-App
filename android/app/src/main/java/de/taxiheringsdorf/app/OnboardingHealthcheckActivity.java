package de.taxiheringsdorf.app;

import android.Manifest;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.location.LocationManager;
import android.net.ConnectivityManager;
import android.net.NetworkCapabilities;
import android.net.NetworkInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.provider.Settings;
import android.util.Log;
import android.view.LayoutInflater;
import android.view.View;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;
import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import com.google.android.material.button.MaterialButton;
import com.google.firebase.auth.FirebaseAuth;
import com.google.firebase.auth.FirebaseUser;
import com.google.firebase.database.FirebaseDatabase;
import com.google.firebase.messaging.FirebaseMessaging;
import java.util.ArrayList;
import java.util.List;

// v6.62.202: Schicht-Healthcheck. Patrick (02.05.2026): "Bei neuen Fahrern auf neuem Handy
// soll alles geprueft werden — GPS, Berechtigung, alles." Geoeffnet von VehiclePicker
// nach Fahrzeugauswahl, ueberspringt sich automatisch wenn alle Checks <14 Tage erfolgreich
// waren. Pro fehlgeschlagenem Check: 'Jetzt fixen'-Button mit passendem Settings-Intent
// oder Permission-Request. Bei ❌ wird einmalig per Bridge-Outbox ein Hinweis an Admin
// gesendet damit Patrick sieht wenn ein Fahrer haengt.
public class OnboardingHealthcheckActivity extends AppCompatActivity {
    private static final String TAG = "Healthcheck";
    private static final String DB_INSTANCE_URL = "https://taxi-heringsdorf-default-rtdb.europe-west1.firebasedatabase.app";
    private static final String PREFS = "onboarding";
    private static final String KEY_LAST_PASS = "lastHealthcheckPass";
    private static final long REPEAT_AFTER_MS = 14L * 24 * 60 * 60 * 1000; // 14 Tage

    private static final int REQ_LOCATION = 1001;
    private static final int REQ_BACKGROUND_LOCATION = 1002;
    private static final int REQ_NOTIFICATIONS = 1003;
    private static final long GPS_FRESH_MAX_AGE_MS = 60_000L;

    private LinearLayout listContainer;
    private TextView summary;
    private MaterialButton btnAutofix, btnContinue, btnSkip;
    private final List<CheckItem> items = new ArrayList<>();
    private boolean autofixInProgress = false;
    private boolean alertSent = false;

    enum Status { CHECKING, PASS, WARN, FAIL }

    // Statisch aufrufbar — VehiclePicker entscheidet ob Healthcheck noetig ist.
    public static boolean shouldRun(Context ctx) {
        long last = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getLong(KEY_LAST_PASS, 0L);
        return (System.currentTimeMillis() - last) > REPEAT_AFTER_MS;
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_onboarding_healthcheck);

        listContainer = findViewById(R.id.healthcheck_list);
        summary = findViewById(R.id.healthcheck_summary);
        btnAutofix = findViewById(R.id.btn_autofix_all);
        btnContinue = findViewById(R.id.btn_continue);
        btnSkip = findViewById(R.id.btn_skip);

        buildCheckList();
        renderList();

        btnAutofix.setOnClickListener(v -> runAutofix());
        btnContinue.setOnClickListener(v -> proceedToDashboard(true));
        btnSkip.setOnClickListener(v -> proceedToDashboard(false));

        // Erste Pruefung leicht verzoegert damit das Layout sichtbar wird
        new Handler(Looper.getMainLooper()).postDelayed(this::recheckAll, 250);
    }

    @Override
    protected void onResume() {
        super.onResume();
        // User kommt aus Settings/Dialog zurueck → re-check
        if (!autofixInProgress) recheckAll();
    }

    private void buildCheckList() {
        items.clear();
        items.add(new CheckItem("loc_fine", "📍 Standort-Berechtigung",
            "App darf dein GPS lesen — Pflicht für Auftragszuweisung"));
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            items.add(new CheckItem("loc_bg", "🛰 Standort 'Immer erlauben'",
                "Damit GPS auch im Hintergrund läuft (Schicht aktiv, App nicht offen)"));
        }
        items.add(new CheckItem("gps_on", "📡 GPS am Gerät aktiviert",
            "Standort-Schalter in den System-Einstellungen muss an sein"));
        items.add(new CheckItem("battery", "🔋 Akku-Optimierung deaktiviert",
            "Sonst schließt Samsung die App nach Bildschirm-Aus → Aufträge werden verpasst"));
        items.add(new CheckItem("notif", "🔔 Benachrichtigungen erlaubt",
            "Damit du neue Aufträge sofort hörst"));
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            items.add(new CheckItem("post_notif", "🔔 Benachrichtigungs-Permission (Android 13+)",
                "POST_NOTIFICATIONS muss erlaubt sein"));
        }
        items.add(new CheckItem("fcm", "📨 Push-Token registriert",
            "FCM-Verbindung zu Google — App empfängt Aufträge auch im Hintergrund"));
        items.add(new CheckItem("internet", "🌐 Internet-Verbindung",
            "Ohne Netz keine Aufträge"));
    }

    private void renderList() {
        listContainer.removeAllViews();
        LayoutInflater inf = LayoutInflater.from(this);
        for (CheckItem c : items) {
            View card = inf.inflate(R.layout.item_healthcheck_card, listContainer, false);
            c.iconView = card.findViewById(R.id.check_status_icon);
            c.titleView = card.findViewById(R.id.check_title);
            c.detailView = card.findViewById(R.id.check_detail);
            c.fixButton = card.findViewById(R.id.check_fix_button);
            c.titleView.setText(c.title);
            c.detailView.setText(c.detail);
            c.fixButton.setOnClickListener(v -> launchFix(c));
            listContainer.addView(card);
            applyStatus(c);
        }
    }

    private void recheckAll() {
        for (CheckItem c : items) {
            c.status = Status.CHECKING;
            applyStatus(c);
        }
        // Pro Check synchron auswerten (alle Calls sind schnell ausser FCM)
        for (CheckItem c : items) {
            evaluateCheck(c);
            applyStatus(c);
        }
        evaluateFcmAsync(); // FCM-Token ist async
        updateSummary();
    }

    private void evaluateCheck(CheckItem c) {
        try {
            switch (c.id) {
                case "loc_fine":
                    boolean fine = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
                    boolean coarse = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
                    c.status = (fine || coarse) ? Status.PASS : Status.FAIL;
                    c.detail = c.status == Status.PASS ? "✓ Genehmigt" : "Nicht erlaubt — App kann GPS nicht nutzen";
                    break;
                case "loc_bg":
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                        boolean bg = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_BACKGROUND_LOCATION) == PackageManager.PERMISSION_GRANTED;
                        c.status = bg ? Status.PASS : Status.FAIL;
                        c.detail = bg ? "✓ 'Immer erlauben' aktiv" : "Aktuell nur 'Beim Benutzen der App' — bei Bildschirm-Aus stoppt GPS";
                    } else {
                        c.status = Status.PASS;
                        c.detail = "✓ Auf Android <10 nicht nötig";
                    }
                    break;
                case "gps_on":
                    LocationManager lm = (LocationManager) getSystemService(LOCATION_SERVICE);
                    boolean gps = lm != null && lm.isProviderEnabled(LocationManager.GPS_PROVIDER);
                    boolean net = lm != null && lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER);
                    if (gps) { c.status = Status.PASS; c.detail = "✓ GPS-Provider aktiv"; }
                    else if (net) { c.status = Status.WARN; c.detail = "Nur Netzwerk-Standort — GPS bitte einschalten für genaue Position"; }
                    else { c.status = Status.FAIL; c.detail = "Standort komplett aus — bitte einschalten"; }
                    break;
                case "battery":
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
                        boolean ignoring = pm != null && pm.isIgnoringBatteryOptimizations(getPackageName());
                        c.status = ignoring ? Status.PASS : Status.FAIL;
                        c.detail = ignoring ? "✓ Auf Whitelist — App wird nicht im Hintergrund gekillt" : "App ist Akku-Optimierung unterworfen — wird nach 15-30 Min gekillt";
                    } else {
                        c.status = Status.PASS;
                        c.detail = "✓ Auf Android <6 nicht nötig";
                    }
                    break;
                case "notif":
                    boolean notif = NotificationManagerCompat.from(this).areNotificationsEnabled();
                    c.status = notif ? Status.PASS : Status.FAIL;
                    c.detail = notif ? "✓ Erlaubt" : "Benachrichtigungen blockiert — keine Audio-Alerts bei neuen Aufträgen";
                    break;
                case "post_notif":
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                        boolean post = ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
                        c.status = post ? Status.PASS : Status.FAIL;
                        c.detail = post ? "✓ Erlaubt" : "POST_NOTIFICATIONS verweigert";
                    } else {
                        c.status = Status.PASS;
                        c.detail = "✓ Auf Android <13 nicht nötig";
                    }
                    break;
                case "internet":
                    c.status = isInternetOk() ? Status.PASS : Status.FAIL;
                    c.detail = c.status == Status.PASS ? "✓ Online" : "Keine Internet-Verbindung — bitte WLAN/mobile Daten prüfen";
                    break;
                case "fcm":
                    // wird in evaluateFcmAsync gesetzt
                    if (c.status != Status.PASS && c.status != Status.FAIL) {
                        c.detail = "Prüfe Token bei Google…";
                    }
                    break;
            }
        } catch (Throwable t) {
            Log.w(TAG, "evaluate " + c.id + " fehler: " + t.getMessage());
            c.status = Status.WARN;
            c.detail = "Prüfung fehlgeschlagen: " + t.getMessage();
        }
    }

    private boolean isInternetOk() {
        try {
            ConnectivityManager cm = (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
            if (cm == null) return false;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                NetworkCapabilities nc = cm.getNetworkCapabilities(cm.getActiveNetwork());
                return nc != null && nc.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
            } else {
                NetworkInfo ni = cm.getActiveNetworkInfo();
                return ni != null && ni.isConnected();
            }
        } catch (Throwable t) {
            return false;
        }
    }

    private void evaluateFcmAsync() {
        CheckItem fcm = findItem("fcm");
        if (fcm == null) return;
        try {
            FirebaseMessaging.getInstance().getToken().addOnCompleteListener(task -> {
                if (task.isSuccessful() && task.getResult() != null && !task.getResult().isEmpty()) {
                    fcm.status = Status.PASS;
                    fcm.detail = "✓ Token registriert (" + task.getResult().substring(0, Math.min(12, task.getResult().length())) + "…)";
                    persistFcmToken(task.getResult());
                } else {
                    fcm.status = Status.FAIL;
                    fcm.detail = "Kein Token von Google — Push wird nicht funktionieren";
                }
                runOnUiThread(() -> {
                    applyStatus(fcm);
                    updateSummary();
                });
            });
        } catch (Throwable t) {
            fcm.status = Status.WARN;
            fcm.detail = "FCM-Check übersprungen: " + t.getMessage();
            runOnUiThread(() -> { applyStatus(fcm); updateSummary(); });
        }
    }

    private void persistFcmToken(String token) {
        try {
            FirebaseUser u = FirebaseAuth.getInstance().getCurrentUser();
            if (u == null) return;
            String deviceId = DeviceIdHelper.getOrCreate(this);
            FirebaseDatabase.getInstance(DB_INSTANCE_URL)
                .getReference("devices/" + deviceId + "/fcmToken").setValue(token);
            FirebaseDatabase.getInstance(DB_INSTANCE_URL)
                .getReference("devices/" + deviceId + "/uid").setValue(u.getUid());
            FirebaseDatabase.getInstance(DB_INSTANCE_URL)
                .getReference("devices/" + deviceId + "/lastSeen").setValue(System.currentTimeMillis());
        } catch (Throwable t) {
            Log.w(TAG, "persistFcmToken: " + t.getMessage());
        }
    }

    private CheckItem findItem(String id) {
        for (CheckItem c : items) if (c.id.equals(id)) return c;
        return null;
    }

    private void applyStatus(CheckItem c) {
        if (c.iconView == null) return;
        switch (c.status) {
            case CHECKING: c.iconView.setText("⏳"); break;
            case PASS: c.iconView.setText("✅"); break;
            case WARN: c.iconView.setText("⚠️"); break;
            case FAIL: c.iconView.setText("❌"); break;
        }
        c.detailView.setText(c.detail);
        c.fixButton.setVisibility(c.status == Status.FAIL || c.status == Status.WARN ? View.VISIBLE : View.GONE);
        c.fixButton.setEnabled(c.status != Status.CHECKING);
    }

    private void updateSummary() {
        int pass = 0, warn = 0, fail = 0;
        for (CheckItem c : items) {
            switch (c.status) {
                case PASS: pass++; break;
                case WARN: warn++; break;
                case FAIL: fail++; break;
                default: break;
            }
        }
        int total = items.size();
        if (fail > 0) {
            summary.setText("❌ " + fail + " Problem" + (fail > 1 ? "e" : "") + " — bitte fixen.  ✓ " + pass + "/" + total);
            btnContinue.setEnabled(false);
            btnContinue.setBackgroundTintList(android.content.res.ColorStateList.valueOf(0xFF475569));
            sendAdminAlertOnce(fail, warn);
        } else if (warn > 0) {
            summary.setText("⚠️ " + warn + " Warnung" + (warn > 1 ? "en" : "") + " — du kannst aber starten.  ✓ " + pass + "/" + total);
            btnContinue.setEnabled(true);
            btnContinue.setBackgroundTintList(android.content.res.ColorStateList.valueOf(0xFFF59E0B));
        } else if (pass == total) {
            summary.setText("✅ Alles ok — bereit für die Schicht.");
            btnContinue.setEnabled(true);
            btnContinue.setBackgroundTintList(android.content.res.ColorStateList.valueOf(0xFF10B981));
        } else {
            summary.setText("Prüfe…");
            btnContinue.setEnabled(false);
        }
    }

    // Bridge-Push an Admin damit Patrick weiss wenn ein Fahrer Probleme hat.
    // Nur einmal pro Activity-Session — sonst spammt jeder Re-Check.
    private void sendAdminAlertOnce(int failCount, int warnCount) {
        if (alertSent) return;
        alertSent = true;
        try {
            FirebaseUser u = FirebaseAuth.getInstance().getCurrentUser();
            if (u == null) return;
            // Eigene Logins (Patrick) nicht melden
            if (PermissionsHelper.isAdmin(this)) return;

            StringBuilder sb = new StringBuilder();
            sb.append("⚠️ Healthcheck-Probleme bei Fahrer\n\n");
            String who = u.getEmail() != null ? u.getEmail() : (u.getPhoneNumber() != null ? u.getPhoneNumber() : u.getUid());
            sb.append("Fahrer: ").append(who).append("\n");
            sb.append("Gerät: ").append(Build.MANUFACTURER).append(" ").append(Build.MODEL);
            sb.append(" (Android ").append(Build.VERSION.RELEASE).append(")\n\n");
            for (CheckItem c : items) {
                if (c.status == Status.FAIL) sb.append("❌ ").append(c.title).append("\n");
                else if (c.status == Status.WARN) sb.append("⚠️ ").append(c.title).append("\n");
            }
            long ts = System.currentTimeMillis();
            java.util.HashMap<String, Object> msg = new java.util.HashMap<>();
            msg.put("message", sb.toString());
            msg.put("targetChatId", 6229490043L);
            msg.put("via", "claude");
            msg.put("ts", ts);
            FirebaseDatabase.getInstance(DB_INSTANCE_URL)
                .getReference("claudeBridge/outbox/" + ts).setValue(msg);
        } catch (Throwable t) {
            Log.w(TAG, "Admin-Alert fehlgeschlagen: " + t.getMessage());
        }
    }

    private void runAutofix() {
        autofixInProgress = true;
        // Geh die FAILs in fester Reihenfolge durch — pro Tap ein Settings-Intent
        // (Android laesst pro Klick nur einen Permission-Dialog zu).
        for (CheckItem c : items) {
            if (c.status == Status.FAIL) {
                launchFix(c);
                return; // nur EINEN Fix pro Tap — User kommt zurueck → onResume → naechster
            }
        }
        autofixInProgress = false;
        Toast.makeText(this, "Keine offenen Probleme.", Toast.LENGTH_SHORT).show();
    }

    private void launchFix(CheckItem c) {
        try {
            switch (c.id) {
                case "loc_fine":
                    ActivityCompat.requestPermissions(this,
                        new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION},
                        REQ_LOCATION);
                    break;
                case "loc_bg":
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                        // Android 11+: Background-Location darf NUR ueber App-Settings gewaehrt werden
                        // (kein Dialog mehr). Auf Android 10 noch ueber requestPermissions moeglich.
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                            openAppSettings("Wähle 'Standort' → 'Immer erlauben'");
                        } else {
                            ActivityCompat.requestPermissions(this,
                                new String[]{Manifest.permission.ACCESS_BACKGROUND_LOCATION},
                                REQ_BACKGROUND_LOCATION);
                        }
                    }
                    break;
                case "gps_on":
                    Intent i1 = new Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS);
                    i1.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(i1);
                    break;
                case "battery":
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                        Intent ib = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
                        ib.setData(Uri.parse("package:" + getPackageName()));
                        try {
                            startActivity(ib);
                        } catch (Throwable t) {
                            // Fallback: globale Liste
                            Intent ib2 = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
                            startActivity(ib2);
                        }
                    }
                    break;
                case "notif":
                    Intent i2 = new Intent();
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        i2.setAction(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
                        i2.putExtra(Settings.EXTRA_APP_PACKAGE, getPackageName());
                    } else {
                        i2.setAction(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                        i2.setData(Uri.parse("package:" + getPackageName()));
                    }
                    i2.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(i2);
                    break;
                case "post_notif":
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                        ActivityCompat.requestPermissions(this,
                            new String[]{Manifest.permission.POST_NOTIFICATIONS},
                            REQ_NOTIFICATIONS);
                    }
                    break;
                case "fcm":
                    // Token nochmal versuchen — typisch Google-Play-Services-Glitch
                    Toast.makeText(this, "Versuche FCM-Token zu erneuern…", Toast.LENGTH_SHORT).show();
                    evaluateFcmAsync();
                    break;
                case "internet":
                    Intent i3 = new Intent(Settings.ACTION_WIFI_SETTINGS);
                    i3.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(i3);
                    break;
            }
        } catch (Throwable t) {
            Log.w(TAG, "Fix " + c.id + " fehler: " + t.getMessage());
            Toast.makeText(this, "Fix fehlgeschlagen — bitte manuell in den Einstellungen.", Toast.LENGTH_LONG).show();
        }
    }

    private void openAppSettings(String hint) {
        try {
            Toast.makeText(this, hint, Toast.LENGTH_LONG).show();
            Intent i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
            i.setData(Uri.parse("package:" + getPackageName()));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(i);
        } catch (Throwable t) {
            Log.w(TAG, "openAppSettings: " + t.getMessage());
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions, @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        autofixInProgress = false;
        recheckAll();
    }

    private void proceedToDashboard(boolean savePassFlag) {
        if (savePassFlag) {
            // Nur als 'pass' speichern wenn alles ok
            boolean allOk = true;
            for (CheckItem c : items) if (c.status == Status.FAIL) { allOk = false; break; }
            if (allOk) {
                SharedPreferences.Editor e = getSharedPreferences(PREFS, MODE_PRIVATE).edit();
                e.putLong(KEY_LAST_PASS, System.currentTimeMillis()).apply();
            }
        }
        // Admin → AdminDashboard, sonst DriverDashboard
        Class<?> nextActivity = PermissionsHelper.isAdmin(this)
            ? AdminDashboardActivity.class
            : DriverDashboardActivity.class;
        startActivity(new Intent(this, nextActivity));
        finish();
    }

    private static class CheckItem {
        final String id;
        final String title;
        String detail;
        Status status = Status.CHECKING;
        TextView iconView;
        TextView titleView;
        TextView detailView;
        MaterialButton fixButton;

        CheckItem(String id, String title, String detail) {
            this.id = id;
            this.title = title;
            this.detail = detail;
        }
    }
}
