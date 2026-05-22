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
                    String name = c.child("name").getValue(String.class);
                    String firma = c.child("firmenname").getValue(String.class);
                    String displayName = name != null ? name : (firma != null ? firma : "?");
                    String[] phoneFields = {"phone","mobilePhone","mobile","phone1","phone2","phone3"};
                    for (String f : phoneFields) {
                        String p = c.child(f).getValue(String.class);
                        if (p != null) crmByPhone.put(normalizePhone(p), displayName);
                    }
                    DataSnapshot addit = c.child("additionalPhones");
                    if (addit.exists()) {
                        for (DataSnapshot ap : addit.getChildren()) {
                            String p = ap.getValue(String.class);
                            if (p != null) crmByPhone.put(normalizePhone(p), displayName);
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
                                r.customerName = crmByPhone.get(normalizePhone(r.phone));
                                all.add(r);
                            }
                        }
                    }
                }
            }
            Collections.sort(all, new Comparator<Recording>() {
                @Override public int compare(Recording a, Recording b) { return Long.compare(b.timestamp, a.timestamp); }
            });
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
                // CrmSearchActivity sucht selbst die CRM-ID per Telefonnummer
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
    // + Recording-Eintrag aus Liste raus (notifyDataSetChanged).
    private void confirmDeleteRecording(Recording r) {
        String dt = new SimpleDateFormat("dd.MM.yyyy HH:mm", Locale.GERMAN).format(new Date(r.timestamp));
        String name = r.customerName != null ? r.customerName : r.phone;
        new androidx.appcompat.app.AlertDialog.Builder(this)
            .setTitle("Aufnahme löschen?")
            .setMessage(name + "\n" + dt + "\n\nDie m4a-Datei wird vom Telefon gelöscht. Kann nicht rückgängig gemacht werden.")
            .setPositiveButton("Löschen", (d, w) -> {
                stopPlayback();
                boolean ok = false;
                try { ok = r.file.delete(); } catch (Exception e) { Log.w(TAG, "Delete-Error: " + e.getMessage()); }
                if (ok) {
                    Toast.makeText(this, "🗑️ Aufnahme gelöscht", Toast.LENGTH_SHORT).show();
                    adapter.removeRecording(r);
                    int total = adapter.getItemCount();
                    header.setText(total + " Aufnahmen (letzte 90 Tage)");
                } else {
                    Toast.makeText(this, "❌ Löschen fehlgeschlagen — Datei evtl. schon weg oder Berechtigung fehlt", Toast.LENGTH_LONG).show();
                }
            })
            .setNegativeButton("Abbrechen", null)
            .show();
    }

    private String msToTime(int ms) {
        int s = ms / 1000;
        return String.format(Locale.GERMAN, "%02d:%02d", s/60, s%60);
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
            h.t1.setText(dir + "  " + name);
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
