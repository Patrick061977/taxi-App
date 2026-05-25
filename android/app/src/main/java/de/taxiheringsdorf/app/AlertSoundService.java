package de.taxiheringsdorf.app;

import android.app.Notification;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.util.Log;

import androidx.core.app.NotificationCompat;

/**
 * v6.62.935 (Patrick 25.05.2026 14:12 "Handy auf Lautlos — das darf nicht passieren"):
 *
 * Foreground-Service der bei neuen Fahrt-Pushs einen ALARM-Sound auf MAX-Volume spielt,
 * UNABHÄNGIG vom Lautlos-/DND-Modus. Setzt vorübergehend STREAM_ALARM auf Max und
 * startet einen looping MediaPlayer mit USAGE_ALARM-AudioAttributes — das ist die
 * gleiche Technik die Wecker-Apps nutzen um durch Lautlos durchzubrechen.
 *
 * Auto-Stop nach 30s, oder via {@link #stop(Context)} sobald der Fahrer Annehmen/
 * Ablehnen tippt (RideActionReceiver ruft das auf).
 */
public class AlertSoundService extends Service {
    private static final String TAG = "AlertSoundService";
    public static final String ACTION_START = "de.taxiheringsdorf.app.ACTION_ALERT_START";
    public static final String ACTION_STOP = "de.taxiheringsdorf.app.ACTION_ALERT_STOP";
    private static final int NOTIF_ID = 9112; // unique
    private static final long AUTO_STOP_MS = 30_000L;

    private MediaPlayer player;
    private Integer savedAlarmVolume = null;
    private final Handler autoStopHandler = new Handler(Looper.getMainLooper());
    private final Runnable autoStopRunnable = () -> {
        Log.i(TAG, "Auto-Stop nach 30s — kein Tap");
        stopSelf();
    };

    public static void start(Context ctx) {
        try {
            Intent i = new Intent(ctx, AlertSoundService.class);
            i.setAction(ACTION_START);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ctx.startForegroundService(i);
            else ctx.startService(i);
        } catch (Throwable t) {
            Log.w(TAG, "start fail: " + t.getMessage());
        }
    }

    public static void stop(Context ctx) {
        try {
            Intent i = new Intent(ctx, AlertSoundService.class);
            i.setAction(ACTION_STOP);
            ctx.startService(i);
        } catch (Throwable _ignore) { /* if Service nicht laeuft, ignorieren */ }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : null;
        if (ACTION_STOP.equals(action)) {
            Log.i(TAG, "Stop requested");
            stopSelf();
            return START_NOT_STICKY;
        }

        // Foreground-Notification (Pflicht ab Android 8 fuer startForegroundService)
        try {
            NotificationCompat.Builder builder = new NotificationCompat.Builder(this, TaxiFCMService.CHANNEL_ID)
                .setContentTitle("🚨 NEUE FAHRT — Alarm aktiv")
                .setContentText("App oeffnen + Annehmen/Ablehnen tippen")
                .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setOngoing(true);
            startForeground(NOTIF_ID, builder.build());
        } catch (Throwable t) {
            Log.e(TAG, "startForeground fail: " + t.getMessage(), t);
            stopSelf();
            return START_NOT_STICKY;
        }

        // Alarm-Volume auf Max setzen + MediaPlayer starten
        try {
            AudioManager am = (AudioManager) getSystemService(AUDIO_SERVICE);
            if (am != null) {
                savedAlarmVolume = am.getStreamVolume(AudioManager.STREAM_ALARM);
                int maxVol = am.getStreamMaxVolume(AudioManager.STREAM_ALARM);
                am.setStreamVolume(AudioManager.STREAM_ALARM, maxVol, 0);
                Log.i(TAG, "STREAM_ALARM " + savedAlarmVolume + " → " + maxVol);
            }

            Uri sound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
            if (sound == null) sound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
            if (sound == null) sound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
            if (sound == null) {
                Log.w(TAG, "Keine System-Sound-URI gefunden");
                stopSelf();
                return START_NOT_STICKY;
            }

            player = new MediaPlayer();
            AudioAttributes attrs = new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ALARM)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build();
            player.setAudioAttributes(attrs);
            player.setDataSource(this, sound);
            player.setLooping(true);
            player.prepare();
            player.start();
            Log.i(TAG, "MediaPlayer started — looping ALARM-Sound");
        } catch (Throwable t) {
            Log.e(TAG, "MediaPlayer start fail: " + t.getMessage(), t);
            // Service trotzdem weiterlaufen lassen — Foreground-Notif ist da
        }

        autoStopHandler.postDelayed(autoStopRunnable, AUTO_STOP_MS);
        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        Log.i(TAG, "onDestroy — stop player + restore volume");
        autoStopHandler.removeCallbacks(autoStopRunnable);

        if (player != null) {
            try { if (player.isPlaying()) player.stop(); } catch (Throwable _i) {}
            try { player.release(); } catch (Throwable _i) {}
            player = null;
        }

        // Alarm-Volume zurueck setzen
        if (savedAlarmVolume != null) {
            try {
                AudioManager am = (AudioManager) getSystemService(AUDIO_SERVICE);
                if (am != null) {
                    am.setStreamVolume(AudioManager.STREAM_ALARM, savedAlarmVolume, 0);
                    Log.i(TAG, "STREAM_ALARM zurueck auf " + savedAlarmVolume);
                }
            } catch (Throwable _ignore) {}
            savedAlarmVolume = null;
        }

        // Foreground-Notification entfernen
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                stopForeground(STOP_FOREGROUND_REMOVE);
            } else {
                stopForeground(true);
            }
            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            if (nm != null) nm.cancel(NOTIF_ID);
        } catch (Throwable _ignore) {}

        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }
}
