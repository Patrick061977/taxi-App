package de.taxiheringsdorf.app;

import android.app.KeyguardManager;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;

import com.google.firebase.database.DataSnapshot;
import com.google.firebase.database.DatabaseError;
import com.google.firebase.database.FirebaseDatabase;
import com.google.firebase.database.ValueEventListener;

/**
 * v6.63.064 (Patrick 31.05.2026 19:34): Vollbild-Alert für Sofort-Aufträge.
 * Ersetzt das kleine Heads-Up-Banner durch eine Fullscreen-Activity die
 * über dem Lockscreen erscheint mit großen Buttons mittig — Patrick:
 * "Wenn was kommt müsste man auch in die Native-App kommen."
 *
 * Aufgerufen via FullScreenIntent aus TaxiFCMService bei type=new_ride.
 * - extra "rideId": Firebase-Ride-ID
 * - extra "title": Notification-Titel (Fallback)
 * - extra "body":  Notification-Body (Fallback)
 *
 * ANNEHMEN-Tap → sendet rideAction=accept (gleicher Pfad wie RideActionReceiver)
 * ABLEHNEN-Tap → sendet rideAction=reject
 */
public class RideAlertActivity extends AppCompatActivity {

    private static final String TAG = "RideAlertActivity";
    private static final String DB_INSTANCE_URL =
        "https://taxi-heringsdorf-default-rtdb.europe-west1.firebasedatabase.app";

    private String rideId;
    private String vehicleId; // 🆕 v6.63.505: vehicleId aus Intent (für RideActionReceiver)

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Über Lockscreen anzeigen + Bildschirm wecken
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
            KeyguardManager km = (KeyguardManager) getSystemService(Context.KEYGUARD_SERVICE);
            if (km != null) km.requestDismissKeyguard(this, null);
        } else {
            getWindow().addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
                | WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
            );
        }

        setContentView(R.layout.activity_ride_alert);

        rideId = getIntent().getStringExtra("rideId");
        vehicleId = getIntent().getStringExtra("vehicleId"); // 🆕 v6.63.505
        Log.i(TAG, "RideAlert für rideId=" + rideId + " vehicleId=" + vehicleId);

        TextView tvCustomer = findViewById(R.id.alert_customer);
        TextView tvPickup = findViewById(R.id.alert_pickup);
        TextView tvDest = findViewById(R.id.alert_destination);
        TextView tvTime = findViewById(R.id.alert_time);
        Button btnAccept = findViewById(R.id.alert_accept);
        Button btnReject = findViewById(R.id.alert_reject);

        // Fallback aus Intent-Extras (bevor Firebase-Daten da sind)
        String preTitle = getIntent().getStringExtra("title");
        String preBody = getIntent().getStringExtra("body");
        if (preTitle != null) tvCustomer.setText(preTitle.replace("🚨 NEUER AUFTRAG: ", "").trim());
        if (preBody != null) tvPickup.setText(preBody);

        // Firebase-Lookup für saubere Anzeige
        if (rideId != null && !rideId.isEmpty()) {
            FirebaseDatabase.getInstance(DB_INSTANCE_URL).getReference("rides/" + rideId)
                .addListenerForSingleValueEvent(new ValueEventListener() {
                    @Override public void onDataChange(@NonNull DataSnapshot s) {
                        String customerName = s.child("customerName").getValue(String.class);
                        String guestName = s.child("guestName").getValue(String.class);
                        String pickup = s.child("pickup").getValue(String.class);
                        String dest = s.child("destination").getValue(String.class);
                        String pickupTime = s.child("pickupTime").getValue(String.class);
                        Long pickupTs = s.child("pickupTimestamp").getValue(Long.class);
                        Boolean isJetzt = s.child("isJetzt").getValue(Boolean.class);

                        StringBuilder cust = new StringBuilder();
                        if (customerName != null) cust.append(customerName);
                        if (guestName != null && !guestName.equals(customerName)) {
                            cust.append(" — ").append(guestName);
                        }
                        if (cust.length() > 0) tvCustomer.setText(cust.toString());

                        if (pickup != null) tvPickup.setText("📍 " + pickup);
                        if (dest != null) tvDest.setText("🎯 " + dest);

                        StringBuilder t = new StringBuilder();
                        if (Boolean.TRUE.equals(isJetzt)) {
                            t.append("⚡ SOFORT");
                        } else if (pickupTime != null) {
                            t.append("⏰ ").append(pickupTime);
                        }
                        if (t.length() > 0) tvTime.setText(t.toString());
                    }
                    @Override public void onCancelled(@NonNull DatabaseError e) {
                        Log.w(TAG, "Firebase-Lookup-Fehler: " + e.getMessage());
                    }
                });
        }

        // 🆕 v6.63.505 (Patrick 28.06. Bridge: "wenn man auf Annehmen klickt, wird auch
        //   die Fahrt abgelehnt"): Bug war falsche Action-Strings + fehlende vehicleId.
        //   Vorher: "de.taxiheringsdorf.app.ACTION_ACCEPT" → RideActionReceiver.ACTION_ACCEPT
        //   ist "de.taxiheringsdorf.app.ACTION_ACCEPT_RIDE" → String-Mismatch → isAccept=false
        //   → HTTP-Call sendete immer action:"reject", auch bei ANNEHMEN-Tap.
        btnAccept.setOnClickListener(v -> {
            Log.i(TAG, "✅ ANNEHMEN tapped, rideId=" + rideId + " vehicleId=" + vehicleId);
            // 🆕 v6.63.777 (Patrick 22.07. Bridge "sound geht nicht weg"): Sound SYNCHRON
            //   stoppen bevor Broadcast + finish(). sendBroadcast war async → Sound lief
            //   0.5-2s weiter bis RideActionReceiver.onReceive greifen konnte.
            _killAllAlarmSounds();
            if (rideId != null) {
                Intent action = new Intent(this, RideActionReceiver.class);
                action.setAction(RideActionReceiver.ACTION_ACCEPT);
                action.putExtra(RideActionReceiver.EXTRA_RIDE_ID, rideId);
                action.putExtra(RideActionReceiver.EXTRA_VEHICLE_ID, vehicleId);
                sendBroadcast(action);
            }
            Intent home = new Intent(this, DriverDashboardActivity.class);
            home.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            home.putExtra("rideId", rideId);
            home.putExtra("openedFromAccept", true);
            startActivity(home);
            finish();
        });

        btnReject.setOnClickListener(v -> {
            Log.i(TAG, "❌ ABLEHNEN tapped, rideId=" + rideId);
            _killAllAlarmSounds();
            if (rideId != null) {
                Intent action = new Intent(this, RideActionReceiver.class);
                action.setAction(RideActionReceiver.ACTION_REJECT);
                action.putExtra(RideActionReceiver.EXTRA_RIDE_ID, rideId);
                action.putExtra(RideActionReceiver.EXTRA_VEHICLE_ID, vehicleId);
                sendBroadcast(action);
            }
            finish();
        });
    }

    // 🆕 v6.63.777: Sound + Notifications sofort killen — SYNCHRON, damit der User
    //   nicht 0.5-2s Alarm hört bevor Broadcast beim RideActionReceiver ankommt.
    //   3 Ebenen: (1) AlertSoundService MediaPlayer, (2) diese Ride's Notification,
    //   (3) alle offenen Taxi-Push-Notifications als Sicherheitsnetz.
    private void _killAllAlarmSounds() {
        try { AlertSoundService.stop(this); } catch (Throwable _ignore) {}
        try {
            android.app.NotificationManager nm = (android.app.NotificationManager)
                getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) {
                if (rideId != null) {
                    int nid = 9000 + (rideId.hashCode() & 0x7FFF);
                    nm.cancel(nid);
                    nm.cancel(nid + 1000);
                }
                // Sicherheitsnetz: alle Taxi-Push-Notifications
                nm.cancelAll();
            }
        } catch (Throwable _ignore) {}
    }
}
