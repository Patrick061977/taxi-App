package de.taxiheringsdorf.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;

import androidx.core.app.NotificationCompat;

/**
 * v6.40.0: Hält die Fahrer-App am Leben während aktiver Schicht.
 * Wird vom ShiftForegroundPlugin (Capacitor) gestartet/gestoppt.
 */
public class ShiftForegroundService extends Service {

    public static final String CHANNEL_ID = "taxi_heringsdorf_shift";
    public static final int NOTIFICATION_ID = 1001;

    public static final String ACTION_START = "de.taxiheringsdorf.app.START_SHIFT";
    public static final String ACTION_STOP = "de.taxiheringsdorf.app.STOP_SHIFT";

    public static final String EXTRA_CONTENT_TEXT = "contentText";

    private static boolean running = false;

    public static boolean isRunning() {
        return running;
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
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        running = false;
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
}
