package de.taxiheringsdorf.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;
import android.util.Log;

import androidx.core.app.NotificationCompat;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;

/**
 * v6.40.0: Hält die Fahrer-App am Leben während aktiver Schicht.
 * v6.41.17: Nativer Heartbeat — pingt alle 30s unsere Cloud Function
 *           unabhängig vom WebView. Läuft auch bei Screen-off / Doze-Mode
 *           weil Foreground-Services davon ausgenommen sind.
 */
public class ShiftForegroundService extends Service {

    private static final String TAG = "ShiftForegroundSvc";

    public static final String CHANNEL_ID = "taxi_heringsdorf_shift";
    public static final int NOTIFICATION_ID = 1001;

    public static final String ACTION_START = "de.taxiheringsdorf.app.START_SHIFT";
    public static final String ACTION_STOP = "de.taxiheringsdorf.app.STOP_SHIFT";

    public static final String EXTRA_CONTENT_TEXT = "contentText";
    public static final String EXTRA_VEHICLE_ID = "vehicleId";

    // Heartbeat-Endpoint
    private static final String HEARTBEAT_URL = "https://europe-west1-taxi-heringsdorf.cloudfunctions.net/shiftHeartbeatPing";
    private static final long HEARTBEAT_INTERVAL_SEC = 30;

    private static boolean running = false;
    private static String currentVehicleId = null;

    private ScheduledExecutorService heartbeatExecutor;
    private ScheduledFuture<?> heartbeatTask;

    public static boolean isRunning() {
        return running;
    }

    public static String getCurrentVehicleId() {
        return currentVehicleId;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : null;
        if (ACTION_STOP.equals(action)) {
            running = false;
            currentVehicleId = null;
            stopHeartbeat();
            stopForeground(true);
            stopSelf();
            return START_NOT_STICKY;
        }

        String contentText = "Schicht aktiv – GPS und Dispatch laufen";
        if (intent != null && intent.hasExtra(EXTRA_CONTENT_TEXT)) {
            String custom = intent.getStringExtra(EXTRA_CONTENT_TEXT);
            if (custom != null && !custom.isEmpty()) {
                contentText = custom;
            }
        }

        // 🆕 v6.41.17: vehicleId aus Intent lesen, Heartbeat starten
        if (intent != null && intent.hasExtra(EXTRA_VEHICLE_ID)) {
            String vid = intent.getStringExtra(EXTRA_VEHICLE_ID);
            if (vid != null && !vid.isEmpty()) {
                currentVehicleId = vid;
            }
        }

        Intent launchIntent = new Intent(this, MainActivity.class);
        launchIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);

        int pendingFlags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            pendingFlags |= PendingIntent.FLAG_IMMUTABLE;
        }
        PendingIntent pendingIntent = PendingIntent.getActivity(
                this, 0, launchIntent, pendingFlags
        );

        Notification notification = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("🚕 Funk Taxi Heringsdorf")
                .setContentText(contentText)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentIntent(pendingIntent)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setCategory(NotificationCompat.CATEGORY_SERVICE)
                .build();

        startForeground(NOTIFICATION_ID, notification);
        running = true;

        // 🆕 v6.41.17: Heartbeat-Timer starten
        startHeartbeat();

        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        running = false;
        stopHeartbeat();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    "Schicht aktiv",
                    NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("Hält die Fahrer-App während der Schicht aktiv");
            channel.setShowBadge(false);
            NotificationManager mgr = getSystemService(NotificationManager.class);
            if (mgr != null) {
                mgr.createNotificationChannel(channel);
            }
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // 💓 Nativer Heartbeat (läuft auch bei Screen-off / Doze-Mode)
    // ═══════════════════════════════════════════════════════════════

    private void startHeartbeat() {
        stopHeartbeat(); // alten Task killen falls vorhanden
        if (currentVehicleId == null || currentVehicleId.isEmpty()) {
            Log.w(TAG, "Heartbeat nicht gestartet — keine vehicleId übergeben");
            return;
        }
        heartbeatExecutor = Executors.newSingleThreadScheduledExecutor();
        heartbeatTask = heartbeatExecutor.scheduleAtFixedRate(
            this::sendHeartbeat,
            5, // erste Ausführung nach 5s (nicht sofort — gibt Zeit für Firebase-Init)
            HEARTBEAT_INTERVAL_SEC,
            TimeUnit.SECONDS
        );
        Log.i(TAG, "💓 Nativer Heartbeat gestartet für vehicle=" + currentVehicleId + " (alle " + HEARTBEAT_INTERVAL_SEC + "s)");
    }

    private void stopHeartbeat() {
        if (heartbeatTask != null) {
            heartbeatTask.cancel(false);
            heartbeatTask = null;
        }
        if (heartbeatExecutor != null) {
            heartbeatExecutor.shutdownNow();
            heartbeatExecutor = null;
        }
    }

    private void sendHeartbeat() {
        if (currentVehicleId == null || currentVehicleId.isEmpty()) return;
        HttpURLConnection conn = null;
        try {
            URL url = new URL(HEARTBEAT_URL + "?vehicleId=" + currentVehicleId);
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("GET");
            conn.setConnectTimeout(5000);
            conn.setReadTimeout(5000);
            int code = conn.getResponseCode();
            if (code >= 200 && code < 300) {
                Log.d(TAG, "💓 Heartbeat OK (" + code + ") vehicle=" + currentVehicleId);
            } else {
                Log.w(TAG, "💓 Heartbeat HTTP " + code + " vehicle=" + currentVehicleId);
            }
        } catch (Exception e) {
            // Netzwerk-Fehler sind normal (kein WLAN / schlechter Empfang) — nur loggen
            Log.w(TAG, "💓 Heartbeat Fehler: " + e.getMessage());
        } finally {
            if (conn != null) conn.disconnect();
        }
    }
}
