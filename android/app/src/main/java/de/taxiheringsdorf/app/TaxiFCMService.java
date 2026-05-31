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

    // 🆕 v6.62.665: Patrick (13.05. 09:56): "Wenn die App auf ist und dann kommt kein Push
    //   oder wie, dass man annehmen drueckt — der Fahrer uebersieht das sehr schnell."
    //   Hintergrund: Android Heads-Up-Notifications werden manchmal unterdrueckt wenn die
    //   eigene App im Vordergrund ist. Channel-Sound spielt dann nicht. Workaround:
    //   Activities setzen dieses Flag onResume/onPause — onMessageReceived spielt bei
    //   isForeground=true den Ringtone + Vibration EXPLIZIT, redundant zum NotificationManager.
    public static volatile boolean isForeground = false;
    public static void setForeground(boolean fg) { isForeground = fg; }

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

        // 🆕 v6.62.893 (Patrick 23.05. 13:40): Force-Logout vom Admin.
        // 'Wenn ein Fahrer vergisst sich abzumelden, was macht man da?' Lösung: Admin tippt
        // im Fleet-Map den Knopf 'Fahrer abmelden' → Cloud schreibt forceLogoutRequest=true
        // → Cloud-Function pushed FCM type=force_logout → App raeumt sich auf + zur Login-Activity.
        if ("force_logout".equals(type)) {
            handleForceLogout(data);
            return;
        }

        // 🆕 v6.62.885 (Patrick 23.05. 07:11): Losfahr-Vibration ohne Sound.
        // 'Sound habe ich ja schon wenn ich annehme. Ich brauch nur eine Vibration'.
        // Cloud Function scheduledDepartureAlert pusht 1× pro accepted-Vorbestellung wenn
        // der Losfahr-Zeitpunkt erreicht wird (pickupTimestamp - drivingTimeToPickup).
        if ("departure_alert".equals(type)) {
            handleDepartureAlert(data);
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
            // 🔧 v6.62.785 (Patrick 16.05. 16:28+16:29): "kleiner Push, schwer zu erkennen
            //   ob es ein Fahrtenpush ist". Patrick will sofort sehen ob's neu/umgeplant
            //   ist + Pickup-Adresse in der eingeklappten Vorschau.
            String reason = data.get("reason"); // 'new' / 'reassign' / 'cloud_auto'
            String isVorbest = data.getOrDefault("isVorbestellung", "false");
            String prefix;
            if ("reassign".equals(reason)) prefix = "🔄 UMGEPLANT AUF DICH";
            else if ("true".equals(isVorbest)) prefix = "📅 NEUE VORBESTELLUNG";
            else prefix = "🚕 NEUE FAHRT";
            title = prefix + ": " + customerName + " · " + pickupTime;
            // ContentText: 1 Zeile, sichtbar auch im Lockscreen eingeklappt
            // Plus BigText: voller Body inkl. Aktions-Hinweis
            String shortPickup = pickup.length() > 50 ? pickup.substring(0, 47) + '…' : pickup;
            body = "📍 " + shortPickup;
            if (!destination.isEmpty()) {
                String shortDest = destination.length() > 50 ? destination.substring(0, 47) + '…' : destination;
                body += "\n🎯 " + shortDest;
            }
            body += "\n👆 ANNEHMEN oder ABLEHNEN tippen";
        } else if ("new_web_booking".equals(type)) {
            // 🆕 v6.62.667: Web-Buchung (buchen.html / qr-aufsteller) → Admin-Push
            //   "Bestaetigen" / "Ablehnen" haben Admins nicht direkt im Notification —
            //   sie tippen den Push, AdminDashboardActivity oeffnet sich, dort sehen sie
            //   die Anfrage in der "NEUE WEB-ANFRAGEN"-Sektion und koennen sie zuweisen.
            String src = data.getOrDefault("source", "web-booking");
            String prefix = "qr-aufsteller".equals(src) ? "📱" : "🌐";
            title = prefix + " Neue Web-Buchung!";
            body = pickupTime + " · " + customerName + "\n📍 " + pickup;
            if (!destination.isEmpty()) body += "\n🎯 " + destination;
        } else if ("new_anfrage".equals(type)) {
            // 🆕 v6.62.673: Web-/WhatsApp-Anfrage aus /anfragen/ — noch nicht in /rides
            //   Patrick: "wo sehe ich offene Anfragen in der Native-App?". Tap auf Push
            //   oeffnet AdminDashboard, dort steht die Anfrage in der OFFENE-ANFRAGEN-
            //   Sektion mit "Übernehmen"-Klick-Aktion.
            String src = data.getOrDefault("source", "web");
            String prefix = "whatsapp".equalsIgnoreCase(src) ? "💬" : "📥";
            title = prefix + " Neue " + (src.length() > 0 ? src.toUpperCase() : "WEB") + "-Anfrage!";
            body = pickupTime + " · " + customerName + "\n📍 " + pickup;
            if (!destination.isEmpty()) body += "\n🎯 " + destination;
            body += "\n💡 Tippen zum Übernehmen";
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
        // 🆕 v6.62.667: Bei Admin-Push (new_web_booking) AdminDashboardActivity oeffnen.
        // 🆕 v6.62.673: new_anfrage ebenfalls AdminDashboardActivity.
        Intent appIntent;
        if ("new_web_booking".equals(type) || "new_anfrage".equals(type)) {
            appIntent = new Intent(this, AdminDashboardActivity.class);
        } else {
            appIntent = new Intent(this, DriverDashboardActivity.class);
        }
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

            // 🆕 v6.62.937 (Patrick 25.05. 14:41 "B - zweimal druecken zum Ablehnen"):
            //   Ablehnen-Button oeffnet jetzt die App auf einem Confirm-Dialog statt
            //   direkt abzulehnen. Verhindert versehentliche Rejects in der Notification.
            Intent rejectI = new Intent(this, DriverDashboardActivity.class);
            rejectI.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
            rejectI.putExtra("rideId", rideId);
            rejectI.putExtra("confirmReject", true);
            rejectI.putExtra("notificationId", notificationId);
            rejectI.putExtra("vehicleId", vehicleId);
            rejectIntent = PendingIntent.getActivity(this, ("r"+rideId).hashCode(), rejectI,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        }

        // Sound + Vibration (LAUT) — v6.41.98: TYPE_RINGTONE statt TYPE_NOTIFICATION,
        // weil RingTone länger + lauter spielt + Samsung's 'still silent'-Override eher umgeht.
        // v6.42.7: ALARM-URI als zusätzliche Eskalation — Patrick erlebte zu leisen Sound trotz Ringtone.
        // 🆕 v6.62.979 (Patrick 27.05. 20:20): Sofortfahrt (new_ride) = Alarm (wie Wecker).
        // Webbuchung/Anfrage = sanfteres Notification-Sound + weniger heftige Vibration,
        // damit Patrick die zwei Push-Klassen sofort unterscheiden kann (Vollbild-Alarm vs.
        // Heads-Up-Banner).
        boolean isOrderPush = "new_ride".equals(type) && rideId != null;
        Uri sound;
        long[] vibratePattern;
        if (isOrderPush) {
            // Sofortfahrt: lauter Alarm-Sound + lange Vibration
            sound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
            if (sound == null) sound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
            if (sound == null) sound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
            vibratePattern = new long[]{0, 800, 300, 800, 300, 800, 300, 800};
        } else {
            // Webbuchung/Anfrage: normales Notification-Sound + kurze Vibration
            sound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
            if (sound == null) sound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
            vibratePattern = new long[]{0, 250, 150, 250};
        }

        // v6.62.18: Auftrags-Push klebt — kann NICHT versehentlich weggewischt werden,
        // verschwindet nur über Annehmen/Ablehnen (RideActionReceiver räumt auf) oder Tap (App-Open).
        // Andere Push-Typen (storniert/Info) bleiben tap-to-dismiss.
        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(title)
            .setContentText(body.split("\n")[0])
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(isOrderPush ? NotificationCompat.CATEGORY_CALL : NotificationCompat.CATEGORY_MESSAGE)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setSound(sound)
            .setVibrate(vibratePattern)
            .setOngoing(isOrderPush)        // ← NEU: kann nicht weggewischt werden (nur Order-Pushes)
            .setAutoCancel(true)            // Tap auf Notification/Action räumt sie weg
            .setContentIntent(pendingIntent)
            // v6.63.063 (Patrick 31.05. 19:34): Quick-Wins für visuelle Sichtbarkeit.
            // setColorized + ColorRed → Sofort-Auftrag-Push ist farblich klar erkennbar.
            // setColor für Akzent + sub-Text + Heads-Up-Hervorhebung.
            .setColor(isOrderPush ? android.graphics.Color.parseColor("#dc2626") : android.graphics.Color.parseColor("#059669"))
            .setColorized(isOrderPush)
            .setShowWhen(true);
        // 🆕 v6.62.979: FullScreenIntent NUR bei Sofortfahrt (= weckt Bildschirm im Lockscreen).
        // Webbuchung/Anfrage: nur Heads-Up Notification, keine Lockscreen-Aktivierung.
        if (isOrderPush) {
            builder.setFullScreenIntent(pendingIntent, true);
        }

        // v6.41.99 + v6.63.063: Action-Buttons mit CAPS-Labels → besser sichtbar im
        // Heads-Up-Banner und auf Lockscreen. Patrick 19:34 "ein bisschen größer".
        if (acceptIntent != null) builder.addAction(android.R.drawable.ic_menu_add, "✅ ANNEHMEN", acceptIntent);
        if (rejectIntent != null) builder.addAction(android.R.drawable.ic_menu_close_clear_cancel, "❌ ABLEHNEN", rejectIntent);

        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.notify(notificationId, builder.build());

        // 🆕 v6.62.935 (Patrick 25.05. 14:12 "Handy auf Lautlos — das darf nicht passieren"):
        //   AlertSoundService startet einen Foreground-MediaPlayer mit USAGE_ALARM +
        //   STREAM_ALARM auf Max — bricht durch Lautlos-Modus durch (wie eine Wecker-App).
        //   Nur fuer new_ride (Order-Push). Stoppt automatisch nach 30s oder via
        //   RideActionReceiver bei Accept/Reject.
        // 🆕 v6.62.987 (Patrick 28.05. 10:19): "Losfahr-Alarm kam nicht / war still".
        // Lifecycle zeigte: FCM sauber empfangen, aber kein AlertSoundService → leiser
        // Heads-Up wurde im Doze/DND-Modus untergebuttert. Jetzt auch bei departure_alert
        // den 30-Sek-Wecker-Sound starten (USAGE_ALARM bricht durch Lautlos).
        if (rideId != null && ("new_ride".equals(type) || "departure_alert".equals(type))) {
            try {
                AlertSoundService.start(this);
                Log.d(TAG, "AlertSoundService gestartet fuer " + type + " " + rideId);
            } catch (Throwable t) {
                Log.w(TAG, "AlertSoundService start fail: " + t.getMessage());
            }
        }

        // 🆕 v6.62.665: Foreground-Fallback — wenn App offen ist und Android Heads-Up
        //   unterdrueckt, spielen wir Sound + Vibration zusaetzlich direkt ueber Ringtone-
        //   und Vibrator-API. Nur fuer new_ride + new_web_booking (Audio-Alert wichtig),
        //   nicht fuer cancel/send_sms/etc.
        if (("new_ride".equals(type) || "new_web_booking".equals(type) || "new_anfrage".equals(type)) && isForeground) {
            try {
                android.media.Ringtone _rt = android.media.RingtoneManager.getRingtone(getApplicationContext(), sound);
                if (_rt != null) {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                        AudioAttributes _aa = new AudioAttributes.Builder()
                            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                            .setUsage(AudioAttributes.USAGE_ALARM)
                            .build();
                        try { _rt.setAudioAttributes(_aa); } catch (Throwable _ig) {}
                    }
                    _rt.play();
                    // nach 8s stoppen falls noch laeuft (Ringtone kann sehr lang sein)
                    new android.os.Handler(getMainLooper()).postDelayed(() -> {
                        try { if (_rt.isPlaying()) _rt.stop(); } catch (Throwable _ig) {}
                    }, 8000);
                }
            } catch (Throwable _rtErr) { Log.w(TAG, "Foreground-Ringtone Fehler: " + _rtErr.getMessage()); }
            try {
                android.os.Vibrator _vib = (android.os.Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
                if (_vib != null && _vib.hasVibrator()) {
                    long[] _pat = new long[]{0, 800, 300, 800, 300, 800, 300, 800};
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        _vib.vibrate(android.os.VibrationEffect.createWaveform(_pat, -1));
                    } else {
                        _vib.vibrate(_pat, -1);
                    }
                }
            } catch (Throwable _vErr) { Log.w(TAG, "Foreground-Vibrate Fehler: " + _vErr.getMessage()); }
            Log.d(TAG, "Foreground-Audio + Vibrate fuer new_ride " + rideId);
        }
    }

    // 🆕 v6.62.893: Force-Logout-Handler. Cloud-Function pushed type=force_logout —
    // hier raeumen wir die Session auf + zwingen die App zur Login-Activity.
    private void handleForceLogout(Map<String, String> data) {
        String reason = data.getOrDefault("reason", "Admin-Aktion");
        Log.i(TAG, "🚪 Force-Logout empfangen: " + reason);
        try {
            // 1. Foreground-Service stoppen (Schicht-Heartbeats)
            try {
                Intent stopSvc = new Intent(this, ShiftForegroundService.class);
                stopSvc.setAction(ShiftForegroundService.ACTION_STOP);
                startService(stopSvc);
            } catch (Throwable _t) { Log.w(TAG, "Service-Stop: " + _t.getMessage()); }
            // 2. Vehicle-Lock clearen (activeDevice + lastHeartbeat) — best-effort
            try {
                String vid = getSharedPreferences("driver", MODE_PRIVATE).getString("vehicleId", null);
                if (vid != null) {
                    com.google.firebase.database.FirebaseDatabase.getInstance(
                        "https://taxi-heringsdorf-default-rtdb.europe-west1.firebasedatabase.app")
                        .getReference("vehicles/" + vid + "/activeDevice").removeValue();
                }
            } catch (Throwable _t) { Log.w(TAG, "Lock-Clear: " + _t.getMessage()); }
            // 3. FirebaseAuth sign out
            try { com.google.firebase.auth.FirebaseAuth.getInstance().signOut(); } catch (Throwable _t) {}
            // 4. SharedPreferences clearen
            try { getSharedPreferences("driver", MODE_PRIVATE).edit().clear().apply(); } catch (Throwable _t) {}
            // 5. LoginActivity oeffnen
            try {
                Intent loginI = new Intent(this, LoginActivity.class);
                loginI.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_CLEAR_TASK);
                startActivity(loginI);
            } catch (Throwable _t) { Log.w(TAG, "LoginActivity-Open: " + _t.getMessage()); }
            // 6. Notification damit der Fahrer sieht warum er abgemeldet wurde
            try {
                NotificationCompat.Builder b = new NotificationCompat.Builder(this, CHANNEL_ID)
                    .setSmallIcon(android.R.drawable.ic_dialog_info)
                    .setContentTitle("🚪 Vom Admin abgemeldet")
                    .setContentText(reason)
                    .setPriority(NotificationCompat.PRIORITY_HIGH)
                    .setAutoCancel(true);
                NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
                if (nm != null) nm.notify(NOTIFICATION_ID_BASE + 9000, b.build());
            } catch (Throwable _t) {}
            Log.i(TAG, "✅ Force-Logout abgeschlossen");
        } catch (Throwable t) {
            Log.e(TAG, "Force-Logout Fehler: " + t.getMessage());
        }
    }

    // v6.63.062 (Patrick 31.05. 18:43): Losfahr-Push-Tap-Fix. Vibrator-Reference statisch
    // damit DriverDashboardActivity sie per cancelDepartureAlert() abbrechen kann.
    private static android.os.Vibrator _departureVibrator = null;
    private static int _departureNotificationId = -1;
    public static void cancelDepartureAlert(android.content.Context ctx) {
        try {
            if (_departureVibrator != null) {
                _departureVibrator.cancel();
                _departureVibrator = null;
            }
        } catch (Throwable _t) {}
        try {
            if (_departureNotificationId >= 0 && ctx != null) {
                android.app.NotificationManager nm = (android.app.NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
                if (nm != null) nm.cancel(_departureNotificationId);
                _departureNotificationId = -1;
            }
        } catch (Throwable _t) {}
    }

    // 🆕 v6.62.885: Losfahr-Alarm fuer akzeptierte Vorbestellungen.
    // Patrick (23.05. 07:09): 'Mir fehlt eine Vibration wenn ich spaetestens losfahren muss.'
    // Server-side schickt scheduledDepartureAlert dieses FCM 1× pro Ride wenn 'losfahrtAt'
    // erreicht ist. Nur Vibration (kein Ringtone) — Patrick will keinen doppelten Sound.
    private void handleDepartureAlert(Map<String, String> data) {
        String rideId = data.get("rideId");
        String customerName = data.getOrDefault("customerName", "Kunde");
        String pickup = data.getOrDefault("pickup", "");
        String pickupTime = data.getOrDefault("pickupTime", "");
        int notificationId = NOTIFICATION_ID_BASE + 5000 + (rideId != null ? rideId.hashCode() & 0x3FFF : 0);

        // 🆕 v6.62.907 (Patrick 24.05. 08:43): Audit-Trail ins Lifecycle-Log damit Patrick
        //   im Verlauf sieht ob der Losfahr-Push empfangen wurde.
        if (rideId != null && !rideId.isEmpty()) {
            try {
                java.util.Map<String, Object> entry = new java.util.HashMap<>();
                entry.put("t", System.currentTimeMillis());
                entry.put("icon", "🚨");
                entry.put("action", "Losfahr-Alarm EMPFANGEN am Handy");
                entry.put("source", "🤖 Native v" + de.taxiheringsdorf.app.BuildConfig.VERSION_NAME);
                entry.put("device", android.os.Build.MODEL);
                com.google.firebase.database.FirebaseDatabase.getInstance("https://taxi-heringsdorf-default-rtdb.europe-west1.firebasedatabase.app")
                    .getReference("rides/" + rideId + "/lifecycleLog").push().setValue(entry);
            } catch (Throwable _logErr) { Log.w(TAG, "Departure-Lifecycle-Log Fehler: " + _logErr.getMessage()); }
        }

        Intent appIntent = new Intent(this, DriverDashboardActivity.class);
        appIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        if (rideId != null) appIntent.putExtra("rideId", rideId);
        PendingIntent pendingIntent = PendingIntent.getActivity(
            this, rideId != null ? rideId.hashCode() : 0, appIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        String title = "🚨 JETZT LOSFAHREN: " + customerName;
        String body = "Pickup um " + pickupTime + (pickup.isEmpty() ? "" : "\n📍 " + pickup);
        // Langes, deutliches Vibration-Pattern. Kein Sound.
        long[] vibrationPat = new long[]{0, 1000, 400, 1000, 400, 1000, 400, 1500};
        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(title)
            .setContentText(body.split("\n")[0])
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setSound(null) // Patrick: kein Sound, nur Vibration
            .setVibrate(vibrationPat)
            .setAutoCancel(true)
            .setContentIntent(pendingIntent);

        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.notify(notificationId, builder.build());
        _departureNotificationId = notificationId; // v6.63.062: für cancelDepartureAlert

        // Foreground-Fallback: zusaetzliche Vibration explizit (Notification-Channel-Sound
        // ist null aber Channel vibriert noch auf Vibration-Pattern. Sicherheitshalber).
        try {
            android.os.Vibrator vib = (android.os.Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
            if (vib != null && vib.hasVibrator()) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    vib.vibrate(android.os.VibrationEffect.createWaveform(vibrationPat, -1));
                } else {
                    vib.vibrate(vibrationPat, -1);
                }
                _departureVibrator = vib; // v6.63.062: Reference für cancelDepartureAlert
            }
        } catch (Throwable _vErr) { Log.w(TAG, "Departure-Vibrate Fehler: " + _vErr.getMessage()); }
        Log.d(TAG, "🚨 Departure-Alert dispatched fuer rideId=" + rideId);
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
