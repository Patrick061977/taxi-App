package de.taxiheringsdorf.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.util.Log;
import androidx.core.app.NotificationCompat;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;
import java.util.Map;

// v6.41.96: Phase 1 Native-First — FCM-Service empfängt Push-Notifications der
// Cloud Function bei neuen Aufträgen. Funktioniert auch wenn WebView/UI gekillt
// wurde, weil Android FCM unabhängig davon zustellt. User hört einen lauten Ton +
// sieht Notification → tippt → App öffnet zum Auftrag.
public class TaxiFCMService extends FirebaseMessagingService {

    private static final String TAG = "TaxiFCMService";
    public static final String CHANNEL_ID = "taxi_heringsdorf_rides";
    public static final String CHANNEL_NAME = "Neue Fahrten";
    private static final int NOTIFICATION_ID_BASE = 2000;

    @Override
    public void onCreate() {
        super.onCreate();
        ensureNotificationChannel();
    }

    @Override
    public void onMessageReceived(RemoteMessage remoteMessage) {
        Log.d(TAG, "FCM-Nachricht empfangen: " + remoteMessage.getMessageId());
        ensureNotificationChannel();

        Map<String, String> data = remoteMessage.getData();
        String type = data.getOrDefault("type", "unknown");
        String rideId = data.get("rideId");
        String pickup = data.getOrDefault("pickup", "");
        String destination = data.getOrDefault("destination", "");
        String pickupTime = data.getOrDefault("pickupTime", "Sofort");
        String customerName = data.getOrDefault("customerName", "Kunde");

        // Notification-Inhalt
        String title;
        String body;
        if ("new_ride".equals(type)) {
            title = "🚕 Neue Fahrt!";
            body = pickupTime + " · " + customerName + "\n📍 " + pickup;
            if (!destination.isEmpty()) body += "\n🎯 " + destination;
        } else if ("ride_cancelled".equals(type)) {
            title = "❌ Fahrt storniert";
            body = customerName + " · " + pickupTime;
        } else {
            // Fallback auf notification payload (selten genutzt)
            RemoteMessage.Notification n = remoteMessage.getNotification();
            title = n != null && n.getTitle() != null ? n.getTitle() : "🚕 Funk Taxi";
            body = n != null && n.getBody() != null ? n.getBody() : "Neue Nachricht";
        }

        // Intent: App öffnen + RideId als Extra mitgeben
        Intent appIntent = new Intent(this, MainActivity.class);
        appIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        if (rideId != null) appIntent.putExtra("rideId", rideId);
        PendingIntent pendingIntent = PendingIntent.getActivity(
            this, 0, appIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        // Sound + Vibration (laut)
        Uri sound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(title)
            .setContentText(body.split("\n")[0])
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_CALL) // hohe Priorität → Heads-Up
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setSound(sound)
            .setVibrate(new long[]{0, 500, 200, 500, 200, 500})
            .setAutoCancel(true)
            .setContentIntent(pendingIntent)
            .setFullScreenIntent(pendingIntent, true); // weckt Bildschirm bei lock-screen

        int notificationId = NOTIFICATION_ID_BASE + (rideId != null ? rideId.hashCode() & 0x7FFF : (int) (System.currentTimeMillis() % 10000));
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.notify(notificationId, builder.build());
    }

    @Override
    public void onNewToken(String token) {
        Log.d(TAG, "Neuer FCM-Token: " + token.substring(0, 16) + "...");
        // Token-Persistierung nach Firebase macht der JS-Code beim App-Start
        // (FCMPlugin.getToken). Wir speichern hier nur ein Pending-Flag damit
        // die UI weiß sie soll den Token holen.
        getSharedPreferences("fcm", MODE_PRIVATE).edit().putString("pending_token", token).apply();
    }

    private void ensureNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        if (nm.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID, CHANNEL_NAME, NotificationManager.IMPORTANCE_HIGH
        );
        channel.setDescription("Benachrichtigungen über neue Fahrt-Aufträge");
        channel.enableVibration(true);
        channel.setVibrationPattern(new long[]{0, 500, 200, 500, 200, 500});
        AudioAttributes audioAttrs = new AudioAttributes.Builder()
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
            .build();
        channel.setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION), audioAttrs);
        channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        nm.createNotificationChannel(channel);
    }
}
