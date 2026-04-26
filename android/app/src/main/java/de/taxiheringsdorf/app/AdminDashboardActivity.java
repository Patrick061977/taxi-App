package de.taxiheringsdorf.app;

import android.app.AlertDialog;
import android.app.DatePickerDialog;
import android.app.TimePickerDialog;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.os.Bundle;
import android.text.InputType;
import android.util.Log;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.PopupMenu;
import android.widget.TextView;
import android.widget.Toast;
import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.RecyclerView;
import com.google.android.material.button.MaterialButton;
import com.google.firebase.auth.FirebaseAuth;
import com.google.firebase.auth.FirebaseUser;
import com.google.firebase.database.DataSnapshot;
import com.google.firebase.database.DatabaseError;
import com.google.firebase.database.DatabaseReference;
import com.google.firebase.database.FirebaseDatabase;
import com.google.firebase.database.Query;
import com.google.firebase.database.ValueEventListener;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

// v6.51.0: Admin-Modus für Patrick auf S9+ (oder anderen Admin-Geräten).
// Kein Fahrzeug, kein GPS, kein Schicht-Timer. Nur:
//  - Liste aller offenen Aufträge (warteschlange/vorbestellt/accepted/on_way/picked_up)
//  - 📞 Anrufliste → CallLogActivity (auto admin-mode via SharedPref)
//  - 🚖 Neue Buchung (manuell, ohne Anrufer)
//  - Hamburger: Logout, Zurück zu Fahrzeugauswahl
public class AdminDashboardActivity extends AppCompatActivity {
    private static final String TAG = "AdminDashboard";
    private static final String DB_INSTANCE_URL = "https://taxi-heringsdorf-default-rtdb.europe-west1.firebasedatabase.app";

    private TextView tvAdminEmail, tvQueueCount;
    private MaterialButton btnMenu, btnCallLog, btnNewBooking;
    private RecyclerView rv;
    private LinearLayout emptyState;
    private AdminRideAdapter adapter;

    private FirebaseDatabase db;
    private Query openRidesQuery;
    private ValueEventListener openRidesListener;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        setContentView(R.layout.activity_admin_dashboard);

        // Admin-Mode Flag setzen — CallLogActivity nutzt das um EINSTEIGER zu verstecken
        getSharedPreferences("admin", MODE_PRIVATE).edit().putBoolean("isAdminMode", true).apply();

        tvAdminEmail = findViewById(R.id.tv_admin_email);
        tvQueueCount = findViewById(R.id.tv_admin_queue_count);
        btnMenu = findViewById(R.id.btn_admin_menu);
        btnCallLog = findViewById(R.id.btn_admin_call_log);
        btnNewBooking = findViewById(R.id.btn_admin_new_booking);
        rv = findViewById(R.id.rv_admin_rides);
        emptyState = findViewById(R.id.admin_empty_state);

        rv.setLayoutManager(new LinearLayoutManager(this));
        adapter = new AdminRideAdapter();
        rv.setAdapter(adapter);

        FirebaseUser u = FirebaseAuth.getInstance().getCurrentUser();
        if (u != null) {
            tvAdminEmail.setText(u.getEmail() != null ? u.getEmail() : (u.getPhoneNumber() != null ? u.getPhoneNumber() : "Admin"));
        }

        btnMenu.setOnClickListener(this::showMenu);
        btnCallLog.setOnClickListener(v -> startActivity(new Intent(this, CallLogActivity.class)));
        btnNewBooking.setOnClickListener(v -> showNewBookingDialog());

        connectFirebase();
    }

    private void connectFirebase() {
        try {
            db = FirebaseDatabase.getInstance(DB_INSTANCE_URL);
            // Server-side Filter: nur warteschlange — Patrick will primär unzugewiesene sehen
            openRidesQuery = db.getReference("rides").orderByChild("status").equalTo("warteschlange");
            openRidesListener = new ValueEventListener() {
                @Override public void onDataChange(@NonNull DataSnapshot s) { onOpenRides(s); }
                @Override public void onCancelled(@NonNull DatabaseError e) { Log.e(TAG, e.getMessage()); }
            };
            openRidesQuery.addValueEventListener(openRidesListener);
        } catch (Throwable t) {
            Log.e(TAG, "Firebase-Setup: " + t.getMessage());
            Toast.makeText(this, "Firebase-Fehler: " + t.getMessage(), Toast.LENGTH_LONG).show();
        }
    }

    private void onOpenRides(DataSnapshot s) {
        List<Ride> list = new ArrayList<>();
        for (DataSnapshot c : s.getChildren()) {
            Ride r = Ride.fromSnap(c);
            if (r != null) list.add(r);
        }
        list.sort(Comparator.comparingLong(r -> r.pickupTimestamp != null ? r.pickupTimestamp : Long.MAX_VALUE));
        adapter.set(list);
        tvQueueCount.setText(String.valueOf(list.size()));
        emptyState.setVisibility(list.isEmpty() ? View.VISIBLE : View.GONE);
        rv.setVisibility(list.isEmpty() ? View.GONE : View.VISIBLE);
    }

    private void showMenu(View anchor) {
        PopupMenu p = new PopupMenu(this, anchor);
        p.getMenu().add(0, 1, 0, "🚗 Zurück zu Fahrzeugauswahl");
        p.getMenu().add(0, 2, 0, "🚪 Logout");
        p.setOnMenuItemClickListener(item -> {
            if (item.getItemId() == 1) {
                getSharedPreferences("admin", MODE_PRIVATE).edit().putBoolean("isAdminMode", false).apply();
                startActivity(new Intent(this, VehiclePickerActivity.class));
                finish();
                return true;
            }
            if (item.getItemId() == 2) {
                getSharedPreferences("admin", MODE_PRIVATE).edit().putBoolean("isAdminMode", false).apply();
                try { FirebaseAuth.getInstance().signOut(); } catch (Throwable _t) {}
                getSharedPreferences("driver", MODE_PRIVATE).edit().clear().apply();
                startActivity(new Intent(this, LoginActivity.class));
                finish();
                return true;
            }
            return false;
        });
        p.show();
    }

    // Manuelle Buchung ohne Anrufer-Kontext
    private void showNewBookingDialog() {
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        int pad = (int) (getResources().getDisplayMetrics().density * 16);
        layout.setPadding(pad, pad, pad, pad);

        EditText etName = new EditText(this);
        etName.setHint("Kundenname");
        layout.addView(etName);

        EditText etPhone = new EditText(this);
        etPhone.setHint("Telefonnummer");
        etPhone.setInputType(InputType.TYPE_CLASS_PHONE);
        layout.addView(etPhone);

        EditText etPickup = new EditText(this);
        etPickup.setHint("Abholort");
        layout.addView(etPickup);

        EditText etDest = new EditText(this);
        etDest.setHint("Zielort");
        layout.addView(etDest);

        EditText etPax = new EditText(this);
        etPax.setHint("Personen (Default 1)");
        etPax.setInputType(InputType.TYPE_CLASS_NUMBER);
        layout.addView(etPax);

        Calendar cal = Calendar.getInstance();
        cal.add(Calendar.HOUR_OF_DAY, 1);
        long[] datetime = { cal.getTimeInMillis() };

        TextView tvDate = new TextView(this);
        tvDate.setText("📅 " + new SimpleDateFormat("EEE dd.MM.yyyy HH:mm", Locale.GERMANY).format(cal.getTime()));
        tvDate.setPadding(0, pad, 0, pad);
        tvDate.setOnClickListener(v -> {
            Calendar curr = Calendar.getInstance();
            curr.setTimeInMillis(datetime[0]);
            new DatePickerDialog(this, (dp, y, m, d) -> {
                new TimePickerDialog(this, (tp, h, mi) -> {
                    Calendar nc = Calendar.getInstance();
                    nc.set(y, m, d, h, mi, 0);
                    datetime[0] = nc.getTimeInMillis();
                    tvDate.setText("📅 " + new SimpleDateFormat("EEE dd.MM.yyyy HH:mm", Locale.GERMANY).format(nc.getTime()));
                }, curr.get(Calendar.HOUR_OF_DAY), curr.get(Calendar.MINUTE), true).show();
            }, curr.get(Calendar.YEAR), curr.get(Calendar.MONTH), curr.get(Calendar.DAY_OF_MONTH)).show();
        });
        layout.addView(tvDate);

        new AlertDialog.Builder(this)
            .setTitle("🚖 Neue Buchung (Admin)")
            .setView(layout)
            .setPositiveButton("Anlegen", (d, w) -> {
                String name = etName.getText().toString().trim();
                String phone = etPhone.getText().toString().trim();
                String pickup = etPickup.getText().toString().trim();
                String dest = etDest.getText().toString().trim();
                if (name.isEmpty() || pickup.isEmpty() || dest.isEmpty()) {
                    Toast.makeText(this, "Name + Abholort + Zielort Pflicht", Toast.LENGTH_LONG).show();
                    return;
                }
                int pax = 1;
                try { pax = Integer.parseInt(etPax.getText().toString().trim()); } catch (Throwable _t) {}
                DatabaseReference ref = FirebaseDatabase.getInstance(DB_INSTANCE_URL).getReference("rides").push();
                long now = System.currentTimeMillis();
                Map<String, Object> r = new HashMap<>();
                r.put("customerName", name);
                if (!phone.isEmpty()) {
                    r.put("customerPhone", phone);
                    r.put("customerMobile", phone);
                }
                r.put("pickup", pickup);
                r.put("destination", dest);
                r.put("pickupTimestamp", datetime[0]);
                r.put("pickupTime", new SimpleDateFormat("HH:mm", Locale.GERMANY).format(new java.util.Date(datetime[0])));
                // Nahe-Fahrt → warteschlange (sofort), sonst vorbestellt
                long deltaMin = (datetime[0] - now) / 60000L;
                r.put("status", deltaMin < 15 ? "warteschlange" : "vorbestellt");
                r.put("createdAt", now);
                r.put("updatedAt", now);
                r.put("source", "native_admin_manual");
                r.put("passengers", pax);
                ref.setValue(r).addOnSuccessListener(_v -> {
                    Toast.makeText(this, "✅ Buchung angelegt", Toast.LENGTH_SHORT).show();
                }).addOnFailureListener(ex -> Toast.makeText(this, "Fehler: " + ex.getMessage(), Toast.LENGTH_LONG).show());
            })
            .setNegativeButton("Abbrechen", null)
            .show();
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        if (openRidesQuery != null && openRidesListener != null) openRidesQuery.removeEventListener(openRidesListener);
    }

    static class Ride {
        String id, customerName, pickup, destination, pickupTime, status;
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
                Object t = s.child("pickupTimestamp").getValue();
                if (t instanceof Number) r.pickupTimestamp = ((Number) t).longValue();
                return r;
            } catch (Throwable _t) { return null; }
        }
    }

    class AdminRideAdapter extends RecyclerView.Adapter<AdminRideAdapter.VH> {
        private List<Ride> data = new ArrayList<>();
        void set(List<Ride> list) { data = list; notifyDataSetChanged(); }
        @NonNull @Override
        public VH onCreateViewHolder(@NonNull ViewGroup p, int t) {
            View v = LayoutInflater.from(p.getContext()).inflate(android.R.layout.simple_list_item_2, p, false);
            v.setBackgroundColor(Color.parseColor("#1E293B"));
            v.setPadding(24, 24, 24, 24);
            return new VH(v);
        }
        @Override public void onBindViewHolder(@NonNull VH h, int pos) { h.bind(data.get(pos)); }
        @Override public int getItemCount() { return data.size(); }
        class VH extends RecyclerView.ViewHolder {
            TextView t1, t2;
            VH(View v) {
                super(v);
                t1 = v.findViewById(android.R.id.text1);
                t2 = v.findViewById(android.R.id.text2);
                t1.setTextColor(Color.parseColor("#F8FAFC"));
                t2.setTextColor(Color.parseColor("#94A3B8"));
            }
            void bind(Ride r) {
                String when = r.pickupTime != null ? r.pickupTime : "—";
                t1.setText(when + "  " + (r.customerName != null ? r.customerName : "?"));
                t2.setText("📍 " + (r.pickup != null ? r.pickup : "?") + "  →  " + (r.destination != null ? r.destination : "?"));
            }
        }
    }
}
