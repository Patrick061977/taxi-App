package de.taxiheringsdorf.app;

import android.content.Context;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.util.Log;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.appcompat.app.AppCompatActivity;

import com.google.firebase.database.DataSnapshot;
import com.google.firebase.database.DatabaseError;
import com.google.firebase.database.FirebaseDatabase;
import com.google.firebase.database.ValueEventListener;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;

/**
 * v6.66.232 (Patrick 04.10.26 12:42/13:27 Bridge: "Kannst du nicht alle Dinger
 *   bauen und ich switche da mal durch").
 * Zeigt 3 alternative Dashboard-Varianten als Tabs:
 *   - HERO: naechste Fahrt gross oben + Mini-Liste
 *   - TIMELINE: chronologische Fahrten heute mit JETZT-Marker
 *   - GANTT: pro Fahrzeug horizontale Zeitachse
 * Alle Daten live via Firebase-Listener auf /rides. Nur read-only, kein Tap-to-edit.
 */
public class AlternativeDashboardActivity extends AppCompatActivity {
    private static final String TAG = "AltDashboard";
    private static final String DB_URL = "https://taxi-heringsdorf-default-rtdb.europe-west1.firebasedatabase.app";

    private LinearLayout content;
    private Button tabHero, tabTimeline, tabGantt;
    private int currentTab = 0; // 0=hero, 1=timeline, 2=gantt
    private ValueEventListener ridesListener;
    private final List<RideData> todayRides = new ArrayList<>();

    private static class RideData {
        String id, customerName, guestName, pickup, destination, status, assignedVehicle, assignedVehicleName;
        long pickupTs, duration;
        double price;
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_alt_dashboard);

        content = findViewById(R.id.alt_content);
        tabHero = findViewById(R.id.tab_hero);
        tabTimeline = findViewById(R.id.tab_timeline);
        tabGantt = findViewById(R.id.tab_gantt);
        findViewById(R.id.btn_alt_close).setOnClickListener(v -> finish());

        tabHero.setOnClickListener(v -> switchTab(0));
        tabTimeline.setOnClickListener(v -> switchTab(1));
        tabGantt.setOnClickListener(v -> switchTab(2));

        startRidesListener();
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        if (ridesListener != null) {
            try { FirebaseDatabase.getInstance(DB_URL).getReference("rides").removeEventListener(ridesListener); } catch (Throwable _ignore) {}
        }
    }

    private void switchTab(int tab) {
        currentTab = tab;
        tabHero.setBackgroundColor(tab == 0 ? Color.parseColor("#DBEAFE") : Color.parseColor("#F3F4F6"));
        tabHero.setTextColor(tab == 0 ? Color.parseColor("#1E40AF") : Color.parseColor("#374151"));
        tabTimeline.setBackgroundColor(tab == 1 ? Color.parseColor("#DBEAFE") : Color.parseColor("#F3F4F6"));
        tabTimeline.setTextColor(tab == 1 ? Color.parseColor("#1E40AF") : Color.parseColor("#374151"));
        tabGantt.setBackgroundColor(tab == 2 ? Color.parseColor("#DBEAFE") : Color.parseColor("#F3F4F6"));
        tabGantt.setTextColor(tab == 2 ? Color.parseColor("#1E40AF") : Color.parseColor("#374151"));
        render();
    }

    private void startRidesListener() {
        try {
            ridesListener = new ValueEventListener() {
                @Override public void onDataChange(DataSnapshot snap) {
                    todayRides.clear();
                    long now = System.currentTimeMillis();
                    long todayStart = startOfToday();
                    long todayEnd = todayStart + 24L * 3600_000L;
                    for (DataSnapshot child : snap.getChildren()) {
                        try {
                            Object ptO = child.child("pickupTimestamp").getValue();
                            if (!(ptO instanceof Number)) continue;
                            long pt = ((Number) ptO).longValue();
                            if (pt < todayStart || pt > todayEnd) continue;
                            Object statusO = child.child("status").getValue();
                            String status = statusO != null ? String.valueOf(statusO) : "";
                            if ("deleted".equals(status) || "cancelled".equals(status) || "storniert".equals(status)) continue;
                            RideData r = new RideData();
                            r.id = child.getKey();
                            r.pickupTs = pt;
                            r.status = status;
                            Object cnO = child.child("customerName").getValue();
                            r.customerName = cnO != null ? String.valueOf(cnO) : "?";
                            Object gnO = child.child("guestName").getValue();
                            r.guestName = gnO != null ? String.valueOf(gnO) : "";
                            Object pO = child.child("pickup").getValue();
                            r.pickup = pO != null ? String.valueOf(pO) : "";
                            Object dO = child.child("destination").getValue();
                            r.destination = dO != null ? String.valueOf(dO) : "";
                            Object avO = child.child("assignedVehicle").getValue();
                            r.assignedVehicle = avO != null ? String.valueOf(avO) : "";
                            Object avnO = child.child("assignedVehicleName").getValue();
                            r.assignedVehicleName = avnO != null ? String.valueOf(avnO) : r.assignedVehicle;
                            Object durO = child.child("duration").getValue();
                            if (!(durO instanceof Number)) durO = child.child("estimatedDuration").getValue();
                            r.duration = (durO instanceof Number) ? ((Number) durO).longValue() : 15;
                            Object prO = child.child("price").getValue();
                            if (prO instanceof Number) r.price = ((Number) prO).doubleValue();
                            else if (prO instanceof String) { try { r.price = Double.parseDouble((String) prO); } catch (Throwable _ignore) {} }
                            todayRides.add(r);
                        } catch (Throwable _ignore) {}
                    }
                    Collections.sort(todayRides, (a, b) -> Long.compare(a.pickupTs, b.pickupTs));
                    runOnUiThread(() -> render());
                }
                @Override public void onCancelled(DatabaseError e) { Log.w(TAG, "listener cancelled: " + e.getMessage()); }
            };
            FirebaseDatabase.getInstance(DB_URL).getReference("rides").addValueEventListener(ridesListener);
        } catch (Throwable _t) { Log.w(TAG, "startRidesListener: " + _t.getMessage()); }
    }

    private long startOfToday() {
        java.util.Calendar c = java.util.Calendar.getInstance(TimeZone.getTimeZone("Europe/Berlin"));
        c.set(java.util.Calendar.HOUR_OF_DAY, 0);
        c.set(java.util.Calendar.MINUTE, 0);
        c.set(java.util.Calendar.SECOND, 0);
        c.set(java.util.Calendar.MILLISECOND, 0);
        return c.getTimeInMillis();
    }

    private void render() {
        content.removeAllViews();
        if (currentTab == 0) renderHero();
        else if (currentTab == 1) renderTimeline();
        else renderGantt();
    }

    private String fmtTime(long ts) {
        SimpleDateFormat sdf = new SimpleDateFormat("HH:mm", Locale.GERMAN);
        sdf.setTimeZone(TimeZone.getTimeZone("Europe/Berlin"));
        return sdf.format(new Date(ts));
    }

    private String nameOf(RideData r) {
        String n = r.guestName != null && !r.guestName.isEmpty() ? r.guestName : r.customerName;
        if (n == null) return "?";
        return n.split("[;,]")[0].trim().split(" ")[0];
    }

    private int dp(int v) { return Math.round(v * getResources().getDisplayMetrics().density); }

    // ───────── HERO: naechste Fahrt gross + Mini-Liste ─────────
    private void renderHero() {
        long now = System.currentTimeMillis();
        String myVid = getSharedPreferences("driver", MODE_PRIVATE).getString("vehicleId", "");
        RideData next = null;
        for (RideData r : todayRides) {
            if (!"completed".equals(r.status) && r.pickupTs > now - 10*60_000L
                    && (myVid.isEmpty() || myVid.equals(r.assignedVehicle))) {
                next = r;
                break;
            }
        }
        if (next != null) {
            LinearLayout hero = new LinearLayout(this);
            hero.setOrientation(LinearLayout.VERTICAL);
            hero.setPadding(dp(16), dp(16), dp(16), dp(16));
            GradientDrawable gd = new GradientDrawable();
            gd.setColor(Color.parseColor("#1E40AF"));
            gd.setCornerRadius(dp(10));
            hero.setBackground(gd);
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            lp.setMargins(0, 0, 0, dp(16));
            hero.setLayoutParams(lp);

            int minsToPickup = (int) ((next.pickupTs - now) / 60000);
            TextView t1 = new TextView(this);
            t1.setText(minsToPickup > 0 ? "in " + minsToPickup + " Minuten" : (minsToPickup < -5 ? Math.abs(minsToPickup) + " Min ueberfaellig" : "JETZT"));
            t1.setTextColor(Color.parseColor("#BFDBFE"));
            t1.setTextSize(14);
            hero.addView(t1);

            TextView t2 = new TextView(this);
            t2.setText(fmtTime(next.pickupTs) + " · " + nameOf(next));
            t2.setTextColor(Color.WHITE);
            t2.setTextSize(28);
            t2.setTypeface(null, Typeface.BOLD);
            hero.addView(t2);

            TextView t3 = new TextView(this);
            t3.setText("📍 " + next.pickup);
            t3.setTextColor(Color.parseColor("#DBEAFE"));
            t3.setTextSize(13);
            t3.setPadding(0, dp(10), 0, 0);
            hero.addView(t3);

            TextView t4 = new TextView(this);
            t4.setText("🎯 " + next.destination);
            t4.setTextColor(Color.parseColor("#DBEAFE"));
            t4.setTextSize(13);
            hero.addView(t4);

            TextView t5 = new TextView(this);
            String svs = "Status: " + statusLabel(next.status);
            if (next.price > 0) svs += " · " + String.format(Locale.GERMAN, "%.2f€", next.price);
            if (next.assignedVehicleName != null && !next.assignedVehicleName.isEmpty()) svs += " · " + next.assignedVehicleName;
            t5.setText(svs);
            t5.setTextColor(Color.parseColor("#A5B4FC"));
            t5.setTextSize(12);
            t5.setPadding(0, dp(10), 0, 0);
            hero.addView(t5);

            content.addView(hero);
        } else {
            TextView empty = new TextView(this);
            empty.setText("Keine naechste Fahrt heute.");
            empty.setPadding(dp(16), dp(32), dp(16), dp(32));
            empty.setGravity(Gravity.CENTER);
            empty.setTextColor(Color.parseColor("#64748B"));
            content.addView(empty);
        }
        TextView header = new TextView(this);
        header.setText("DANACH");
        header.setTextColor(Color.parseColor("#64748B"));
        header.setTextSize(11);
        header.setTypeface(null, Typeface.BOLD);
        header.setPadding(0, 0, 0, dp(8));
        content.addView(header);
        int count = 0;
        for (RideData r : todayRides) {
            if (r == next) continue;
            if (r.pickupTs <= now - 60*60_000L) continue;
            if ("completed".equals(r.status)) continue;
            addMiniRow(r, now);
            count++;
            if (count >= 6) break;
        }
    }

    private void addMiniRow(RideData r, long now) {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.VERTICAL);
        row.setPadding(dp(10), dp(8), dp(10), dp(8));
        GradientDrawable gd = new GradientDrawable();
        gd.setColor(Color.parseColor("#FFFFFF"));
        gd.setStroke(dp(1), Color.parseColor("#E2E8F0"));
        gd.setCornerRadius(dp(6));
        row.setBackground(gd);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.setMargins(0, 0, 0, dp(6));
        row.setLayoutParams(lp);

        TextView t1 = new TextView(this);
        t1.setText(fmtTime(r.pickupTs) + " · " + nameOf(r));
        t1.setTypeface(null, Typeface.BOLD);
        t1.setTextSize(13);
        row.addView(t1);

        TextView t2 = new TextView(this);
        String info = r.pickup;
        if (info.length() > 40) info = info.substring(0, 37) + "…";
        info += " → ";
        String dest = r.destination;
        if (dest.length() > 40) dest = dest.substring(0, 37) + "…";
        info += dest;
        t2.setText(info);
        t2.setTextSize(10);
        t2.setTextColor(Color.parseColor("#64748B"));
        row.addView(t2);

        TextView t3 = new TextView(this);
        String extra = statusLabel(r.status);
        if (r.assignedVehicleName != null && !r.assignedVehicleName.isEmpty()) extra += " · " + r.assignedVehicleName;
        if (r.price > 0) extra += " · " + String.format(Locale.GERMAN, "%.2f€", r.price);
        t3.setText(extra);
        t3.setTextSize(10);
        t3.setTextColor(Color.parseColor("#334155"));
        row.addView(t3);

        content.addView(row);
    }

    // ───────── TIMELINE: chronologisch mit JETZT-Marker ─────────
    private void renderTimeline() {
        long now = System.currentTimeMillis();
        boolean jetztInserted = false;
        for (RideData r : todayRides) {
            if (!jetztInserted && r.pickupTs > now) {
                jetztInserted = true;
                TextView jm = new TextView(this);
                jm.setText("━━━ JETZT " + fmtTime(now) + " ━━━");
                jm.setTextColor(Color.WHITE);
                jm.setBackgroundColor(Color.parseColor("#DC2626"));
                jm.setPadding(dp(12), dp(8), dp(12), dp(8));
                jm.setTypeface(null, Typeface.BOLD);
                jm.setTextSize(13);
                LinearLayout.LayoutParams lpj = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
                lpj.setMargins(0, dp(6), 0, dp(6));
                jm.setLayoutParams(lpj);
                content.addView(jm);
            }
            addTimelineRow(r, now);
        }
        if (!jetztInserted) {
            TextView jm = new TextView(this);
            jm.setText("━━━ JETZT " + fmtTime(now) + " · (alle Fahrten vorbei) ━━━");
            jm.setTextColor(Color.WHITE);
            jm.setBackgroundColor(Color.parseColor("#DC2626"));
            jm.setPadding(dp(12), dp(8), dp(12), dp(8));
            jm.setTypeface(null, Typeface.BOLD);
            jm.setTextSize(13);
            content.addView(jm);
        }
    }

    private void addTimelineRow(RideData r, long now) {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setPadding(dp(8), dp(6), dp(8), dp(6));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.setMargins(0, 0, 0, dp(4));
        row.setLayoutParams(lp);

        TextView dot = new TextView(this);
        dot.setText("●");
        int statusColor = statusColor(r.status);
        dot.setTextColor(statusColor);
        dot.setTextSize(16);
        dot.setPadding(0, 0, dp(10), 0);
        row.addView(dot);

        LinearLayout info = new LinearLayout(this);
        info.setOrientation(LinearLayout.VERTICAL);
        LinearLayout.LayoutParams infoLp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1);
        info.setLayoutParams(infoLp);

        TextView t1 = new TextView(this);
        t1.setText(fmtTime(r.pickupTs) + " " + statusEmoji(r.status) + " " + nameOf(r));
        t1.setTypeface(null, Typeface.BOLD);
        t1.setTextSize(13);
        info.addView(t1);

        TextView t2 = new TextView(this);
        String s = (r.assignedVehicleName != null && !r.assignedVehicleName.isEmpty() ? r.assignedVehicleName : "-");
        if (r.price > 0) s += " · " + String.format(Locale.GERMAN, "%.2f€", r.price);
        t2.setText(s);
        t2.setTextSize(10);
        t2.setTextColor(Color.parseColor("#64748B"));
        info.addView(t2);

        row.addView(info);
        content.addView(row);
    }

    // ───────── GANTT: pro Fahrzeug horizontal (vereinfacht als Liste) ─────────
    private void renderGantt() {
        // Pro assignedVehicle gruppieren
        java.util.Map<String, List<RideData>> byVid = new java.util.LinkedHashMap<>();
        for (RideData r : todayRides) {
            String vid = r.assignedVehicleName != null && !r.assignedVehicleName.isEmpty() ? r.assignedVehicleName : (r.assignedVehicle != null ? r.assignedVehicle : "(nicht zugewiesen)");
            byVid.computeIfAbsent(vid, k -> new ArrayList<>()).add(r);
        }
        long now = System.currentTimeMillis();
        for (java.util.Map.Entry<String, List<RideData>> e : byVid.entrySet()) {
            TextView header = new TextView(this);
            header.setText("🚗 " + e.getKey());
            header.setTypeface(null, Typeface.BOLD);
            header.setTextSize(14);
            header.setTextColor(Color.parseColor("#0F172A"));
            header.setPadding(0, dp(10), 0, dp(6));
            content.addView(header);
            for (RideData r : e.getValue()) {
                LinearLayout bar = new LinearLayout(this);
                bar.setOrientation(LinearLayout.HORIZONTAL);
                bar.setPadding(dp(10), dp(8), dp(10), dp(8));
                GradientDrawable gd = new GradientDrawable();
                int color;
                if ("completed".equals(r.status)) color = 0xFFD1FAE5;
                else if ("accepted".equals(r.status) || "on_way".equals(r.status) || "arrived".equals(r.status)) color = 0xFFBFDBFE;
                else if ("picked_up".equals(r.status)) color = 0xFFFECACA;
                else if (r.pickupTs < now) color = 0xFFFDE68A;
                else color = 0xFFF3F4F6;
                gd.setColor(color);
                gd.setCornerRadius(dp(6));
                bar.setBackground(gd);
                LinearLayout.LayoutParams barLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
                barLp.setMargins(0, 0, 0, dp(4));
                bar.setLayoutParams(barLp);

                TextView t = new TextView(this);
                t.setText(fmtTime(r.pickupTs) + " · " + nameOf(r) + " · " + statusLabel(r.status) + (r.price > 0 ? " · " + String.format(Locale.GERMAN, "%.2f€", r.price) : ""));
                t.setTextSize(12);
                t.setTextColor(Color.parseColor("#0F172A"));
                bar.addView(t);

                content.addView(bar);
            }
        }
        if (byVid.isEmpty()) {
            TextView empty = new TextView(this);
            empty.setText("Keine Fahrten heute.");
            empty.setPadding(dp(16), dp(32), dp(16), dp(32));
            empty.setGravity(Gravity.CENTER);
            empty.setTextColor(Color.parseColor("#64748B"));
            content.addView(empty);
        }
    }

    private String statusLabel(String s) {
        if ("accepted".equals(s)) return "angenommen";
        if ("on_way".equals(s)) return "unterwegs";
        if ("arrived".equals(s)) return "angekommen";
        if ("picked_up".equals(s)) return "mit Fahrgast";
        if ("completed".equals(s)) return "abgeschlossen";
        if ("vorbestellt".equals(s)) return "vorbestellt";
        if ("new".equals(s) || "sofort".equals(s)) return "neu";
        if ("wartepool".equals(s)) return "Wartepool";
        return s;
    }

    private String statusEmoji(String s) {
        if ("completed".equals(s)) return "✓";
        if ("accepted".equals(s) || "on_way".equals(s)) return "⚙";
        if ("picked_up".equals(s)) return "🚗";
        if ("vorbestellt".equals(s) || "new".equals(s)) return "⏳";
        return "·";
    }

    private int statusColor(String s) {
        if ("completed".equals(s)) return Color.parseColor("#10B981");
        if ("accepted".equals(s) || "on_way".equals(s) || "arrived".equals(s)) return Color.parseColor("#3B82F6");
        if ("picked_up".equals(s)) return Color.parseColor("#DC2626");
        if ("wartepool".equals(s)) return Color.parseColor("#F59E0B");
        return Color.parseColor("#9CA3AF");
    }
}
