package de.taxiheringsdorf.app;

// 🆕 v6.63.015 (Patrick 29.05.2026 19:13): In-App-Call-Recorder als ACR-Ersatz.
// Foreground-Service der bei OFFHOOK MediaRecorder startet, bei IDLE stoppt.
// Speichert nach /sdcard/FunktaxiCalls/{YYYY}/{MM}/{DD}/+phone-{direction}-{ts}.m4a —
// gleiche Verzeichnis-Konvention wie ACR damit CallRecordingsActivity beide findet.
//
// AudioSource-Strategie: VOICE_CALL → VOICE_COMMUNICATION → MIC Fallback. Auf S9+
// (Android 10) und S20 FE (Android 12) ist VOICE_CALL üblicherweise blockiert; MIC
// nimmt zwar nur die Lautsprecher-Stimme zuverlässig auf wenn das Telefon im
// Speakerphone-Modus ist, ist aber besser als nichts.
//
// Foreground-Notification zeigt 🎙️ + Telefonnummer damit Android den Service
// nicht killt.

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.media.AudioManager;
import android.media.MediaRecorder;
import android.os.Build;
import android.os.Environment;
import android.os.IBinder;
import android.util.Log;

import java.io.File;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

public class CallRecorderService extends Service {
    private static final String TAG = "CallRecorder";
    private static final String CHANNEL_ID = "call_recorder_channel";
    private static final int NOTIFICATION_ID = 9011;

    public static final String ACTION_START = "de.taxiheringsdorf.app.CALL_RECORD_START";
    public static final String ACTION_STOP = "de.taxiheringsdorf.app.CALL_RECORD_STOP";
    public static final String EXTRA_PHONE = "phone";
    public static final String EXTRA_DIRECTION = "direction"; // "0" = IN, "1" = OUT (ACR-kompatibel)

    public static final File RECORDINGS_ROOT = new File(Environment.getExternalStorageDirectory(), "FunktaxiCalls");

    private MediaRecorder recorder;
    private File currentFile;
    private String currentPhone;
    private String currentDirection;
    // 🆕 v6.63.018: Audio-Routing-State sichern damit wir nach dem Anruf wiederherstellen können
    private int prevAudioMode = AudioManager.MODE_NORMAL;
    private boolean prevSpeakerOn = false;
    private boolean weEnabledBtSco = false;
    private boolean weEnabledSpeaker = false;

    @Nullable @Override public IBinder onBind(Intent intent) { return null; }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) return START_NOT_STICKY;
        String action = intent.getAction();
        if (ACTION_START.equals(action)) {
            String phone = intent.getStringExtra(EXTRA_PHONE);
            String dir = intent.getStringExtra(EXTRA_DIRECTION);
            startRecording(phone != null ? phone : "unbekannt", dir != null ? dir : "IN");
        } else if (ACTION_STOP.equals(action)) {
            stopRecording();
            stopSelf();
        }
        return START_NOT_STICKY;
    }

    private void startRecording(String phone, String direction) {
        if (recorder != null) {
            Log.w(TAG, "startRecording called while already running — skip");
            return;
        }
        // User-Toggle prüfen (Default = ON wenn Permission da)
        SharedPreferences sp = getSharedPreferences("call_recorder_prefs", MODE_PRIVATE);
        if (!sp.getBoolean("auto_record_enabled", true)) {
            Log.i(TAG, "Auto-Recording disabled by user — skip");
            stopSelf();
            return;
        }

        currentPhone = phone;
        currentDirection = direction;
        long now = System.currentTimeMillis();
        Date d = new Date(now);
        SimpleDateFormat dyf = new SimpleDateFormat("yyyy", Locale.GERMANY);
        SimpleDateFormat dmf = new SimpleDateFormat("MM", Locale.GERMANY);
        SimpleDateFormat ddf = new SimpleDateFormat("dd", Locale.GERMANY);
        // ACR-Verzeichnis-Schema: ROOT/YYYY/MM/DD/+phone/+phone-DIR-ts.m4a
        String phoneDir = phone.startsWith("+") ? phone : ("+" + phone.replaceAll("[^0-9]", ""));
        if (phoneDir.length() < 2) phoneDir = "+unknown";
        File targetDir = new File(RECORDINGS_ROOT,
            dyf.format(d) + "/" + dmf.format(d) + "/" + ddf.format(d) + "/" + phoneDir);
        if (!targetDir.exists() && !targetDir.mkdirs()) {
            Log.e(TAG, "mkdir fehlgeschlagen: " + targetDir);
            stopSelf();
            return;
        }
        currentFile = new File(targetDir, phoneDir + "-" + direction + "-" + now + ".m4a");

        // Foreground-Notification (Pflicht Android 8+ für Service)
        Notification notif = buildNotification(phone, direction);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(NOTIFICATION_ID, notif,
                android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
        } else {
            startForeground(NOTIFICATION_ID, notif);
        }

        // MediaRecorder mit AudioSource-Fallback-Kette
        int[] sources = {
            MediaRecorder.AudioSource.VOICE_CALL,
            MediaRecorder.AudioSource.VOICE_COMMUNICATION,
            MediaRecorder.AudioSource.VOICE_RECOGNITION,
            MediaRecorder.AudioSource.MIC
        };
        Exception lastErr = null;
        for (int src : sources) {
            try {
                if (recorder != null) {
                    try { recorder.release(); } catch (Throwable _t) {}
                    recorder = null;
                }
                recorder = new MediaRecorder();
                recorder.setAudioSource(src);
                recorder.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4);
                recorder.setAudioEncoder(MediaRecorder.AudioEncoder.AAC);
                recorder.setAudioChannels(1);
                recorder.setAudioSamplingRate(44100);
                recorder.setAudioEncodingBitRate(64000);
                recorder.setOutputFile(currentFile.getAbsolutePath());
                recorder.prepare();
                recorder.start();
                Log.i(TAG, "Recording started src=" + src + " → " + currentFile);
                // 🆕 v6.63.018 (Patrick 29.05. 20:19 "Beides"): Audio-Routing erweitern.
                //   Nur wenn der MIC-Fallback greift (= VOICE_CALL/COMMUNICATION/RECOGNITION
                //   nicht zur Verfügung), brauchen wir das Speakerphone-/BT-Sco-Trick. Bei
                //   diesen drei Audio-Sources kommt der Anrufer-Stream direkt, kein Routing
                //   nötig.
                if (src == MediaRecorder.AudioSource.MIC) {
                    enableLoudCaptureRouting();
                }
                return;
            } catch (Exception ex) {
                lastErr = ex;
                Log.w(TAG, "AudioSource " + src + " fehlgeschlagen: " + ex.getMessage());
                if (recorder != null) {
                    try { recorder.release(); } catch (Throwable _t) {}
                    recorder = null;
                }
            }
        }
        Log.e(TAG, "Alle AudioSources fehlgeschlagen, letzter Fehler: "
            + (lastErr != null ? lastErr.getMessage() : "?"));
        stopSelf();
    }

    private void stopRecording() {
        if (recorder == null) return;
        try {
            recorder.stop();
            recorder.release();
            Log.i(TAG, "Recording stopped → " + currentFile);
        } catch (Throwable t) {
            Log.w(TAG, "stop fehlgeschlagen: " + t.getMessage());
            // Datei könnte korrupt sein; löschen damit Player nicht crashed
            try { if (currentFile != null && currentFile.exists() && currentFile.length() < 1024) currentFile.delete(); }
            catch (Throwable _t) {}
        }
        recorder = null;
        currentFile = null;
        // 🆕 v6.63.018: Audio-Routing wiederherstellen wie es vor dem Anruf war
        restoreLoudCaptureRouting();
    }

    /**
     * 🆕 v6.63.018: Aktiviert Speakerphone oder Bluetooth-SCO damit das MIC
     * beide Stimmen aufnehmen kann. BT-SCO bevorzugt wenn BT-Headset connected.
     * Patrick (29.05.): "Bei ACR geht aber auch Bluetooth" → gleicher Trick.
     */
    private void enableLoudCaptureRouting() {
        try {
            AudioManager am = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
            if (am == null) return;
            prevAudioMode = am.getMode();
            prevSpeakerOn = am.isSpeakerphoneOn();
            // Communication-Mode notwendig damit setSpeakerphoneOn/BluetoothSco wirken
            try { am.setMode(AudioManager.MODE_IN_COMMUNICATION); } catch (Throwable _t) {}
            if (am.isBluetoothScoAvailableOffCall()) {
                try {
                    am.startBluetoothSco();
                    am.setBluetoothScoOn(true);
                    weEnabledBtSco = true;
                    Log.i(TAG, "🎧 BT-SCO aktiviert für MIC-Tap");
                    return;
                } catch (Throwable t) {
                    Log.w(TAG, "BT-SCO fehlgeschlagen: " + t.getMessage());
                }
            }
            try {
                am.setSpeakerphoneOn(true);
                weEnabledSpeaker = true;
                Log.i(TAG, "🔊 Speakerphone aktiviert für MIC-Tap");
            } catch (Throwable t) {
                Log.w(TAG, "Speakerphone fehlgeschlagen: " + t.getMessage());
            }
        } catch (Throwable t) {
            Log.w(TAG, "enableLoudCaptureRouting Fehler: " + t.getMessage());
        }
    }

    private void restoreLoudCaptureRouting() {
        try {
            AudioManager am = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
            if (am == null) return;
            if (weEnabledBtSco) {
                try { am.setBluetoothScoOn(false); am.stopBluetoothSco(); } catch (Throwable _t) {}
                weEnabledBtSco = false;
            }
            if (weEnabledSpeaker) {
                try { am.setSpeakerphoneOn(prevSpeakerOn); } catch (Throwable _t) {}
                weEnabledSpeaker = false;
            }
            try { am.setMode(prevAudioMode); } catch (Throwable _t) {}
        } catch (Throwable t) {
            Log.w(TAG, "restoreLoudCaptureRouting Fehler: " + t.getMessage());
        }
    }

    @Override
    public void onDestroy() {
        stopRecording();
        super.onDestroy();
    }

    private Notification buildNotification(String phone, String direction) {
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel ch = new NotificationChannel(CHANNEL_ID, "Anruf-Aufnahme",
                NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("Läuft während eines Anrufs zur Aufzeichnung");
            ch.setShowBadge(false);
            if (nm != null) nm.createNotificationChannel(ch);
        }
        String title = "🎙️ Anruf-Aufnahme läuft";
        String body = direction + " · " + phone;
        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setContentTitle(title)
            .setContentText(body)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build();
    }
}
