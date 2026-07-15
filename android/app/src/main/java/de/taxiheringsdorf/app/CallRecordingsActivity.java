package de.taxiheringsdorf.app;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.media.MediaPlayer;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.text.format.Formatter;
import android.util.Log;
import android.view.Gravity;
import android.view.View;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.SeekBar;
import android.widget.TextView;
import android.widget.Toast;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.RecyclerView;

import com.google.firebase.database.DataSnapshot;
import com.google.firebase.database.DatabaseError;
import com.google.firebase.database.DatabaseReference;
import com.google.firebase.database.FirebaseDatabase;
import com.google.firebase.database.ValueEventListener;

import java.io.File;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

// v6.62.828: Anruf-Aufnahmen lokal — liest /sdcard/ACRCalls/ACRPhone/ aus,
// matcht Telefonnummer mit CRM, spielt m4a-Aufnahme lokal mit MediaPlayer.
// Patrick (22.05. 14:48): "ich will es nur auf dem Phone abhören, KEIN Upload".
public class CallRecordingsActivity extends AppCompatActivity {
    private static final String TAG = "CallRecordings";
    private static final int REQ_PERM = 9101;
    private static final String DB_URL = "https://taxi-heringsdorf-default-rtdb.europe-west1.firebasedatabase.app";
    // ACR Phone speichert in: /sdcard/ACRCalls/ACRPhone/{YYYY}/{MM}/{DD}/+TelNr/+TelNr-direction-ts.m4a
    private static final File ACR_ROOT = new File(Environment.getExternalStorageDirectory(), "ACRCalls/ACRPhone");
    // 🆕 v6.63.015 (Patrick 29.05. 19:13): In-App-Call-Recorder speichert in /sdcard/FunktaxiCalls/{YYYY}/{MM}/{DD}/
    //   Gleiche Schema-Konvention damit dieselbe Scan-Logik beide Verzeichnisse abdeckt.
    private static final File FUNKTAXI_ROOT = new File(Environment.getExternalStorageDirectory(), "FunktaxiCalls");

    private RecyclerView rv;
    private ProgressBar progress;
    private TextView header, permHint;
    private RecAdapter adapter;
    private Map<String, String> crmByPhone = new HashMap<>();
    // v6.63.597: Hilfe-Karte (ACR-Einrichtung) — Instance-Fields für Zugriff aus scanRecordings()
    private LinearLayout helpCard;
    private android.widget.Button btnHelp;
    private boolean[] helpOpen = {false};
    // 🆕 v6.62.890 (Patrick 23.05. 09:12): Phone → customerId Mapping zusaetzlich. Wird bei
    //   'Vorbestellung erstellen' an CrmSearchActivity weitergegeben, damit dort der RICHTIGE
    //   CRM-Match-Pfad (mit Hotel/Stammkunden-Maske) greift statt der Neukunden-Fallback.
    private Map<String, String> crmIdByPhone = new HashMap<>();
    private MediaPlayer mp;
    private Recording playing;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(0xFF0f172a);

        LinearLayout topBar = new LinearLayout(this);
        topBar.setOrientation(LinearLayout.HORIZONTAL);
        topBar.setBackgroundColor(0xFF1e293b);
        topBar.setPadding(dp(16), dp(16), dp(16), dp(16));
        TextView title = new TextView(this);
        title.setText("📞 Anruf-Aufnahmen");
        title.setTextSize(18);
        title.setTextColor(0xFFffffff);
        title.setLayoutParams(new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f));
        topBar.addView(title);
        root.addView(topBar);

        // 🆕 v6.63.597: Hilfe-Karte — aufklappbar über Button, automatisch offen wenn kein Ordner
        helpCard = new LinearLayout(this);
        helpCard.setOrientation(LinearLayout.VERTICAL);
        helpCard.setBackgroundColor(0xFF0f2d4a);
        helpCard.setPadding(dp(16), dp(12), dp(16), dp(12));
        helpCard.setVisibility(View.GONE);

        TextView helpTitle = new TextView(this);
        helpTitle.setText("📞 ACR Phone einrichten — Schritt für Schritt");
        helpTitle.setTextColor(0xFF60a5fa);
        helpTitle.setTextSize(14);
        helpTitle.setTypeface(null, android.graphics.Typeface.BOLD);
        helpCard.addView(helpTitle);

        TextView helpText = new TextView(this);
        helpText.setTextColor(0xFFcbd5e1);
        helpText.setTextSize(13);
        helpText.setLineSpacing(dp(2), 1f);
        helpText.setPadding(0, dp(8), 0, dp(8));
        helpText.setText(
            "1️⃣  App installieren:\n" +
            "     Play Store öffnen → suche nach\n" +
            "     «Call Recorder – ACR Phone»\n" +
            "     (kostenlos, von NLL Apps)\n\n" +
            "2️⃣  ACR starten und Berechtigungen erlauben:\n" +
            "     • Mikrofon → Zulassen\n" +
            "     • Telefon-Anruf-Protokoll → Zulassen\n\n" +
            "3️⃣  Aufnahme-Einstellungen (optional):\n" +
            "     ACR → Einstellungen → Speicher\n" +
            "     → Aufnahmeordner: Intern wählen\n" +
            "     → Format: M4A\n\n" +
            "4️⃣  Fertig — ab jetzt nimmt ACR alle\n" +
            "     Anrufe automatisch auf.\n\n" +
            "5️⃣  Aufnahmen hier abhören:\n" +
            "     Diese Seite neu laden (raus + rein)\n" +
            "     → Aufnahme antippen → wird abgespielt\n" +
            "     → «📅 Vorbestellung erstellen» tipppen\n" +
            "     → Daten werden automatisch ausgefüllt\n\n" +
            "📁  Wo liegen die Dateien?\n" +
            "     Interner Speicher → ACRCalls → ACRPhone"
        );
        helpCard.addView(helpText);

        btnHelp = new android.widget.Button(this);
        btnHelp.setText("❓ Hilfe: ACR einrichten");
        btnHelp.setTextColor(0xFF93c5fd);
        btnHelp.setBackgroundColor(0xFF1e3a5f);
        btnHelp.setOnClickListener(v -> {
            helpOpen[0] = !helpOpen[0];
            helpCard.setVisibility(helpOpen[0] ? View.VISIBLE : View.GONE);
            btnHelp.setText(helpOpen[0] ? "✖ Hilfe schließen" : "❓ Hilfe: ACR einrichten");
        });
        LinearLayout.LayoutParams helpBtnLp = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        helpBtnLp.setMargins(dp(16), dp(4), dp(16), 0);
        btnHelp.setLayoutParams(helpBtnLp);
        root.addView(btnHelp);
        root.addView(helpCard);

        header = new TextView(this);
        header.setPadding(dp(16), dp(8), dp(16), dp(8));
        header.setTextColor(0xFF94a3b8);
        header.setText("Lade …");
        root.addView(header);

        // 🆕 v6.62.892 (Patrick 23.05. 11:15): Bulk-Loesch-Button (alle aelter als 30 Tage).
        //   Patrick: 'ich muss die Fahrten ja loeschen koennen damit das nicht ueberquillt'.
        //   Einzel-Loeschen via Samsung Owner-Lock unzuverlaessig — Bulk loescht in einem Rutsch
        //   mit allen 6 Strategien pro Datei + zeigt eine Erfolgs-Statistik am Ende.
        // 🆕 v6.62.895 (Patrick 23.05. 14:54): Bulk-Verstecken statt Bulk-Loeschen
        //   (zuverlaessig auf Samsung). Datei bleibt, wird aber nicht mehr angezeigt.
        android.widget.Button btnBulkHide = new android.widget.Button(this);
        btnBulkHide.setText("👁️ Alle aelter als 30 Tage verstecken");
        btnBulkHide.setTextColor(0xFF6b7280);
        btnBulkHide.setOnClickListener(v -> confirmBulkHideOlderThan30Days());
        LinearLayout.LayoutParams bulkLp = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        bulkLp.setMargins(dp(16), 0, dp(16), dp(8));
        btnBulkHide.setLayoutParams(bulkLp);
        root.addView(btnBulkHide);

        // 🆕 v6.63.015 (Patrick 29.05. 19:13): Auto-Recorder-Toggle.
        //   In-App-Recorder per Default an; User kann ihn hier deaktivieren.
        final android.content.SharedPreferences _recPrefs = getSharedPreferences("call_recorder_prefs", MODE_PRIVATE);
        final android.widget.Switch swAutoRec = new android.widget.Switch(this);
        swAutoRec.setText("🎙️ Auto-Aufnahme bei Anruf (In-App)");
        swAutoRec.setTextColor(0xFFf8fafc);
        // 🐛 v6.63.028 (Patrick 30.05.): Default OFF damit Recorder bei Install stumm bleibt
        swAutoRec.setChecked(_recPrefs.getBoolean("auto_record_enabled", false));
        swAutoRec.setPadding(dp(16), dp(8), dp(16), dp(8));
        swAutoRec.setOnCheckedChangeListener((cb, isChecked) -> {
            _recPrefs.edit().putBoolean("auto_record_enabled", isChecked).apply();
            Toast.makeText(this, isChecked ? "✅ Auto-Aufnahme AN" : "⛔ Auto-Aufnahme AUS", Toast.LENGTH_SHORT).show();
        });
        root.addView(swAutoRec);

        // 🆕 v6.63.019 (Patrick 29.05. 20:24 "kann ich das auch wieder ausschalten"):
        //   Separater Toggle für Auto-Lautsprecher/BT-Routing. Default ON. Wenn aus,
        //   bleibt die Aufnahme zwar an, aber Patrick verliert die Anrufer-Stimme
        //   (Phone-Mikro hört nur das eigene Sprechen).
        final android.widget.Switch swLoud = new android.widget.Switch(this);
        swLoud.setText("🔊 Auto-Lautsprecher/Bluetooth bei Anruf");
        swLoud.setTextColor(0xFFf8fafc);
        swLoud.setChecked(_recPrefs.getBoolean("auto_loud_routing_enabled", true));
        swLoud.setPadding(dp(16), dp(8), dp(16), dp(8));
        swLoud.setOnCheckedChangeListener((cb, isChecked) -> {
            _recPrefs.edit().putBoolean("auto_loud_routing_enabled", isChecked).apply();
            Toast.makeText(this, isChecked ? "✅ Lautsprecher/BT-Auto AN" : "⛔ Lautsprecher/BT-Auto AUS — Aufnahme hört nur dich", Toast.LENGTH_LONG).show();
        });
        root.addView(swLoud);

        // Versteckte einblenden
        android.widget.Button btnShowHidden = new android.widget.Button(this);
        btnShowHidden.setText("🔓 Versteckte einblenden");
        btnShowHidden.setTextColor(0xFF6b7280);
        btnShowHidden.setOnClickListener(v -> {
            _showHidden = !_showHidden;
            btnShowHidden.setText(_showHidden ? "🔒 Versteckte ausblenden" : "🔓 Versteckte einblenden");
            scanRecordings();
        });
        LinearLayout.LayoutParams sh = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        sh.setMargins(dp(16), 0, dp(16), dp(8));
        btnShowHidden.setLayoutParams(sh);
        root.addView(btnShowHidden);

        // 🆕 v6.63.442 (Patrick 20.06. 12:35 Bridge: "Aus dem Papierkorb wiederherstellen
        //   müsste es auch gehen. Dass man sich aber die Sachen auch anhören kann im
        //   Papierkorb"): Papierkorb-Button zeigt versteckte _papierkorb-Aufnahmen
        //   im selben RecyclerView mit Restore-Button statt Lösch-Button.
        android.widget.Button btnTrash = new android.widget.Button(this);
        btnTrash.setText("🗑️ Papierkorb (zum Wiederherstellen)");
        btnTrash.setTextColor(0xFFb45309);
        btnTrash.setOnClickListener(v -> {
            _showTrash = !_showTrash;
            btnTrash.setText(_showTrash ? "🔙 Zurück zu Aufnahmen" : "🗑️ Papierkorb (zum Wiederherstellen)");
            scanRecordings();
        });
        LinearLayout.LayoutParams sht = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        sht.setMargins(dp(16), 0, dp(16), dp(8));
        btnTrash.setLayoutParams(sht);
        root.addView(btnTrash);

        permHint = new TextView(this);
        permHint.setPadding(dp(16), dp(16), dp(16), dp(16));
        permHint.setTextColor(0xFFef4444);
        permHint.setVisibility(View.GONE);
        root.addView(permHint);

        progress = new ProgressBar(this);
        progress.setLayoutParams(new LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT));
        ((LinearLayout.LayoutParams) progress.getLayoutParams()).gravity = Gravity.CENTER_HORIZONTAL;
        root.addView(progress);

        rv = new RecyclerView(this);
        rv.setLayoutManager(new LinearLayoutManager(this));
        rv.setLayoutParams(new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f));
        adapter = new RecAdapter();
        rv.setAdapter(adapter);
        root.addView(rv);

        setContentView(root);

        checkPermsAndLoad();
    }

    private int dp(int v) { return (int)(v * getResources().getDisplayMetrics().density); }

    private void checkPermsAndLoad() {
        // 🐛 v6.63.030 (Patrick 30.05. 08:14 "kann Aufnahmen nicht mehr sehen"):
        //   Activity fragt nur noch Storage-Permission ab. RECORD_AUDIO +
        //   READ_PHONE_STATE für den In-App-Recorder waren in v6.63.016 ergänzt,
        //   aber wenn Patrick sie verweigert kommt der Permission-Dialog dauerhaft
        //   (Android "do not ask again"-State) und die Liste lädt nicht. ACR-Aufnahmen
        //   sehen ist NUR Storage-Berechtigung — kein Mic / Telefon nötig.
        String need = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
            ? Manifest.permission.READ_MEDIA_AUDIO
            : Manifest.permission.READ_EXTERNAL_STORAGE;
        if (checkSelfPermission(need) != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this, new String[]{need}, REQ_PERM);
            return;
        }
        loadCrmThenScan();
    }

    @Override
    public void onRequestPermissionsResult(int code, @NonNull String[] perms, @NonNull int[] res) {
        super.onRequestPermissionsResult(code, perms, res);
        if (code == REQ_PERM) {
            if (res.length > 0 && res[0] == PackageManager.PERMISSION_GRANTED) loadCrmThenScan();
            else {
                permHint.setVisibility(View.VISIBLE);
                permHint.setText("Berechtigung verweigert. Bitte in Einstellungen → Apps → Funk Taxi → Berechtigungen 'Audio' erlauben.");
                progress.setVisibility(View.GONE);
            }
        }
    }

    private void loadCrmThenScan() {
        DatabaseReference ref = FirebaseDatabase.getInstance(DB_URL).getReference("customers");
        ref.addListenerForSingleValueEvent(new ValueEventListener() {
            @Override public void onDataChange(@NonNull DataSnapshot snap) {
                for (DataSnapshot c : snap.getChildren()) {
                    String cid = c.getKey();
                    String name = c.child("name").getValue(String.class);
                    String firma = c.child("firmenname").getValue(String.class);
                    String displayName = name != null ? name : (firma != null ? firma : "?");
                    String[] phoneFields = {"phone","mobilePhone","mobile","phone1","phone2","phone3"};
                    for (String f : phoneFields) {
                        String p = c.child(f).getValue(String.class);
                        if (p != null) {
                            String np = normalizePhone(p);
                            crmByPhone.put(np, displayName);
                            if (cid != null) crmIdByPhone.put(np, cid);
                        }
                    }
                    DataSnapshot addit = c.child("additionalPhones");
                    if (addit.exists()) {
                        for (DataSnapshot ap : addit.getChildren()) {
                            String p = ap.getValue(String.class);
                            if (p != null) {
                                String np = normalizePhone(p);
                                crmByPhone.put(np, displayName);
                                if (cid != null) crmIdByPhone.put(np, cid);
                            }
                        }
                    }
                }
                Log.i(TAG, "CRM geladen: " + crmByPhone.size() + " Telefonnummern");
                scanRecordings();
            }
            @Override public void onCancelled(@NonNull DatabaseError err) {
                Log.w(TAG, "CRM-Lade-Fehler: " + err.getMessage());
                scanRecordings();
            }
        });
    }

    private String normalizePhone(String p) {
        return p.replaceAll("[^0-9+]", "");
    }

    // 🆕 v6.62.895 (Patrick 23.05. 14:54): Verstecken-Set aus SharedPreferences.
    //   Echtes Loeschen klappt nicht zuverlaessig auf Samsung S9+. 'Verstecken' filtert
    //   die m4a-Datei aus der Liste raus (Datei bleibt im Speicher, ACR Phone verwaltet das).
    private java.util.Set<String> _hiddenRecordingPaths = new java.util.HashSet<>();
    private boolean _showHidden = false;
    // v6.63.442 Patrick 20.06. 12:35: Papierkorb-Modus mit Restore-Button
    private boolean _showTrash = false;

    private void loadHiddenSet() {
        try {
            String json = getSharedPreferences("acr_recordings", MODE_PRIVATE).getString("hidden_paths", "[]");
            org.json.JSONArray arr = new org.json.JSONArray(json);
            _hiddenRecordingPaths.clear();
            for (int i = 0; i < arr.length(); i++) _hiddenRecordingPaths.add(arr.getString(i));
        } catch (Throwable _t) { _hiddenRecordingPaths.clear(); }
    }
    private void saveHiddenSet() {
        try {
            org.json.JSONArray arr = new org.json.JSONArray();
            for (String p : _hiddenRecordingPaths) arr.put(p);
            getSharedPreferences("acr_recordings", MODE_PRIVATE).edit().putString("hidden_paths", arr.toString()).apply();
        } catch (Throwable _t) {}
    }
    private void hideRecording(Recording r) {
        if (r == null || r.file == null) return;
        _hiddenRecordingPaths.add(r.file.getAbsolutePath());
        saveHiddenSet();
        adapter.removeRecording(r);
        Toast.makeText(this, "👁️ Versteckt — Datei bleibt im Speicher", Toast.LENGTH_SHORT).show();
    }

    // 🆕 v6.63.442: Wiederherstellt eine m4a-Datei aus /sdcard/ACRCalls/_papierkorb/
    //   in den Original-Pfad. Original-Pfad ist im Dateinamen als 'Timestamp__origRel'
    //   codiert — origRel enthält alle Pfad-Tokens via '_' getrennt: '_YYYY_MM_DD_+TelNr_+TelNr-X-Y.m4a'
    private void restoreFromTrash(Recording r) {
        new androidx.appcompat.app.AlertDialog.Builder(this)
            .setTitle("Wiederherstellen?")
            .setMessage(r.phone + "\n\nDatei wird in den Original-ACRCalls-Pfad zurückverschoben.")
            .setPositiveButton("Wiederherstellen", (d, w) -> {
                stopPlayback();
                try {
                    String fn = r.file.getName();
                    int sep = fn.indexOf("__");
                    if (sep <= 0) {
                        Toast.makeText(this, "Original-Pfad nicht im Dateinamen — manuell verschieben", Toast.LENGTH_LONG).show();
                        return;
                    }
                    String origRel = fn.substring(sep + 2);
                    // origRel z.B. "_2026_06_17_+491743045755_+491743045755-0-1781705161261.m4a"
                    // Parse: jahr=2026, monat=06, tag=17, phoneDir=+491743045755, fileName=+49...m4a
                    String[] parts = origRel.split("_");
                    if (parts.length < 5) {
                        Toast.makeText(this, "Pfad-Format unbekannt", Toast.LENGTH_LONG).show();
                        return;
                    }
                    // [0]="" (leading _), [1]=year, [2]=month, [3]=day, [4]=phoneDir, [5..]=fileName mit _ als Trenner
                    String year = parts[1], month = parts[2], day = parts[3], phoneDir = parts[4];
                    StringBuilder fname = new StringBuilder();
                    for (int i = 5; i < parts.length; i++) {
                        if (i > 5) fname.append("_");
                        fname.append(parts[i]);
                    }
                    java.io.File targetDir = new java.io.File(ACR_ROOT, "ACRPhone/" + year + "/" + month + "/" + day + "/" + phoneDir);
                    if (!targetDir.exists()) targetDir.mkdirs();
                    java.io.File targetFile = new java.io.File(targetDir, fname.toString());
                    boolean ok = r.file.renameTo(targetFile);
                    if (!ok) {
                        // Fallback: copy+delete
                        try (java.io.InputStream in = new java.io.FileInputStream(r.file);
                             java.io.OutputStream out = new java.io.FileOutputStream(targetFile)) {
                            byte[] buf = new byte[8192]; int n;
                            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                        }
                        ok = r.file.delete();
                    }
                    if (ok) {
                        Toast.makeText(this, "✅ Wiederhergestellt: " + targetFile.getName(), Toast.LENGTH_LONG).show();
                        if (currentDetailDialog != null) currentDetailDialog.dismiss();
                        scanRecordings();
                    } else {
                        Toast.makeText(this, "❌ Wiederherstellen fehlgeschlagen", Toast.LENGTH_LONG).show();
                    }
                } catch (Exception e) {
                    Toast.makeText(this, "Fehler: " + e.getMessage(), Toast.LENGTH_LONG).show();
                    Log.w(TAG, "v6.63.442 Restore Fehler: " + e.getMessage());
                }
            })
            .setNegativeButton("Abbrechen", null)
            .show();
    }

    // 🆕 v6.63.442: Scant /sdcard/ACRCalls/_papierkorb/ und baut Recording-Objekte
    //   mit Original-Pfad-Info im Dateinamen (Timestamp__origRel).
    private void scanTrashRecordings() {
        progress.setVisibility(View.VISIBLE);
        new Thread(() -> {
            List<Recording> all = new ArrayList<>();
            try {
                java.io.File trashRoot = new java.io.File(ACR_ROOT, "_papierkorb");
                if (trashRoot.exists() && trashRoot.isDirectory()) {
                    java.io.File[] trashFiles = trashRoot.listFiles();
                    if (trashFiles != null) for (java.io.File tf : trashFiles) {
                        if (!tf.getName().endsWith(".m4a")) continue;
                        Recording r = new Recording();
                        r.file = tf;
                        String fn = tf.getName();
                        int sep = fn.indexOf("__");
                        long ts = 0;
                        if (sep > 0) {
                            try { ts = Long.parseLong(fn.substring(0, sep)); } catch (Exception _ig) {}
                            String origRel = fn.substring(sep + 2);
                            // Phone aus Original-Pfad rauspuhlen — Format _YYYY_MM_DD_+TelNr_+TelNr-X-Y.m4a
                            int pIdx = origRel.indexOf("+");
                            if (pIdx >= 0) {
                                int pEnd = origRel.indexOf("_", pIdx);
                                if (pEnd > 0) r.phone = origRel.substring(pIdx, pEnd);
                                else r.phone = "?";
                            } else r.phone = "?";
                        } else {
                            r.phone = "?";
                        }
                        r.timestamp = ts > 0 ? ts : tf.lastModified();
                        r.size = tf.length();
                        r.direction = 0;
                        // CRM-Match übersprungen im Trash-Modus (kein Helper im scope)
                        all.add(r);
                    }
                }
            } catch (Exception _e) { Log.w(TAG, "v6.63.442 Trash-Scan Fehler: " + _e.getMessage()); }
            Collections.sort(all, new Comparator<Recording>() {
                @Override public int compare(Recording a, Recording b) { return Long.compare(b.timestamp, a.timestamp); }
            });
            final int finalSize = all.size();
            runOnUiThread(() -> {
                progress.setVisibility(View.GONE);
                header.setText("🗑️ Papierkorb: " + finalSize + " Aufnahmen — Tap zum Anhören + Wiederherstellen-Button");
                adapter.setData(all);
            });
        }).start();
    }

    private void scanRecordings() {
        loadHiddenSet();
        // 🆕 v6.63.442 Papierkorb-Modus: scant /ACRCalls/_papierkorb/ statt normaler Ordner
        if (_showTrash) {
            scanTrashRecordings();
            return;
        }
        // 🆕 v6.63.015: Beide Verzeichnisse scannen (ACR + In-App-Recorder).
        java.util.List<File> roots = new java.util.ArrayList<>();
        if (ACR_ROOT.exists() && ACR_ROOT.isDirectory()) roots.add(ACR_ROOT);
        if (FUNKTAXI_ROOT.exists() && FUNKTAXI_ROOT.isDirectory()) roots.add(FUNKTAXI_ROOT);
        if (roots.isEmpty()) {
            header.setText("⚠️ Kein ACR-Ordner gefunden — bitte ACR Phone App installieren.\nSiehe Hilfe-Button oben.");
            progress.setVisibility(View.GONE);
            // Hilfe automatisch aufklappen damit der Fahrer sofort sieht was zu tun ist
            runOnUiThread(() -> {
                helpCard.setVisibility(View.VISIBLE);
                helpOpen[0] = true;
                btnHelp.setText("✖ Hilfe schließen");
            });
            return;
        }
        new Thread(() -> {
            List<Recording> all = new ArrayList<>();
            // v6.63.020: optionales -CW-Suffix für Call-Waiting-Aufnahmen
            // v6.63.613: Regex erweitert — erkennt jetzt auch nicht-numerische Namen (Privat, Anonym,
            //   Unbekannt) die ACR für unterdrückte/unbekannte Nummern nutzt. normalizePhone() gibt
            //   "" zurück → kein CRM-Match, aber Aufnahme wird in Liste angezeigt.
            Pattern fileRe = Pattern.compile("^([^\\s-][^-]*)-(\\d+)(?:-CW)?-(\\d+)\\.m4a$");
            long cutoff = System.currentTimeMillis() - 90L*24*3600*1000;
            // 🆕 v6.63.414 Papierkorb-Auto-Cleanup: alle Files in _papierkorb älter als 30 Tage entfernen
            try {
                java.io.File trashRoot = new java.io.File(ACR_ROOT, "_papierkorb");
                if (trashRoot.exists() && trashRoot.isDirectory()) {
                    long trashCutoff = System.currentTimeMillis() - 30L*24*3600*1000;
                    java.io.File[] trashFiles = trashRoot.listFiles();
                    int cleaned = 0;
                    if (trashFiles != null) for (java.io.File tf : trashFiles) {
                        // Filename startet mit Timestamp z.B. '1781807402537__...'
                        String fn = tf.getName();
                        int sep = fn.indexOf("__");
                        if (sep > 0) {
                            try {
                                long ts = Long.parseLong(fn.substring(0, sep));
                                if (ts < trashCutoff) { if (tf.delete()) cleaned++; }
                            } catch (Exception _ig) {}
                        }
                    }
                    if (cleaned > 0) Log.i(TAG, "v6.63.414 Papierkorb-Cleanup: " + cleaned + " Dateien älter 30 Tage gelöscht");
                }
            } catch (Exception _e) { Log.w(TAG, "v6.63.414 Papierkorb-Cleanup Fehler: " + _e.getMessage()); }
            // walk: /ROOT/YYYY/MM/DD/+TelNr/*.m4a — beide Verzeichnisse
            java.util.List<File> allYears = new java.util.ArrayList<>();
            for (File root : roots) {
                File[] ys = root.listFiles();
                if (ys != null) for (File y : ys) allYears.add(y);
            }
            File[] years = allYears.toArray(new File[0]);
            for (File year : years) {
                if (!year.isDirectory()) continue;
                File[] months = year.listFiles();
                if (months == null) continue;
                for (File month : months) {
                    if (!month.isDirectory()) continue;
                    File[] days = month.listFiles();
                    if (days == null) continue;
                    for (File day : days) {
                        if (!day.isDirectory()) continue;
                        File[] phoneDirs = day.listFiles();
                        if (phoneDirs == null) continue;
                        for (File phoneDir : phoneDirs) {
                            if (!phoneDir.isDirectory()) continue;
                            File[] files = phoneDir.listFiles();
                            if (files == null) continue;
                            for (File f : files) {
                                if (!f.isFile() || f.length() == 0) continue;
                                String name = f.getName();
                                Matcher m = fileRe.matcher(name);
                                if (!m.matches()) continue;
                                long ts;
                                try { ts = Long.parseLong(m.group(3)); } catch (Exception e) { continue; }
                                if (ts < cutoff) continue;
                                // 🆕 v6.62.895: Versteckte Dateien rausfiltern (es sei denn _showHidden=true)
                                if (!_showHidden && _hiddenRecordingPaths.contains(f.getAbsolutePath())) continue;
                                Recording r = new Recording();
                                r.file = f;
                                r.phone = m.group(1);
                                try { r.direction = Integer.parseInt(m.group(2)); } catch (Exception e) { r.direction = 0; }
                                r.timestamp = ts;
                                r.size = f.length();
                                String np = normalizePhone(r.phone);
                                r.customerName = crmByPhone.get(np);
                                r.customerId = crmIdByPhone.get(np);
                                all.add(r);
                            }
                        }
                    }
                }
            }
            Collections.sort(all, new Comparator<Recording>() {
                @Override public int compare(Recording a, Recording b) { return Long.compare(b.timestamp, a.timestamp); }
            });
            // v6.62.863 (Patrick 22.05. 15:41): Parallel-Anruf-Indikator — wenn 2 Aufnahmen
            // zeitlich nah beieinander liegen (<60 Sek Abstand), markieren als 'verpasst evt.'
            // weil ACR Phone NoAccessibility den 2. Anruf nicht zuverlässig aufnimmt während
            // der 1. läuft.
            // v6.63.428 (Patrick 19.06. 21:50 Bridge: "Danilo 10:12 Aufnahme 5:24 lang,
            //   bei 3:09 kam zweiter Anruf, in Detail steht 2. Nummer drunter — sollte
            //   als parallel markiert werden"): 60 Sek-Schwelle reichte nur wenn 2.
            //   Aufnahme PRAKTISCH gleichzeitig startete. Realer Fall: 5+ Min Aufnahme,
            //   2. Anruf kommt mitten drin → Start-Start-Diff war 3+ Min → nicht erkannt.
            //   Schwelle auf 600 Sek (10 Min) — deckt die typischen langen Hotel/Kunden-
            //   Telefonate ab. False-Positives sind nur eine gelbe Markierung, kein Block.
            for (int i = 0; i < all.size(); i++) {
                Recording cur = all.get(i);
                for (int j = 0; j < all.size(); j++) {
                    if (i == j) continue;
                    Recording oth = all.get(j);
                    long diff = Math.abs(cur.timestamp - oth.timestamp);
                    if (diff < 180_000) {  // v6.63.440 Patrick 20.06. 11:46: 600s war zu viel — alles parallel markiert. 180s (3 Min) reicht für Anklopfen
                        cur.parallel = true;
                        // v6.63.182 (Patrick 05.06. 18:04): Partner-Info merken für UI-Anzeige
                        if (cur.parallelPartnerName == null && cur.parallelPartnerPhone == null) {
                            cur.parallelPartnerName = oth.customerName;
                            cur.parallelPartnerPhone = oth.phone;
                        }
                        // v6.63.184 (Patrick 05.06. 19:38): alle Partner sammeln, nicht nur ersten
                        cur.parallelPartners.add(new String[]{ oth.customerName, oth.phone, oth.customerId });
                    }
                }
            }
            // 🆕 v6.63.614: CallLog-Abgleich — findet Anklopf-Partner auch wenn ACR nur 1 Datei erstellt hat.
            //   Android-System-CallLog enthält JEDEN Anruf. Für jede Aufnahme: welche anderen
            //   Nummern sind im CallLog innerhalb ±3 Min des Aufnahme-Timestamps?
            //   Das funktioniert auch ohne zweite Datei.
            if (checkSelfPermission(Manifest.permission.READ_CALL_LOG) == PackageManager.PERMISSION_GRANTED) {
                try {
                    long callLogLookback = 90L * 24 * 3600 * 1000; // 90 Tage wie Aufnahmen
                    long minTs = System.currentTimeMillis() - callLogLookback;
                    android.database.Cursor cur = getContentResolver().query(
                        android.provider.CallLog.Calls.CONTENT_URI,
                        new String[]{ android.provider.CallLog.Calls.NUMBER, android.provider.CallLog.Calls.DATE },
                        android.provider.CallLog.Calls.DATE + " >= ?",
                        new String[]{ String.valueOf(minTs) },
                        android.provider.CallLog.Calls.DATE + " DESC"
                    );
                    // CallLog-Einträge in Map: timestamp → normalisierte Nummer
                    java.util.List<long[]> callLogTs = new java.util.ArrayList<>();
                    java.util.List<String> callLogNums = new java.util.ArrayList<>();
                    if (cur != null) {
                        int colNum = cur.getColumnIndex(android.provider.CallLog.Calls.NUMBER);
                        int colDate = cur.getColumnIndex(android.provider.CallLog.Calls.DATE);
                        while (cur.moveToNext()) {
                            String num = cur.getString(colNum);
                            long date = cur.getLong(colDate);
                            if (num == null || num.isEmpty()) continue;
                            callLogTs.add(new long[]{ date });
                            callLogNums.add(normalizePhone(num));
                        }
                        cur.close();
                    }
                    // Für jede Aufnahme: CallLog-Nummern innerhalb Zeitfenster suchen
                    // v6.63.717 (Patrick 15.07.): Fenster asymmetrisch — bei outgoing (Patrick ruft
                    //   raus) sucht 15 Min NACH Aufnahme-Start (Anklopf-Anruf kommt mitten im laufenden
                    //   Gespräch). Vorher 180s: reichte nur wenn Anklopfer sehr früh anrief. Jetzt
                    //   fangen wir auch die "8-Min-später-Anklopf"-Fälle wie 15.7. 12:39/12:47 ein.
                    for (Recording r : all) {
                        String rNorm = normalizePhone(r.phone != null ? r.phone : "");
                        java.util.Set<String> alreadyPartner = new java.util.HashSet<>();
                        alreadyPartner.add(rNorm);
                        if (r.parallelPartners != null) {
                            for (String[] pp : r.parallelPartners) if (pp[1] != null) alreadyPartner.add(normalizePhone(pp[1]));
                        }
                        // Outgoing (direction=1): 15 Min asymmetrisch (Gespräch läuft weiter, Anklopfer kommt mitten drin)
                        // Incoming (direction=0): symmetrisch ±3 Min (Anklopfer kommt kurz während Kunden-Anruf rein)
                        final boolean _isOutgoing = r.direction == 1;
                        final long _windowBefore = 180_000L; // 3 Min
                        final long _windowAfter = _isOutgoing ? 900_000L : 180_000L; // 15 Min bzw 3 Min
                        for (int ci = 0; ci < callLogTs.size(); ci++) {
                            long ts = callLogTs.get(ci)[0];
                            long diff = ts - r.timestamp;
                            // diff negativ = CallLog VOR Aufnahme, positiv = NACH
                            if (diff < -_windowBefore || diff > _windowAfter) continue;
                            String clNum = callLogNums.get(ci);
                            if (clNum.isEmpty() || alreadyPartner.contains(clNum)) continue;
                            // Neue Nummer aus CallLog — Anklopf-Partner!
                            r.parallel = true;
                            String clName = crmByPhone.get(clNum);
                            String clId = crmIdByPhone.get(clNum);
                            r.parallelPartners.add(new String[]{ clName, clNum, clId });
                            if (r.parallelPartnerPhone == null) {
                                r.parallelPartnerName = clName;
                                r.parallelPartnerPhone = clNum;
                            }
                            alreadyPartner.add(clNum);
                        }
                    }
                } catch (Exception _clErr) {
                    Log.w(TAG, "v6.63.614 CallLog-Abgleich Fehler: " + _clErr.getMessage());
                }
            }
            int matched = 0;
            for (Recording r : all) if (r.customerName != null) matched++;
            final int finalMatched = matched;
            runOnUiThread(() -> {
                progress.setVisibility(View.GONE);
                header.setText(all.size() + " Aufnahmen (letzte 90 Tage) · " + finalMatched + " mit CRM-Treffer");
                adapter.setData(all);
            });
        }).start();
    }

    private void playRecording(Recording r) {
        showRecordingDialog(r);
    }

    // v6.62.861: Tap = Detail-Dialog mit Audio-Player (Play/Pause/Stop/Seek) + Aktion-Buttons
    // (Vorbestellung, Sofort-Fahrt, CRM, History) — analog zu CallLogActivity.showActionDialog.
    private void showRecordingDialog(Recording r) {
        if (mp != null) { try { mp.stop(); } catch (Exception ig) {} mp.release(); mp = null; }
        try {
            mp = new MediaPlayer();
            mp.setDataSource(r.file.getAbsolutePath());
            mp.prepare();
        } catch (Exception e) {
            Toast.makeText(this, "Audio-Fehler: " + e.getMessage(), Toast.LENGTH_LONG).show();
            return;
        }
        playing = r;

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(20), dp(20), dp(20), dp(20));
        root.setBackgroundColor(0xFF1e293b);

        // Header
        String dirStr = r.direction == 0 ? "⬅️ Eingehend" : "➡️ Ausgehend";
        String name = r.customerName != null ? r.customerName : r.phone;
        TextView th = new TextView(this);
        th.setText(dirStr + "  " + name);
        th.setTextColor(0xFFffffff); th.setTextSize(17);
        root.addView(th);
        TextView td = new TextView(this);
        td.setText(new SimpleDateFormat("dd.MM.yyyy HH:mm", Locale.GERMAN).format(new Date(r.timestamp)) + "  ·  " + r.phone);
        td.setTextColor(0xFF94a3b8); td.setTextSize(12);
        td.setPadding(0, dp(4), 0, dp(16));
        root.addView(td);

        // Audio-Player
        LinearLayout playerBar = new LinearLayout(this);
        playerBar.setOrientation(LinearLayout.HORIZONTAL);
        playerBar.setGravity(Gravity.CENTER_VERTICAL);
        android.widget.Button playBtn = new android.widget.Button(this);
        playBtn.setText("▶");
        playBtn.setTextSize(20);
        android.widget.Button skipBackBtn = new android.widget.Button(this);
        skipBackBtn.setText("⏪");
        skipBackBtn.setOnClickListener(v -> { if (mp != null) { int pos = Math.max(0, mp.getCurrentPosition() - 10000); mp.seekTo(pos); } });
        android.widget.Button skipFwdBtn = new android.widget.Button(this);
        skipFwdBtn.setText("⏩");
        skipFwdBtn.setOnClickListener(v -> { if (mp != null) { int pos = Math.min(mp.getDuration(), mp.getCurrentPosition() + 10000); mp.seekTo(pos); } });
        TextView posLabel = new TextView(this);
        posLabel.setTextColor(0xFFcbd5e1);
        posLabel.setPadding(dp(10), 0, dp(10), 0);
        posLabel.setText("00:00 / " + msToTime(mp.getDuration()));
        playerBar.addView(skipBackBtn);
        playerBar.addView(playBtn);
        playerBar.addView(skipFwdBtn);
        playerBar.addView(posLabel);
        root.addView(playerBar);

        SeekBar seek = new SeekBar(this);
        seek.setMax(mp.getDuration());
        seek.setProgress(0);
        seek.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
            @Override public void onProgressChanged(SeekBar s, int p, boolean user) { if (user && mp != null) mp.seekTo(p); }
            @Override public void onStartTrackingTouch(SeekBar s) {}
            @Override public void onStopTrackingTouch(SeekBar s) {}
        });
        root.addView(seek);

        final Handler[] hr = new Handler[]{ null };
        final Runnable[] tick = new Runnable[]{ null };
        playBtn.setOnClickListener(v -> {
            if (mp == null) return;
            if (mp.isPlaying()) {
                mp.pause();
                playBtn.setText("▶");
            } else {
                mp.start();
                playBtn.setText("⏸");
                if (hr[0] == null) hr[0] = new Handler(Looper.getMainLooper());
                tick[0] = () -> {
                    if (mp == null || !mp.isPlaying()) return;
                    int p = mp.getCurrentPosition();
                    seek.setProgress(p);
                    posLabel.setText(msToTime(p) + " / " + msToTime(mp.getDuration()));
                    hr[0].postDelayed(tick[0], 250);
                };
                hr[0].post(tick[0]);
            }
        });

        // Auto-Play sofort
        try { mp.start(); playBtn.setText("⏸");
            if (hr[0] == null) hr[0] = new Handler(Looper.getMainLooper());
            tick[0] = () -> {
                if (mp == null || !mp.isPlaying()) return;
                int p = mp.getCurrentPosition();
                seek.setProgress(p);
                posLabel.setText(msToTime(p) + " / " + msToTime(mp.getDuration()));
                hr[0].postDelayed(tick[0], 250);
            };
            hr[0].post(tick[0]);
        } catch (Exception ig) {}

        mp.setOnCompletionListener(p -> { playBtn.setText("▶"); seek.setProgress(mp.getDuration()); });

        // Spacer
        View spacer = new View(this);
        spacer.setLayoutParams(new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(16)));
        root.addView(spacer);

        // Aktion-Buttons (gleiche Logik wie CallLogActivity)
        TextView actionLbl = new TextView(this);
        actionLbl.setText("📋 Aktion aus dieser Aufnahme:");
        actionLbl.setTextColor(0xFFa3a3a3); actionLbl.setTextSize(13);
        actionLbl.setPadding(0, dp(8), 0, dp(8));
        root.addView(actionLbl);

        boolean hasCrm = r.customerName != null;
        android.widget.Button btnVorbestellung = new android.widget.Button(this);
        btnVorbestellung.setText("📅 Vorbestellung erstellen");
        btnVorbestellung.setOnClickListener(v -> {
            android.content.Intent i = new android.content.Intent(this, CrmSearchActivity.class);
            if (hasCrm) {
                // 🆕 v6.62.890 (Patrick 23.05. 09:12): customer_id PFLICHT mitgeben, sonst
                //   faellt CrmSearchActivity in den Neukunden-Fallback und oeffnet eine
                //   "andere Maske" statt der Hotel/Stammkunden-Maske mit allen voreingestellten
                //   Daten (Adresse, customerKind, etc.).
                if (r.customerId != null) i.putExtra("auto_vorbestellung_customer_id", r.customerId);
                i.putExtra("auto_vorbestellung_phone", r.phone);
                i.putExtra("auto_vorbestellung_name", r.customerName);
            } else {
                i.putExtra("auto_vorbestellung_phone", r.phone);
            }
            // 🆕 v6.63.011 (Patrick 29.05. 17:23 "nicht zurück zum Abhören"): Recording-Pfad
            //   mitgeben damit der Booking-Dialog einen 🔊 Aufnahme-Replay-Button anzeigt.
            if (r.file != null) i.putExtra("auto_vorbestellung_recording_path", r.file.getAbsolutePath());
            startActivity(i);
        });
        root.addView(btnVorbestellung);

        if (hasCrm) {
            android.widget.Button btnHist = new android.widget.Button(this);
            btnHist.setText("📜 Bisherige Fahrten anschauen");
            btnHist.setOnClickListener(v -> {
                // 🐛 v6.63.014 (Patrick 29.05. 18:55 'bei Aufnahmen geht's nicht'):
                //   prefill_search_query existiert in CrmSearchActivity nicht — Extra
                //   wurde ignoriert, User landete in leerer CRM-Suche. Fix: auto_history_customer_id
                //   mit (wie CallLogActivity v6.62.626) → showCustomerRideHistory triggert direkt.
                android.content.Intent i = new android.content.Intent(this, CrmSearchActivity.class);
                if (r.customerId != null && !r.customerId.isEmpty()) {
                    i.putExtra("auto_history_customer_id", r.customerId);
                    if (r.customerName != null) i.putExtra("auto_history_customer_name", r.customerName);
                } else {
                    Toast.makeText(this, "❌ Kunden-ID fehlt — Aufnahme neu zuordnen", Toast.LENGTH_LONG).show();
                    return;
                }
                startActivity(i);
            });
            root.addView(btnHist);
        } else {
            android.widget.Button btnCrm = new android.widget.Button(this);
            btnCrm.setText("👤 Als CRM-Kunde anlegen");
            btnCrm.setOnClickListener(v -> {
                android.content.Intent i = new android.content.Intent(this, CrmSearchActivity.class);
                i.putExtra("prefill_new_phone", r.phone);
                startActivity(i);
            });
            root.addView(btnCrm);
        }

        // 🆕 v6.62.940 (Patrick 25.05. 15:10): Telefonnummer mit BESTEHENDEM CRM verknuepfen.
        //   Use-Case: Hotel hat mehrere Nummern, alte Nummer war im CRM, neue Nummer kommt rein →
        //   diese neue Nummer am bestehenden Eintrag ergaenzen statt als neuen Kunden anzulegen.
        android.widget.Button btnLink = new android.widget.Button(this);
        btnLink.setText("🔗 Mit anderem CRM-Kunde verknüpfen");
        btnLink.setTextColor(0xFF1d4ed8);
        btnLink.setOnClickListener(v -> {
            android.content.Intent i = new android.content.Intent(this, CrmSearchActivity.class);
            i.putExtra("link_phone_to_crm", r.phone);
            startActivity(i);
            try { if (currentDetailDialog != null) { currentDetailDialog.dismiss(); currentDetailDialog = null; } } catch (Throwable _t) {}
        });
        root.addView(btnLink);

        // 🆕 v6.62.895 (Patrick 23.05. 14:54): Verstecken-Button (zuverlaessig, anders als Loeschen)
        android.widget.Button btnHide = new android.widget.Button(this);
        btnHide.setText("👁️ Aufnahme verstecken");
        btnHide.setTextColor(0xFF6b7280);
        btnHide.setOnClickListener(v -> {
            hideRecording(r);
            // Detail-Dialog schliessen
            try {
                if (currentDetailDialog != null) { currentDetailDialog.dismiss(); currentDetailDialog = null; }
            } catch (Throwable _t) {}
            int total = adapter.getItemCount();
            header.setText(total + " Aufnahmen (letzte 90 Tage)");
        });
        root.addView(btnHide);

        // v6.62.862 (Patrick 22.05. 15:32): "wie kann ich die Anrufliste löschen" — Lösch-Button
        // unten im Detail-Dialog. Mit Bestätigungs-Dialog vor dem tatsächlichen Delete.
        // 🆕 v6.63.442 Patrick 20.06. 12:35: Im Papierkorb-Modus wird der Lösch-Button
        //   durch einen Wiederherstellen-Button ersetzt (gleiche Position, andere Funktion).
        if (_showTrash) {
            android.widget.Button btnRestore = new android.widget.Button(this);
            btnRestore.setText("♻️ Aus Papierkorb wiederherstellen");
            btnRestore.setTextColor(0xFF059669);
            btnRestore.setOnClickListener(v -> restoreFromTrash(r));
            root.addView(btnRestore);
        } else {
            android.widget.Button btnDelete = new android.widget.Button(this);
            btnDelete.setText("🗑️ Aufnahme löschen (riskant — Samsung Owner-Lock)");
            btnDelete.setTextColor(0xFFef4444);
            btnDelete.setOnClickListener(v -> confirmDeleteRecording(r));
            root.addView(btnDelete);
        }

        currentDetailDialog = new androidx.appcompat.app.AlertDialog.Builder(this)
            .setView(root)
            .setNegativeButton("Schliessen", (d, w) -> stopPlayback())
            .setOnDismissListener(d -> { stopPlayback(); currentDetailDialog = null; })
            .show();
    }

    private androidx.appcompat.app.AlertDialog currentDetailDialog = null;

    // v6.62.862: Aufnahme löschen — File von /sdcard/ACRCalls/ACRPhone/.../*.m4a entfernen
    // v6.62.884 (Patrick 23.05. 06:51): "Berechtigung fehlt" — Android 11+ braucht
    //   MANAGE_EXTERNAL_STORAGE für Lösch-Zugriff auf fremde App-Files (ACR Phone).
    //   Permission muss MANUELL in Settings aktiviert werden (kein normaler Permission-
    //   Request möglich). Wir leiten den User dorthin.
    private void confirmDeleteRecording(Recording r) {
        // 🆕 v6.62.899 (Patrick 24.05. 07:20): Permission-Check je nach Android-Version.
        //   Patrick's S9+ hat Android 8.0 (API 26) — MANAGE_EXTERNAL_STORAGE existiert dort
        //   NICHT. WRITE_EXTERNAL_STORAGE ist Pflicht. ADB-Shell rm hat bewiesen dass die
        //   Datei loeschbar IST, also ist es ein App-Permission-Problem.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            // Android 11+: MANAGE_EXTERNAL_STORAGE (Settings-Intent)
            if (!Environment.isExternalStorageManager()) {
                new androidx.appcompat.app.AlertDialog.Builder(this)
                    .setTitle("🔓 Berechtigung fehlt")
                    .setMessage("Zum Löschen von ACR-Aufnahmen brauchst Du 'Über Apps mit Zugriff auf alle Dateien'.\n\nIn den Einstellungen den Schalter für Funk Taxi auf AN setzen, dann zurück + nochmal Löschen.")
                    .setPositiveButton("Einstellungen öffnen", (d, w) -> {
                        try {
                            android.content.Intent i = new android.content.Intent(
                                android.provider.Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION,
                                android.net.Uri.parse("package:" + getPackageName()));
                            startActivity(i);
                        } catch (Exception e) {
                            try { startActivity(new android.content.Intent(android.provider.Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION)); }
                            catch (Exception _e) { Toast.makeText(this, "Einstellungen → Apps → Funk Taxi → Berechtigungen → 'Alle Dateien verwalten' AN", Toast.LENGTH_LONG).show(); }
                        }
                    })
                    .setNegativeButton("Abbrechen", null).show();
                return;
            }
        } else {
            // Android 10 und aelter: WRITE_EXTERNAL_STORAGE Runtime-Permission
            if (androidx.core.content.ContextCompat.checkSelfPermission(this,
                    android.Manifest.permission.WRITE_EXTERNAL_STORAGE) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
                androidx.core.app.ActivityCompat.requestPermissions(this,
                    new String[]{ android.Manifest.permission.WRITE_EXTERNAL_STORAGE }, 9988);
                Toast.makeText(this, "Bitte 'Speicher' erlauben + nochmal Loeschen tippen", Toast.LENGTH_LONG).show();
                return;
            }
        }
        String dt = new SimpleDateFormat("dd.MM.yyyy HH:mm", Locale.GERMAN).format(new Date(r.timestamp));
        String name = r.customerName != null ? r.customerName : r.phone;
        new androidx.appcompat.app.AlertDialog.Builder(this)
            .setTitle("Aufnahme in Papierkorb verschieben?")
            .setMessage(name + "\n" + dt + "\n\nDie m4a-Datei wird in den Papierkorb verschoben (/ACRCalls/_papierkorb/). Aus dem Papierkorb kannst du sie wiederherstellen oder endgültig löschen.")
            .setPositiveButton("In Papierkorb", (d, w) -> {
                stopPlayback();
                boolean ok = false;
                String errMsg = null;
                String diag = "exists=" + r.file.exists() + " canW=" + r.file.canWrite() + " absPath=" + r.file.getAbsolutePath();
                Log.i(TAG, "Soft-Delete-Versuch: " + diag);
                // 🆕 v6.63.414 (Patrick 18.06. 20:30 Bridge "Ja bauen"):
                //   Soft-Delete — verschiebe in /sdcard/ACRCalls/_papierkorb/ statt hart löschen.
                //   Dort liegt sie 30 Tage bis Auto-Cleanup, kann jederzeit wiederhergestellt werden.
                try {
                    java.io.File trashRoot = new java.io.File(ACR_ROOT, "_papierkorb");
                    if (!trashRoot.exists()) trashRoot.mkdirs();
                    // Dateiname mit Original-Pfad-Hash damit Wiederherstellung möglich
                    String origRel = r.file.getAbsolutePath().replace(ACR_ROOT.getAbsolutePath(), "").replaceAll("[\\\\/:]+","_");
                    java.io.File trashFile = new java.io.File(trashRoot, System.currentTimeMillis() + "__" + origRel);
                    boolean renamed = r.file.renameTo(trashFile);
                    Log.i(TAG, "v6.63.414 Soft-Delete rename: " + renamed + " → " + trashFile.getAbsolutePath());
                    if (renamed) {
                        ok = true;
                    } else {
                        // Fallback: copy + delete (wenn rename fehlt z.B. wegen verschiedener Mountpoints)
                        try (java.io.InputStream in = new java.io.FileInputStream(r.file);
                             java.io.OutputStream out = new java.io.FileOutputStream(trashFile)) {
                            byte[] buf = new byte[8192]; int n;
                            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                        }
                        ok = r.file.delete();
                        if (!ok) trashFile.delete(); // Cleanup nach Fail
                        Log.i(TAG, "v6.63.414 Soft-Delete copy+delete: " + ok);
                    }
                } catch (Exception e) {
                    errMsg = "Soft-Delete: " + e.getMessage();
                    Log.w(TAG, "v6.63.414 Soft-Delete Fehler: " + e.getMessage());
                }
                // Fallback auf alte Hart-Delete-Logik wenn Soft-Delete komplett fehlschlägt
                if (!ok) {
                try { ok = r.file.delete(); }
                catch (Exception e) { errMsg = e.getMessage(); Log.w(TAG, "Delete-Error file.delete(): " + e.getMessage()); }
                Log.i(TAG, "Direct delete result: " + ok);
                }
                // 🆕 v6.62.890 (Patrick 23.05. 09:25): 'Alle Dateien verwalten aktiv' aber Loeschen
                //   fehlschlaegt. Auf Samsung S9+ (Android 10/11) kann file.delete() trotz
                //   MANAGE_EXTERNAL_STORAGE fehlschlagen wenn ACR-App als Owner der Datei
                //   im MediaStore registriert ist. Fallback ueber ContentResolver+MediaStore-DELETE.
                if (!ok && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    try {
                        android.content.ContentResolver cr = getContentResolver();
                        android.net.Uri uri = android.provider.MediaStore.Files.getContentUri("external");
                        int deleted = cr.delete(uri, android.provider.MediaStore.Files.FileColumns.DATA + "=?",
                                                new String[]{ r.file.getAbsolutePath() });
                        Log.i(TAG, "MediaStore delete result: " + deleted + " rows");
                        if (deleted > 0) ok = true;
                        else errMsg = (errMsg == null ? "" : errMsg + " · ") + "MediaStore 0 Rows";
                    } catch (Exception e) {
                        Log.w(TAG, "MediaStore-Delete Fehler: " + e.getMessage());
                        errMsg = (errMsg == null ? "" : errMsg + " · ") + "MediaStore: " + e.getMessage();
                    }
                }
                // Try 3: Falls noch nicht gelöscht — File.delete() noch mal probieren, vielleicht
                // hat MediaStore-Delete den Owner-Lock gelöst.
                if (!ok) {
                    try { ok = r.file.delete(); Log.i(TAG, "Second file.delete: " + ok); }
                    catch (Exception e) { /* still */ }
                }
                // 🆕 v6.62.892 (Patrick 23.05. 12:30): canWrite=false trotz MANAGE_EXTERNAL_STORAGE
                //   auf Samsung S9+ — drei zusaetzliche Strategien:
                // Try 4: setWritable(true)+setReadable(true) erzwingen, dann File.delete()
                if (!ok) {
                    try {
                        r.file.setWritable(true, false);
                        r.file.setReadable(true, false);
                        ok = r.file.delete();
                        Log.i(TAG, "Try 4 setWritable+delete: " + ok + " (canW=" + r.file.canWrite() + ")");
                    } catch (Exception e) { Log.w(TAG, "Try 4 Fehler: " + e.getMessage()); }
                }
                // Try 5: java.nio.file.Files.delete(Path) — andere API mit anderer Exception
                if (!ok && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    try {
                        java.nio.file.Files.delete(r.file.toPath());
                        ok = !r.file.exists();
                        Log.i(TAG, "Try 5 Files.delete: " + ok);
                    } catch (Exception e) {
                        Log.w(TAG, "Try 5 Fehler: " + e.getMessage());
                        errMsg = (errMsg == null ? "" : errMsg + " · ") + "nio: " + e.getMessage();
                    }
                }
                // Try 6: Rename-Trick — erst in .tmp_to_delete umbenennen + dann loeschen.
                //   Manchmal hilft das gegen Samsung Owner-Lock (rename = neue File-Entity).
                if (!ok) {
                    try {
                        java.io.File tmp = new java.io.File(r.file.getParentFile(), r.file.getName() + ".tmp_to_delete");
                        boolean renamed = r.file.renameTo(tmp);
                        Log.i(TAG, "Try 6 rename: " + renamed);
                        if (renamed) {
                            ok = tmp.delete();
                            Log.i(TAG, "Try 6 delete after rename: " + ok);
                        }
                    } catch (Exception e) { Log.w(TAG, "Try 6 Fehler: " + e.getMessage()); }
                }
                if (ok) {
                    Toast.makeText(this, "📦 In Papierkorb (30 Tage)", Toast.LENGTH_SHORT).show();
                    adapter.removeRecording(r);
                    int total = adapter.getItemCount();
                    header.setText(total + " Aufnahmen (letzte 90 Tage)");
                } else {
                    String fullMsg = "❌ Löschen fehlgeschlagen" + (errMsg != null ? " — " + errMsg : "") + "\n" + diag;
                    Toast.makeText(this, fullMsg, Toast.LENGTH_LONG).show();
                    Log.w(TAG, fullMsg);
                }
            })
            .setNegativeButton("Abbrechen", null)
            .show();
    }

    private String msToTime(int ms) {
        int s = ms / 1000;
        return String.format(Locale.GERMAN, "%02d:%02d", s/60, s%60);
    }

    // 🆕 v6.62.895 (Patrick 23.05. 14:54): Bulk-Verstecken (zuverlaessig).
    private void confirmBulkHideOlderThan30Days() {
        new androidx.appcompat.app.AlertDialog.Builder(this)
            .setTitle("Alle Aufnahmen > 30 Tage verstecken?")
            .setMessage("Alle ACR-Aufnahmen aelter als 30 Tage werden aus der Liste versteckt. Die Dateien bleiben im Speicher (kannst du ueber 'Versteckte einblenden' jederzeit wiederholen).\n\nWeiter?")
            .setPositiveButton("Ja, verstecken", (d, w) -> runBulkHideOlderThan30Days())
            .setNegativeButton("Abbrechen", null)
            .show();
    }

    private void runBulkHideOlderThan30Days() {
        stopPlayback();
        loadHiddenSet();
        final long cutoff = System.currentTimeMillis() - 30L * 24L * 3600L * 1000L;
        new Thread(() -> {
            int found = 0, hidden = 0;
            if (!ACR_ROOT.exists()) {
                runOnUiThread(() -> Toast.makeText(this, "ACR-Ordner nicht gefunden", Toast.LENGTH_LONG).show());
                return;
            }
            java.util.regex.Pattern fileRe = java.util.regex.Pattern.compile("^(\\+?\\d+)-(\\d)(?:-CW)?-(\\d+)\\.m4a$");
            File[] years = ACR_ROOT.listFiles();
            if (years == null) { runOnUiThread(() -> Toast.makeText(this, "Keine Dateien", Toast.LENGTH_LONG).show()); return; }
            for (File year : years) {
                if (!year.isDirectory()) continue;
                File[] months = year.listFiles(); if (months == null) continue;
                for (File month : months) {
                    if (!month.isDirectory()) continue;
                    File[] days = month.listFiles(); if (days == null) continue;
                    for (File day : days) {
                        if (!day.isDirectory()) continue;
                        File[] phoneDirs = day.listFiles(); if (phoneDirs == null) continue;
                        for (File phoneDir : phoneDirs) {
                            if (!phoneDir.isDirectory()) continue;
                            File[] files = phoneDir.listFiles(); if (files == null) continue;
                            for (File f : files) {
                                if (!f.isFile()) continue;
                                java.util.regex.Matcher m = fileRe.matcher(f.getName());
                                if (!m.matches()) continue;
                                long ts;
                                try { ts = Long.parseLong(m.group(3)); } catch (Exception e) { continue; }
                                if (ts >= cutoff) continue;
                                found++;
                                String path = f.getAbsolutePath();
                                if (!_hiddenRecordingPaths.contains(path)) {
                                    _hiddenRecordingPaths.add(path);
                                    hidden++;
                                }
                            }
                        }
                    }
                }
            }
            saveHiddenSet();
            final int _found = found, _hid = hidden;
            runOnUiThread(() -> {
                Toast.makeText(this, "👁️ " + _hid + " versteckt (von " + _found + " >30 Tage)", Toast.LENGTH_LONG).show();
                scanRecordings();
            });
        }).start();
    }

    // 🆕 v6.62.892: Bulk-Loesch von ACR-Aufnahmen aelter als 30 Tage.
    // Iteriert ueber /sdcard/ACRCalls/ACRPhone/{year}/{month}/{day}/{phoneDir}/*.m4a,
    // versucht pro Datei alle 6 Loesch-Strategien, zeigt am Ende eine Statistik.
    private void confirmBulkDeleteOlderThan30Days() {
        // Permission-Check wie bei Einzel-Loesch
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && !Environment.isExternalStorageManager()) {
            new androidx.appcompat.app.AlertDialog.Builder(this)
                .setTitle("🔓 Berechtigung fehlt")
                .setMessage("Bulk-Loesch braucht 'Über Apps mit Zugriff auf alle Dateien'.\nEinstellungen → Funk Taxi → Berechtigungen → 'Alle Dateien verwalten' AN.")
                .setPositiveButton("Einstellungen öffnen", (d, w) -> {
                    try {
                        startActivity(new android.content.Intent(
                            android.provider.Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION,
                            android.net.Uri.parse("package:" + getPackageName())));
                    } catch (Exception e) { /* ignore */ }
                })
                .setNegativeButton("Abbrechen", null).show();
            return;
        }
        new androidx.appcompat.app.AlertDialog.Builder(this)
            .setTitle("Alle Aufnahmen > 30 Tage loeschen?")
            .setMessage("Alle ACR-Aufnahmen die aelter als 30 Tage sind, werden vom Telefon entfernt. Kann nicht rueckgaengig gemacht werden.\n\nWeiter?")
            .setPositiveButton("Ja, alle loeschen", (d, w) -> runBulkDeleteOlderThan30Days())
            .setNegativeButton("Abbrechen", null)
            .show();
    }

    private void runBulkDeleteOlderThan30Days() {
        stopPlayback();
        final long cutoff = System.currentTimeMillis() - 30L * 24L * 3600L * 1000L;
        new Thread(() -> {
            int found = 0, deleted = 0, failed = 0;
            if (!ACR_ROOT.exists()) {
                runOnUiThread(() -> Toast.makeText(this, "ACR-Ordner nicht gefunden", Toast.LENGTH_LONG).show());
                return;
            }
            java.util.regex.Pattern fileRe = java.util.regex.Pattern.compile("^(\\+?\\d+)-(\\d)(?:-CW)?-(\\d+)\\.m4a$");
            File[] years = ACR_ROOT.listFiles();
            if (years == null) { runOnUiThread(() -> Toast.makeText(this, "Keine Dateien", Toast.LENGTH_LONG).show()); return; }
            for (File year : years) {
                if (!year.isDirectory()) continue;
                File[] months = year.listFiles();
                if (months == null) continue;
                for (File month : months) {
                    if (!month.isDirectory()) continue;
                    File[] days = month.listFiles();
                    if (days == null) continue;
                    for (File day : days) {
                        if (!day.isDirectory()) continue;
                        File[] phoneDirs = day.listFiles();
                        if (phoneDirs == null) continue;
                        for (File phoneDir : phoneDirs) {
                            if (!phoneDir.isDirectory()) continue;
                            File[] files = phoneDir.listFiles();
                            if (files == null) continue;
                            for (File f : files) {
                                if (!f.isFile()) continue;
                                java.util.regex.Matcher m = fileRe.matcher(f.getName());
                                if (!m.matches()) continue;
                                long ts;
                                try { ts = Long.parseLong(m.group(3)); } catch (Exception e) { continue; }
                                if (ts >= cutoff) continue;
                                found++;
                                if (bulkDeleteOneFile(f)) deleted++; else failed++;
                            }
                        }
                    }
                }
            }
            final int _found = found, _del = deleted, _fail = failed;
            runOnUiThread(() -> {
                Toast.makeText(this, "🗑️ Bulk-Loesch fertig: " + _del + " gelöscht / " + _fail + " fehlgeschlagen / " + _found + " >30 Tage", Toast.LENGTH_LONG).show();
                scanRecordings(); // Liste neu laden
            });
        }).start();
    }

    // Versucht eine Datei zu loeschen mit allen 6 Strategien hintereinander.
    private boolean bulkDeleteOneFile(File f) {
        // Try 1: direct
        try { if (f.delete()) return true; } catch (Exception e) { /* */ }
        // Try 2: MediaStore (Android 10+)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            try {
                android.content.ContentResolver cr = getContentResolver();
                int n = cr.delete(android.provider.MediaStore.Files.getContentUri("external"),
                                  android.provider.MediaStore.Files.FileColumns.DATA + "=?",
                                  new String[]{ f.getAbsolutePath() });
                if (n > 0 || !f.exists()) return true;
            } catch (Exception e) { /* */ }
        }
        // Try 3: setWritable + delete
        try {
            f.setWritable(true, false);
            f.setReadable(true, false);
            if (f.delete()) return true;
        } catch (Exception e) { /* */ }
        // Try 4: nio Files.delete
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            try { java.nio.file.Files.delete(f.toPath()); if (!f.exists()) return true; }
            catch (Exception e) { /* */ }
        }
        // Try 5: rename + delete
        try {
            File tmp = new File(f.getParentFile(), f.getName() + ".tmp_to_delete");
            if (f.renameTo(tmp)) {
                if (tmp.delete()) return true;
            }
        } catch (Exception e) { /* */ }
        return false;
    }

    private void stopPlayback() {
        if (mp != null) { try { mp.stop(); } catch (Exception e) {} mp.release(); mp = null; }
        playing = null;
    }

    @Override protected void onDestroy() {
        super.onDestroy();
        stopPlayback();
    }

    // v6.63.184 (Patrick 05.06. 19:38 Bridge "ich würde am liebsten alle Nummern eine
    //   Vorbestellung zusammenbauen"): bei Parallel-Aufnahmen Aktions-Dialog zeigen
    //   damit Patrick wählen kann ob er die Haupt-Aufnahme oder einen Partner-Anruf als
    //   Vorbestellungs-Quelle nimmt. Vorbestellungs-Maske öffnet sich genauso wie bisher
    //   (über CrmSearchActivity mit auto_vorbestellung_* Extras), nur mit ausgewähltem
    //   Telefon/Name vorbefüllt.
    private void showRecordingActionDialog(Recording r) {
        java.util.List<String> labels = new java.util.ArrayList<>();
        java.util.List<Runnable> actions = new java.util.ArrayList<>();

        // 1) Abspielen
        labels.add("🔊 Aufnahme abspielen");
        actions.add(() -> playRecording(r));

        // 2) Vorbestellung für die Haupt-Aufnahme (= r)
        String mainLabel = r.customerName != null && !r.customerName.isEmpty()
            ? r.customerName + " (" + r.phone + ")"
            : r.phone;
        labels.add("📅 Vorbestellung für " + mainLabel);
        actions.add(() -> openVorbestellungForPhone(r.phone, r.customerName, r.customerId, r.file != null ? r.file.getAbsolutePath() : null));

        // 3) Vorbestellung für jeden Partner
        if (r.parallelPartners != null) {
            java.util.HashSet<String> seen = new java.util.HashSet<>();
            seen.add(r.phone != null ? r.phone : "");
            for (String[] p : r.parallelPartners) {
                String pName = p[0];
                String pPhone = p[1];
                String pId = p.length > 2 ? p[2] : null;
                if (pPhone == null || pPhone.isEmpty() || seen.contains(pPhone)) continue;
                seen.add(pPhone);
                String pLabel = (pName != null && !pName.isEmpty()) ? pName + " (" + pPhone + ")" : pPhone;
                labels.add("📅 Vorbestellung für " + pLabel);
                actions.add(() -> openVorbestellungForPhone(pPhone, pName, pId, null));
            }
        }

        new androidx.appcompat.app.AlertDialog.Builder(this)
            .setTitle("Was möchtest Du machen?")
            .setItems(labels.toArray(new String[0]), (d, w) -> {
                if (w >= 0 && w < actions.size()) {
                    try { actions.get(w).run(); } catch (Throwable t) {
                        Toast.makeText(this, "Fehler: " + t.getMessage(), Toast.LENGTH_LONG).show();
                    }
                }
            })
            .setNegativeButton("Abbrechen", null)
            .show();
    }

    private void openVorbestellungForPhone(String phone, String customerName, String customerId, String recordingPath) {
        android.content.Intent i = new android.content.Intent(this, CrmSearchActivity.class);
        if (customerId != null && !customerId.isEmpty()) i.putExtra("auto_vorbestellung_customer_id", customerId);
        if (phone != null) i.putExtra("auto_vorbestellung_phone", phone);
        if (customerName != null && !customerName.isEmpty()) i.putExtra("auto_vorbestellung_name", customerName);
        if (recordingPath != null) i.putExtra("auto_vorbestellung_recording_path", recordingPath);
        startActivity(i);
    }

    static class Recording {
        File file;
        String phone;
        int direction; // 0 = incoming, 1 = outgoing
        long timestamp;
        long size;
        String customerName; // null wenn nicht in CRM
        String customerId;   // 🆕 v6.62.890: CRM-ID fuer korrekten Vorbestell-Maske-Pfad (Hotel/Stamm)
        boolean parallel; // v6.62.863: anderer Anruf <60 Sek davor/danach — möglich verpasst
        // v6.63.182 (Patrick 05.06. 18:04 "auch bei Aufnahmen"): bei parallel-Markierung
        //   auch Name + Nummer der anderen Aufnahme speichern, damit Anzeige zeigt
        //   "⚠️ während Müller Hans (+49157...)".
        String parallelPartnerName;
        String parallelPartnerPhone;
        // v6.63.184 (Patrick 05.06. 19:38 Bridge "alle Nummern eine Vorbestellung
        //   zusammenbauen"): Liste aller Partner-Aufnahmen <60 Sek. Tap auf Aufnahme
        //   öffnet Aktions-Dialog mit allen Partnern.
        java.util.List<String[]> parallelPartners = new java.util.ArrayList<>(); // jeweils [name, phone, customerId]
    }

    class RecAdapter extends RecyclerView.Adapter<RecHolder> {
        private List<Recording> data = new ArrayList<>();
        void setData(List<Recording> d) { data = d; notifyDataSetChanged(); }
        void removeRecording(Recording r) {
            int idx = data.indexOf(r);
            if (idx >= 0) { data.remove(idx); notifyItemRemoved(idx); }
        }
        @NonNull @Override public RecHolder onCreateViewHolder(@NonNull android.view.ViewGroup parent, int viewType) {
            LinearLayout row = new LinearLayout(parent.getContext());
            row.setOrientation(LinearLayout.VERTICAL);
            row.setPadding(dp(16), dp(12), dp(16), dp(12));
            row.setBackgroundColor(0xFF1e293b);
            row.setLayoutParams(new RecyclerView.LayoutParams(RecyclerView.LayoutParams.MATCH_PARENT, RecyclerView.LayoutParams.WRAP_CONTENT));
            TextView t1 = new TextView(parent.getContext()); t1.setTextSize(15); t1.setTextColor(0xFFffffff);
            TextView t2 = new TextView(parent.getContext()); t2.setTextSize(12); t2.setTextColor(0xFF94a3b8);
            TextView t3 = new TextView(parent.getContext()); t3.setTextSize(11); t3.setTextColor(0xFF64748b);
            row.addView(t1); row.addView(t2); row.addView(t3);
            View divider = new View(parent.getContext());
            divider.setBackgroundColor(0xFF334155);
            divider.setLayoutParams(new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(1)));
            row.addView(divider);
            return new RecHolder(row, t1, t2, t3);
        }
        @Override public void onBindViewHolder(@NonNull RecHolder h, int pos) {
            Recording r = data.get(pos);
            String dir = r.direction == 0 ? "⬅️ EIN" : "➡️ AUS";
            String name = r.customerName != null ? r.customerName : r.phone;
            // v6.62.863: Parallel-Anruf-Warnung
            // v6.63.182 (Patrick 05.06. 18:04 "auch bei Aufnahmen"): Partner-Info anhängen
            //   damit sichtbar ist mit WELCHEM Anruf parallel.
            String prefix = r.parallel ? "⚠️ " : "";
            String parallelSuffix = "";
            if (r.parallel) {
                String partnerLabel;
                if (r.parallelPartnerName != null && !r.parallelPartnerName.isEmpty()) {
                    partnerLabel = r.parallelPartnerName + " (" + (r.parallelPartnerPhone != null ? r.parallelPartnerPhone : "?") + ")";
                } else if (r.parallelPartnerPhone != null && !r.parallelPartnerPhone.isEmpty()) {
                    partnerLabel = r.parallelPartnerPhone;
                } else {
                    partnerLabel = "anderem Anruf";
                }
                // v6.63.184 (Patrick 05.06. 19:38): Wenn mehrere Partner vorhanden, alle
                //   im Label auflisten (max 3, dann Kürzung). Damit Patrick beim Tippen
                //   sieht WIE VIELE Anrufe parallel waren.
                if (r.parallelPartners != null && r.parallelPartners.size() > 1) {
                    StringBuilder sb = new StringBuilder();
                    int show = Math.min(3, r.parallelPartners.size());
                    for (int pi = 0; pi < show; pi++) {
                        String[] p = r.parallelPartners.get(pi);
                        if (sb.length() > 0) sb.append(", ");
                        sb.append(p[0] != null && !p[0].isEmpty() ? p[0] : (p[1] != null ? p[1] : "?"));
                    }
                    if (r.parallelPartners.size() > 3) sb.append(" + ").append(r.parallelPartners.size() - 3).append(" weitere");
                    parallelSuffix = "  🔗 parallel zu " + sb.toString();
                } else {
                    parallelSuffix = "  🔗 parallel zu " + partnerLabel;
                }
            }
            h.t1.setText(prefix + dir + "  " + name + parallelSuffix);
            if (r.parallel) h.t1.setTextColor(0xFFfbbf24); else h.t1.setTextColor(0xFFffffff);
            String dt = new SimpleDateFormat("dd.MM.yyyy HH:mm", Locale.GERMAN).format(new Date(r.timestamp));
            h.t2.setText(dt + "  ·  " + Formatter.formatShortFileSize(CallRecordingsActivity.this, r.size));
            h.t3.setText(r.phone);
            // v6.63.184 (Patrick 05.06. 19:38): bei Parallel-Aufnahmen Aktions-Dialog mit
            //   Wahl-Optionen (Abspielen vs Vorbestellung pro Anrufer). Ohne Parallel: direkt
            //   Abspielen wie bisher.
            h.itemView.setOnClickListener(v -> {
                if (r.parallel && r.parallelPartners != null && !r.parallelPartners.isEmpty()) {
                    showRecordingActionDialog(r);
                } else {
                    playRecording(r);
                }
            });
            // v6.62.862: Long-Press = Lösch-Dialog (statt nur Stop, weil Stop ist im Detail-Dialog).
            h.itemView.setOnLongClickListener(v -> { confirmDeleteRecording(r); return true; });
        }
        @Override public int getItemCount() { return data.size(); }
    }

    static class RecHolder extends RecyclerView.ViewHolder {
        TextView t1, t2, t3;
        RecHolder(View v, TextView t1, TextView t2, TextView t3) { super(v); this.t1 = t1; this.t2 = t2; this.t3 = t3; }
    }
}
