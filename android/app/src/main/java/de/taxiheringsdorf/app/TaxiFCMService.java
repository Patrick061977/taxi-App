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

        // v6.62.49: Native SMS-Gateway. Cloud-Function pusht FCM type=send_sms wenn ein
        // smsQueue-Eintrag verarbeitet werden soll. Wir rufen SmsManager.sendTextMessage
        // (SEND_SMS-Permission ist im Manifest, einmal granted) und schreiben Status zurueck.
        if ("send_sms".equals(type)) {
            handleSmsRelay(data);
            return;
        }

        // v6.62.656: Patrick (13.05. 07:44): 'Push klingelt nach Annehmen weiter, wische
        // runter raus aus App'. Cloud-Function schickt jetzt type=cancel_notification
        // wenn Status auf 'accepted' wechselt — wir canceln die persistente Notification.
        if ("cancel_notification".equals(type)) {
            String _rid = data.get("rideId");
            if (_rid != null && !_rid.isEmpty()) {
                int _nid = NOTIFICATION_ID_BASE + (_rid.hashCode() & 0x7FFF);
                NotificationManager _nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
                if (_nm != null) _nm.cancel(_nid);
                Log.d(TAG, "Notification cancelled fuer rideId=" + _rid + " (id=" + _nid + ")");
            }
            return;
        }

        String rideId = data.get("rideId");
        String pickup = data.getOrDefault("pickup", "");
        String destination = data.getOrDefault("destination", "");
        String pickupTime = data.getOrDefault("pickupTime", "Sofort");
        String customerName = data.getOrDefault("customerName", "Kunde");

        // v6.62.69: Audit-Trail — Push-Empfang im lifecycleLog der Ride loggen.
        // Patrick will sehen wann sein Handy den Push wirklich empfangen hat (vs. wann er
        // gesendet wurde). Differenz zeigt FCM-Latenz.
        if (rideId != null && !rideId.isEmpty() && ("new_ride".equals(type) || "ride_cancelled".equals(type))) {
            try {
                java.util.Map<String, Object> entry = new java.util.HashMap<>();
                entry.put("t", System.currentTimeMillis());
                entry.put("icon", "📥");
                entry.put("action", "FCM-Push empfangen (Handy)");
                entry.put("source", "🤖 Native v" + de.taxiheringsdorf.app.BuildConfig.VERSION_NAME);
                entry.put("device", android.os.Build.MODEL);
                org.json.JSONObject details = new org.json.JSONObject();
                details.put("type", type);
                details.put("isReminder", data.getOrDefault("isReminder", "false"));
                entry.put("details", details.toString());
                com.google.firebase.database.FirebaseDatabase.getInstance("https://taxi-heringsdorf-default-rtdb.europe-west1.firebasedatabase.app")
                    .getReference("rides/" + rideId + "/lifecycleLog").push().setValue(entry);
            } catch (Throwable _logErr) { Log.w(TAG, "Lifecycle-Log fuer Push-Empfang fehlgeschlagen: " + _logErr.getMessage()); }
        }

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

        // v6.43.2: Notification-Tap öffnet DriverDashboardActivity (nicht MainActivity/WebView).
        // Patrick erlebte: Power-Button-Wakeup → Tippen auf Notification → Login-Screen statt Dashboard.
        Intent appIntent = new Intent(this, DriverDashboardActivity.class);
        appIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        if (rideId != null) appIntent.putExtra("rideId", rideId);
        PendingIntent pendingIntent = PendingIntent.getActivity(
            this, rideId != null ? rideId.hashCode() : 0, appIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        // v6.41.99: Action-Buttons für Annehmen/Ablehnen direkt in der Notification
        String vehicleId = data.get("vehicleId"); // Cloud Function muss das mitschicken
        int notificationId = NOTIFICATION_ID_BASE + (rideId != null ? rideId.hashCode() & 0x7FFF : (int) (System.currentTimeMillis() % 10000));
        PendingIntent acceptIntent = null, rejectIntent = null;
        if ("new_ride".equals(type) && rideId != null) {
            Intent acceptI = new Intent(this, RideActionReceiver.class);
            acceptI.setAction(RideActionReceiver.ACTION_ACCEPT);
            acceptI.putExtra(RideActionReceiver.EXTRA_RIDE_ID, rideId);
            acceptI.putExtra(RideActionReceiver.EXTRA_NOTIFICATION_ID, notificationId);
            acceptI.putExtra(RideActionReceiver.EXTRA_VEHICLE_ID, vehicleId);
            acceptIntent = PendingIntent.getBroadcast(this, ("a"+rideId).hashCode(), acceptI,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

            Intent rejectI = new Intent(this, RideActionReceiver.class);
            rejectI.setAction(RideActionReceiver.ACTION_REJECT);
            rejectI.putExtra(RideActionReceiver.EXTRA_RIDE_ID, rideId);
            rejectI.putExtra(RideActionReceiver.EXTRA_NOTIFICATION_ID, notificationId);
            rejectI.putExtra(RideActionReceiver.EXTRA_VEHICLE_ID, vehicleId);
            rejectIntent = PendingIntent.getBroadcast(this, ("r"+rideId).hashCode(), rejectI,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        }

        // Sound + Vibration (LAUT) — v6.41.98: TYPE_RINGTONE statt TYPE_NOTIFICATION,
        // weil RingTone länger + lauter spielt + Samsung's 'still silent'-Override eher umgeht.
        // v6.42.7: ALARM-URI als zusätzliche Eskalation — Patrick erlebte zu leisen Sound trotz Ringtone.
        Uri sound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
        if (sound == null) sound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
        if (sound == null) sound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);

        // v6.62.18: Auftrags-Push klebt — kann NICHT versehentlich weggewischt werden,
        // verschwindet nur über Annehmen/Ablehnen (RideActionReceiver räumt auf) oder Tap (App-Open).
        // Andere Push-Typen (storniert/Info) bleiben tap-to-dismiss.
        boolean isOrderPush = "new_ride".equals(type) && rideId != null;
        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(title)
            .setContentText(body.split("\n")[0])
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_CALL) // hohe Priorität → Heads-Up
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setSound(sound)
            .setVibrate(new long[]{0, 800, 300, 800, 300, 800, 300, 800})
            .setOngoing(isOrderPush)        // ← NEU: kann nicht weggewischt werden (nur Order-Pushes)
            .setAutoCancel(true)            // Tap auf Notification/Action räumt sie weg
            .setContentIntent(pendingIntent)
            .setFullScreenIntent(pendingIntent, true); // weckt Bildschirm bei lock-screen

        // v6.41.99: Action-Buttons direkt in der Notification — Annehmen/Ablehnen ohne App zu öffnen
        if (acceptIntent != null) builder.addAction(android.R.drawable.ic_menu_add, "✅ Annehmen", acceptIntent);
        if (rejectIntent != null) builder.addAction(android.R.drawable.ic_menu_close_clear_cancel, "❌ Ablehnen", rejectIntent);

        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.notify(notificationId, builder.build());
    }

    // v6.62.49: Native SMS-Gateway. Empfaengt FCM type=send_sms, ruft SmsManager und
    // schreibt Status zurueck nach /smsQueue/{smsId}. Ersetzt das Macrodroid-Setup.
    private void handleSmsRelay(Map<String, String> data) {
        final String smsId = data.get("smsId");
        final String phone = data.get("phone");
        final String text = data.get("text");
        if (smsId == null || phone == null || text == null) {
            Log.w(TAG, "send_sms: smsId/phone/text fehlt");
            return;
        }
        // SEND_SMS-Permission pruefen
        if (androidx.core.content.ContextCompat.checkSelfPermission(this,
                android.Manifest.permission.SEND_SMS) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            Log.w(TAG, "send_sms: SEND_SMS-Permission fehlt");
            updateSmsStatus(smsId, "failed", "no_send_sms_permission");
            return;
        }
        try {
            // Bei langen Texten: divideMessage
            android.telephony.SmsManager sm = android.telephony.SmsManager.getDefault();
            if (text.length() > 160) {
                java.util.ArrayList<String> parts = sm.divideMessage(text);
                sm.sendMultipartTextMessage(phone, null, parts, null, null);
            } else {
                sm.sendTextMessage(phone, null, text, null, null);
            }
            Log.i(TAG, "📲 SMS gesendet an " + phone + " (smsId " + smsId + ")");
            // v6.62.94: Patrick: 'gestern war mein Postausgang immer mit den SMSen gefuellt
            // damit ich das alles nochmal kontrollieren kann was verschickt wird'. Samsung
            // capturete frueher SmsManager-SMS automatisch — nach APK-Update v6.62.93 nicht
            // mehr. Wir schreiben die SMS jetzt explizit in Telephony.Sms.Sent damit sie
            // OS-unabhaengig im Standard-SMS-Postausgang erscheint. Ab Android 4.4 darf das
            // eigentlich nur die Default-SMS-App, aber Samsung-Geraete tolerieren den Insert
            // historisch — Best-Effort, Fehler ignorieren.
            try {
                android.content.ContentValues values = new android.content.ContentValues();
                values.put("address", phone);
                values.put("body", text);
                values.put("date", System.currentTimeMillis());
                values.put("read", 1);
                values.put("type", 2); // MESSAGE_TYPE_SENT
                getContentResolver().insert(android.net.Uri.parse("content://sms/sent"), values);
            } catch (Throwable _outboxErr) {
                Log.w(TAG, "Outbox-Insert nicht moeglich: " + _outboxErr.getMessage());
            }
            updateSmsStatus(smsId, "sent", null);
        } catch (Throwable t) {
            Log.e(TAG, "send_sms Fehler: " + t.getMessage());
            updateSmsStatus(smsId, "failed", t.getMessage());
        }
    }

    private void updateSmsStatus(String smsId, String status, String error) {
        try {
            java.util.Map<String, Object> upd = new java.util.HashMap<>();
            upd.put("status", status);
            upd.put("processedAt", System.currentTimeMillis());
            upd.put("processedBy", "native_gateway_" + Build.MODEL);
            if (error != null) upd.put("error", error);
            com.google.firebase.database.FirebaseDatabase.getInstance(
                "https://taxi-heringsdorf-default-rtdb.europe-west1.firebasedatabase.app")
                .getReference("smsQueue/" + smsId).updateChildren(upd);
        } catch (Throwable _t) { /* still */ }
    }

    @Override
    public void onNewToken(String token) {
        Log.d(TAG, "Neuer FCM-Token: " + token.substring(0, 16) + "...");
        // v6.41.99: Token in SharedPreferences damit RideActionReceiver ihn auch ohne
        // JS-Bridge findet — wichtig wenn die App tot ist und nur die Notification-Buttons getippt werden.
        getSharedPreferences("fcm", MODE_PRIVATE).edit()
            .putString("current_token", token)
            .putString("pending_token", token)
            .apply();
    }

    private void ensureNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        if (nm.getNotificationChannel(CHANNEL_ID) != null) return;
        // v6.41.98: IMPORTANCE_HIGH ist max programmatisch — User kann's in Settings auf MAX setzen.
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID, CHANNEL_NAME, NotificationManager.IMPORTANCE_HIGH
        );
        channel.setDescription("Benachrichtigungen über neue Fahrt-Aufträge — HOCH wichtig, Sound + Vibration");
        channel.enableVibration(true);
        channel.setVibrationPattern(new long[]{0, 800, 300, 800, 300, 800, 300, 800});
        // v6.42.7: USAGE_ALARM erzwingt MAX-Volume + ignoriert Notifications-Slider.
        // ALARM-URI ist außerdem noch lauter/länger als Ringtone.
        AudioAttributes audioAttrs = new AudioAttributes.Builder()
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .setUsage(AudioAttributes.USAGE_ALARM)
            .build();
        Uri channelSound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
        if (channelSound == null) channelSound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
        if (channelSound == null) channelSound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
        channel.setSound(channelSound, audioAttrs);
        channel.setBypassDnd(true); // wichtig: durch Nicht-Stören-Modus durchbrechen für Aufträge
        channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        nm.createNotificationChannel(channel);
    }
}
