package de.taxiheringsdorf.app;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.location.Location;
import android.os.Build;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.util.Log;

import androidx.core.app.ActivityCompat;
import androidx.core.app.NotificationCompat;

import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationCallback;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationResult;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;

import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;

/**
 * v6.40.0: Hält die Fahrer-App am Leben während aktiver Schicht.
 * v6.41.17: Nativer Heartbeat alle 30s (ScheduledExecutorService).
 * v6.41.19: Nativer GPS-Tracker (FusedLocationProviderClient) — läuft auch
 *           bei Screen-off / Doze-Mode weil Foreground-Services davon
 *           ausgenommen sind. GPS wird zusammen mit dem Heartbeat an die
 *           Cloud Function gepusht (ein HTTP-Call für beides).
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
    private static final long GPS_INTERVAL_MS = 15000; // GPS alle 15s (schneller als Heartbeat)
    private static final long GPS_MIN_INTERVAL_MS = 10000;

    private static boolean running = false;
    private static String currentVehicleId = null;

    private ScheduledExecutorService heartbeatExecutor;
    private ScheduledFuture<?> heartbeatTask;

    // 🆕 v6.41.19: GPS
    private FusedLocationProviderClient fusedLocationClient;
    private LocationCallback locationCallback;
    private volatile Double lastLat = null;
    private volatile Double lastLon = null;
    private volatile Float lastAccuracy = null;

    // 🆕 v6.41.76: WakeLock hält CPU wach während Schicht (sonst drosselt Android bei Screen-off)
    private PowerManager.WakeLock wakeLock = null;
    private static final String WAKE_LOCK_TAG = "TaxiHeringsdorf::ShiftGpsWakeLock";

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
            stopGpsTracking();
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

        if (intent != null && intent.hasExtra(EXTRA_VEHICLE_ID)) {
            String vid = intent.getStringExtra(EXTRA_VEHICLE_ID);
            if (vid != null && !vid.isEmpty()) {
                currentVehicleId = vid;
            }
        }

        // v6.43.2: Persistent Schicht-Notification öffnet DriverDashboardActivity (nicht WebView).
        Intent launchIntent = new Intent(this, DriverDashboardActivity.class);
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

        acquireWakeLock();
        startHeartbeat();
        startGpsTracking();

        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        running = false;
        stopHeartbeat();
        stopGpsTracking();
        releaseWakeLock();
        super.onDestroy();
    }

    // 🆕 v6.41.76: WakeLock — verhindert dass Android die CPU schlafen legt wenn Screen aus ist.
    // Ohne WakeLock drosselt FusedLocationProvider bei Screen-off auf ~60s-Intervalle und
    // ScheduledExecutorService kann verspätet feuern.
    private void acquireWakeLock() {
        try {
            if (wakeLock != null && wakeLock.isHeld()) return;
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm == null) {
                Log.w(TAG, "🔋 PowerManager nicht verfügbar — kein WakeLock");
                return;
            }
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, WAKE_LOCK_TAG);
            wakeLock.setReferenceCounted(false);
            wakeLock.acquire();
            Log.i(TAG, "🔋 WakeLock acquired (PARTIAL)");
        } catch (Exception e) {
            Log.w(TAG, "🔋 WakeLock acquire fehlgeschlagen: " + e.getMessage());
        }
    }

    private void releaseWakeLock() {
        try {
            if (wakeLock != null && wakeLock.isHeld()) {
                wakeLock.release();
                Log.i(TAG, "🔋 WakeLock released");
            }
        } catch (Exception e) {
            Log.w(TAG, "🔋 WakeLock release fehlgeschlagen: " + e.getMessage());
        } finally {
            wakeLock = null;
        }
    }

    private boolean isWakeLockHeld() {
        try { return wakeLock != null && wakeLock.isHeld(); } catch (Exception e) { return false; }
    }

    private boolean isBatteryOptimizationIgnored() {
        try {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm == null) return false;
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return true; // irrelevant vor M
            return pm.isIgnoringBatteryOptimizations(getPackageName());
        } catch (Exception e) {
            return false;
        }
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
    // 💓 Nativer Heartbeat — pingt alle 30s Cloud Function
    //    (auch bei Screen-off / Doze-Mode)
    // ═══════════════════════════════════════════════════════════════

    private void startHeartbeat() {
        stopHeartbeat();
        if (currentVehicleId == null || currentVehicleId.isEmpty()) {
            Log.w(TAG, "Heartbeat nicht gestartet — keine vehicleId übergeben");
            return;
        }
        heartbeatExecutor = Executors.newSingleThreadScheduledExecutor();
        heartbeatTask = heartbeatExecutor.scheduleAtFixedRate(
            this::sendHeartbeat,
            5,
            HEARTBEAT_INTERVAL_SEC,
            TimeUnit.SECONDS
        );
        Log.i(TAG, "💓 Nativer Heartbeat gestartet für vehicle=" + currentVehicleId);
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
            StringBuilder url = new StringBuilder(HEARTBEAT_URL);
            url.append("?vehicleId=").append(URLEncoder.encode(currentVehicleId, "UTF-8"));
            // 🆕 v6.41.19: GPS aus FusedLocationProviderClient mitsenden wenn vorhanden
            Double lat = lastLat;
            Double lon = lastLon;
            Float acc = lastAccuracy;
            if (lat != null && lon != null) {
                url.append("&lat=").append(lat);
                url.append("&lon=").append(lon);
                if (acc != null) url.append("&acc=").append(acc);
            }
            // 🆕 v6.41.76: Power-/Service-Status mitsenden (für Diagnose-UI in Fahrer-App)
            url.append("&wakeLock=").append(isWakeLockHeld() ? "1" : "0");
            url.append("&batteryOpt=").append(isBatteryOptimizationIgnored() ? "1" : "0");
            url.append("&gpsInt=").append(GPS_INTERVAL_MS);
            url.append("&hbInt=").append(HEARTBEAT_INTERVAL_SEC);
            url.append("&svcVer=").append("6.41.76");

            URL u = new URL(url.toString());
            conn = (HttpURLConnection) u.openConnection();
            conn.setRequestMethod("GET");
            conn.setConnectTimeout(5000);
            conn.setReadTimeout(5000);
            int code = conn.getResponseCode();
            if (code >= 200 && code < 300) {
                Log.d(TAG, "💓 Heartbeat OK (" + code + ") gps=" + (lat != null));
            } else {
                Log.w(TAG, "💓 Heartbeat HTTP " + code);
            }
        } catch (Exception e) {
            Log.w(TAG, "💓 Heartbeat Fehler: " + e.getMessage());
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // 📍 Nativer GPS-Tracker — läuft auch bei Screen-off
    //    Speichert Position lokal, Heartbeat sendet sie an Cloud Function
    // ═══════════════════════════════════════════════════════════════

    private void startGpsTracking() {
        if (ActivityCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED &&
            ActivityCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            Log.w(TAG, "📍 Keine Location-Permission — nativer GPS-Tracker deaktiviert");
            return;
        }
        try {
            fusedLocationClient = LocationServices.getFusedLocationProviderClient(this);
            // 🆕 v6.41.76: setMaxUpdateDelayMillis = Intervall → Android darf GPS-Updates NICHT batchen.
            //               setMinUpdateDistanceMeters(0) → auch bei Stillstand weiterhin Updates.
            LocationRequest req = new LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, GPS_INTERVAL_MS)
                    .setMinUpdateIntervalMillis(GPS_MIN_INTERVAL_MS)
                    .setMaxUpdateDelayMillis(GPS_INTERVAL_MS)
                    .setMinUpdateDistanceMeters(0)
                    .setWaitForAccurateLocation(false)
                    .build();
            locationCallback = new LocationCallback() {
                @Override
                public void onLocationResult(LocationResult result) {
                    if (result == null) return;
                    Location loc = result.getLastLocation();
                    if (loc == null) return;
                    lastLat = loc.getLatitude();
                    lastLon = loc.getLongitude();
                    lastAccuracy = loc.hasAccuracy() ? loc.getAccuracy() : null;
                    Log.d(TAG, "📍 Native GPS: " + lastLat + "," + lastLon + " ±" + lastAccuracy + "m");
                }
            };
            fusedLocationClient.requestLocationUpdates(req, locationCallback, Looper.getMainLooper());
            Log.i(TAG, "📍 Nativer GPS-Tracker gestartet (alle " + (GPS_INTERVAL_MS / 1000) + "s, PRIORITY_HIGH_ACCURACY)");
        } catch (SecurityException e) {
            Log.w(TAG, "📍 GPS-Permission fehlt: " + e.getMessage());
        } catch (Exception e) {
            Log.w(TAG, "📍 GPS-Tracker konnte nicht gestartet werden: " + e.getMessage());
        }
    }

    private void stopGpsTracking() {
        if (fusedLocationClient != null && locationCallback != null) {
            try {
                fusedLocationClient.removeLocationUpdates(locationCallback);
                Log.i(TAG, "📍 Nativer GPS-Tracker gestoppt");
            } catch (Exception e) { /* ignore */ }
        }
        fusedLocationClient = null;
        locationCallback = null;
        lastLat = null;
        lastLon = null;
        lastAccuracy = null;
    }
}
