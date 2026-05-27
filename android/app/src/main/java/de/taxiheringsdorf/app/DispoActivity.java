package de.taxiheringsdorf.app;

import android.content.Context;
import android.graphics.Color;
import android.graphics.Typeface;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;
import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import com.google.firebase.database.DataSnapshot;
import com.google.firebase.database.DatabaseError;
import com.google.firebase.database.FirebaseDatabase;
import com.google.firebase.database.ValueEventListener;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

// v6.62.971 (Patrick 27.05. 19:23): Dispo-Live-Ansicht.
// "Live-Ansicht welche Fahrten wer gerade macht oder zugeteilt wurde — Übersicht behalten".
// Lädt alle Fahrzeuge (online/shift active) + alle aktiven/kommenden Fahrten 2h.
// Refresh alle 5 Sek. Nur Admin (wegen Übersicht über fremde Fahrzeuge).
public class DispoActivity extends AppCompatActivity {
    private static final String DB_INSTANCE_URL = "https://taxi-heringsdorf-default-rtdb.europe-west1.firebasedatabase.app";

    private LinearLayout llActive, llUpcoming;
    private TextView tvMeta;
    private final Handler refreshHandler = new Handler(Looper.getMainLooper());
    private final SimpleDateFormat hhmm = new SimpleDateFormat("HH:mm", Locale.GERMAN);

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        setContentView(R.layout.activity_dispo);

        llActive = findViewById(R.id.ll_active_vehicles);
        llUpcoming = findViewById(R.id.ll_upcoming_rides);
        tvMeta = findViewById(R.id.tv_dispo_meta);

        loadAndRender();
    }

    @Override
    protected void onResume() {
        super.onResume();
        refreshHandler.post(refreshTick);
    }

    @Override
    protected void onPause() {
        super.onPause();
        refreshHandler.removeCallbacks(refreshTick);
    }

    private final Runnable refreshTick = new Runnable() {
        @Override
        public void run() {
            try { loadAndRender(); } catch (Throwable _t) {}
            refreshHandler.postDelayed(this, 5_000L);
        }
    };

    private void loadAndRender() {
        FirebaseDatabase db = FirebaseDatabase.getInstance(DB_INSTANCE_URL);
        db.getReference("vehicles").addListenerForSingleValueEvent(new ValueEventListener() {
            @Override public void onDataChange(@NonNull DataSnapshot vSnap) {
                final Map<String, VehicleInfo> vehicles = new HashMap<>();
                for (DataSnapshot v : vSnap.getChildren()) {
                    VehicleInfo info = parseVehicle(v);
                    if (info != null) vehicles.put(info.id, info);
                }
                db.getReference("rides").addListenerForSingleValueEvent(new ValueEventListener() {
                    @Override public void onDataChange(@NonNull DataSnapshot rSnap) {
                        renderAll(vehicles, rSnap);
                    }
                    @Override public void onCancelled(@NonNull DatabaseError e) {}
                });
            }
            @Override public void onCancelled(@NonNull DatabaseError e) {}
        });
    }

    private void renderAll(Map<String, VehicleInfo> vehicles, DataSnapshot ridesSnap) {
        long now = System.currentTimeMillis();
        long in2h = now + 2 * 3600_000L;

        // Aktive Fahrten pro Fahrzeug zuordnen
        Map<String, RideInfo> activeByVeh = new HashMap<>();
        List<RideInfo> upcoming = new ArrayList<>();
        for (DataSnapshot r : ridesSnap.getChildren()) {
            RideInfo ri = parseRide(r);
            if (ri == null) continue;
            if (ri.isActive() && ri.vehicleId != null) {
                RideInfo existing = activeByVeh.get(ri.vehicleId);
                // Aktivste zuerst (picked_up > arrived > on_way > accepted > assigned)
                if (existing == null || ri.statusRank() > existing.statusRank()) {
                    activeByVeh.put(ri.vehicleId, ri);
                }
            }
            if (ri.isUpcoming(now, in2h)) upcoming.add(ri);
        }

        // Aktive Fahrzeuge rendern — sortiert: mit Fahrt zuerst, dann nach Name
        List<VehicleInfo> vList = new ArrayList<>(vehicles.values());
        vList.sort((a, b) -> {
            boolean aBusy = activeByVeh.containsKey(a.id);
            boolean bBusy = activeByVeh.containsKey(b.id);
            if (aBusy != bBusy) return aBusy ? -1 : 1;
            return a.name.compareToIgnoreCase(b.name);
        });

        llActive.removeAllViews();
        int busyCount = 0, idleCount = 0, offlineCount = 0;
        for (VehicleInfo v : vList) {
            if (!v.online && !v.shiftActive) { offlineCount++; continue; }
            RideInfo ride = activeByVeh.get(v.id);
            if (ride != null) busyCount++;
            else idleCount++;
            llActive.addView(buildVehicleCard(v, ride));
        }
        if (busyCount + idleCount == 0) {
            llActive.addView(buildEmptyText("Keine Fahrzeuge aktiv"));
        }

        // Kommend rendern
        upcoming.sort(Comparator.comparingLong(r -> r.pickupTs));
        llUpcoming.removeAllViews();
        if (upcoming.isEmpty()) {
            llUpcoming.addView(buildEmptyText("Keine Fahrten in den nächsten 2h"));
        } else {
            for (RideInfo r : upcoming) llUpcoming.addView(buildUpcomingCard(r, vehicles));
        }

        tvMeta.setText(busyCount + " besetzt · " + idleCount + " frei · "
            + offlineCount + " offline · " + upcoming.size() + " kommend · "
            + hhmm.format(new Date()));
    }

    private View buildVehicleCard(VehicleInfo v, RideInfo ride) {
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(12), dp(10), dp(12), dp(10));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.bottomMargin = dp(8);
        card.setLayoutParams(lp);
        card.setBackgroundColor(ride != null ? Color.parseColor("#1E293B") : Color.parseColor("#0B1A3B"));

        LinearLayout top = new LinearLayout(this);
        top.setOrientation(LinearLayout.HORIZONTAL);
        top.setGravity(Gravity.CENTER_VERTICAL);

        TextView badge = new TextView(this);
        String bText; int bColor;
        if (ride == null) { bText = "FREI"; bColor = Color.parseColor("#10B981"); }
        else if ("picked_up".equals(ride.status)) { bText = "FAHRT"; bColor = Color.parseColor("#F97316"); }
        else if ("arrived".equals(ride.status)) { bText = "BEIM KUNDE"; bColor = Color.parseColor("#EAB308"); }
        else if ("on_way".equals(ride.status)) { bText = "ANFAHRT"; bColor = Color.parseColor("#3B82F6"); }
        else { bText = ride.status.toUpperCase(); bColor = Color.parseColor("#64748B"); }
        badge.setText(bText);
        badge.setTextColor(Color.WHITE);
        badge.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11);
        badge.setTypeface(null, Typeface.BOLD);
        badge.setPadding(dp(8), dp(3), dp(8), dp(3));
        badge.setBackgroundColor(bColor);
        top.addView(badge);

        TextView vName = new TextView(this);
        vName.setText("  " + v.name + (v.plate != null ? "  " + v.plate : ""));
        vName.setTextColor(Color.parseColor("#F1F5F9"));
        vName.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        vName.setTypeface(null, Typeface.BOLD);
        top.addView(vName);
        card.addView(top);

        if (ride != null) {
            TextView line1 = new TextView(this);
            String cust = ride.customerName != null ? ride.customerName : "?";
            String eta = "";
            if ("on_way".equals(ride.status) && ride.drivingTimeToPickup != null) {
                eta = "  · ETA " + ride.drivingTimeToPickup + " Min";
                if (ride.drivingDistanceToPickupKm != null) eta += " / " + ride.drivingDistanceToPickupKm + " km";
            } else if ("picked_up".equals(ride.status) && ride.drivingTimeToDestination != null) {
                eta = "  · ETA " + ride.drivingTimeToDestination + " Min";
            }
            line1.setText(cust + eta);
            line1.setTextColor(Color.parseColor("#CBD5E1"));
            line1.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
            line1.setPadding(0, dp(4), 0, 0);
            card.addView(line1);

            TextView line2 = new TextView(this);
            String pickup = ride.pickup != null ? shorten(ride.pickup, 30) : "?";
            String dest = ride.destination != null ? shorten(ride.destination, 30) : "?";
            line2.setText(pickup + " → " + dest);
            line2.setTextColor(Color.parseColor("#94A3B8"));
            line2.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
            line2.setPadding(0, dp(2), 0, 0);
            card.addView(line2);
        } else if (v.lastHeartbeat != null) {
            long ageMin = (System.currentTimeMillis() - v.lastHeartbeat) / 60_000L;
            TextView line1 = new TextView(this);
            line1.setText("Heartbeat vor " + ageMin + " Min");
            line1.setTextColor(Color.parseColor("#64748B"));
            line1.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
            line1.setPadding(0, dp(4), 0, 0);
            card.addView(line1);
        }

        if (ride != null) {
            final String rideIdFinal = ride.id;
            final String custFinal = ride.customerName != null ? ride.customerName : "?";
            card.setOnClickListener(v2 -> Toast.makeText(this,
                "Fahrt " + custFinal + " (Tap-Details kommen in v6.62.972)",
                Toast.LENGTH_SHORT).show());
        }
        return card;
    }

    private View buildUpcomingCard(RideInfo r, Map<String, VehicleInfo> vehicles) {
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.HORIZONTAL);
        card.setGravity(Gravity.CENTER_VERTICAL);
        card.setPadding(dp(12), dp(8), dp(12), dp(8));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.bottomMargin = dp(6);
        card.setLayoutParams(lp);
        card.setBackgroundColor(Color.parseColor("#1E293B"));

        TextView tvTime = new TextView(this);
        tvTime.setText(hhmm.format(new Date(r.pickupTs)));
        tvTime.setTextColor(Color.parseColor("#FB923C"));
        tvTime.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        tvTime.setTypeface(null, Typeface.BOLD);
        tvTime.setMinWidth(dp(56));
        card.addView(tvTime);

        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);
        LinearLayout.LayoutParams cp = new LinearLayout.LayoutParams(
            0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        col.setLayoutParams(cp);

        TextView tvCust = new TextView(this);
        String cust = r.customerName != null ? r.customerName : "?";
        String vehLabel;
        if (r.vehicleId != null && vehicles.containsKey(r.vehicleId)) {
            vehLabel = "  · " + vehicles.get(r.vehicleId).name;
        } else if (r.vehicleName != null) {
            vehLabel = "  · " + r.vehicleName;
        } else {
            vehLabel = "  · ⚠ kein Fz";
        }
        tvCust.setText(cust + vehLabel);
        tvCust.setTextColor(Color.parseColor("#F1F5F9"));
        tvCust.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        tvCust.setTypeface(null, Typeface.BOLD);
        col.addView(tvCust);

        TextView tvRoute = new TextView(this);
        tvRoute.setText(shorten(r.pickup != null ? r.pickup : "?", 22) + " → " + shorten(r.destination != null ? r.destination : "?", 22));
        tvRoute.setTextColor(Color.parseColor("#94A3B8"));
        tvRoute.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11);
        col.addView(tvRoute);

        card.addView(col);
        return card;
    }

    private View buildEmptyText(String text) {
        TextView tv = new TextView(this);
        tv.setText(text);
        tv.setTextColor(Color.parseColor("#64748B"));
        tv.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        tv.setPadding(dp(12), dp(16), dp(12), dp(16));
        tv.setGravity(Gravity.CENTER);
        return tv;
    }

    private int dp(int v) {
        return (int) (v * getResources().getDisplayMetrics().density);
    }

    private String shorten(String s, int max) {
        if (s == null) return "";
        if (s.length() <= max) return s;
        return s.substring(0, max - 1) + "…";
    }

    // ───────── Parser ─────────
    private VehicleInfo parseVehicle(DataSnapshot s) {
        VehicleInfo v = new VehicleInfo();
        v.id = s.getKey();
        v.name = strOf(s.child("name").getValue(), v.id);
        v.plate = strOrNull(s.child("plate").getValue());
        v.online = boolOf(s.child("online").getValue());
        Object lh = s.child("shift/lastHeartbeat").getValue();
        if (lh instanceof Number) v.lastHeartbeat = ((Number) lh).longValue();
        Object shStatus = s.child("shift/status").getValue();
        Object forceEnded = s.child("shift/forceEnded").getValue();
        v.shiftActive = "active".equals(shStatus) && !Boolean.TRUE.equals(forceEnded);
        return v;
    }

    private RideInfo parseRide(DataSnapshot s) {
        RideInfo r = new RideInfo();
        r.id = s.getKey();
        r.status = strOrNull(s.child("status").getValue());
        if (r.status == null) return null;
        r.customerName = strOrNull(s.child("customerName").getValue());
        if (r.customerName == null) r.customerName = strOrNull(s.child("guestName").getValue());
        r.pickup = strOrNull(s.child("pickup").getValue());
        r.destination = strOrNull(s.child("destination").getValue());
        r.vehicleId = strOrNull(s.child("assignedVehicle").getValue());
        r.vehicleName = strOrNull(s.child("assignedVehicleName").getValue());
        Object pt = s.child("pickupTimestamp").getValue();
        if (pt instanceof Number) r.pickupTs = ((Number) pt).longValue();
        Object dtP = s.child("drivingTimeToPickup").getValue();
        if (dtP instanceof Number) r.drivingTimeToPickup = ((Number) dtP).intValue();
        Object ddP = s.child("drivingDistanceToPickupKm").getValue();
        if (ddP instanceof Number) r.drivingDistanceToPickupKm = ((Number) ddP).doubleValue();
        Object dtD = s.child("drivingTimeToDestination").getValue();
        if (dtD instanceof Number) r.drivingTimeToDestination = ((Number) dtD).intValue();
        return r;
    }

    private String strOf(Object o, String fallback) {
        if (o instanceof String) return (String) o;
        return fallback;
    }

    private String strOrNull(Object o) {
        if (o instanceof String) return (String) o;
        return null;
    }

    private boolean boolOf(Object o) {
        return o instanceof Boolean && ((Boolean) o);
    }

    // ───────── Datenklassen ─────────
    static class VehicleInfo {
        String id;
        String name;
        String plate;
        boolean online;
        boolean shiftActive;
        Long lastHeartbeat;
    }

    static class RideInfo {
        String id;
        String status;
        String customerName;
        String pickup;
        String destination;
        String vehicleId;
        String vehicleName;
        long pickupTs;
        Integer drivingTimeToPickup;
        Double drivingDistanceToPickupKm;
        Integer drivingTimeToDestination;

        boolean isActive() {
            return "assigned".equals(status) || "accepted".equals(status)
                || "sofort".equals(status) || "on_way".equals(status)
                || "arrived".equals(status) || "picked_up".equals(status);
        }

        boolean isUpcoming(long now, long until) {
            return "vorbestellt".equals(status) && pickupTs > now && pickupTs <= until;
        }

        int statusRank() {
            switch (status == null ? "" : status) {
                case "picked_up": return 6;
                case "arrived":   return 5;
                case "on_way":    return 4;
                case "accepted":  return 3;
                case "sofort":    return 2;
                case "assigned":  return 1;
                default:          return 0;
            }
        }
    }
}
