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
        Log.i(TAG, "RideAlert für rideId=" + rideId);

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

        btnAccept.setOnClickListener(v -> {
            Log.i(TAG, "✅ ANNEHMEN tapped, rideId=" + rideId);
            if (rideId != null) {
                Intent action = new Intent(this, RideActionReceiver.class);
                action.setAction("de.taxiheringsdorf.app.ACTION_ACCEPT");
                action.putExtra("rideId", rideId);
                sendBroadcast(action);
            }
            // App in Vordergrund bringen
            Intent home = new Intent(this, DriverDashboardActivity.class);
            home.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            if (rideId != null) home.putExtra("rideId", rideId);
            startActivity(home);
            finish();
        });

        btnReject.setOnClickListener(v -> {
            Log.i(TAG, "❌ ABLEHNEN tapped, rideId=" + rideId);
            if (rideId != null) {
                Intent action = new Intent(this, RideActionReceiver.class);
                action.setAction("de.taxiheringsdorf.app.ACTION_REJECT");
                action.putExtra("rideId", rideId);
                sendBroadcast(action);
            }
            finish();
        });
    }
}
