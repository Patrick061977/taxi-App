package de.taxiheringsdorf.app;

import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.widget.ProgressBar;
import android.widget.TextView;
import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import com.google.firebase.database.DataSnapshot;
import com.google.firebase.database.DatabaseError;
import com.google.firebase.database.FirebaseDatabase;
import com.google.firebase.database.Query;
import com.google.firebase.database.ValueEventListener;
import java.util.Calendar;
import java.util.Locale;

// v6.47.0: Statistik-Activity — Tag/Woche/Monat Verdienst, km, Anzahl Fahrten,
// Durchschnitt pro Fahrt (30 Tage). Liest /rides gefiltert auf currentVehicleId.
public class StatsActivity extends AppCompatActivity {
    private static final String DB_INSTANCE_URL = "https://taxi-heringsdorf-default-rtdb.europe-west1.firebasedatabase.app";

    private TextView tvVehicle, tvTodayTotal, tvTodayMeta, tvWeekTotal, tvWeekMeta,
        tvMonthTotal, tvMonthMeta, tvAvgPerRide;
    private ProgressBar progress;
    private String vehicleId;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        setContentView(R.layout.activity_stats);

        tvVehicle = findViewById(R.id.tv_stats_vehicle);
        tvTodayTotal = findViewById(R.id.tv_today_total);
        tvTodayMeta = findViewById(R.id.tv_today_meta);
        tvWeekTotal = findViewById(R.id.tv_week_total);
        tvWeekMeta = findViewById(R.id.tv_week_meta);
        tvMonthTotal = findViewById(R.id.tv_month_total);
        tvMonthMeta = findViewById(R.id.tv_month_meta);
        tvAvgPerRide = findViewById(R.id.tv_avg_per_ride);
        progress = findViewById(R.id.stats_progress);

        vehicleId = getSharedPreferences("driver", MODE_PRIVATE).getString("vehicleId", null);
        String vName = getSharedPreferences("driver", MODE_PRIVATE).getString("vehicleName", null);
        tvVehicle.setText(vName != null ? vName + " (" + vehicleId + ")" : "Fahrzeug: " + vehicleId);
        if (vehicleId == null) { finish(); return; }
        loadStats();
    }

    private void loadStats() {
        progress.setVisibility(View.VISIBLE);
        Query q = FirebaseDatabase.getInstance(DB_INSTANCE_URL).getReference("rides")
            .orderByChild("vehicleId").equalTo(vehicleId);
        q.addListenerForSingleValueEvent(new ValueEventListener() {
            @Override public void onDataChange(@NonNull DataSnapshot s) {
                progress.setVisibility(View.GONE);
                aggregate(s);
            }
            @Override public void onCancelled(@NonNull DatabaseError e) {
                progress.setVisibility(View.GONE);
                tvTodayTotal.setText("Fehler");
            }
        });
    }

    private void aggregate(DataSnapshot s) {
        long now = System.currentTimeMillis();
        Calendar c = Calendar.getInstance();
        c.set(Calendar.HOUR_OF_DAY, 0); c.set(Calendar.MINUTE, 0); c.set(Calendar.SECOND, 0); c.set(Calendar.MILLISECOND, 0);
        long dayStart = c.getTimeInMillis();
        // Wochenstart = Montag 00:00
        c.set(Calendar.DAY_OF_WEEK, Calendar.MONDAY);
        long weekStart = c.getTimeInMillis();
        if (weekStart > dayStart) weekStart -= 7L * 86400000L;
        // Monatsstart = 1. des Monats
        Calendar c2 = Calendar.getInstance();
        c2.set(Calendar.DAY_OF_MONTH, 1);
        c2.set(Calendar.HOUR_OF_DAY, 0); c2.set(Calendar.MINUTE, 0); c2.set(Calendar.SECOND, 0); c2.set(Calendar.MILLISECOND, 0);
        long monthStart = c2.getTimeInMillis();
        long thirtyDaysAgo = now - 30L * 86400000L;

        double tT = 0, tW = 0, tM = 0, t30 = 0;
        int nT = 0, nW = 0, nM = 0, n30 = 0;
        double kmT = 0, kmW = 0, kmM = 0;

        for (DataSnapshot child : s.getChildren()) {
            String st = child.child("status").getValue(String.class);
            if (st == null) continue;
            String stl = st.toLowerCase();
            if (!stl.equals("completed") && !stl.equals("abgeschlossen") && !stl.equals("done")) continue;

            Object completedAtO = child.child("completedAt").getValue();
            long completedAt = 0;
            if (completedAtO instanceof Number) completedAt = ((Number) completedAtO).longValue();
            if (completedAt == 0) {
                Object pickO = child.child("pickupTimestamp").getValue();
                if (pickO instanceof Number) completedAt = ((Number) pickO).longValue();
            }
            if (completedAt == 0) continue;

            double price = 0;
            Object pO = child.child("price").getValue();
            if (pO instanceof Number) price = ((Number) pO).doubleValue();
            else if (pO instanceof String) try { price = Double.parseDouble(((String) pO).replace(',', '.')); } catch (Throwable _t) {}

            double dist = 0;
            Object dO = child.child("distance").getValue();
            if (dO instanceof Number) dist = ((Number) dO).doubleValue();
            else if (dO instanceof String) try { dist = Double.parseDouble(((String) dO).replace(',', '.')); } catch (Throwable _t) {}

            if (completedAt >= dayStart) { tT += price; nT++; kmT += dist; }
            if (completedAt >= weekStart) { tW += price; nW++; kmW += dist; }
            if (completedAt >= monthStart) { tM += price; nM++; kmM += dist; }
            if (completedAt >= thirtyDaysAgo) { t30 += price; n30++; }
        }

        tvTodayTotal.setText(String.format(Locale.GERMANY, "%.2f €", tT));
        tvTodayMeta.setText(String.format(Locale.GERMANY, "%d Fahrten · %.1f km", nT, kmT));
        tvWeekTotal.setText(String.format(Locale.GERMANY, "%.2f €", tW));
        tvWeekMeta.setText(String.format(Locale.GERMANY, "%d Fahrten · %.1f km", nW, kmW));
        tvMonthTotal.setText(String.format(Locale.GERMANY, "%.2f €", tM));
        tvMonthMeta.setText(String.format(Locale.GERMANY, "%d Fahrten · %.1f km", nM, kmM));
        if (n30 > 0) {
            tvAvgPerRide.setText(String.format(Locale.GERMANY, "%.2f €  (aus %d Fahrten)", t30 / n30, n30));
        } else {
            tvAvgPerRide.setText("noch keine Fahrten");
        }
    }
}
