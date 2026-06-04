package de.taxiheringsdorf.app;

import android.app.Notification;
import android.app.NotificationManager;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
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
 * v6.62.935 (Patrick 25.05.2026 14:12): erste Version mit STREAM_ALARM + USAGE_ALARM.
 *
 * v6.63.126 (Patrick 03.06.2026 21:17 "Uber-Style"): umgebaut auf dezenten
 * Notification-Sound. Patrick beschwerte sich, dass der Wecker-Sound waehrend einer
 * Fahrt mit Gaesten im Auto extrem peinlich war und der Push sich nicht stoppen liess
 * — siehe Bridge 19:34/20:21. Aenderungen:
 *  - USAGE_NOTIFICATION + STREAM_NOTIFICATION statt USAGE_ALARM/STREAM_ALARM
 *    → respektiert die Handy-Lautstaerke des Fahrers, bricht NICHT mehr durch Lautlos.
 *  - Auto-Stop nach 5s statt 30s (Heads-Up-Banner bleibt visuell).
 *  - BroadcastReceiver fuer ACTION_SCREEN_OFF → Power-Knopf stoppt den Sound sofort.
 *  - Foreground-Notification ist NICHT mehr ongoing → kann weg-geswiped werden.
 *  - Lautstaerke wird NICHT mehr manipuliert (kein STREAM_ALARM-Override).
 *
 * Die alte STREAM_ALARM-Variante wurde nur fuer 'new_ride' verwendet — der dezente
 * Push reicht laut Patrick aus.
 */
public class AlertSoundService extends Service {
    private static final String TAG = "AlertSoundService";
    public static final String ACTION_START = "de.taxiheringsdorf.app.ACTION_ALERT_START";
    public static final String ACTION_STOP = "de.taxiheringsdorf.app.ACTION_ALERT_STOP";
    private static final int NOTIF_ID = 9112; // unique
    private static final long AUTO_STOP_MS = 5_000L; // v6.63.126: 30s → 5s

    private MediaPlayer player;
    private final Handler autoStopHandler = new Handler(Looper.getMainLooper());
    private final Runnable autoStopRunnable = () -> {
        Log.i(TAG, "Auto-Stop nach 5s");
        stopSelf();
    };

    // 🆕 v6.63.126: Power-Knopf stoppt den Sound. Der Receiver wird in onStartCommand
    //   registriert und in onDestroy abgemeldet.
    private BroadcastReceiver screenOffReceiver = null;

    // Statische Refs damit stop() ohne Intent-Latenz funktioniert (war schon v6.62.945).
    private static MediaPlayer _activePlayer = null;
    private static Context _activeServiceCtx = null;

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
            if (_activePlayer != null) {
                try { if (_activePlayer.isPlaying()) _activePlayer.stop(); } catch (Throwable _i) {}
                try { _activePlayer.release(); } catch (Throwable _i) {}
                _activePlayer = null;
                Log.i(TAG, "Sofort-Stop via statische Ref");
            }
        } catch (Throwable _e) {}
        try {
            Intent i = new Intent(ctx, AlertSoundService.class);
            i.setAction(ACTION_STOP);
            ctx.startService(i);
        } catch (Throwable _ignore) {}
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : null;
        if (ACTION_STOP.equals(action)) {
            Log.i(TAG, "Stop requested");
            stopSelf();
            return START_NOT_STICKY;
        }

        // 🆕 v6.63.126: Foreground-Notification NICHT mehr ongoing — weg-swipebar.
        try {
            NotificationCompat.Builder builder = new NotificationCompat.Builder(this, TaxiFCMService.CHANNEL_ID)
                .setContentTitle("🚖 Neue Fahrt verfügbar")
                .setContentText("App öffnen + Annehmen/Ablehnen")
                .setSmallIcon(android.R.drawable.ic_menu_send)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setOngoing(false);
            startForeground(NOTIF_ID, builder.build());
        } catch (Throwable t) {
            Log.e(TAG, "startForeground fail: " + t.getMessage(), t);
            stopSelf();
            return START_NOT_STICKY;
        }

        // 🆕 v6.63.126: Power-Knopf (Display-Aus) stoppt den Sound sofort.
        try {
            screenOffReceiver = new BroadcastReceiver() {
                @Override public void onReceive(Context ctx, Intent it) {
                    Log.i(TAG, "ACTION_SCREEN_OFF — Power-Knopf gedrueckt, Sound stoppen");
                    stopSelf();
                }
            };
            registerReceiver(screenOffReceiver, new IntentFilter(Intent.ACTION_SCREEN_OFF));
        } catch (Throwable t) {
            Log.w(TAG, "screenOff receiver register fail: " + t.getMessage());
        }

        // 🆕 v6.63.127 (Patrick 04.06. 05:58 "kam jetzt gar kein Alarm. Oh, und hat Licht"):
        //   USAGE_NOTIFICATION_RINGTONE statt USAGE_NOTIFICATION. Ringtone-Variante ist die
        //   "eingehender Anruf"-Lautstaerke — verlaesslicher hoerbar bei normalem
        //   Handy-Volume, ohne die Wecker-Peinlichkeit von USAGE_ALARM. Heads-Up-Banner
        //   ("Licht") bleibt gleich. Wenn Patrick komplett stumm hat, bleibt es weiterhin
        //   stumm — kein force-loud, kein STREAM-Override.
        try {
            Uri sound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
            if (sound == null) sound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
            if (sound == null) {
                Log.w(TAG, "Keine System-Sound-URI gefunden");
                stopSelf();
                return START_NOT_STICKY;
            }

            player = new MediaPlayer();
            AudioAttributes attrs = new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build();
            player.setAudioAttributes(attrs);
            player.setDataSource(this, sound);
            player.setLooping(true);
            player.prepare();
            player.start();
            _activePlayer = player;
            _activeServiceCtx = getApplicationContext();
            Log.i(TAG, "MediaPlayer started — Notification-Sound (Uber-Style)");
        } catch (Throwable t) {
            Log.e(TAG, "MediaPlayer start fail: " + t.getMessage(), t);
            // Service trotzdem weiterlaufen lassen — Foreground-Notif ist da
        }

        autoStopHandler.postDelayed(autoStopRunnable, AUTO_STOP_MS);
        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        Log.i(TAG, "onDestroy — stop player + cleanup");
        autoStopHandler.removeCallbacks(autoStopRunnable);

        if (player != null) {
            try { if (player.isPlaying()) player.stop(); } catch (Throwable _i) {}
            try { player.release(); } catch (Throwable _i) {}
            player = null;
        }
        _activePlayer = null;
        _activeServiceCtx = null;

        if (screenOffReceiver != null) {
            try { unregisterReceiver(screenOffReceiver); } catch (Throwable _ignore) {}
            screenOffReceiver = null;
        }

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
