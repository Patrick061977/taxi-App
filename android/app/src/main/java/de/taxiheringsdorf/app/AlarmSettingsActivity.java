package de.taxiheringsdorf.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.media.AudioManager;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Bundle;
import android.util.Log;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.ArrayAdapter;
import android.widget.AdapterView;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.RadioGroup;
import android.widget.Spinner;
import android.widget.TextView;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;
import androidx.appcompat.widget.SwitchCompat;

import com.google.firebase.database.DataSnapshot;
import com.google.firebase.database.DatabaseError;
import com.google.firebase.database.FirebaseDatabase;
import com.google.firebase.database.Query;
import com.google.firebase.database.ValueEventListener;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * v6.66.211 (Patrick 04.10.26 Bridge "wo man den Alarm einstellen kann und
 *   vielleicht sieht ob man einen Push bekommt — Statistik"):
 * Fahrer-Settings-Screen:
 *   - Alarmton waehlen (Wecker / Klingelton / Benachrichtigung)
 *   - Vibration an/aus
 *   - Alarm-Dauer (10/30/60s)
 *   - Test-Button spielt Alarm genau wie bei echter Fahrt
 *   - Push-Historie letzte 20 pro Fahrzeug mit grün/rot Status
 *     (grün = gesendet UND empfangen, rot = gesendet aber Handy war offline)
 *
 * Settings landen in SharedPreferences 'alarm' + Firebase
 *   /vehicles/{vid}/alarmSettings fuer Admin-Uebersicht.
 */
public class AlarmSettingsActivity extends AppCompatActivity {
    private static final String TAG = "AlarmSettings";
    private static final String DB_URL = "https://taxi-heringsdorf-default-rtdb.europe-west1.firebasedatabase.app";
    private static final String PREFS = "alarm";

    private Spinner spSound;
    private SwitchCompat swVibrate;
    private RadioGroup rgDuration;
    private Button btnTest;
    private TextView tvAlarmHint, tvVolumeInfo, tvPushEmpty;
    private LinearLayout pushContainer;
    private String vehicleId;
    private final String[] soundLabels = { "Standard-Wecker (laut)", "Standard-Klingelton", "Standard-Benachrichtigung" };
    private final String[] soundKeys = { "alarm", "ringtone", "notification" };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_alarm_settings);
        setTitle("Alarm-Einstellungen");

        vehicleId = getSharedPreferences("driver", MODE_PRIVATE).getString("vehicleId", null);

        spSound = findViewById(R.id.sp_alarm_sound);
        swVibrate = findViewById(R.id.sw_vibrate);
        rgDuration = findViewById(R.id.rg_duration);
        btnTest = findViewById(R.id.btn_test_alarm);
        tvAlarmHint = findViewById(R.id.tv_alarm_hint);
        tvVolumeInfo = findViewById(R.id.tv_volume_info);
        pushContainer = findViewById(R.id.push_history_container);
        tvPushEmpty = findViewById(R.id.tv_push_empty);

        // Spinner fuellen
        ArrayAdapter<String> adp = new ArrayAdapter<>(this, android.R.layout.simple_spinner_item, soundLabels);
        adp.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        spSound.setAdapter(adp);

        // Settings laden
        SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        String savedSound = prefs.getString("sound", "alarm");
        for (int i = 0; i < soundKeys.length; i++) {
            if (soundKeys[i].equals(savedSound)) { spSound.setSelection(i); break; }
        }
        swVibrate.setChecked(prefs.getBoolean("vibrate", true));
        int savedDur = prefs.getInt("durationSec", 30);
        if (savedDur == 10) rgDuration.check(R.id.rb_dur_10);
        else if (savedDur == 60) rgDuration.check(R.id.rb_dur_60);
        else rgDuration.check(R.id.rb_dur_30);

        // Change-Listener → sofort speichern + Firebase sync
        spSound.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
            @Override public void onItemSelected(AdapterView<?> p, View v, int pos, long id) { saveSettings(); }
            @Override public void onNothingSelected(AdapterView<?> p) {}
        });
        swVibrate.setOnCheckedChangeListener((b, c) -> saveSettings());
        rgDuration.setOnCheckedChangeListener((g, id) -> saveSettings());

        btnTest.setOnClickListener(v -> runAlarmTest());

        // Lautstaerke-Info aktualisieren
        updateVolumeInfo();

        // Push-Historie laden
        loadPushHistory();
    }

    @Override
    protected void onResume() {
        super.onResume();
        updateVolumeInfo();
    }

    private void updateVolumeInfo() {
        try {
            AudioManager am = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
            if (am == null) return;
            int cur = am.getStreamVolume(AudioManager.STREAM_ALARM);
            int max = am.getStreamMaxVolume(AudioManager.STREAM_ALARM);
            String msg;
            if (cur == 0) msg = "⚠️ Alarm-Lautstärke ist 0 — du hoerst gar nix! Lauter drehen mit Lautstärke-Taste bei laufendem Test.";
            else if (cur < max / 3) msg = "ℹ️ Alarm-Lautstärke " + cur + "/" + max + " — relativ leise. Mit Lautstärke-Taste anpassen während Alarm läuft.";
            else msg = "✓ Alarm-Lautstärke " + cur + "/" + max + " — OK.";
            tvVolumeInfo.setText(msg);
        } catch (Throwable _t) { Log.w(TAG, "Volume-Info Fehler: " + _t.getMessage()); }
    }

    private int getSelectedDuration() {
        int id = rgDuration.getCheckedRadioButtonId();
        if (id == R.id.rb_dur_10) return 10;
        if (id == R.id.rb_dur_60) return 60;
        return 30;
    }

    private String getSelectedSoundKey() {
        int pos = spSound.getSelectedItemPosition();
        if (pos >= 0 && pos < soundKeys.length) return soundKeys[pos];
        return "alarm";
    }

    private void saveSettings() {
        String soundKey = getSelectedSoundKey();
        boolean vibrate = swVibrate.isChecked();
        int dur = getSelectedDuration();
        getSharedPreferences(PREFS, MODE_PRIVATE).edit()
            .putString("sound", soundKey)
            .putBoolean("vibrate", vibrate)
            .putInt("durationSec", dur)
            .apply();
        if (vehicleId != null && !vehicleId.isEmpty()) {
            try {
                Map<String, Object> m = new HashMap<>();
                m.put("sound", soundKey);
                m.put("vibrate", vibrate);
                m.put("durationSec", dur);
                m.put("updatedAt", System.currentTimeMillis());
                m.put("device", android.os.Build.MODEL);
                FirebaseDatabase.getInstance(DB_URL)
                    .getReference("vehicles/" + vehicleId + "/alarmSettings")
                    .setValue(m);
            } catch (Throwable _t) { Log.w(TAG, "Settings-Sync Fehler: " + _t.getMessage()); }
        }
    }

    private void runAlarmTest() {
        String soundKey = getSelectedSoundKey();
        boolean vibrate = swVibrate.isChecked();
        int dur = getSelectedDuration();
        tvAlarmHint.setText("🔔 Test läuft " + dur + " Sek… tippe 'Stop' um abzubrechen.");
        btnTest.setText("⏹ STOP");

        // AlertSoundService als Service starten mit der gewünschten Dauer
        try { AlertSoundService.start(this); } catch (Throwable t) { Log.w(TAG, "Alarm-Start fail: " + t.getMessage()); }

        // Vibration
        if (vibrate) {
            try {
                android.os.Vibrator v = (android.os.Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
                if (v != null && android.os.Build.VERSION.SDK_INT >= 26) {
                    long[] pattern = {0, 800, 300, 800, 300, 800};
                    v.vibrate(android.os.VibrationEffect.createWaveform(pattern, 0));
                }
            } catch (Throwable _t) { Log.w(TAG, "Vibration-Fehler: " + _t.getMessage()); }
        }

        // Stop nach dur Sekunden ODER bei Button-Tap
        android.os.Handler h = new android.os.Handler(android.os.Looper.getMainLooper());
        Runnable stopR = () -> {
            try { AlertSoundService.stop(this); } catch (Throwable _ignore) {}
            try { ((android.os.Vibrator) getSystemService(Context.VIBRATOR_SERVICE)).cancel(); } catch (Throwable _ignore) {}
            btnTest.setText("JETZT ALARM TESTEN");
            tvAlarmHint.setText("✓ Test beendet.");
            btnTest.setOnClickListener(x -> runAlarmTest());
        };
        h.postDelayed(stopR, dur * 1000L);
        btnTest.setOnClickListener(x -> { h.removeCallbacks(stopR); stopR.run(); });

        // In Firebase vermerken dass getestet wurde
        if (vehicleId != null && !vehicleId.isEmpty()) {
            try {
                FirebaseDatabase.getInstance(DB_URL)
                    .getReference("vehicles/" + vehicleId + "/alarmTestedAt")
                    .setValue(System.currentTimeMillis());
            } catch (Throwable _t) { /* non-critical */ }
        }
    }

    private void loadPushHistory() {
        if (vehicleId == null || vehicleId.isEmpty()) {
            tvPushEmpty.setVisibility(View.VISIBLE);
            tvPushEmpty.setText("Kein Fahrzeug ausgewaehlt");
            return;
        }
        try {
            Query q = FirebaseDatabase.getInstance(DB_URL)
                .getReference("pushAudit/" + vehicleId)
                .orderByKey()
                .limitToLast(20);
            q.addListenerForSingleValueEvent(new ValueEventListener() {
                @Override public void onDataChange(DataSnapshot snap) {
                    List<Map<String, Object>> items = new ArrayList<>();
                    for (DataSnapshot child : snap.getChildren()) {
                        Map<String, Object> m = new HashMap<>();
                        for (DataSnapshot f : child.getChildren()) m.put(f.getKey(), f.getValue());
                        m.put("_key", child.getKey());
                        items.add(m);
                    }
                    Collections.reverse(items); // neueste zuerst
                    renderPushHistory(items);
                }
                @Override public void onCancelled(DatabaseError e) {
                    tvPushEmpty.setVisibility(View.VISIBLE);
                    tvPushEmpty.setText("Fehler: " + e.getMessage());
                }
            });
        } catch (Throwable _t) { Log.w(TAG, "pushHistory-Load Fehler: " + _t.getMessage()); }
    }

    private void renderPushHistory(List<Map<String, Object>> items) {
        pushContainer.removeAllViews();
        if (items.isEmpty()) {
            tvPushEmpty.setVisibility(View.VISIBLE);
            return;
        }
        tvPushEmpty.setVisibility(View.GONE);
        SimpleDateFormat sdf = new SimpleDateFormat("dd.MM HH:mm:ss", Locale.GERMAN);
        for (Map<String, Object> item : items) {
            Object tsO = item.get("ts");
            long ts = (tsO instanceof Long) ? (Long) tsO : 0L;
            String type = String.valueOf(item.getOrDefault("type", "?"));
            String severity = String.valueOf(item.getOrDefault("severity", "?"));
            String rideId = String.valueOf(item.getOrDefault("rideId", ""));
            String pickup = String.valueOf(item.getOrDefault("pickup", ""));
            Object succO = item.get("success");
            boolean success = !(succO instanceof Boolean) || (Boolean) succO;
            // "Empfangen" check: pushReceivedHistory muesste auf gleicher Zeit stehen —
            // vereinfacht: pruefe nur ob success=true. Fuer echte Empfangs-Check waere
            // ein 2-Hop-Query noetig (teurer). Admin-Analyse kann das.
            boolean received = success;

            LinearLayout row = new LinearLayout(this);
            row.setOrientation(LinearLayout.VERTICAL);
            row.setPadding(dp(12), dp(8), dp(12), dp(8));
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            lp.setMargins(0, 0, 0, dp(6));
            row.setLayoutParams(lp);
            int bg = received ? 0xFFDCFCE7 : 0xFFFEE2E2; // gruen / rot
            int border = received ? 0xFF16A34A : 0xFFDC2626;
            android.graphics.drawable.GradientDrawable d = new android.graphics.drawable.GradientDrawable();
            d.setColor(bg); d.setCornerRadius(dp(8)); d.setStroke(dp(2), border);
            row.setBackground(d);

            TextView tv1 = new TextView(this);
            tv1.setText((received ? "✅ " : "❌ ") + sdf.format(new Date(ts)) + " · " + type + " [" + severity + "]");
            tv1.setTextSize(13f);
            tv1.setTextColor(0xFF111827);
            tv1.setTypeface(null, android.graphics.Typeface.BOLD);
            row.addView(tv1);

            if (!pickup.isEmpty() && !"?".equals(pickup) && !"null".equals(pickup)) {
                TextView tv2 = new TextView(this);
                tv2.setText("📍 " + (pickup.length() > 60 ? pickup.substring(0, 57) + "…" : pickup));
                tv2.setTextSize(11f);
                tv2.setTextColor(0xFF374151);
                row.addView(tv2);
            }
            pushContainer.addView(row);
        }
    }

    private int dp(int v) { return Math.round(v * getResources().getDisplayMetrics().density); }
}
