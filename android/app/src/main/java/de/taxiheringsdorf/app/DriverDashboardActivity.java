package de.taxiheringsdorf.app;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.os.Bundle;
import android.util.Log;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.LinearLayout;
import android.widget.TextView;
import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.RecyclerView;
import com.google.android.material.button.MaterialButton;
import com.google.android.material.floatingactionbutton.ExtendedFloatingActionButton;
import com.google.firebase.database.DataSnapshot;
import com.google.firebase.database.DatabaseError;
import com.google.firebase.database.DatabaseReference;
import com.google.firebase.database.FirebaseDatabase;
import com.google.firebase.database.Query;
import com.google.firebase.database.ValueEventListener;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;

// v6.42.0: Native Fahrer-Dashboard — komplett ohne WebView. Liest Schicht + Aufträge
// direkt aus Firebase Database SDK (nativ), zeigt sie als Material-Cards. Stabile UI
// die nicht von WebView abhängt — wenn WebView gekillt wird, lebt diese Activity weiter.
public class DriverDashboardActivity extends AppCompatActivity {

    private static final String TAG = "DriverDashboard";
    private static final String DB_INSTANCE_URL = "https://taxi-heringsdorf-default-rtdb.europe-west1.firebasedatabase.app";

    private TextView tvVehicleInfo, tvShiftStatus, tvShiftDetail;
    private MaterialButton btnShiftToggle;
    private RecyclerView rvRides;
    private LinearLayout emptyState;
    private RideAdapter rideAdapter;

    private FirebaseDatabase db;
    private String currentVehicleId;
    private DatabaseReference vehicleRef;
    private Query ridesQuery;
    private ValueEventListener shiftListener;
    private ValueEventListener ridesListener;

    private boolean shiftActive = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Bildschirm wach halten solange Dashboard offen
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        setContentView(R.layout.activity_driver_dashboard);

        tvVehicleInfo = findViewById(R.id.tv_vehicle_info);
        tvShiftStatus = findViewById(R.id.tv_shift_status);
        tvShiftDetail = findViewById(R.id.tv_shift_detail);
        btnShiftToggle = findViewById(R.id.btn_shift_toggle);
        rvRides = findViewById(R.id.rv_rides);
        emptyState = findViewById(R.id.empty_state);

        rvRides.setLayoutManager(new LinearLayoutManager(this));
        rideAdapter = new RideAdapter();
        rvRides.setAdapter(rideAdapter);

        // v6.42.3: Optionaler Intent-Extra (für ADB-Setup ohne WebView-Login):
        // adb shell am start -n de.taxiheringsdorf.app/.DriverDashboardActivity --es setVehicleId pw-my-222-e
        String intentVehicleId = getIntent() != null ? getIntent().getStringExtra("setVehicleId") : null;
        if (intentVehicleId != null && !intentVehicleId.isEmpty()) {
            getSharedPreferences("driver", MODE_PRIVATE).edit().putString("vehicleId", intentVehicleId).apply();
            getSharedPreferences("fcm", MODE_PRIVATE).edit().putString("vehicleId", intentVehicleId).apply();
            Log.i(TAG, "vehicleId via Intent-Extra gesetzt: " + intentVehicleId);
        }

        // Vehicle-ID aus SharedPreferences lesen (wird vom WebView/JS gesetzt)
        SharedPreferences prefs = getSharedPreferences("driver", MODE_PRIVATE);
        currentVehicleId = prefs.getString("vehicleId", null);

        // Fallback: aus FCM-Prefs
        if (currentVehicleId == null) {
            SharedPreferences fcmPrefs = getSharedPreferences("fcm", MODE_PRIVATE);
            currentVehicleId = fcmPrefs.getString("vehicleId", null);
        }

        if (currentVehicleId == null) {
            tvVehicleInfo.setText("⚠️ Kein Fahrzeug ausgewählt — bitte zuerst Web-App öffnen + Fahrer-Login");
            btnShiftToggle.setEnabled(false);
        } else {
            tvVehicleInfo.setText("Fahrzeug: " + currentVehicleId);
            connectFirebase();
        }

        btnShiftToggle.setOnClickListener(v -> toggleShift());

        ExtendedFloatingActionButton fab = findViewById(R.id.fab_open_webview);
        fab.setOnClickListener(v -> openWebView());
    }

    private void connectFirebase() {
        try {
            db = FirebaseDatabase.getInstance(DB_INSTANCE_URL);
            vehicleRef = db.getReference("vehicles/" + currentVehicleId);
            // Shift-Listener
            shiftListener = new ValueEventListener() {
                @Override
                public void onDataChange(@NonNull DataSnapshot s) {
                    onVehicleUpdate(s);
                }
                @Override
                public void onCancelled(@NonNull DatabaseError error) {
                    Log.e(TAG, "Vehicle-Listener cancelled: " + error.getMessage());
                }
            };
            vehicleRef.addValueEventListener(shiftListener);

            // Rides-Listener: alle Fahrten zugewiesen an dieses Fahrzeug
            ridesQuery = db.getReference("rides").orderByChild("vehicleId").equalTo(currentVehicleId);
            ridesListener = new ValueEventListener() {
                @Override
                public void onDataChange(@NonNull DataSnapshot s) {
                    onRidesUpdate(s);
                }
                @Override
                public void onCancelled(@NonNull DatabaseError error) {
                    Log.e(TAG, "Rides-Listener cancelled: " + error.getMessage());
                }
            };
            ridesQuery.addValueEventListener(ridesListener);
        } catch (Throwable t) {
            Log.e(TAG, "Firebase-Setup Fehler: " + t.getMessage());
            tvVehicleInfo.setText("⚠️ Firebase-Verbindungsfehler: " + t.getMessage());
        }
    }

    private void onVehicleUpdate(DataSnapshot s) {
        Object shiftObj = s.child("shift").getValue();
        Object onlineObj = s.child("online").getValue();
        Object lastUpdateObj = s.child("lastUpdate").getValue();

        // Shift-Status
        String status = "?";
        Long lastHb = null;
        if (shiftObj instanceof java.util.Map) {
            java.util.Map<?, ?> m = (java.util.Map<?, ?>) shiftObj;
            Object st = m.get("status");
            if (st != null) status = String.valueOf(st);
            Object hb = m.get("lastHeartbeat");
            if (hb instanceof Long) lastHb = (Long) hb;
            else if (hb instanceof Number) lastHb = ((Number) hb).longValue();
        }
        shiftActive = "active".equals(status);
        if (shiftActive) {
            tvShiftStatus.setText("🟢 Schicht aktiv");
            String detail = "Heartbeat OK";
            if (lastHb != null) {
                long ageSec = (System.currentTimeMillis() - lastHb) / 1000;
                detail = "Letzter GPS-Update vor " + ageSec + "s";
            }
            tvShiftDetail.setText(detail);
            btnShiftToggle.setText("⏹ Stopp");
            btnShiftToggle.setBackgroundTintList(android.content.res.ColorStateList.valueOf(Color.parseColor("#EF4444")));
        } else {
            tvShiftStatus.setText("⏸️ Schicht " + ("auto-ended".equals(status) ? "auto-beendet" : "beendet"));
            tvShiftDetail.setText("auto-ended".equals(status) ? "Letzter Crash hat Schicht beendet — neu starten" : "Tippe Start zum Beginnen");
            btnShiftToggle.setText("▶ Start");
            btnShiftToggle.setBackgroundTintList(android.content.res.ColorStateList.valueOf(Color.parseColor("#10B981")));
        }
    }

    private void onRidesUpdate(DataSnapshot s) {
        List<Ride> active = new ArrayList<>();
        for (DataSnapshot child : s.getChildren()) {
            Ride r = Ride.fromSnap(child);
            if (r == null) continue;
            // Nur aktive (nicht completed/cancelled/storniert/deleted)
            if (r.status == null) continue;
            if (r.status.equals("completed") || r.status.equals("cancelled") ||
                r.status.equals("storniert") || r.status.equals("deleted")) continue;
            active.add(r);
        }
        // Sortieren: assigned/new oben, accepted/on_way/picked_up unten
        active.sort((a, b) -> Long.compare(a.pickupTimestamp != null ? a.pickupTimestamp : 0,
                                          b.pickupTimestamp != null ? b.pickupTimestamp : 0));
        rideAdapter.setRides(active);
        emptyState.setVisibility(active.isEmpty() ? View.VISIBLE : View.GONE);
        rvRides.setVisibility(active.isEmpty() ? View.GONE : View.VISIBLE);
    }

    private void toggleShift() {
        if (currentVehicleId == null) return;
        if (shiftActive) {
            // Schicht beenden
            DatabaseReference ref = db.getReference("vehicles/" + currentVehicleId + "/shift");
            java.util.Map<String, Object> updates = new java.util.HashMap<>();
            updates.put("status", "ended");
            updates.put("endedAt", System.currentTimeMillis());
            updates.put("endedReason", "manual_native_dashboard");
            ref.updateChildren(updates);
        } else {
            // Schicht starten
            DatabaseReference ref = db.getReference("vehicles/" + currentVehicleId + "/shift");
            java.util.Map<String, Object> updates = new java.util.HashMap<>();
            updates.put("status", "active");
            updates.put("startTime", System.currentTimeMillis());
            updates.put("startedBy", "native_dashboard");
            updates.put("lastHeartbeat", System.currentTimeMillis());
            ref.updateChildren(updates);
            // Foreground Service starten
            Intent svc = new Intent(this, ShiftForegroundService.class);
            svc.setAction(ShiftForegroundService.ACTION_START);
            svc.putExtra(ShiftForegroundService.EXTRA_VEHICLE_ID, currentVehicleId);
            svc.putExtra(ShiftForegroundService.EXTRA_CONTENT_TEXT, "Schicht aktiv via Native-Dashboard");
            startForegroundService(svc);
        }
    }

    private void openWebView() {
        Intent i = new Intent(this, MainActivity.class);
        startActivity(i);
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        if (vehicleRef != null && shiftListener != null) vehicleRef.removeEventListener(shiftListener);
        if (ridesQuery != null && ridesListener != null) ridesQuery.removeEventListener(ridesListener);
    }

    // === Datenmodell ===
    static class Ride {
        String id, customerName, pickup, destination, pickupTime, status;
        Double price, distance;
        Long pickupTimestamp;

        static Ride fromSnap(DataSnapshot s) {
            try {
                Ride r = new Ride();
                r.id = s.getKey();
                r.customerName = s.child("customerName").getValue(String.class);
                r.pickup = s.child("pickup").getValue(String.class);
                r.destination = s.child("destination").getValue(String.class);
                r.pickupTime = s.child("pickupTime").getValue(String.class);
                r.status = s.child("status").getValue(String.class);
                Object p = s.child("price").getValue();
                if (p instanceof Number) r.price = ((Number) p).doubleValue();
                else if (p instanceof String) try { r.price = Double.parseDouble((String) p); } catch (NumberFormatException _e) {}
                Object d = s.child("distance").getValue();
                if (d instanceof Number) r.distance = ((Number) d).doubleValue();
                else if (d instanceof String) try { r.distance = Double.parseDouble((String) d); } catch (NumberFormatException _e) {}
                Object ts = s.child("pickupTimestamp").getValue();
                if (ts instanceof Long) r.pickupTimestamp = (Long) ts;
                else if (ts instanceof Number) r.pickupTimestamp = ((Number) ts).longValue();
                return r;
            } catch (Throwable _t) { return null; }
        }
    }

    // === RecyclerView-Adapter ===
    class RideAdapter extends RecyclerView.Adapter<RideAdapter.VH> {
        private List<Ride> data = new ArrayList<>();
        void setRides(List<Ride> list) {
            this.data = list;
            notifyDataSetChanged();
        }
        @NonNull
        @Override
        public VH onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
            View v = LayoutInflater.from(parent.getContext()).inflate(R.layout.item_ride_card, parent, false);
            return new VH(v);
        }
        @Override
        public void onBindViewHolder(@NonNull VH holder, int position) {
            Ride r = data.get(position);
            holder.bind(r);
        }
        @Override
        public int getItemCount() { return data.size(); }

        class VH extends RecyclerView.ViewHolder {
            TextView tvBadge, tvTime, tvName, tvPickup, tvDest, tvPriceDist;
            MaterialButton btnAccept, btnReject;
            LinearLayout actionRow;
            VH(View v) {
                super(v);
                tvBadge = v.findViewById(R.id.tv_status_badge);
                tvTime = v.findViewById(R.id.tv_pickup_time);
                tvName = v.findViewById(R.id.tv_customer_name);
                tvPickup = v.findViewById(R.id.tv_pickup);
                tvDest = v.findViewById(R.id.tv_destination);
                tvPriceDist = v.findViewById(R.id.tv_price_distance);
                btnAccept = v.findViewById(R.id.btn_accept);
                btnReject = v.findViewById(R.id.btn_reject);
                actionRow = v.findViewById(R.id.action_row);
            }
            void bind(Ride r) {
                tvName.setText(r.customerName != null ? r.customerName : "(Kunde)");
                tvPickup.setText("📍 " + (r.pickup != null ? r.pickup : "-"));
                tvDest.setText("🎯 " + (r.destination != null ? r.destination : "-"));
                tvTime.setText(r.pickupTime != null ? r.pickupTime : "Sofort");
                String pd = String.format(Locale.GERMANY, "💰 %s€ · 🛣️ %s km",
                    r.price != null ? String.format(Locale.GERMANY, "%.2f", r.price) : "--",
                    r.distance != null ? String.format(Locale.GERMANY, "%.1f", r.distance) : "--");
                tvPriceDist.setText(pd);
                // Status-Badge Color + Text
                String s = r.status != null ? r.status : "?";
                String badge; int bgColor;
                switch (s) {
                    case "new": badge = "🆕 NEU"; bgColor = Color.parseColor("#F59E0B"); break;
                    case "sofort": badge = "⚡ SOFORT"; bgColor = Color.parseColor("#F59E0B"); break;
                    case "vorbestellt": badge = "📅 VORBESTELLT"; bgColor = Color.parseColor("#3B82F6"); break;
                    case "assigned": badge = "🎯 ZUGEWIESEN"; bgColor = Color.parseColor("#3B82F6"); break;
                    case "accepted": badge = "✅ ANGENOMMEN"; bgColor = Color.parseColor("#10B981"); break;
                    case "on_way": badge = "🚗 UNTERWEGS"; bgColor = Color.parseColor("#F59E0B"); break;
                    case "picked_up": badge = "🎉 ABGEHOLT"; bgColor = Color.parseColor("#10B981"); break;
                    default: badge = s.toUpperCase(); bgColor = Color.parseColor("#64748B");
                }
                tvBadge.setText(badge);
                tvBadge.setBackgroundColor(bgColor);
                // Accept/Reject nur bei new/assigned/sofort/vorbestellt
                boolean canAct = s.equals("new") || s.equals("assigned") || s.equals("sofort") || s.equals("vorbestellt");
                actionRow.setVisibility(canAct ? View.VISIBLE : View.GONE);
                btnAccept.setOnClickListener(v -> updateStatus(r.id, "accepted"));
                btnReject.setOnClickListener(v -> rejectRide(r.id));
            }
        }
    }

    private void updateStatus(String rideId, String newStatus) {
        if (db == null || rideId == null) return;
        java.util.Map<String, Object> u = new java.util.HashMap<>();
        u.put("status", newStatus);
        u.put("acceptedAt", System.currentTimeMillis());
        u.put("acceptedVia", "native_dashboard");
        u.put("updatedAt", System.currentTimeMillis());
        db.getReference("rides/" + rideId).updateChildren(u);
    }

    private void rejectRide(String rideId) {
        if (db == null || rideId == null) return;
        java.util.Map<String, Object> u = new java.util.HashMap<>();
        u.put("vehicleId", null);
        u.put("assignedVehicle", null);
        u.put("vehicle", null);
        u.put("status", "new");
        u.put("rejectedBy", currentVehicleId);
        u.put("rejectedAt", System.currentTimeMillis());
        u.put("rejectedVia", "native_dashboard");
        u.put("updatedAt", System.currentTimeMillis());
        db.getReference("rides/" + rideId).updateChildren(u);
    }
}
