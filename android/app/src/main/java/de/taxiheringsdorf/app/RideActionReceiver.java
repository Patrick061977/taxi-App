package de.taxiheringsdorf.app;

import android.app.NotificationManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.util.Log;
import androidx.core.app.NotificationCompat;
import com.google.firebase.messaging.FirebaseMessaging;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

// v6.41.99: BroadcastReceiver für Annehmen/Ablehnen-Buttons in der FCM-Notification.
// Tipp auf den Button → onReceive feuert SOFORT (auch wenn App tot ist).
// Wir machen einen HTTP-POST an die Cloud Function rideAction die das Firebase-Update macht.
// Dann updaten wir die Notification damit der Fahrer sieht: ✅ angenommen / ❌ abgelehnt.
public class RideActionReceiver extends BroadcastReceiver {

    private static final String TAG = "RideActionReceiver";
    public static final String ACTION_ACCEPT = "de.taxiheringsdorf.app.ACTION_ACCEPT_RIDE";
    public static final String ACTION_REJECT = "de.taxiheringsdorf.app.ACTION_REJECT_RIDE";
    public static final String EXTRA_RIDE_ID = "rideId";
    public static final String EXTRA_NOTIFICATION_ID = "notificationId";
    public static final String EXTRA_VEHICLE_ID = "vehicleId";

    private static final String RIDE_ACTION_URL = "https://europe-west1-taxi-heringsdorf.cloudfunctions.net/rideAction";

    @Override
    public void onReceive(Context context, Intent intent) {
        final String rideId = intent.getStringExtra(EXTRA_RIDE_ID);
        final int notifId = intent.getIntExtra(EXTRA_NOTIFICATION_ID, 0);
        final String vehicleId = intent.getStringExtra(EXTRA_VEHICLE_ID);
        final String act = intent.getAction();
        final boolean isAccept = ACTION_ACCEPT.equals(act);
        if (rideId == null) return;

        Log.d(TAG, "Action: " + (isAccept ? "ACCEPT" : "REJECT") + " für rideId=" + rideId + " vehicleId=" + vehicleId);

        // Sofort Notification aktualisieren (UI-Feedback)
        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        NotificationCompat.Builder building = new NotificationCompat.Builder(context, TaxiFCMService.CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(isAccept ? "⏳ Akzeptiere Auftrag…" : "⏳ Lehne Auftrag ab…")
            .setContentText("Wird verarbeitet")
            .setAutoCancel(false)
            .setOngoing(true);
        if (nm != null) nm.notify(notifId, building.build());

        // HTTP-Call in Background-Thread
        new Thread(() -> {
            String result = doRideAction(context, rideId, vehicleId, isAccept);
            // Final Notification mit Ergebnis
            String finalTitle, finalText;
            if ("ok".equals(result)) {
                finalTitle = isAccept ? "✅ Auftrag akzeptiert" : "❌ Auftrag abgelehnt";
                finalText = "Auftrag #" + rideId + " · Status aktualisiert";
            } else {
                finalTitle = "⚠️ Aktion fehlgeschlagen";
                finalText = "Bitte App öffnen + manuell bestätigen. (" + result + ")";
            }
            NotificationCompat.Builder finalB = new NotificationCompat.Builder(context, TaxiFCMService.CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentTitle(finalTitle)
                .setContentText(finalText)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(finalText))
                .setAutoCancel(true)
                .setTimeoutAfter(10_000);
            // Tipp öffnet App
            Intent openIntent = new Intent(context, MainActivity.class);
            openIntent.putExtra("rideId", rideId);
            openIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            android.app.PendingIntent pi = android.app.PendingIntent.getActivity(context, 0, openIntent,
                android.app.PendingIntent.FLAG_UPDATE_CURRENT | android.app.PendingIntent.FLAG_IMMUTABLE);
            finalB.setContentIntent(pi);
            if (nm != null) nm.notify(notifId, finalB.build());
        }).start();
    }

    private String doRideAction(Context context, String rideId, String vehicleId, boolean isAccept) {
        try {
            // FCM-Token aus SharedPreferences holen (TaxiFCMService.onNewToken speichert ihn dort)
            SharedPreferences prefs = context.getSharedPreferences("fcm", Context.MODE_PRIVATE);
            String fcmToken = prefs.getString("current_token", null);
            // Falls kein Token gespeichert → live abrufen
            if (fcmToken == null) {
                try {
                    com.google.android.gms.tasks.Task<String> t = FirebaseMessaging.getInstance().getToken();
                    com.google.android.gms.tasks.Tasks.await(t, 5, java.util.concurrent.TimeUnit.SECONDS);
                    fcmToken = t.getResult();
                } catch (Throwable _e) { /* ignore */ }
            }
            if (fcmToken == null) return "kein FCM-Token";

            URL url = new URL(RIDE_ACTION_URL);
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setRequestProperty("Accept", "application/json");
            conn.setConnectTimeout(8000);
            conn.setReadTimeout(8000);
            conn.setDoOutput(true);

            String body = "{\"rideId\":" + jsonStr(rideId)
                       + ",\"action\":" + jsonStr(isAccept ? "accept" : "reject")
                       + ",\"vehicleId\":" + jsonStr(vehicleId == null ? "" : vehicleId)
                       + ",\"fcmToken\":" + jsonStr(fcmToken) + "}";
            try (OutputStream os = conn.getOutputStream()) {
                os.write(body.getBytes("UTF-8"));
            }
            int code = conn.getResponseCode();
            conn.disconnect();
            return code >= 200 && code < 300 ? "ok" : ("HTTP " + code);
        } catch (Throwable t) {
            Log.e(TAG, "doRideAction Fehler: " + t.getMessage());
            return "Fehler: " + t.getMessage();
        }
    }

    private String jsonStr(String s) {
        if (s == null) return "null";
        return "\"" + s.replace("\\","\\\\").replace("\"","\\\"") + "\"";
    }
}
