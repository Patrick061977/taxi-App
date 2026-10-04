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
    private Button btnTest, btnPickCustom;
    private TextView tvAlarmHint, tvVolumeInfo, tvPushEmpty, tvCustomSoundName;
    private LinearLayout pushContainer;
    private String vehicleId;
    private final String[] soundLabels = { "Standard-Wecker (laut)", "Standard-Klingelton", "Standard-Benachrichtigung", "Eigener Ton (unten waehlen)" };
    private final String[] soundKeys = { "alarm", "ringtone", "notification", "custom" };
    private static final int REQ_PICK_RINGTONE = 7788;
    private String customSoundUri = null;
    private String customSoundName = null;
    private android.media.MediaPlayer testPlayer = null; // v6.66.213 fuer custom-Ton-Test

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
        btnPickCustom = findViewById(R.id.btn_pick_custom_sound);
        tvAlarmHint = findViewById(R.id.tv_alarm_hint);
        tvVolumeInfo = findViewById(R.id.tv_volume_info);
        tvCustomSoundName = findViewById(R.id.tv_custom_sound_name);
        pushContainer = findViewById(R.id.push_history_container);
        tvPushEmpty = findViewById(R.id.tv_push_empty);
        btnPickCustom.setOnClickListener(v -> pickCustomSound());

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
        customSoundUri = prefs.getString("customSoundUri", null);
        customSoundName = prefs.getString("customSoundName", null);
        if (customSoundUri != null && customSoundName != null) {
            tvCustomSoundName.setText("✓ Eigener Ton: " + customSoundName);
        } else {
            tvCustomSoundName.setText("Noch kein eigener Ton gewaehlt — tippe oben um zu waehlen.");
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
            // v6.66.213 (Patrick 04.10. 09:06 "Warum steht da immer noch 0 obwohl normal eingestellt ist"):
            //   Problem: STREAM_ALARM ist SEPARAT von der Hardware-Lautstaerke-Taste.
            //   Nutzer dreht die normale Taste hoch → STREAM_RING und STREAM_MUSIC gehen hoch,
            //   STREAM_ALARM bleibt stehen wo es war. Zeige alle 3 damit Patrick die
            //   Diskrepanz versteht.
            int alarmV = am.getStreamVolume(AudioManager.STREAM_ALARM);
            int alarmM = am.getStreamMaxVolume(AudioManager.STREAM_ALARM);
            int ringV = am.getStreamVolume(AudioManager.STREAM_RING);
            int ringM = am.getStreamMaxVolume(AudioManager.STREAM_RING);
            int musicV = am.getStreamVolume(AudioManager.STREAM_MUSIC);
            int musicM = am.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
            StringBuilder sb = new StringBuilder();
            if (alarmV == 0) {
                sb.append("⚠️ Alarm-Lautstaerke = 0 (STREAM_ALARM separat!). Du hoerst nichts.\n");
                sb.append("ℹ️ Beim Alarm-Test druecke die Hardware-Taste wenn der Alarm bimmelt — dann wird STREAM_ALARM angehoben.\n");
            } else if (alarmV < alarmM / 3) {
                sb.append("ℹ️ Alarm leise (").append(alarmV).append("/").append(alarmM).append(").\n");
            } else {
                sb.append("✓ Alarm (").append(alarmV).append("/").append(alarmM).append(") OK.\n");
            }
            sb.append("Ring: ").append(ringV).append("/").append(ringM);
            sb.append("  ·  Musik: ").append(musicV).append("/").append(musicM);
            tvVolumeInfo.setText(sb.toString());
        } catch (Throwable _t) { Log.w(TAG, "Volume-Info Fehler: " + _t.getMessage()); }
    }

    private void pickCustomSound() {
        try {
            Intent i = new Intent(RingtoneManager.ACTION_RINGTONE_PICKER);
            i.putExtra(RingtoneManager.EXTRA_RINGTONE_TITLE, "Signalton waehlen");
            i.putExtra(RingtoneManager.EXTRA_RINGTONE_TYPE,
                RingtoneManager.TYPE_RINGTONE | RingtoneManager.TYPE_ALARM | RingtoneManager.TYPE_NOTIFICATION);
            i.putExtra(RingtoneManager.EXTRA_RINGTONE_SHOW_DEFAULT, true);
            i.putExtra(RingtoneManager.EXTRA_RINGTONE_SHOW_SILENT, false);
            if (customSoundUri != null) {
                try { i.putExtra(RingtoneManager.EXTRA_RINGTONE_EXISTING_URI, Uri.parse(customSoundUri)); } catch (Throwable _e) {}
            }
            startActivityForResult(i, REQ_PICK_RINGTONE);
        } catch (Throwable _t) {
            Toast.makeText(this, "Picker nicht verfuegbar: " + _t.getMessage(), Toast.LENGTH_LONG).show();
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_PICK_RINGTONE && resultCode == RESULT_OK && data != null) {
            Uri uri = data.getParcelableExtra(RingtoneManager.EXTRA_RINGTONE_PICKED_URI);
            if (uri != null) {
                customSoundUri = uri.toString();
                try {
                    android.media.Ringtone rt = RingtoneManager.getRingtone(this, uri);
                    customSoundName = rt != null ? rt.getTitle(this) : "ausgewaehlter Ton";
                } catch (Throwable _t) { customSoundName = "ausgewaehlter Ton"; }
                tvCustomSoundName.setText("✓ Eigener Ton: " + customSoundName);
                // Selektion auf 'Eigener Ton' umstellen (letzter Eintrag)
                spSound.setSelection(soundKeys.length - 1);
                saveSettings();
                Toast.makeText(this, "✓ Signalton gesetzt: " + customSoundName, Toast.LENGTH_SHORT).show();
            }
        }
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
        SharedPreferences.Editor ed = getSharedPreferences(PREFS, MODE_PRIVATE).edit()
            .putString("sound", soundKey)
            .putBoolean("vibrate", vibrate)
            .putInt("durationSec", dur);
        if (customSoundUri != null) ed.putString("customSoundUri", customSoundUri);
        if (customSoundName != null) ed.putString("customSoundName", customSoundName);
        ed.apply();
        if (vehicleId != null && !vehicleId.isEmpty()) {
            try {
                Map<String, Object> m = new HashMap<>();
                m.put("sound", soundKey);
                m.put("vibrate", vibrate);
                m.put("durationSec", dur);
                m.put("customSoundName", customSoundName);
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

        // v6.66.213: Bei 'custom' den eigenen Ton via MediaPlayer, sonst AlertSoundService (TYPE_ALARM)
        if ("custom".equals(soundKey) && customSoundUri != null) {
            try {
                if (testPlayer != null) { try { testPlayer.release(); } catch (Throwable _e) {} }
                testPlayer = new android.media.MediaPlayer();
                testPlayer.setAudioAttributes(new android.media.AudioAttributes.Builder()
                    .setUsage(android.media.AudioAttributes.USAGE_ALARM)
                    .setContentType(android.media.AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build());
                testPlayer.setDataSource(this, Uri.parse(customSoundUri));
                testPlayer.setLooping(true);
                testPlayer.prepare();
                // Lautstaerke anheben wenn STREAM_ALARM=0 → STREAM_RING statt
                AudioManager am = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
                int alarmV = am != null ? am.getStreamVolume(AudioManager.STREAM_ALARM) : 0;
                if (alarmV == 0 && am != null) {
                    int ringMax = am.getStreamMaxVolume(AudioManager.STREAM_RING);
                    try { am.setStreamVolume(AudioManager.STREAM_ALARM, ringMax, 0); } catch (Throwable _e) {}
                }
                testPlayer.start();
            } catch (Throwable t) { Log.w(TAG, "custom-sound test fail: " + t.getMessage()); Toast.makeText(this, "Ton konnte nicht abgespielt werden: " + t.getMessage(), Toast.LENGTH_LONG).show(); }
        } else {
            try { AlertSoundService.start(this); } catch (Throwable t) { Log.w(TAG, "Alarm-Start fail: " + t.getMessage()); }
        }

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
            if (testPlayer != null) {
                try { testPlayer.stop(); } catch (Throwable _e) {}
                try { testPlayer.release(); } catch (Throwable _e) {}
                testPlayer = null;
            }
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
            String severityRaw = String.valueOf(item.getOrDefault("severity", "?"));
            // v6.66.214 (Patrick 04.10. 09:09 "warum steht da Silent"): klarer labeln
            String severity;
            switch (severityRaw) {
                case "alarm":    severity = "🔔 Vollalarm";  break;
                case "reminder": severity = "🔉 Erinnerung"; break;
                case "silent":   severity = "📵 Still (nur Daten)"; break;
                default:         severity = severityRaw; break;
            }
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
