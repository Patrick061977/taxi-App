package de.taxiheringsdorf.app;

import android.Manifest;
import android.app.AlertDialog;
import android.app.DatePickerDialog;
import android.app.TimePickerDialog;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.os.Bundle;
import android.provider.CallLog;
import android.text.InputType;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;
import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.RecyclerView;
import com.google.firebase.database.DataSnapshot;
import com.google.firebase.database.DatabaseError;
import com.google.firebase.database.DatabaseReference;
import com.google.firebase.database.FirebaseDatabase;
import com.google.firebase.database.ValueEventListener;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

// v6.49.0: Anrufliste mit CRM-Lookup. Pro Anruf:
// - MATCH (Name aus CRM): EINSTEIGER mit CRM-Adresse, Vorbestellung mit CRM-Daten, CRM editieren
// - KEIN MATCH: CRM-Anlegen, EINSTEIGER nur mit Nummer, Vorbestellung mit Tel
public class CallLogActivity extends AppCompatActivity {
    private static final int REQ_PERM = 9001;
    private static final String DB_INSTANCE_URL = "https://taxi-heringsdorf-default-rtdb.europe-west1.firebasedatabase.app";

    private RecyclerView rv;
    private ProgressBar progress;
    private TextView permHint;
    private CallAdapter adapter;
    private Map<String, CrmCustomer> crmByPhone = new HashMap<>();

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        setContentView(R.layout.activity_call_log);

        rv = findViewById(R.id.rv_calls);
        progress = findViewById(R.id.calls_progress);
        permHint = findViewById(R.id.permission_hint);
        rv.setLayoutManager(new LinearLayoutManager(this));
        adapter = new CallAdapter();
        rv.setAdapter(adapter);

        // CRM-Cache parallel laden
        loadCrmCache();

        if (ContextCompat.checkSelfPermission(this, Manifest.permission.READ_CALL_LOG) != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this, new String[]{Manifest.permission.READ_CALL_LOG, Manifest.permission.READ_CONTACTS}, REQ_PERM);
        } else {
            loadCalls();
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions, @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_PERM) {
            if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                permHint.setVisibility(View.GONE);
                loadCalls();
            } else {
                permHint.setVisibility(View.VISIBLE);
            }
        }
    }

    private void loadCrmCache() {
        FirebaseDatabase.getInstance(DB_INSTANCE_URL).getReference("customers")
            .addListenerForSingleValueEvent(new ValueEventListener() {
                @Override public void onDataChange(@NonNull DataSnapshot snap) {
                    crmByPhone.clear();
                    for (DataSnapshot c : snap.getChildren()) {
                        CrmCustomer cust = CrmCustomer.fromSnap(c);
                        if (cust == null) continue;
                        if (cust.phone != null) crmByPhone.put(normalizePhone(cust.phone), cust);
                        if (cust.mobilePhone != null) crmByPhone.put(normalizePhone(cust.mobilePhone), cust);
                    }
                    adapter.notifyDataSetChanged();
                }
                @Override public void onCancelled(@NonNull DatabaseError error) {}
            });
    }

    private static String normalizePhone(String p) {
        if (p == null) return "";
        return p.replaceAll("[^+0-9]", "");
    }

    private CrmCustomer lookupCrm(String phone) {
        return crmByPhone.get(normalizePhone(phone));
    }

    private void loadCalls() {
        progress.setVisibility(View.VISIBLE);
        new Thread(() -> {
            List<CallEntry> result = new ArrayList<>();
            try {
                String[] proj = {CallLog.Calls.NUMBER, CallLog.Calls.CACHED_NAME, CallLog.Calls.DATE, CallLog.Calls.TYPE, CallLog.Calls.DURATION};
                Cursor c = getContentResolver().query(CallLog.Calls.CONTENT_URI, proj, null, null, CallLog.Calls.DATE + " DESC LIMIT 50");
                if (c != null) {
                    while (c.moveToNext()) {
                        CallEntry e = new CallEntry();
                        e.number = c.getString(0);
                        e.name = c.getString(1);
                        e.date = c.getLong(2);
                        e.type = c.getInt(3);
                        e.durationSec = c.getLong(4);
                        if (e.number != null && !e.number.isEmpty()) result.add(e);
                    }
                    c.close();
                }
            } catch (Throwable t) {
                runOnUiThread(() -> Toast.makeText(this, "Anrufliste-Fehler: " + t.getMessage(), Toast.LENGTH_LONG).show());
            }
            runOnUiThread(() -> {
                progress.setVisibility(View.GONE);
                adapter.set(result);
                if (result.isEmpty()) Toast.makeText(this, "Keine Anrufe gefunden", Toast.LENGTH_SHORT).show();
            });
        }).start();
    }

    // v6.51.0: Admin-Modus — Patrick auf S9+ ohne Fahrzeug. EINSTEIGER macht keinen Sinn
    // (Admin sitzt nicht im Auto), nur Vorbestellung. Erkennung via SharedPref-Flag,
    // gesetzt von AdminDashboardActivity.
    private boolean isAdminMode() {
        return getSharedPreferences("admin", MODE_PRIVATE).getBoolean("isAdminMode", false);
    }

    private void showActionDialog(CallEntry e) {
        CrmCustomer crm = lookupCrm(e.number);
        boolean admin = isAdminMode();
        if (crm != null) {
            String[] options = admin
                ? new String[]{ "📅 Vorbestellung erstellen", "📋 CRM-Eintrag bearbeiten", "Abbrechen" }
                : new String[]{ "🚖 EINSTEIGER (mit CRM-Adresse als Pickup)", "📅 Vorbestellung erstellen", "📋 CRM-Eintrag bearbeiten", "Abbrechen" };
            new AlertDialog.Builder(this)
                .setTitle("📞 " + crm.name)
                .setMessage(e.number + (crm.address != null ? "\n📍 " + crm.address : ""))
                .setItems(options, (d, which) -> {
                    if (admin) {
                        switch (which) {
                            case 0: showPrebookingDialog(e, crm); break;
                            case 1: showCrmEditDialog(crm); break;
                        }
                    } else {
                        switch (which) {
                            case 0: createEinsteigerCrm(e, crm); break;
                            case 1: showPrebookingDialog(e, crm); break;
                            case 2: showCrmEditDialog(crm); break;
                        }
                    }
                }).show();
        } else {
            String[] options = admin
                ? new String[]{ "👤 Als CRM-Kunde anlegen", "📅 Vorbestellung erstellen", "Abbrechen" }
                : new String[]{ "👤 Als CRM-Kunde anlegen", "🚖 EINSTEIGER (nur mit Nummer)", "📅 Vorbestellung erstellen", "Abbrechen" };
            new AlertDialog.Builder(this)
                .setTitle("❓ " + e.number)
                .setMessage("Nummer nicht im CRM")
                .setItems(options, (d, which) -> {
                    if (admin) {
                        switch (which) {
                            case 0: showCrmCreateDialog(e); break;
                            case 1: showPrebookingDialog(e, null); break;
                        }
                    } else {
                        switch (which) {
                            case 0: showCrmCreateDialog(e); break;
                            case 1: createEinsteigerWithPhone(e); break;
                            case 2: showPrebookingDialog(e, null); break;
                        }
                    }
                }).show();
        }
    }

    private void createEinsteigerCrm(CallEntry e, CrmCustomer crm) {
        String vehicleId = getSharedPreferences("driver", MODE_PRIVATE).getString("vehicleId", null);
        if (vehicleId == null) { Toast.makeText(this, "Kein Fahrzeug ausgewählt", Toast.LENGTH_SHORT).show(); return; }
        // v6.49.1: Bestätigungs-Dialog VOR Anlage — Patrick hat zu schnellen Tap erlebt
        new AlertDialog.Builder(this)
            .setTitle("🚖 EINSTEIGER anlegen?")
            .setMessage("Kunde: " + crm.name + "\n📍 Pickup: " + (crm.address != null ? crm.address : "Standort Fahrer") + "\n📞 " + e.number + "\n\nFahrt wird sofort als 'abgeholt' eingetragen.")
            .setPositiveButton("✅ Ja, anlegen", (d, w) -> {
                DatabaseReference ref = FirebaseDatabase.getInstance(DB_INSTANCE_URL).getReference("rides").push();
                long now = System.currentTimeMillis();
                Map<String, Object> r = new HashMap<>();
                r.put("customerName", crm.name);
                r.put("customerId", crm.id);
                r.put("customerPhone", e.number);
                r.put("customerMobile", crm.mobilePhone != null ? crm.mobilePhone : e.number);
                r.put("vehicleId", vehicleId);
                r.put("status", "picked_up");
                r.put("pickup", crm.address != null ? crm.address : "Standort Fahrer");
                if (crm.lat != null) { r.put("pickupLat", crm.lat); r.put("pickupLon", crm.lon); }
                r.put("destination", "");
                r.put("pickupTimestamp", now);
                r.put("createdAt", now);
                r.put("updatedAt", now);
                r.put("acceptedAt", now);
                r.put("acceptedVia", "native_einsteiger_calllog_crm");
                r.put("source", "native_einsteiger_call_crm");
                r.put("isInsteiger", true);
                r.put("passengers", 1);
                ref.setValue(r).addOnSuccessListener(_v -> {
                    Toast.makeText(this, "✅ EINSTEIGER angelegt: " + crm.name, Toast.LENGTH_SHORT).show();
                    startActivity(new Intent(this, DriverDashboardActivity.class));
                    finish();
                }).addOnFailureListener(ex -> Toast.makeText(this, "Fehler: " + ex.getMessage(), Toast.LENGTH_LONG).show());
            })
            .setNegativeButton("Abbrechen", null).show();
    }

    private void createEinsteigerWithPhone(CallEntry e) {
        String vehicleId = getSharedPreferences("driver", MODE_PRIVATE).getString("vehicleId", null);
        if (vehicleId == null) { Toast.makeText(this, "Kein Fahrzeug ausgewählt", Toast.LENGTH_SHORT).show(); return; }
        // v6.49.1: Bestätigungs-Dialog VOR Anlage
        String label = e.name != null && !e.name.isEmpty() ? e.name : "Einsteiger";
        new AlertDialog.Builder(this)
            .setTitle("🚖 EINSTEIGER anlegen?")
            .setMessage("Kunde: " + label + "\n📞 " + e.number + "\n\nFahrt wird sofort als 'abgeholt' eingetragen (ohne CRM-Adresse).")
            .setPositiveButton("✅ Ja, anlegen", (d, w) -> {
                DatabaseReference ref = FirebaseDatabase.getInstance(DB_INSTANCE_URL).getReference("rides").push();
                long now = System.currentTimeMillis();
                Map<String, Object> r = new HashMap<>();
                r.put("customerName", label);
                r.put("customerPhone", e.number);
                r.put("customerMobile", e.number);
                r.put("vehicleId", vehicleId);
                r.put("status", "picked_up");
                r.put("pickup", "Standort Fahrer");
                r.put("destination", "");
                r.put("pickupTimestamp", now);
                r.put("createdAt", now);
                r.put("updatedAt", now);
                r.put("acceptedAt", now);
                r.put("acceptedVia", "native_einsteiger_calllog");
                r.put("source", "native_einsteiger_call");
                r.put("isInsteiger", true);
                r.put("passengers", 1);
                ref.setValue(r).addOnSuccessListener(_v -> {
                    Toast.makeText(this, "✅ EINSTEIGER angelegt mit " + e.number, Toast.LENGTH_SHORT).show();
                    startActivity(new Intent(this, DriverDashboardActivity.class));
                    finish();
                }).addOnFailureListener(ex -> Toast.makeText(this, "Fehler: " + ex.getMessage(), Toast.LENGTH_LONG).show());
            })
            .setNegativeButton("Abbrechen", null).show();
    }

    private void showCrmCreateDialog(CallEntry e) {
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        int pad = (int) (getResources().getDisplayMetrics().density * 16);
        layout.setPadding(pad, pad, pad, pad);

        EditText etName = new EditText(this);
        etName.setHint("Name (Pflicht)");
        if (e.name != null) etName.setText(e.name);
        layout.addView(etName);

        EditText etAddress = new EditText(this);
        etAddress.setHint("Adresse (optional)");
        layout.addView(etAddress);

        EditText etType = new EditText(this);
        etType.setHint("Typ (hotel/firma/privat — optional)");
        layout.addView(etType);

        new AlertDialog.Builder(this)
            .setTitle("👤 Neuer CRM-Kunde")
            .setMessage("Telefonnummer: " + e.number)
            .setView(layout)
            .setPositiveButton("Speichern", (d, w) -> {
                String name = etName.getText().toString().trim();
                if (name.isEmpty()) { Toast.makeText(this, "Name ist Pflicht", Toast.LENGTH_SHORT).show(); return; }
                DatabaseReference ref = FirebaseDatabase.getInstance(DB_INSTANCE_URL).getReference("customers").push();
                long now = System.currentTimeMillis();
                Map<String, Object> c = new HashMap<>();
                c.put("name", name);
                c.put("phone", e.number);
                c.put("mobilePhone", e.number);
                String addr = etAddress.getText().toString().trim();
                if (!addr.isEmpty()) c.put("address", addr);
                String type = etType.getText().toString().trim();
                if (!type.isEmpty()) c.put("customerKind", type);
                c.put("createdAt", now);
                c.put("createdVia", "native_calllog");
                ref.setValue(c).addOnSuccessListener(_v -> {
                    Toast.makeText(this, "✅ " + name + " als CRM-Kunde gespeichert", Toast.LENGTH_SHORT).show();
                    loadCrmCache(); // Cache aktualisieren
                }).addOnFailureListener(ex -> {
                    // v6.52.2: Patrick: 'CRM-übernehmen funktioniert nicht'. Silent-Fail beseitigt.
                    Toast.makeText(this, "❌ CRM-Speichern fehlgeschlagen: " + ex.getMessage(), Toast.LENGTH_LONG).show();
                });
            })
            .setNegativeButton("Abbrechen", null).show();
    }

    private void showCrmEditDialog(CrmCustomer crm) {
        Toast.makeText(this, "CRM-Edit: vorerst über Web-App", Toast.LENGTH_SHORT).show();
        // TODO später: vollständiges Edit-Modal mit allen Feldern
    }

    private void showPrebookingDialog(CallEntry e, CrmCustomer crm) {
        // v6.51.0: Im Admin-Modus kein Fahrzeug nötig — Buchung landet in Warteschlange,
        // Cloud-AutoAssign kümmert sich. Im Driver-Modus weiterhin Fahrzeug Pflicht.
        String vehicleId = getSharedPreferences("driver", MODE_PRIVATE).getString("vehicleId", null);
        if (vehicleId == null && !isAdminMode()) {
            Toast.makeText(this, "Kein Fahrzeug ausgewählt", Toast.LENGTH_SHORT).show();
            return;
        }

        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        int pad = (int) (getResources().getDisplayMetrics().density * 16);
        layout.setPadding(pad, pad, pad, pad);

        EditText etName = new EditText(this);
        etName.setHint("Kundenname");
        etName.setText(crm != null ? crm.name : (e.name != null ? e.name : ""));
        layout.addView(etName);

        EditText etPickup = new EditText(this);
        etPickup.setHint("Abholort");
        if (crm != null && crm.address != null) etPickup.setText(crm.address);
        layout.addView(etPickup);

        EditText etDest = new EditText(this);
        etDest.setHint("Zielort");
        layout.addView(etDest);

        EditText etPax = new EditText(this);
        etPax.setHint("Personen (Default 1)");
        etPax.setInputType(InputType.TYPE_CLASS_NUMBER);
        layout.addView(etPax);

        // Datum + Zeit Picker als Buttons
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
            .setTitle("📅 Vorbestellung anlegen")
            .setMessage("Telefonnummer: " + e.number)
            .setView(layout)
            .setPositiveButton("Anlegen", (d, w) -> {
                String name = etName.getText().toString().trim();
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
                if (crm != null) r.put("customerId", crm.id);
                r.put("customerPhone", e.number);
                r.put("customerMobile", e.number);
                r.put("pickup", pickup);
                r.put("destination", dest);
                if (crm != null && crm.lat != null) { r.put("pickupLat", crm.lat); r.put("pickupLon", crm.lon); }
                r.put("pickupTimestamp", datetime[0]);
                r.put("pickupTime", new SimpleDateFormat("HH:mm", Locale.GERMANY).format(new java.util.Date(datetime[0])));
                r.put("status", "vorbestellt");
                r.put("createdAt", now);
                r.put("updatedAt", now);
                r.put("source", "native_calllog_prebooking");
                r.put("passengers", pax);
                ref.setValue(r).addOnSuccessListener(_v -> {
                    Toast.makeText(this, "✅ Vorbestellung angelegt", Toast.LENGTH_SHORT).show();
                    finish();
                }).addOnFailureListener(ex -> Toast.makeText(this, "Fehler: " + ex.getMessage(), Toast.LENGTH_LONG).show());
            })
            .setNegativeButton("Abbrechen", null).show();
    }

    static class CrmCustomer {
        String id, name, phone, mobilePhone, address, customerKind;
        Double lat, lon;
        static CrmCustomer fromSnap(DataSnapshot s) {
            try {
                CrmCustomer c = new CrmCustomer();
                c.id = s.getKey();
                c.name = s.child("name").getValue(String.class);
                c.phone = s.child("phone").getValue(String.class);
                c.mobilePhone = s.child("mobilePhone").getValue(String.class);
                c.address = s.child("address").getValue(String.class);
                c.customerKind = s.child("customerKind").getValue(String.class);
                Object lat = s.child("addressLat").getValue();
                if (lat instanceof Number) c.lat = ((Number) lat).doubleValue();
                Object lon = s.child("addressLon").getValue();
                if (lon instanceof Number) c.lon = ((Number) lon).doubleValue();
                if (c.name == null) return null;
                return c;
            } catch (Throwable _t) { return null; }
        }
    }

    static class CallEntry {
        String number, name;
        long date;
        long durationSec;
        int type;
    }

    class CallAdapter extends RecyclerView.Adapter<CallAdapter.VH> {
        private List<CallEntry> data = new ArrayList<>();
        void set(List<CallEntry> e) { data = e; notifyDataSetChanged(); }
        @NonNull @Override
        public VH onCreateViewHolder(@NonNull ViewGroup p, int t) {
            return new VH(LayoutInflater.from(p.getContext()).inflate(R.layout.item_call_card, p, false));
        }
        @Override public void onBindViewHolder(@NonNull VH h, int pos) { h.bind(data.get(pos)); }
        @Override public int getItemCount() { return data.size(); }
        class VH extends RecyclerView.ViewHolder {
            TextView tvIcon, tvName, tvNumber, tvTime;
            VH(View v) {
                super(v);
                tvIcon = v.findViewById(R.id.tv_call_icon);
                tvName = v.findViewById(R.id.tv_call_name);
                tvNumber = v.findViewById(R.id.tv_call_number);
                tvTime = v.findViewById(R.id.tv_call_time);
            }
            void bind(CallEntry e) {
                String emoji;
                switch (e.type) {
                    case 1: emoji = "📥"; break;
                    case 2: emoji = "📤"; break;
                    case 3: emoji = "❌"; break;
                    default: emoji = "📞";
                }
                tvIcon.setText(emoji);

                // CRM-Lookup für Anzeige
                CrmCustomer crm = lookupCrm(e.number);
                if (crm != null) {
                    String typeIcon = "👤";
                    if ("hotel".equalsIgnoreCase(crm.customerKind)) typeIcon = "🏨";
                    else if ("firma".equalsIgnoreCase(crm.customerKind) || "supplier".equalsIgnoreCase(crm.customerKind)) typeIcon = "🏢";
                    tvName.setText(typeIcon + " " + crm.name);
                } else {
                    tvName.setText(e.name != null && !e.name.isEmpty() ? e.name : "❓ Unbekannt");
                }
                tvNumber.setText(e.number);

                long ageSec = (System.currentTimeMillis() - e.date) / 1000;
                String age;
                if (ageSec < 60) age = ageSec + "s";
                else if (ageSec < 3600) age = (ageSec / 60) + " Min";
                else if (ageSec < 86400) age = (ageSec / 3600) + " Std";
                else age = (ageSec / 86400) + " Tagen";
                tvTime.setText("vor " + age + (e.durationSec > 0 ? " · Dauer " + e.durationSec + "s" : ""));

                itemView.setOnClickListener(_v -> showActionDialog(e));
            }
        }
    }
}
