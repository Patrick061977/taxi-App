package de.taxiheringsdorf.app;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.location.Location;
import android.os.BatteryManager;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.util.Log;

import androidx.core.app.ActivityCompat;
import androidx.core.app.NotificationCompat;

import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationCallback;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationResult;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;
import com.google.firebase.database.DatabaseReference;
import com.google.firebase.database.FirebaseDatabase;
import com.google.firebase.database.ServerValue;

import java.util.HashMap;
import java.util.Map;

/**
 * v6.40.0: Hält die Fahrer-App am Leben während aktiver Schicht.
 * v6.40.8: Eigene native GPS-Loop (FusedLocationProvider) damit Tracking auch
 *          bei abgeschaltetem Bildschirm + dösender WebView weiterläuft.
 *          Akku-Temperatur wird zyklisch nach Firebase geschrieben.
 */
public class ShiftForegroundService extends Service {

    private static final String TAG = "ShiftFGService";

    public static final String CHANNEL_ID = "taxi_heringsdorf_shift";
    public static final int NOTIFICATION_ID = 1001;

    public static final String ACTION_START = "de.taxiheringsdorf.app.START_SHIFT";
    public static final String ACTION_STOP = "de.taxiheringsdorf.app.STOP_SHIFT";

    public static final String EXTRA_CONTENT_TEXT = "contentText";
    public static final String EXTRA_VEHICLE_ID = "vehicleId";
    public static final String EXTRA_VEHICLE_NAME = "vehicleName";
    public static final String EXTRA_USER_ID = "userId";
    public static final String EXTRA_USER_EMAIL = "userEmail";

    // GPS-Update-Intervall (ms) — 5s ist ein guter Kompromiss aus Genauigkeit & Akku
    private static final long LOCATION_INTERVAL_MS = 5_000L;
    private static final long LOCATION_FASTEST_MS = 3_000L;
    // Akku-Temperatur alle 60s loggen
    private static final long BATTERY_LOG_INTERVAL_MS = 60_000L;

    private static boolean running = false;

    private FusedLocationProviderClient fusedClient;
    private LocationCallback locationCallback;
    private Handler bgHandler;
    private Runnable batteryLogger;

    private String vehicleId;
    private String vehicleName;
    private String userId;
    private String userEmail;

    public static boolean isRunning() {
        return running;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
        bgHandler = new Handler(Looper.getMainLooper());
        try {
            fusedClient = LocationServices.getFusedLocationProviderClient(this);
        } catch (Throwable t) {
            Log.w(TAG, "FusedLocationProvider nicht verfügbar: " + t.getMessage());
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : null;
        if (ACTION_STOP.equals(action)) {
            stopGpsLoop();
            stopBatteryLogger();
            running = false;
            stopForeground(true);
            stopSelf();
            return START_NOT_STICKY;
        }

        if (intent != null) {
            if (intent.hasExtra(EXTRA_VEHICLE_ID)) vehicleId = intent.getStringExtra(EXTRA_VEHICLE_ID);
            if (intent.hasExtra(EXTRA_VEHICLE_NAME)) vehicleName = intent.getStringExtra(EXTRA_VEHICLE_NAME);
            if (intent.hasExtra(EXTRA_USER_ID)) userId = intent.getStringExtra(EXTRA_USER_ID);
            if (intent.hasExtra(EXTRA_USER_EMAIL)) userEmail = intent.getStringExtra(EXTRA_USER_EMAIL);
        }

        String contentText = "Schicht aktiv – GPS und Dispatch laufen";
        if (intent != null && intent.hasExtra(EXTRA_CONTENT_TEXT)) {
            String custom = intent.getStringExtra(EXTRA_CONTENT_TEXT);
            if (custom != null && !custom.isEmpty()) {
                contentText = custom;
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

        // v6.40.8: Native GPS- und Akku-Loops starten
        startGpsLoop();
        startBatteryLogger();

        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        running = false;
        stopGpsLoop();
        stopBatteryLogger();
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

    // ───── GPS ─────────────────────────────────────────────

    private boolean hasLocationPermission() {
        return ActivityCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION)
                == PackageManager.PERMISSION_GRANTED
                || ActivityCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION)
                == PackageManager.PERMISSION_GRANTED;
    }

    private void startGpsLoop() {
        if (fusedClient == null || !hasLocationPermission()) {
            Log.w(TAG, "GPS-Loop kann nicht starten: Berechtigung oder Client fehlt");
            return;
        }
        try {
            LocationRequest req = new LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, LOCATION_INTERVAL_MS)
                    .setMinUpdateIntervalMillis(LOCATION_FASTEST_MS)
                    .setWaitForAccurateLocation(false)
                    .build();

            locationCallback = new LocationCallback() {
                @Override
                public void onLocationResult(LocationResult result) {
                    if (result == null) return;
                    Location loc = result.getLastLocation();
                    if (loc == null) return;
                    writeLocationToFirebase(loc);
                }
            };

            fusedClient.requestLocationUpdates(req, locationCallback, Looper.getMainLooper());
            Log.i(TAG, "✅ Native GPS-Loop gestartet (Intervall " + LOCATION_INTERVAL_MS + "ms)");
        } catch (SecurityException se) {
            Log.w(TAG, "GPS-Loop SecurityException: " + se.getMessage());
        } catch (Throwable t) {
            Log.w(TAG, "GPS-Loop konnte nicht starten: " + t.getMessage());
        }
    }

    private void stopGpsLoop() {
        try {
            if (fusedClient != null && locationCallback != null) {
                fusedClient.removeLocationUpdates(locationCallback);
            }
        } catch (Throwable ignored) {
        } finally {
            locationCallback = null;
        }
    }

    private void writeLocationToFirebase(Location loc) {
        if (vehicleId == null || vehicleId.isEmpty()) return;
        try {
            DatabaseReference ref = FirebaseDatabase.getInstance().getReference("vehicles").child(vehicleId);
            Map<String, Object> update = new HashMap<>();
            update.put("lat", loc.getLatitude());
            update.put("lon", loc.getLongitude());
            update.put("accuracy", loc.getAccuracy());
            update.put("speed", loc.hasSpeed() ? loc.getSpeed() : 0);
            update.put("heading", loc.hasBearing() ? loc.getBearing() : 0);
            update.put("timestamp", System.currentTimeMillis());
            update.put("vehicleId", vehicleId);
            if (vehicleName != null) update.put("vehicle", vehicleName);
            update.put("mode", "native_service");
            update.put("source", "ShiftForegroundService");
            if (userId != null) update.put("userId", userId);
            if (userEmail != null) update.put("userEmail", userEmail);
            ref.updateChildren(update);
        } catch (Throwable t) {
            Log.w(TAG, "Firebase-Write fehlgeschlagen: " + t.getMessage());
        }
    }

    // ───── Akku-Temperatur ────────────────────────────────

    private void startBatteryLogger() {
        stopBatteryLogger();
        batteryLogger = new Runnable() {
            @Override
            public void run() {
                logBatteryHealth();
                if (running && bgHandler != null) {
                    bgHandler.postDelayed(this, BATTERY_LOG_INTERVAL_MS);
                }
            }
        };
        if (bgHandler != null) bgHandler.post(batteryLogger);
    }

    private void stopBatteryLogger() {
        if (bgHandler != null && batteryLogger != null) {
            bgHandler.removeCallbacks(batteryLogger);
        }
        batteryLogger = null;
    }

    private void logBatteryHealth() {
        if (vehicleId == null || vehicleId.isEmpty()) return;
        try {
            IntentFilter filter = new IntentFilter(Intent.ACTION_BATTERY_CHANGED);
            Intent battery = registerReceiver((BroadcastReceiver) null, filter);
            if (battery == null) return;

            int level = battery.getIntExtra(BatteryManager.EXTRA_LEVEL, -1);
            int scale = battery.getIntExtra(BatteryManager.EXTRA_SCALE, -1);
            int tempDeci = battery.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, -1); // Zehntel-Grad
            int voltage = battery.getIntExtra(BatteryManager.EXTRA_VOLTAGE, -1);     // mV
            int status = battery.getIntExtra(BatteryManager.EXTRA_STATUS, -1);
            int plugged = battery.getIntExtra(BatteryManager.EXTRA_PLUGGED, -1);
            int health = battery.getIntExtra(BatteryManager.EXTRA_HEALTH, -1);
            String technology = battery.getStringExtra(BatteryManager.EXTRA_TECHNOLOGY);

            double percent = (level >= 0 && scale > 0) ? (level * 100.0 / scale) : -1;
            double tempC = tempDeci != -1 ? (tempDeci / 10.0) : -1;

            long now = System.currentTimeMillis();
            Map<String, Object> entry = new HashMap<>();
            entry.put("ts", now);
            entry.put("vehicleId", vehicleId);
            if (userId != null) entry.put("userId", userId);
            entry.put("battery_pct", percent);
            entry.put("battery_temp_c", tempC);
            entry.put("battery_voltage_mv", voltage);
            entry.put("battery_status", status);
            entry.put("battery_plugged", plugged);
            entry.put("battery_health", health);
            entry.put("battery_tech", technology);
            entry.put("created", ServerValue.TIMESTAMP);

            // Pfad: /driverHealth/{vehicleId}/{timestamp}
            FirebaseDatabase.getInstance()
                    .getReference("driverHealth")
                    .child(vehicleId)
                    .child(String.valueOf(now))
                    .setValue(entry);

            // ⚠️ Hitze-Warnung ab 42°C (Samsung throttelt ab ~45°C, akute Gefahr ab 50°C)
            if (tempC >= 42.0) {
                Map<String, Object> warn = new HashMap<>();
                warn.put("ts", now);
                warn.put("vehicleId", vehicleId);
                warn.put("battery_temp_c", tempC);
                warn.put("battery_pct", percent);
                warn.put("level", tempC >= 50.0 ? "critical" : (tempC >= 45.0 ? "high" : "warn"));
                warn.put("created", ServerValue.TIMESTAMP);
                FirebaseDatabase.getInstance()
                        .getReference("driverHealthAlerts")
                        .child(vehicleId)
                        .push()
                        .setValue(warn);
            }
        } catch (Throwable t) {
            Log.w(TAG, "Battery-Log fehlgeschlagen: " + t.getMessage());
        }
    }
}
