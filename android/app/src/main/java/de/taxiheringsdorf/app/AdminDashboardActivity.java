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
import android.widget.ScrollView;
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
import java.util.Arrays;
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
    // v6.62.153: Active-Statuses fuer Disposition-Liste (alle Fahrten die noch nicht abgeschlossen sind)
    private static final List<String> ACTIVE_STATUSES = Arrays.asList(
        "warteschlange", "vorbestellt", "new", "accepted", "on_way", "picked_up");

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
            // v6.62.153: Alle Fahrten ab letzten 24h ziehen, client-seitig nach
            // ACTIVE_STATUSES filtern. Vorher nur warteschlange.
            // 🔧 v6.62.161 FIX: Patrick: 'Disposition wie normaler Kalender, sortiert nach Tagen'.
            // Vorher createdAt-Filter (24h zurueck) — verlor Vorbestellungen die vor 3 Tagen
            // angelegt wurden fuer uebermorgen. Jetzt pickupTimestamp-Filter: 2h vor jetzt
            // bis +14 Tage, deckt aktive + alle naechste-Wochen-Vorbestellungen ab.
            long since = System.currentTimeMillis() - 2L * 60 * 60 * 1000;
            long until = System.currentTimeMillis() + 14L * 24 * 60 * 60 * 1000;
            openRidesQuery = db.getReference("rides").orderByChild("pickupTimestamp").startAt(since).endAt(until);
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
            // v6.62.153: client-seitiger Filter nach Active-Status (siehe ACTIVE_STATUSES)
            if (r != null && r.status != null && ACTIVE_STATUSES.contains(r.status)) list.add(r);
        }
        list.sort(Comparator.comparingLong(r -> r.pickupTimestamp != null ? r.pickupTimestamp : Long.MAX_VALUE));
        // v6.62.161: Tag-Header zwischen Fahrten einfuegen (HEUTE / MORGEN / Datum)
        // Patrick: 'Disposition wie normaler Kalender, sortiert nach Tagen'.
        List<Object> sectioned = new ArrayList<>();
        Calendar lastDay = null;
        Calendar today = Calendar.getInstance();
        today.set(Calendar.HOUR_OF_DAY, 0); today.set(Calendar.MINUTE, 0);
        today.set(Calendar.SECOND, 0); today.set(Calendar.MILLISECOND, 0);
        Calendar tomorrow = (Calendar) today.clone();
        tomorrow.add(Calendar.DAY_OF_MONTH, 1);
        for (Ride r : list) {
            if (r.pickupTimestamp == null) continue;
            Calendar c = Calendar.getInstance();
            c.setTimeInMillis(r.pickupTimestamp);
            if (lastDay == null || c.get(Calendar.YEAR) != lastDay.get(Calendar.YEAR)
                    || c.get(Calendar.DAY_OF_YEAR) != lastDay.get(Calendar.DAY_OF_YEAR)) {
                String header;
                if (sameDay(c, today)) header = "🟡 HEUTE — " + new SimpleDateFormat("EEE dd.MM.yyyy", Locale.GERMANY).format(c.getTime());
                else if (sameDay(c, tomorrow)) header = "🔵 MORGEN — " + new SimpleDateFormat("EEE dd.MM.yyyy", Locale.GERMANY).format(c.getTime());
                else header = "📅 " + new SimpleDateFormat("EEEE dd.MM.yyyy", Locale.GERMANY).format(c.getTime());
                sectioned.add(header);
                lastDay = c;
            }
            sectioned.add(r);
        }
        adapter.set(sectioned);
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
        // v6.62.153: Wenn Patrick von Driver-Hamburger-'Disposition' kam, Admin-Mode wieder
        // ausschalten — sonst denkt CallLogActivity nach Rueckkehr es laeuft Admin-Modus.
        // Nur ausschalten wenn Driver-Vehicle gesetzt ist (= wir kamen aus Driver-Mode).
        try {
            String vehicleId = getSharedPreferences("driver", MODE_PRIVATE).getString("vehicleId", null);
            if (vehicleId != null) {
                getSharedPreferences("admin", MODE_PRIVATE).edit().putBoolean("isAdminMode", false).apply();
            }
        } catch (Throwable _t) {}
    }

    static class Ride {
        String id, customerName, customerPhone, pickup, destination, pickupTime, status;
        Long pickupTimestamp;
        Integer passengers;

        static Ride fromSnap(DataSnapshot s) {
            try {
                Ride r = new Ride();
                r.id = s.getKey();
                r.customerName = s.child("customerName").getValue(String.class);
                r.customerPhone = s.child("customerPhone").getValue(String.class);
                r.pickup = s.child("pickup").getValue(String.class);
                r.destination = s.child("destination").getValue(String.class);
                r.pickupTime = s.child("pickupTime").getValue(String.class);
                r.status = s.child("status").getValue(String.class);
                Object t = s.child("pickupTimestamp").getValue();
                if (t instanceof Number) r.pickupTimestamp = ((Number) t).longValue();
                Object p = s.child("passengers").getValue();
                if (p instanceof Number) r.passengers = ((Number) p).intValue();
                return r;
            } catch (Throwable _t) { return null; }
        }
    }

    class AdminRideAdapter extends RecyclerView.Adapter<RecyclerView.ViewHolder> {
        private List<Object> data = new ArrayList<>();
        private static final int TYPE_HEADER = 0;
        private static final int TYPE_RIDE = 1;
        void set(List<Object> list) { data = list; notifyDataSetChanged(); }
        @Override public int getItemViewType(int pos) {
            return data.get(pos) instanceof String ? TYPE_HEADER : TYPE_RIDE;
        }
        @NonNull @Override
        public RecyclerView.ViewHolder onCreateViewHolder(@NonNull ViewGroup p, int t) {
            if (t == TYPE_HEADER) {
                TextView v = new TextView(p.getContext());
                v.setBackgroundColor(Color.parseColor("#0F172A"));
                v.setPadding(28, 22, 28, 22);
                v.setTextSize(15);
                v.setTextColor(Color.parseColor("#FBBF24"));
                v.setLayoutParams(new RecyclerView.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
                return new HeaderVH(v);
            }
            View v = LayoutInflater.from(p.getContext()).inflate(android.R.layout.simple_list_item_2, p, false);
            v.setBackgroundColor(Color.parseColor("#1E293B"));
            v.setPadding(24, 24, 24, 24);
            return new RideVH(v);
        }
        @Override public void onBindViewHolder(@NonNull RecyclerView.ViewHolder h, int pos) {
            Object item = data.get(pos);
            if (h instanceof HeaderVH && item instanceof String) ((HeaderVH) h).bind((String) item);
            else if (h instanceof RideVH && item instanceof Ride) ((RideVH) h).bind((Ride) item);
        }
        @Override public int getItemCount() { return data.size(); }

        class HeaderVH extends RecyclerView.ViewHolder {
            TextView tv;
            HeaderVH(View v) { super(v); tv = (TextView) v; }
            void bind(String header) { tv.setText(header); }
        }

        class RideVH extends RecyclerView.ViewHolder {
            TextView t1, t2;
            RideVH(View v) {
                super(v);
                t1 = v.findViewById(android.R.id.text1);
                t2 = v.findViewById(android.R.id.text2);
                t1.setTextColor(Color.parseColor("#F8FAFC"));
                t2.setTextColor(Color.parseColor("#94A3B8"));
            }
            void bind(Ride r) {
                String when = r.pickupTime != null ? r.pickupTime : "—";
                String statusBadge = r.status != null ? "  [" + statusEmoji(r.status) + " " + r.status + "]" : "";
                t1.setText(when + "  " + (r.customerName != null ? r.customerName : "?") + statusBadge);
                t2.setText("📍 " + (r.pickup != null ? r.pickup : "?") + "  →  " + (r.destination != null ? r.destination : "?"));
                // v6.62.153: Tap → Edit-Dialog (Patrick: 'will Fahrten bearbeiten aus der App')
                itemView.setOnClickListener(_v -> showEditRideDialog(r));
            }
        }
    }

    // v6.62.161: Helper fuer Tag-Vergleich
    private static boolean sameDay(Calendar a, Calendar b) {
        return a != null && b != null
            && a.get(Calendar.YEAR) == b.get(Calendar.YEAR)
            && a.get(Calendar.DAY_OF_YEAR) == b.get(Calendar.DAY_OF_YEAR);
    }

    // v6.62.153: Status-Emoji für visuelle Schnell-Erkennung in der Liste
    private static String statusEmoji(String status) {
        switch (status) {
            case "warteschlange": return "⏳";
            case "vorbestellt":   return "📅";
            case "new":           return "🆕";
            case "accepted":      return "✅";
            case "on_way":        return "🚗";
            case "picked_up":     return "🧍";
            default:              return "❓";
        }
    }

    // v6.62.153: Edit-Dialog für eine bestehende Fahrt — bearbeitbare Felder:
    // Name, Phone, Pickup, Destination, Datum/Zeit, Personenzahl, Status. Plus Stornieren-Button.
    private void showEditRideDialog(final Ride r) {
        if (r == null || r.id == null) return;
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        int pad = (int) (getResources().getDisplayMetrics().density * 16);
        int padHalf = pad / 2;
        layout.setPadding(pad, pad, pad, pad);

        EditText etName = new EditText(this);
        etName.setHint("Kundenname");
        etName.setText(r.customerName != null ? r.customerName : "");
        layout.addView(etName);

        EditText etPhone = new EditText(this);
        etPhone.setHint("Telefonnummer");
        etPhone.setInputType(InputType.TYPE_CLASS_PHONE);
        etPhone.setText(r.customerPhone != null ? r.customerPhone : "");
        layout.addView(etPhone);

        EditText etPickup = new EditText(this);
        etPickup.setHint("Abholort");
        etPickup.setText(r.pickup != null ? r.pickup : "");
        layout.addView(etPickup);

        EditText etDest = new EditText(this);
        etDest.setHint("Zielort");
        etDest.setText(r.destination != null ? r.destination : "");
        layout.addView(etDest);

        // Datum + Zeit
        final long[] dateTime = { r.pickupTimestamp != null ? r.pickupTimestamp : System.currentTimeMillis() };
        Calendar cal = Calendar.getInstance();
        cal.setTimeInMillis(dateTime[0]);
        TextView tvDate = new TextView(this);
        tvDate.setText("📅 " + new SimpleDateFormat("EEE dd.MM.yyyy HH:mm", Locale.GERMANY).format(cal.getTime()));
        tvDate.setPadding(0, pad, 0, pad);
        tvDate.setOnClickListener(v -> {
            Calendar curr = Calendar.getInstance();
            curr.setTimeInMillis(dateTime[0]);
            new DatePickerDialog(this, (dp, y, m, d) ->
                new TimePickerDialog(this, (tp, h, mi) -> {
                    Calendar nc = Calendar.getInstance();
                    nc.set(y, m, d, h, mi, 0);
                    dateTime[0] = nc.getTimeInMillis();
                    tvDate.setText("📅 " + new SimpleDateFormat("EEE dd.MM.yyyy HH:mm", Locale.GERMANY).format(nc.getTime()));
                }, curr.get(Calendar.HOUR_OF_DAY), curr.get(Calendar.MINUTE), true).show(),
                curr.get(Calendar.YEAR), curr.get(Calendar.MONTH), curr.get(Calendar.DAY_OF_MONTH)).show();
        });
        layout.addView(tvDate);

        // Personenzahl-Spinner 1-8
        TextView tvPaxLabel = new TextView(this);
        tvPaxLabel.setText("👥 Personen:");
        tvPaxLabel.setTextSize(13);
        tvPaxLabel.setPadding(0, pad, 0, padHalf);
        layout.addView(tvPaxLabel);
        final android.widget.Spinner spnPax = new android.widget.Spinner(this);
        android.widget.ArrayAdapter<String> paxAdapter = new android.widget.ArrayAdapter<>(
            this, android.R.layout.simple_spinner_item,
            new String[]{"1 Person", "2 Personen", "3 Personen", "4 Personen",
                         "5 Personen (Bus)", "6 Personen (Bus)", "7 Personen (Bus)", "8 Personen (Bus)"});
        paxAdapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        spnPax.setAdapter(paxAdapter);
        int paxSel = (r.passengers != null && r.passengers >= 1 && r.passengers <= 8) ? r.passengers - 1 : 0;
        spnPax.setSelection(paxSel);
        layout.addView(spnPax);

        // Status-Spinner
        TextView tvStatusLabel = new TextView(this);
        tvStatusLabel.setText("📊 Status:");
        tvStatusLabel.setTextSize(13);
        tvStatusLabel.setPadding(0, pad, 0, padHalf);
        layout.addView(tvStatusLabel);
        final android.widget.Spinner spnStatus = new android.widget.Spinner(this);
        final String[] statusVals = {"warteschlange", "vorbestellt", "new", "accepted", "on_way", "picked_up", "completed", "cancelled"};
        android.widget.ArrayAdapter<String> statAdapter = new android.widget.ArrayAdapter<>(
            this, android.R.layout.simple_spinner_item, statusVals);
        statAdapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        spnStatus.setAdapter(statAdapter);
        int statSel = 0;
        for (int i = 0; i < statusVals.length; i++) if (statusVals[i].equals(r.status)) { statSel = i; break; }
        spnStatus.setSelection(statSel);
        layout.addView(spnStatus);

        ScrollView sv = new ScrollView(this);
        sv.addView(layout);

        new AlertDialog.Builder(this)
            .setTitle("✏️ Fahrt bearbeiten")
            .setMessage("ID: " + r.id)
            .setView(sv)
            .setPositiveButton("💾 Speichern", (d, w) -> {
                Map<String, Object> upd = new HashMap<>();
                upd.put("customerName", etName.getText().toString().trim());
                upd.put("customerPhone", etPhone.getText().toString().trim());
                upd.put("pickup", etPickup.getText().toString().trim());
                upd.put("destination", etDest.getText().toString().trim());
                upd.put("pickupTimestamp", dateTime[0]);
                upd.put("pickupTime", new SimpleDateFormat("HH:mm", Locale.GERMANY).format(new java.util.Date(dateTime[0])));
                upd.put("passengers", spnPax.getSelectedItemPosition() + 1);
                upd.put("status", statusVals[spnStatus.getSelectedItemPosition()]);
                upd.put("updatedAt", System.currentTimeMillis());
                upd.put("updatedBy", "native_admin_dispo_edit");
                FirebaseDatabase.getInstance(DB_INSTANCE_URL).getReference("rides/" + r.id)
                    .updateChildren(upd)
                    .addOnSuccessListener(_v -> Toast.makeText(this, "✅ Fahrt aktualisiert", Toast.LENGTH_SHORT).show())
                    .addOnFailureListener(ex -> Toast.makeText(this, "Fehler: " + ex.getMessage(), Toast.LENGTH_LONG).show());
            })
            // 🆕 v6.62.191: Stornieren-Button war unter "Abbrechen" platziert — Patrick hat
            // versehentlich gedrueckt und Vetter-Touristik 11:20-Tour war weg. Jetzt mit
            // Bestaetigungs-Dialog davor: "Wirklich stornieren?" Yes/No.
            .setNeutralButton("🚫 Stornieren", (d, w) -> {
                String confirmMsg = "Diese Fahrt wirklich stornieren?\n\n" +
                    (r.customerName != null ? "👤 " + r.customerName + "\n" : "") +
                    (r.pickupTime != null ? "🕒 " + r.pickupTime + "\n" : "") +
                    (r.pickup != null ? "📍 " + r.pickup + "\n" : "");
                new AlertDialog.Builder(AdminDashboardActivity.this)
                    .setTitle("⚠️ Stornieren bestaetigen")
                    .setMessage(confirmMsg)
                    .setPositiveButton("🚫 Ja, stornieren", (d2, w2) -> {
                        Map<String, Object> upd = new HashMap<>();
                        upd.put("status", "cancelled");
                        upd.put("cancelledAt", System.currentTimeMillis());
                        upd.put("cancelledBy", "native_admin_dispo");
                        upd.put("updatedAt", System.currentTimeMillis());
                        FirebaseDatabase.getInstance(DB_INSTANCE_URL).getReference("rides/" + r.id)
                            .updateChildren(upd)
                            .addOnSuccessListener(_v -> Toast.makeText(this, "🚫 Fahrt storniert", Toast.LENGTH_SHORT).show())
                            .addOnFailureListener(ex -> Toast.makeText(this, "Fehler: " + ex.getMessage(), Toast.LENGTH_LONG).show());
                    })
                    .setNegativeButton("Nein, behalten", null)
                    .show();
            })
            .setNegativeButton("Abbrechen", null)
            .show();
    }
}
