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

    private RecyclerView rv;
    private ProgressBar progress;
    private TextView header, permHint;
    private RecAdapter adapter;
    private Map<String, String> crmByPhone = new HashMap<>();
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

        header = new TextView(this);
        header.setPadding(dp(16), dp(8), dp(16), dp(8));
        header.setTextColor(0xFF94a3b8);
        header.setText("Lade …");
        root.addView(header);

        // 🆕 v6.62.892 (Patrick 23.05. 11:15): Bulk-Loesch-Button (alle aelter als 30 Tage).
        //   Patrick: 'ich muss die Fahrten ja loeschen koennen damit das nicht ueberquillt'.
        //   Einzel-Loeschen via Samsung Owner-Lock unzuverlaessig — Bulk loescht in einem Rutsch
        //   mit allen 6 Strategien pro Datei + zeigt eine Erfolgs-Statistik am Ende.
        android.widget.Button btnBulkDelete = new android.widget.Button(this);
        btnBulkDelete.setText("🗑️ Alle aelter als 30 Tage löschen");
        btnBulkDelete.setTextColor(0xFFef4444);
        btnBulkDelete.setOnClickListener(v -> confirmBulkDeleteOlderThan30Days());
        LinearLayout.LayoutParams bulkLp = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        bulkLp.setMargins(dp(16), 0, dp(16), dp(8));
        btnBulkDelete.setLayoutParams(bulkLp);
        root.addView(btnBulkDelete);

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
        String need;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            need = Manifest.permission.READ_MEDIA_AUDIO;
        } else {
            need = Manifest.permission.READ_EXTERNAL_STORAGE;
        }
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

    private void scanRecordings() {
        if (!ACR_ROOT.exists() || !ACR_ROOT.isDirectory()) {
            header.setText("ACR-Ordner nicht gefunden:\n" + ACR_ROOT.getAbsolutePath());
            progress.setVisibility(View.GONE);
            return;
        }
        new Thread(() -> {
            List<Recording> all = new ArrayList<>();
            Pattern fileRe = Pattern.compile("^(\\+?\\d+)-(\\d+)-(\\d+)\\.m4a$");
            // 2-level walk: /YYYY/MM/DD/+TelNr/*.m4a — wir scannen alle Tage maximum letzte 90 Tage
            File[] years = ACR_ROOT.listFiles();
            if (years == null) { runOnUiThread(() -> { header.setText("Keine Aufnahmen"); progress.setVisibility(View.GONE); }); return; }
            long cutoff = System.currentTimeMillis() - 90L*24*3600*1000;
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
            for (int i = 0; i < all.size(); i++) {
                Recording cur = all.get(i);
                for (int j = 0; j < all.size(); j++) {
                    if (i == j) continue;
                    Recording oth = all.get(j);
                    long diff = Math.abs(cur.timestamp - oth.timestamp);
                    if (diff < 60_000) { cur.parallel = true; break; }
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
            startActivity(i);
        });
        root.addView(btnVorbestellung);

        if (hasCrm) {
            android.widget.Button btnHist = new android.widget.Button(this);
            btnHist.setText("📜 Bisherige Fahrten anschauen");
            btnHist.setOnClickListener(v -> {
                android.content.Intent i = new android.content.Intent(this, CrmSearchActivity.class);
                // CrmSearchActivity sucht via Phone → wir öffnen direkt Suche mit Phone als Query
                i.putExtra("prefill_search_query", r.phone);
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

        // v6.62.862 (Patrick 22.05. 15:32): "wie kann ich die Anrufliste löschen" — Lösch-Button
        // unten im Detail-Dialog. Mit Bestätigungs-Dialog vor dem tatsächlichen Delete.
        android.widget.Button btnDelete = new android.widget.Button(this);
        btnDelete.setText("🗑️ Aufnahme löschen");
        btnDelete.setTextColor(0xFFef4444);
        btnDelete.setOnClickListener(v -> confirmDeleteRecording(r));
        root.addView(btnDelete);

        new androidx.appcompat.app.AlertDialog.Builder(this)
            .setView(root)
            .setNegativeButton("Schliessen", (d, w) -> stopPlayback())
            .setOnDismissListener(d -> stopPlayback())
            .show();
    }

    // v6.62.862: Aufnahme löschen — File von /sdcard/ACRCalls/ACRPhone/.../*.m4a entfernen
    // v6.62.884 (Patrick 23.05. 06:51): "Berechtigung fehlt" — Android 11+ braucht
    //   MANAGE_EXTERNAL_STORAGE für Lösch-Zugriff auf fremde App-Files (ACR Phone).
    //   Permission muss MANUELL in Settings aktiviert werden (kein normaler Permission-
    //   Request möglich). Wir leiten den User dorthin.
    private void confirmDeleteRecording(Recording r) {
        // Prüfen ob MANAGE_EXTERNAL_STORAGE erteilt — wenn nicht, Settings-Intent öffnen
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
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
                            // Fallback: generelle MANAGE_ALL_FILES Liste
                            try {
                                startActivity(new android.content.Intent(android.provider.Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION));
                            } catch (Exception _e) {
                                Toast.makeText(this, "Einstellungen → Apps → Funk Taxi → Berechtigungen → 'Alle Dateien verwalten' AN", Toast.LENGTH_LONG).show();
                            }
                        }
                    })
                    .setNegativeButton("Abbrechen", null)
                    .show();
                return;
            }
        }
        String dt = new SimpleDateFormat("dd.MM.yyyy HH:mm", Locale.GERMAN).format(new Date(r.timestamp));
        String name = r.customerName != null ? r.customerName : r.phone;
        new androidx.appcompat.app.AlertDialog.Builder(this)
            .setTitle("Aufnahme löschen?")
            .setMessage(name + "\n" + dt + "\n\nDie m4a-Datei wird vom Telefon gelöscht. Kann nicht rückgängig gemacht werden.")
            .setPositiveButton("Löschen", (d, w) -> {
                stopPlayback();
                boolean ok = false;
                String errMsg = null;
                String diag = "exists=" + r.file.exists() + " canW=" + r.file.canWrite() + " absPath=" + r.file.getAbsolutePath();
                Log.i(TAG, "Delete-Versuch: " + diag);
                // Try 1: direct file.delete()
                try { ok = r.file.delete(); }
                catch (Exception e) { errMsg = e.getMessage(); Log.w(TAG, "Delete-Error file.delete(): " + e.getMessage()); }
                Log.i(TAG, "Direct delete result: " + ok);
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
                    Toast.makeText(this, "🗑️ Aufnahme gelöscht", Toast.LENGTH_SHORT).show();
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
            java.util.regex.Pattern fileRe = java.util.regex.Pattern.compile("^(\\+?\\d+)-(\\d)-(\\d+)\\.m4a$");
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

    static class Recording {
        File file;
        String phone;
        int direction; // 0 = incoming, 1 = outgoing
        long timestamp;
        long size;
        String customerName; // null wenn nicht in CRM
        String customerId;   // 🆕 v6.62.890: CRM-ID fuer korrekten Vorbestell-Maske-Pfad (Hotel/Stamm)
        boolean parallel; // v6.62.863: anderer Anruf <60 Sek davor/danach — möglich verpasst
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
            String prefix = r.parallel ? "⚠️ " : "";
            h.t1.setText(prefix + dir + "  " + name);
            if (r.parallel) h.t1.setTextColor(0xFFfbbf24); else h.t1.setTextColor(0xFFffffff);
            String dt = new SimpleDateFormat("dd.MM.yyyy HH:mm", Locale.GERMAN).format(new Date(r.timestamp));
            h.t2.setText(dt + "  ·  " + Formatter.formatShortFileSize(CallRecordingsActivity.this, r.size));
            h.t3.setText(r.phone);
            h.itemView.setOnClickListener(v -> playRecording(r));
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
