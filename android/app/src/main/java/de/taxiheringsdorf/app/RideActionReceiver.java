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

        // 🆕 v6.62.935: Lautlos-Override-Alarm sofort stoppen — Fahrer hat reagiert.
        try { AlertSoundService.stop(context); } catch (Throwable _ignore) {}
        // 🆕 v6.63.775 (Patrick 22.07. Bridge "ton muss ausgehen wenn man annimmt"):
        //   Notification SOFORT cancel — sonst spielt der Channel-Alarm-Sound (30-60s Loop
        //   via USAGE_ALARM auf taxi_heringsdorf_rides_v2) weiter, obwohl der MediaPlayer
        //   des AlertSoundService gestoppt ist. Beim Update via nm.notify() stoppt Android
        //   den Sound NICHT — nur nm.cancel(notifId) tut es. Danach neue Notification unter
        //   +1000-offset ID damit die ⏳/final Notification nicht mit der Ursprungs-ID
        //   kollidiert (sonst wuerde Android sie als Sound-triggerndes Neu-Notify werten).
        try {
            NotificationManager _snm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            if (_snm != null) _snm.cancel(notifId);
        } catch (Throwable _ignore) {}
        final int progressNotifId = notifId + 1000;

        // v6.62.5: Patrick: 'wenn ich auf Annehmen klicke, muss ich sofort in die App reinkommen'.
        // Bei ACCEPT direkt DriverDashboardActivity launchen — HTTP-Call läuft async daneben.
        // (Bei REJECT bleibt der Fahrer wo er ist — er hat ja abgelehnt, kein Grund die App zu öffnen.)
        if (isAccept) {
            try {
                Intent openApp = new Intent(context, DriverDashboardActivity.class);
                openApp.putExtra("rideId", rideId);
                openApp.putExtra("openedFromAccept", true);
                openApp.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
                context.startActivity(openApp);
                Log.d(TAG, "✅ DriverDashboard direkt nach Annehmen geöffnet");
            } catch (Throwable t) {
                Log.w(TAG, "DashboardActivity-Launch fehlgeschlagen: " + t.getMessage());
            }
        }

        // Sofort Notification aktualisieren (UI-Feedback)
        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        // 🆕 v6.63.775: eigener silent Progress-Channel damit kein Alarm-Sound bei Fortschritts-Update
        NotificationCompat.Builder building = new NotificationCompat.Builder(context, TaxiFCMService.DEPARTURE_CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(isAccept ? "⏳ Akzeptiere Auftrag…" : "⏳ Lehne Auftrag ab…")
            .setContentText("Wird verarbeitet")
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOnlyAlertOnce(true)
            .setSound(null)
            .setAutoCancel(false)
            .setOngoing(true);
        if (nm != null) nm.notify(progressNotifId, building.build());

        // HTTP-Call in Background-Thread
        new Thread(() -> {
            String result = doRideAction(context, rideId, vehicleId, isAccept);
            // Final Notification mit Ergebnis
            String finalTitle, finalText;
            if ("ok".equals(result)) {
                finalTitle = isAccept ? "✅ Auftrag akzeptiert" : "❌ Auftrag abgelehnt";
                finalText = "Auftrag #" + rideId + " · Status aktualisiert";
            } else if (result != null && result.startsWith("skipped:")) {
                // v6.63.087: Server hat Klick bewusst ignoriert (z.B. Fahrt schon picked_up)
                finalTitle = "ℹ️ Klick ignoriert";
                finalText = result.substring(8);  // text after "skipped:"
            } else {
                finalTitle = "⚠️ Aktion fehlgeschlagen";
                finalText = "Bitte App öffnen + manuell bestätigen. (" + result + ")";
            }
            NotificationCompat.Builder finalB = new NotificationCompat.Builder(context, TaxiFCMService.DEPARTURE_CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentTitle(finalTitle)
                .setContentText(finalText)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(finalText))
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setOnlyAlertOnce(true)
                .setSound(null)
                .setAutoCancel(true)
                .setTimeoutAfter(10_000);
            // v6.43.2: Tipp auf Bestätigungs-Notification öffnet DriverDashboardActivity (nicht WebView).
            Intent openIntent = new Intent(context, DriverDashboardActivity.class);
            openIntent.putExtra("rideId", rideId);
            openIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            android.app.PendingIntent pi = android.app.PendingIntent.getActivity(context, 0, openIntent,
                android.app.PendingIntent.FLAG_UPDATE_CURRENT | android.app.PendingIntent.FLAG_IMMUTABLE);
            finalB.setContentIntent(pi);
            if (nm != null) nm.notify(progressNotifId, finalB.build());
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
            // v6.63.087 (Patrick 02.06. 09:53 'Ablehnen-Push geht nicht'):
            //   Response-Body lesen — Cloud gibt jetzt JSON mit { action: 'reject_skipped',
            //   message: '...' } zurück wenn z.B. Fahrt bereits picked_up ist. Ohne diesen
            //   Parse hat der Fahrer keine Ahnung warum sein Klick "nichts gemacht hat".
            String responseBody = "";
            try {
                java.io.BufferedReader br = new java.io.BufferedReader(new java.io.InputStreamReader(
                    code >= 200 && code < 300 ? conn.getInputStream() : conn.getErrorStream(), "UTF-8"));
                StringBuilder sb = new StringBuilder();
                String line;
                while ((line = br.readLine()) != null) sb.append(line);
                responseBody = sb.toString();
                br.close();
            } catch (Throwable _ignore) {}
            conn.disconnect();
            // Parse optional message-field
            String msg = null;
            try {
                if (responseBody.contains("\"message\"")) {
                    int idx = responseBody.indexOf("\"message\"");
                    int colon = responseBody.indexOf(':', idx);
                    int start = responseBody.indexOf('"', colon + 1);
                    int end = responseBody.indexOf('"', start + 1);
                    if (start > 0 && end > start) msg = responseBody.substring(start + 1, end);
                }
            } catch (Throwable _ignore) {}
            if (code >= 200 && code < 300) {
                if (responseBody.contains("reject_skipped") || responseBody.contains("alreadyProgressed")) {
                    return "skipped:" + (msg != null ? msg : "Fahrt bereits in Bearbeitung");
                }
                return "ok";
            }
            return "HTTP " + code + (msg != null ? " — " + msg : "");
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
