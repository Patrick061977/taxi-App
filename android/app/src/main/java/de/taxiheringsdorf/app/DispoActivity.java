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

    // 🆕 v6.63.450 (Patrick 21.06. 06:50 Bridge: "dass du mir nicht alles anzeigst, was
    //   das System für die Uhrzeitberechnung herannimmt"): Live-Werte aus settings/pricing
    //   damit Anzeige NICHT mit hardcoded 3 Min Default lügt. Werden im loadAndRender
    //   einmal pro Tick neu geladen.
    private int _boardingMin = 0;   // Default 0 — nur settings sind Quelle der Wahrheit
    private int _alightingMin = 0;
    private int _optiBufferMin = 0;

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

    // 🆕 v6.63.002 (Patrick 29.05. 06:25): vehicleShifts laden für echte Schichtplan-Diagnose
    private DataSnapshot _cachedShiftsSnap;

    private void loadAndRender() {
        FirebaseDatabase db = FirebaseDatabase.getInstance(DB_INSTANCE_URL);
        // 🆕 v6.63.450: Buffer-Werte live aus settings/pricing — keine Defaults mehr verstecken
        db.getReference("settings/pricing").addListenerForSingleValueEvent(new ValueEventListener() {
            @Override public void onDataChange(@NonNull DataSnapshot pSnap) {
                try {
                    Object b = pSnap.child("boardingTime").getValue();
                    Object a = pSnap.child("alightingTime").getValue();
                    Object o = pSnap.child("optimierungBufferMin").getValue();
                    _boardingMin = (b instanceof Number) ? ((Number) b).intValue() : 0;
                    _alightingMin = (a instanceof Number) ? ((Number) a).intValue() : 0;
                    _optiBufferMin = (o instanceof Number) ? ((Number) o).intValue() : 0;
                } catch (Throwable _t) { /* defensive — Defaults bleiben 0 */ }
            }
            @Override public void onCancelled(@NonNull DatabaseError e) { /* Defaults bleiben 0 */ }
        });
        db.getReference("vehicles").addListenerForSingleValueEvent(new ValueEventListener() {
            @Override public void onDataChange(@NonNull DataSnapshot vSnap) {
                final Map<String, VehicleInfo> vehicles = new HashMap<>();
                for (DataSnapshot v : vSnap.getChildren()) {
                    VehicleInfo info = parseVehicle(v);
                    if (info != null) vehicles.put(info.id, info);
                }
                // v6.63.002: vehicleShifts mit-laden für Diagnose-Berechnung
                db.getReference("vehicleShifts").addListenerForSingleValueEvent(new ValueEventListener() {
                    @Override public void onDataChange(@NonNull DataSnapshot sSnap) {
                        _cachedShiftsSnap = sSnap;
                        db.getReference("rides").addListenerForSingleValueEvent(new ValueEventListener() {
                            @Override public void onDataChange(@NonNull DataSnapshot rSnap) {
                                renderAll(vehicles, rSnap);
                            }
                            @Override public void onCancelled(@NonNull DatabaseError e) {}
                        });
                    }
                    @Override public void onCancelled(@NonNull DatabaseError e) {
                        // Fallback ohne Shifts
                        db.getReference("rides").addListenerForSingleValueEvent(new ValueEventListener() {
                            @Override public void onDataChange(@NonNull DataSnapshot rSnap) {
                                renderAll(vehicles, rSnap);
                            }
                            @Override public void onCancelled(@NonNull DatabaseError e2) {}
                        });
                    }
                });
            }
            @Override public void onCancelled(@NonNull DatabaseError e) {}
        });
    }

    // 🆕 v6.63.002: Pro Fahrzeug+Datum+Zeit prüfen ob es im Schichtplan ist.
    //   Logik identisch zu index.html isVehicleAvailableAtSlot (v6.62.1000).
    private boolean isVehicleInShift(String vid, String dateStr, String timeStr) {
        if (_cachedShiftsSnap == null) return false;
        DataSnapshot vSnap = _cachedShiftsSnap.child(vid);
        if (!vSnap.exists()) return false;
        // 1) Tag-Override prüfen
        DataSnapshot dayEntry = vSnap.child(dateStr);
        if (dayEntry.exists()) {
            Object actObj = dayEntry.child("active").getValue();
            boolean isActive = !Boolean.FALSE.equals(actObj);
            if (!isActive) return false;
            String startT = strOrNull(dayEntry.child("startTime").getValue());
            String endT = strOrNull(dayEntry.child("endTime").getValue());
            // timeRanges (Split-Shifts) zuerst prüfen
            DataSnapshot rangesNode = dayEntry.child("timeRanges");
            if (rangesNode.exists() && rangesNode.getChildrenCount() > 0) {
                for (DataSnapshot rn : rangesNode.getChildren()) {
                    String rs = strOrNull(rn.child("startTime").getValue());
                    String re = strOrNull(rn.child("endTime").getValue());
                    if (rs != null && re != null && timeStr.compareTo(rs) >= 0 && timeStr.compareTo(re) <= 0) return true;
                }
                return false;
            }
            if (startT != null && endT != null) {
                return timeStr.compareTo(startT) >= 0 && timeStr.compareTo(endT) <= 0;
            }
            return isActive; // active ohne Zeiten = ganztägig
        }
        // 2) Wochenplan defaults[dow] + defaultTimes[dow]
        try {
            java.util.Calendar cal = java.util.Calendar.getInstance();
            String[] parts = dateStr.split("-");
            cal.set(Integer.parseInt(parts[0]), Integer.parseInt(parts[1]) - 1, Integer.parseInt(parts[2]), 12, 0, 0);
            int dow = cal.get(java.util.Calendar.DAY_OF_WEEK) - 1; // 0=So
            Object defActive = vSnap.child("defaults").child(String.valueOf(dow)).getValue();
            if (!Boolean.TRUE.equals(defActive)) return false;
            DataSnapshot defT = vSnap.child("defaultTimes").child(String.valueOf(dow));
            if (!defT.exists()) return true;
            String dStart = strOrNull(defT.child("startTime").getValue());
            String dEnd = strOrNull(defT.child("endTime").getValue());
            if (dStart != null && dEnd != null) {
                return timeStr.compareTo(dStart) >= 0 && timeStr.compareTo(dEnd) <= 0;
            }
            return true;
        } catch (Throwable t) {
            return false;
        }
    }

    // 🆕 v6.63.002: Schichtzeit-String fuer Fahrzeug an Datum (z.B. "08:00-12:00" oder "OFFLINE")
    private String getVehicleShiftLabel(String vid, String dateStr) {
        if (_cachedShiftsSnap == null) return "?";
        DataSnapshot vSnap = _cachedShiftsSnap.child(vid);
        if (!vSnap.exists()) return "OFFLINE";
        DataSnapshot dayEntry = vSnap.child(dateStr);
        if (dayEntry.exists()) {
            Object actObj = dayEntry.child("active").getValue();
            if (Boolean.FALSE.equals(actObj)) return "OFFLINE (Ausnahme)";
            String startT = strOrNull(dayEntry.child("startTime").getValue());
            String endT = strOrNull(dayEntry.child("endTime").getValue());
            DataSnapshot rangesNode = dayEntry.child("timeRanges");
            if (rangesNode.exists() && rangesNode.getChildrenCount() > 0) {
                List<String> ranges = new ArrayList<>();
                for (DataSnapshot rn : rangesNode.getChildren()) {
                    String rs = strOrNull(rn.child("startTime").getValue());
                    String re = strOrNull(rn.child("endTime").getValue());
                    if (rs != null && re != null) ranges.add(rs + "-" + re);
                }
                return String.join(", ", ranges) + " (Ausnahme)";
            }
            if (startT != null && endT != null) return startT + "-" + endT + " (Ausnahme)";
            return "aktiv (Ausnahme, ohne Zeiten)";
        }
        // Wochenplan
        try {
            java.util.Calendar cal = java.util.Calendar.getInstance();
            String[] parts = dateStr.split("-");
            cal.set(Integer.parseInt(parts[0]), Integer.parseInt(parts[1]) - 1, Integer.parseInt(parts[2]), 12, 0, 0);
            int dow = cal.get(java.util.Calendar.DAY_OF_WEEK) - 1;
            Object defActive = vSnap.child("defaults").child(String.valueOf(dow)).getValue();
            if (!Boolean.TRUE.equals(defActive)) return "OFFLINE (Wochenplan)";
            DataSnapshot defT = vSnap.child("defaultTimes").child(String.valueOf(dow));
            String dStart = strOrNull(defT.child("startTime").getValue());
            String dEnd = strOrNull(defT.child("endTime").getValue());
            if (dStart != null && dEnd != null) return dStart + "-" + dEnd + " (Wochenplan)";
            return "aktiv (Wochenplan)";
        } catch (Throwable t) {
            return "?";
        }
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
        // 🆕 v6.63.332 (Patrick 14.06.2026 12:15 'Locked maximal 30 min vor einer Fahrt'):
        //   Lock-Badge nur im 30-Min-Window vor Pickup anzeigen.
        long _minToPickupLk = r.pickupTs > 0 ? (r.pickupTs - System.currentTimeMillis()) / 60000 : -9999;
        boolean _lockActive = r.assignmentLocked && _minToPickupLk <= 30;
        String lockBadge = _lockActive ? " 🔒" : "";
        tvCust.setText(cust + vehLabel + lockBadge);
        tvCust.setTextColor(Color.parseColor("#F1F5F9"));
        tvCust.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        tvCust.setTypeface(null, Typeface.BOLD);
        col.addView(tvCust);

        TextView tvRoute = new TextView(this);
        tvRoute.setText(shorten(r.pickup != null ? r.pickup : "?", 22) + " → " + shorten(r.destination != null ? r.destination : "?", 22));
        tvRoute.setTextColor(Color.parseColor("#94A3B8"));
        tvRoute.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11);
        col.addView(tvRoute);

        // v6.63.344 (Patrick 15.06. 07:29 'Fahrplan-Modus, wann welches Fahrzeug wo'):
        //   Zeit-Detail-Zeile pro Card: Pickup-Zeit + Anfahrt + Fahrt-Dauer + Drop + Frei.
        try {
            java.text.SimpleDateFormat hm = new java.text.SimpleDateFormat("HH:mm", java.util.Locale.GERMANY);
            hm.setTimeZone(java.util.TimeZone.getTimeZone("Europe/Berlin"));
            StringBuilder tl = new StringBuilder();
            if (r.pickupTs > 0) {
                tl.append("🕒 ").append(hm.format(new java.util.Date(r.pickupTs)));
                if (r.drivingTimeToPickup > 0) tl.append(" · Anfahrt ").append(r.drivingTimeToPickup).append(" Min");
                if (r.drivingTimeToDestination > 0) {
                    tl.append(" · Fahrt ").append(r.drivingTimeToDestination).append(" Min");
                    long drop = r.pickupTs + r.drivingTimeToDestination * 60_000L;
                    tl.append(" · Drop ").append(hm.format(new java.util.Date(drop)));
                    // 🆕 v6.63.450 (Patrick 21.06. 06:50 Bridge: alles transparent): Buffer-Werte
                    //   aus LIVE settings/pricing (boardingTime + alightingTime + optimierungBufferMin)
                    //   statt hardcoded 3 Min. Plus Buffer-Aufschlüsselung in der Anzeige.
                    int bufferTotal = _boardingMin + _alightingMin + _optiBufferMin;
                    long frei = drop + bufferTotal * 60_000L;
                    tl.append(" + ").append(bufferTotal).append("min Buffer (")
                      .append(_boardingMin).append("+").append(_alightingMin).append("+").append(_optiBufferMin)
                      .append(") · Frei ").append(hm.format(new java.util.Date(frei)));
                } else {
                    // v6.63.351 (Patrick 15.06. 12:40 'es muss da stehen OSRM ausgefallen'):
                    //   wenn duration null, explizit Hinweis statt stillem Weglassen.
                    tl.append(" · ⚠ Fahrt-Dauer wird nachberechnet (OSRM)");
                }
            }
            if (tl.length() > 0) {
                TextView tvTimeline = new TextView(this);
                tvTimeline.setText(tl.toString());
                tvTimeline.setTextColor(Color.parseColor("#CBD5E1"));
                tvTimeline.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11);
                tvTimeline.setPadding(0, dp(2), 0, 0);
                col.addView(tvTimeline);
            }
        } catch (Throwable _t) { /* defensive */ }

        // 🆕 v6.62.1001 (Patrick 28.05. 21:41): Konflikt-Diagnose direkt im Dispo-Card
        //   anzeigen wenn Fahrt im wartepool oder ohne Fahrzeug — pro Fahrzeug rechnen:
        //   im Schichtplan? frei? kollidiert?
        if (r.vehicleId == null || "wartepool".equals(r.status)) {
            String diag = computeRideDiagnosisText(r, vehicles);
            if (diag != null && !diag.isEmpty()) {
                TextView tvDiag = new TextView(this);
                tvDiag.setText(diag);
                tvDiag.setTextColor(Color.parseColor("#FCA5A5"));
                tvDiag.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11);
                tvDiag.setPadding(0, dp(4), 0, 0);
                col.addView(tvDiag);
            }
        }

        card.addView(col);
        // v6.62.1001: Tap auf Karte → Detail-Dialog mit voller Konflikt-Diagnose
        final RideInfo rFinal = r;
        final Map<String, VehicleInfo> vehMap = vehicles;
        card.setOnClickListener(v -> showRideDiagnosisDialog(rFinal, vehMap));
        return card;
    }

    // 🆕 v6.62.1001 / v6.63.002: Konflikt-Diagnose-Text (kurz, für Card-Zeile)
    private String computeRideDiagnosisText(RideInfo r, Map<String, VehicleInfo> vehicles) {
        if (r == null || vehicles == null || vehicles.isEmpty()) return null;
        // v6.63.002: Echte Schichtplan-Berechnung
        Date dt = new Date(r.pickupTs);
        String dateStr = new SimpleDateFormat("yyyy-MM-dd", Locale.GERMAN).format(dt);
        String timeStr = new SimpleDateFormat("HH:mm", Locale.GERMAN).format(dt);
        int inShift = 0, notInShift = 0, busy = 0;
        for (VehicleInfo v : vehicles.values()) {
            boolean inS = isVehicleInShift(v.id, dateStr, timeStr);
            if (inS) inShift++;
            else notInShift++;
        }
        StringBuilder sb = new StringBuilder();
        if (r.wartepoolReason != null) {
            sb.append("⚠️ ").append(r.wartepoolReason);
        } else if ("wartepool".equals(r.status)) {
            sb.append("⚠️ Wartepool");
        } else {
            sb.append("⚠️ Kein Fahrzeug");
        }
        sb.append("  ·  ").append(inShift).append(" im Plan, ").append(notInShift).append(" offline");
        sb.append("  ·  Tap für Details");
        return sb.toString();
    }

    // 🆕 v6.63.002 (Patrick 29.05. 06:26): Detail-Dialog mit echter Schichtplan-Berechnung
    //   + 1-Klick-Lösungs-Buttons:
    //   • 🕒 Schicht-Editor öffnen
    //   • ⏰ Pickup um +15 Min verschieben
    //   • 🤖 Auto-Zuweisen anstoßen
    private void showRideDiagnosisDialog(RideInfo r, Map<String, VehicleInfo> vehicles) {
        if (r == null) return;
        Date dt = new Date(r.pickupTs);
        final String dateStr = new SimpleDateFormat("yyyy-MM-dd", Locale.GERMAN).format(dt);
        String timeStr = new SimpleDateFormat("HH:mm", Locale.GERMAN).format(dt);
        StringBuilder body = new StringBuilder();
        body.append("📋 ").append(r.customerName != null ? r.customerName : "?").append("\n");
        body.append("⏰ ").append(hhmm.format(new Date(r.pickupTs))).append("\n");
        body.append("📍 ").append(r.pickup != null ? r.pickup : "?").append("\n");
        body.append("🎯 ").append(r.destination != null ? r.destination : "?").append("\n\n");
        body.append("🚗 Fahrzeug-Status für ").append(dateStr).append(" ").append(timeStr).append(":\n");
        for (VehicleInfo v : vehicles.values()) {
            boolean inS = isVehicleInShift(v.id, dateStr, timeStr);
            String label = getVehicleShiftLabel(v.id, dateStr);
            String mark = inS ? "🟢" : "⚫";
            body.append("  ").append(mark).append(" ").append(v.name);
            if (v.plate != null) body.append(" ").append(v.plate);
            body.append(": ").append(label).append("\n");
        }
        if (r.wartepoolReason != null) {
            body.append("\n⚠️ Wartepool-Grund: ").append(r.wartepoolReason).append("\n");
        } else if (r.autoAssignLastReason != null) {
            // 🆕 v6.63.024: Fallback wenn Cron noch keinen Wartepool-Eintritt geschrieben hat
            body.append("\n⚠️ Letzter Auto-Assign-Befund: ").append(r.autoAssignLastReason).append("\n");
        }
        // 🆕 v6.63.024: Pro-Fahrzeug Reject-Reason aus vehicleScores anzeigen
        if (r.vehicleScoreSummary != null && !r.vehicleScoreSummary.isEmpty()) {
            body.append("\n🛠️ Auto-Assign-Befund pro Fahrzeug:\n");
            for (java.util.Map.Entry<String, String> _e : r.vehicleScoreSummary.entrySet()) {
                body.append("  • ").append(_e.getKey()).append(" — ").append(_e.getValue()).append("\n");
            }
        }
        if (r.drivingTimeToPickup != null) {
            body.append("\n🚗 Letzte Anfahrt: ").append(r.drivingTimeToPickup).append(" Min");
            if (r.drivingDistanceToPickupKm != null) body.append(" / ").append(r.drivingDistanceToPickupKm).append(" km");
            body.append("\n");
        }

        final RideInfo rFinal = r;
        androidx.appcompat.app.AlertDialog.Builder dlg = new androidx.appcompat.app.AlertDialog.Builder(this)
            .setTitle("⚠️ Konflikt-Diagnose")
            .setMessage(body.toString())
            // 🆕 v6.63.023 (Patrick 29.05. 20:59 "im wartepool kann ich nur die Zeit
            //   verschieben aber nicht bearbeiten"): Bearbeiten-Button öffnet
            //   AdminDashboardActivity mit Intent-Extra → direkt der Edit-Dialog.
            .setPositiveButton("✏️ Bearbeiten", (d, w) -> {
                android.content.Intent i = new android.content.Intent(this, AdminDashboardActivity.class);
                i.putExtra("auto_edit_ride_id", rFinal.id);
                startActivity(i);
            })
            .setNeutralButton("+15 Min", (d, w) -> {
                // 1-Klick: Pickup-Zeit um 15 Min verschieben
                long newTs = rFinal.pickupTs + 15 * 60_000L;
                FirebaseDatabase.getInstance(DB_INSTANCE_URL).getReference("rides/" + rFinal.id)
                    .child("pickupTimestamp").setValue(newTs)
                    .addOnSuccessListener(_ok -> {
                        Toast.makeText(this, rFinal.customerName + ": Pickup +15 Min", Toast.LENGTH_LONG).show();
                        // Wartepool-Reset triggern damit autoAssign neu rechnet
                        FirebaseDatabase.getInstance(DB_INSTANCE_URL).getReference("rides/" + rFinal.id)
                            .child("autoAssignAttempts").setValue(0);
                        FirebaseDatabase.getInstance(DB_INSTANCE_URL).getReference("rides/" + rFinal.id)
                            .child("wartepoolReason").setValue(null);
                    })
                    .addOnFailureListener(ex -> Toast.makeText(this, "Fehler: " + ex.getMessage(), Toast.LENGTH_LONG).show());
            })
            .setNegativeButton("Auto-Zuweisen", (d, w) -> {
                // 1-Klick: Wartepool-Reset → scheduledAutoAssign greift im naechsten 10-Min-Lauf
                Map<String, Object> resetUpd = new HashMap<>();
                resetUpd.put("autoAssignAttempts", 0);
                resetUpd.put("wartepoolReason", null);
                if ("wartepool".equals(rFinal.status)) resetUpd.put("status", "vorbestellt");
                resetUpd.put("resetForAssignAt", System.currentTimeMillis());
                resetUpd.put("resetBy", "native-dispo-v6.63.002");
                FirebaseDatabase.getInstance(DB_INSTANCE_URL).getReference("rides/" + rFinal.id)
                    .updateChildren(resetUpd)
                    .addOnSuccessListener(_ok -> Toast.makeText(this, "🤖 Reset — AutoAssign greift im naechsten Lauf", Toast.LENGTH_LONG).show())
                    .addOnFailureListener(ex -> Toast.makeText(this, "Fehler: " + ex.getMessage(), Toast.LENGTH_LONG).show());
            });
        // 🆕 v6.63.309 (Patrick 12.06. 18:56 Bridge: 'in der Disposition auf die Fahrt
        //   klicken und Stripe-Link verschicken, einfacher als CRM-Suche'): Dialog
        //   bekommt zusaetzliches Stripe-Action via List-View, nachdem die 3 Standard-
        //   Buttons schon belegt sind.
        androidx.appcompat.app.AlertDialog _shown = dlg.show();
        try {
            android.widget.LinearLayout _msgParent = (android.widget.LinearLayout) _shown.findViewById(android.R.id.message).getParent();
            if (_msgParent != null) {
                android.widget.Button _stripeBtn = new android.widget.Button(this);
                _stripeBtn.setText("💳 Vorkasse-Link erstellen");
                _stripeBtn.setAllCaps(false);
                _stripeBtn.setBackgroundColor(0xFF7C3AED);
                _stripeBtn.setTextColor(android.graphics.Color.WHITE);
                int _pad = (int)(getResources().getDisplayMetrics().density * 12);
                android.widget.LinearLayout.LayoutParams _slp = new android.widget.LinearLayout.LayoutParams(
                    android.widget.LinearLayout.LayoutParams.MATCH_PARENT,
                    android.widget.LinearLayout.LayoutParams.WRAP_CONTENT);
                _slp.setMargins(_pad, _pad, _pad, _pad);
                _stripeBtn.setLayoutParams(_slp);
                _stripeBtn.setOnClickListener(_v -> {
                    _shown.dismiss();
                    createStripeLinkFromDispoRide(rFinal);
                });
                _msgParent.addView(_stripeBtn);
            }
        } catch (Throwable _ignore) {}
    }

    // 🆕 v6.63.309 (Patrick 12.06. Bridge): Stripe-Vorkasse-Link aus DispoActivity-Diagnose.
    //   POST createStripeCheckout mit ride-Daten, URL in Clipboard, ride.stripePaymentLink
    //   gespeichert.
    private void createStripeLinkFromDispoRide(RideInfo r) {
        if (r == null || r.id == null) {
            Toast.makeText(this, "❌ Fahrt-ID fehlt", Toast.LENGTH_LONG).show();
            return;
        }
        final String _rideId = r.id;
        final String _custName = r.customerName != null ? r.customerName : "Kunde";
        final double _initialPrice = r.price != null ? r.price : 0.0;
        final String _pickup = r.pickup != null ? r.pickup : "";
        final String _destination = r.destination != null ? r.destination : "";
        final long _ts = r.pickupTs;
        java.text.SimpleDateFormat _dtFmt = new java.text.SimpleDateFormat("dd.MM.yyyy HH:mm", Locale.GERMAN);
        _dtFmt.setTimeZone(java.util.TimeZone.getTimeZone("Europe/Berlin"));
        final String _descPrefill = "Vorkasse Funk Taxi " + (_ts > 0 ? _dtFmt.format(new java.util.Date(_ts)) : "")
            + " " + (_pickup.length() > 25 ? _pickup.substring(0, 25) : _pickup)
            + " → " + (_destination.length() > 25 ? _destination.substring(0, 25) : _destination);

        android.widget.LinearLayout _layout = new android.widget.LinearLayout(this);
        _layout.setOrientation(android.widget.LinearLayout.VERTICAL);
        int _pad = (int)(getResources().getDisplayMetrics().density * 12);
        _layout.setPadding(_pad, _pad, _pad, _pad);

        TextView _lblP = new TextView(this);
        _lblP.setText("💰 Betrag (€) — vorgefuellt aus Fahrt:");
        _lblP.setTextSize(11);
        _layout.addView(_lblP);
        android.widget.EditText _etAmount = new android.widget.EditText(this);
        _etAmount.setInputType(android.text.InputType.TYPE_CLASS_NUMBER | android.text.InputType.TYPE_NUMBER_FLAG_DECIMAL);
        _etAmount.setText(String.format(Locale.GERMAN, "%.2f", _initialPrice));
        _layout.addView(_etAmount);

        TextView _lblE = new TextView(this);
        _lblE.setText("📧 Email (Stripe schickt Quittung):");
        _lblE.setTextSize(11);
        android.widget.LinearLayout.LayoutParams _llp = new android.widget.LinearLayout.LayoutParams(
            android.widget.LinearLayout.LayoutParams.MATCH_PARENT, android.widget.LinearLayout.LayoutParams.WRAP_CONTENT);
        _llp.setMargins(0, _pad, 0, 0);
        _lblE.setLayoutParams(_llp);
        _layout.addView(_lblE);
        android.widget.EditText _etEmail = new android.widget.EditText(this);
        _etEmail.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS);
        _etEmail.setHint("kunde@example.de (optional)");
        _layout.addView(_etEmail);

        TextView _lblD = new TextView(this);
        _lblD.setText("📝 Beschreibung:");
        _lblD.setTextSize(11);
        _lblD.setLayoutParams(_llp);
        _layout.addView(_lblD);
        android.widget.EditText _etDesc = new android.widget.EditText(this);
        _etDesc.setText(_descPrefill);
        _layout.addView(_etDesc);

        android.widget.ScrollView _scroll = new android.widget.ScrollView(this);
        _scroll.addView(_layout);

        new androidx.appcompat.app.AlertDialog.Builder(this)
            .setTitle("💳 Vorkasse-Link fuer " + _custName)
            .setView(_scroll)
            .setPositiveButton("Generieren", (d, w) -> {
                String _amountStr = _etAmount.getText().toString().trim().replace(',', '.');
                String _finalEmail = _etEmail.getText().toString().trim();
                String _finalDesc = _etDesc.getText().toString().trim();
                double _amount;
                try { _amount = Double.parseDouble(_amountStr); }
                catch (Throwable _err) {
                    Toast.makeText(this, "⚠️ Ungueltiger Betrag", Toast.LENGTH_LONG).show();
                    return;
                }
                if (_amount < 0.5) {
                    Toast.makeText(this, "⚠️ Mindestbetrag 0,50 €", Toast.LENGTH_LONG).show();
                    return;
                }
                final double _fAmount = _amount;
                final String _invoiceNumber = "VKAS-" + _rideId.substring(Math.max(0, _rideId.length() - 8));
                Toast.makeText(this, "⏳ Generiere Stripe-Link...", Toast.LENGTH_SHORT).show();
                new Thread(() -> {
                    try {
                        java.net.URL _url = new java.net.URL("https://europe-west1-taxi-heringsdorf.cloudfunctions.net/createStripeCheckout");
                        java.net.HttpURLConnection _conn = (java.net.HttpURLConnection) _url.openConnection();
                        _conn.setRequestMethod("POST");
                        _conn.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                        _conn.setDoOutput(true);
                        _conn.setConnectTimeout(10000);
                        _conn.setReadTimeout(20000);
                        org.json.JSONObject _body = new org.json.JSONObject();
                        _body.put("invoiceNumber", _invoiceNumber);
                        _body.put("amount", _fAmount);
                        _body.put("customerName", _custName);
                        if (!_finalEmail.isEmpty()) _body.put("customerEmail", _finalEmail);
                        _body.put("description", _finalDesc.isEmpty() ? "Vorkasse Funk Taxi Heringsdorf" : _finalDesc);
                        _body.put("rideId", _rideId);
                        try (java.io.OutputStream _os = _conn.getOutputStream()) {
                            _os.write(_body.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8));
                        }
                        int _rc = _conn.getResponseCode();
                        if (_rc < 200 || _rc >= 300) {
                            runOnUiThread(() -> Toast.makeText(this, "❌ Stripe-Fehler HTTP " + _rc, Toast.LENGTH_LONG).show());
                            return;
                        }
                        java.io.BufferedReader _br = new java.io.BufferedReader(new java.io.InputStreamReader(_conn.getInputStream(), java.nio.charset.StandardCharsets.UTF_8));
                        StringBuilder _sb = new StringBuilder();
                        String _line; while ((_line = _br.readLine()) != null) _sb.append(_line);
                        org.json.JSONObject _resp = new org.json.JSONObject(_sb.toString());
                        final String _checkoutUrl = _resp.optString("url", "");
                        if (_checkoutUrl.isEmpty()) {
                            runOnUiThread(() -> Toast.makeText(this, "❌ Stripe lieferte keine URL", Toast.LENGTH_LONG).show());
                            return;
                        }
                        Map<String, Object> _upd = new HashMap<>();
                        _upd.put("stripePaymentLink", _checkoutUrl);
                        _upd.put("stripeRequestedAt", System.currentTimeMillis());
                        _upd.put("stripeRequestedBy", "native-dispo-v6.63.309");
                        _upd.put("stripeAmount", _fAmount);
                        FirebaseDatabase.getInstance(DB_INSTANCE_URL).getReference("rides/" + _rideId).updateChildren(_upd);
                        runOnUiThread(() -> {
                            android.content.ClipboardManager _cm = (android.content.ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
                            if (_cm != null) _cm.setPrimaryClip(android.content.ClipData.newPlainText("Stripe", _checkoutUrl));
                            new androidx.appcompat.app.AlertDialog.Builder(this)
                                .setTitle("💳 Stripe-Link bereit")
                                .setMessage("Link in Zwischenablage kopiert:\n\n" + _checkoutUrl + "\n\nIn WhatsApp / SMS / E-Mail einfuegen.")
                                .setPositiveButton("OK", null).show();
                        });
                    } catch (Throwable _err) {
                        runOnUiThread(() -> Toast.makeText(this, "❌ Stripe-Fehler: " + _err.getMessage(), Toast.LENGTH_LONG).show());
                    }
                }).start();
            })
            .setNegativeButton("Abbrechen", null)
            .show();
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
        // v6.62.1001: Wartepool-Reason fuer Diagnose-Anzeige
        r.wartepoolReason = strOrNull(s.child("wartepoolReason").getValue());
        // 🆕 v6.63.331: Lock-Indicator
        Object _lockObj = s.child("assignmentLocked").getValue();
        r.assignmentLocked = (_lockObj instanceof Boolean) && (Boolean) _lockObj;
        r.assignmentLockedBy = strOrNull(s.child("assignmentLockedBy").getValue());
        // 🆕 v6.63.309: price fuer Stripe-Vorkasse-Vorfilling
        Object _priceRaw = s.child("price").getValue();
        if (_priceRaw instanceof Number) r.price = ((Number) _priceRaw).doubleValue();
        else if (_priceRaw != null) {
            try { r.price = Double.parseDouble(String.valueOf(_priceRaw).replace(',', '.')); }
            catch (Throwable __) {}
        }
        // 🆕 v6.63.024: vehicleScores + autoAssignLastReason für Konflikt-Diagnose
        // 🆕 v6.63.455 (Patrick 21.06. 09:17 Bridge: 'ich konnte den Fehler in der Live-Dispo
        //   nicht sehen'): vehicleScores komplett auswerten — leerfahrtMin, totalScore,
        //   priorityPenalty, busyUntil, conflictMath, blockingRide damit Patrick im Card-
        //   Dialog SIEHT WARUM welches Vehicle gewählt/abgelehnt wurde.
        r.autoAssignLastReason = strOrNull(s.child("autoAssignLastReason").getValue());
        java.util.Map<String, String> _scoreReasons = new java.util.LinkedHashMap<>();
        DataSnapshot _vs = s.child("vehicleScores");
        if (_vs.exists()) {
            for (DataSnapshot _vsc : _vs.getChildren()) {
                String _vid = _vsc.getKey();
                String _status = strOrNull(_vsc.child("status").getValue());
                String _reason = strOrNull(_vsc.child("reason").getValue());
                String _check = strOrNull(_vsc.child("check").getValue());
                Object _leerfahrtRaw = _vsc.child("leerfahrtMin").getValue();
                Object _totalScoreRaw = _vsc.child("totalScore").getValue();
                Object _priorityPenaltyRaw = _vsc.child("priorityPenalty").getValue();
                String _leerfahrtVon = strOrNull(_vsc.child("leerfahrtVon").getValue());
                String _busyUntil = strOrNull(_vsc.child("busyUntil").getValue());
                String _blockingCustomer = strOrNull(_vsc.child("blockingRideCustomer").getValue());
                String _blockingTime = strOrNull(_vsc.child("blockingRideTime").getValue());
                if (_vid != null) {
                    StringBuilder _line = new StringBuilder();
                    _line.append(_status != null ? _status : "?");
                    if (_totalScoreRaw instanceof Number) _line.append(" · score=").append(((Number)_totalScoreRaw).intValue());
                    if (_leerfahrtRaw instanceof Number) {
                        _line.append(" · ").append(((Number)_leerfahrtRaw).intValue()).append("min ");
                        _line.append(_leerfahrtVon != null ? _leerfahrtVon : "Anfahrt");
                    }
                    if (_priorityPenaltyRaw instanceof Number && ((Number)_priorityPenaltyRaw).intValue() != 0) {
                        _line.append(" · penalty ").append(((Number)_priorityPenaltyRaw).intValue());
                    }
                    if (_blockingCustomer != null && _blockingTime != null) {
                        _line.append(" · blockiert von ").append(_blockingCustomer).append(" ").append(_blockingTime);
                    } else if (_busyUntil != null) {
                        _line.append(" · frei ab ").append(_busyUntil);
                    }
                    if (_reason != null && !_reason.isEmpty()) {
                        _line.append("\n      ↳ ").append(_reason);
                    }
                    _scoreReasons.put(_vid, _line.toString());
                }
            }
        }
        r.vehicleScoreSummary = _scoreReasons;
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
        // 🆕 v6.63.024: Konflikt-Diagnose-Felder
        String autoAssignLastReason;
        java.util.Map<String, String> vehicleScoreSummary;
        // 🆕 v6.63.309 (Stripe-Vorkasse aus DispoActivity)
        Double price;

        boolean isActive() {
            return "assigned".equals(status) || "accepted".equals(status)
                || "sofort".equals(status) || "on_way".equals(status)
                || "arrived".equals(status) || "picked_up".equals(status);
        }

        boolean isUpcoming(long now, long until) {
            // 🆕 v6.62.1001 (Patrick 28.05. 21:41): Wartepool-Fahrten auch in der Liste
            //   zeigen damit Patrick den Konflikt-Grund sieht.
            return ("vorbestellt".equals(status) || "wartepool".equals(status))
                && pickupTs > now && pickupTs <= until;
        }

        // 🆕 v6.62.1001: Wartepool-Reason-String fuer UI-Anzeige
        String wartepoolReason;
        // 🆕 v6.63.331 (Patrick 14.06.2026 10:02 'sehe nicht ob Fahrt gelockt ist'):
        //   Lock-Indicator im Card
        boolean assignmentLocked;
        String assignmentLockedBy;

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
