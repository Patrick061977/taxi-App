// v6.63.916 (Patrick 20.08.2026 04:52 'Ich möchte meine Kollegen aus der native app anrufen'):
// Kollegen-Anruf-Liste. Kombiniert:
//   1) Aktive Fahrer aus /vehicles.shift (userId → /users/{uid}/phoneNumber)
//   2) Extras aus /settings/quickCallContacts [{name, phone, role}]
// Tap auf 📞 → Android ACTION_DIAL öffnet Dialer mit vorbereiteter Nummer.
// „+ Kontakt"-Button oben öffnet Dialog zum Anlegen (Name + Nummer + Rolle).
package de.taxiheringsdorf.app;

import android.app.AlertDialog;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.text.InputType;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.RecyclerView;

import com.google.android.material.button.MaterialButton;
import com.google.firebase.database.DataSnapshot;
import com.google.firebase.database.DatabaseError;
import com.google.firebase.database.DatabaseReference;
import com.google.firebase.database.FirebaseDatabase;
import com.google.firebase.database.ValueEventListener;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

public class ColleagueCallActivity extends AppCompatActivity {
    private DatabaseReference db;
    private RecyclerView rv;
    private LinearLayout empty;
    private ColleagueAdapter adapter;
    private ValueEventListener vehiclesListener, usersListener, quickListener;
    private Map<String, String> userPhoneByUid = new HashMap<>();
    private Map<String, String> userNameByUid = new HashMap<>();
    private List<VehicleDriver> vehicleDrivers = new ArrayList<>();
    private List<QuickContact> quickContacts = new ArrayList<>();

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_colleague_call);
        db = FirebaseDatabase.getInstance("https://taxi-heringsdorf-default-rtdb.europe-west1.firebasedatabase.app").getReference();
        rv = findViewById(R.id.rv_colleagues);
        empty = findViewById(R.id.empty_state);
        findViewById(R.id.btn_back).setOnClickListener(v -> finish());
        findViewById(R.id.btn_add_contact).setOnClickListener(v -> showAddContactDialog());
        rv.setLayoutManager(new LinearLayoutManager(this));
        adapter = new ColleagueAdapter();
        rv.setAdapter(adapter);
        attach();
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        if (vehiclesListener != null) db.child("vehicles").removeEventListener(vehiclesListener);
        if (usersListener != null) db.child("users").removeEventListener(usersListener);
        if (quickListener != null) db.child("settings/quickCallContacts").removeEventListener(quickListener);
    }

    private void attach() {
        usersListener = new ValueEventListener() {
            @Override public void onDataChange(@NonNull DataSnapshot snap) {
                userPhoneByUid.clear();
                userNameByUid.clear();
                for (DataSnapshot u : snap.getChildren()) {
                    String ph = u.child("phoneNumber").getValue(String.class);
                    if (ph == null) ph = u.child("phone").getValue(String.class);
                    if (ph == null) ph = u.child("mobilePhone").getValue(String.class);
                    String nm = u.child("displayName").getValue(String.class);
                    if (nm == null) nm = u.child("name").getValue(String.class);
                    if (nm == null) nm = u.child("driverName").getValue(String.class);
                    if (u.getKey() != null && ph != null && !ph.isEmpty()) userPhoneByUid.put(u.getKey(), ph);
                    if (u.getKey() != null && nm != null) userNameByUid.put(u.getKey(), nm);
                }
                rebuild();
            }
            @Override public void onCancelled(@NonNull DatabaseError err) { }
        };
        db.child("users").addValueEventListener(usersListener);

        vehiclesListener = new ValueEventListener() {
            @Override public void onDataChange(@NonNull DataSnapshot snap) {
                vehicleDrivers.clear();
                for (DataSnapshot v : snap.getChildren()) {
                    DataSnapshot sh = v.child("shift");
                    String status = sh.child("status").getValue(String.class);
                    if (!"active".equals(status)) continue;
                    String driverName = sh.child("driverName").getValue(String.class);
                    String userId = sh.child("userId").getValue(String.class);
                    String vName = v.child("name").getValue(String.class);
                    String plate = v.child("plate").getValue(String.class);
                    VehicleDriver vd = new VehicleDriver();
                    vd.driverName = driverName != null ? driverName : (userId != null && userNameByUid.get(userId) != null ? userNameByUid.get(userId) : "Fahrer");
                    vd.vehicleName = vName;
                    vd.plate = plate;
                    vd.userId = userId;
                    vehicleDrivers.add(vd);
                }
                rebuild();
            }
            @Override public void onCancelled(@NonNull DatabaseError err) { }
        };
        db.child("vehicles").addValueEventListener(vehiclesListener);

        quickListener = new ValueEventListener() {
            @Override public void onDataChange(@NonNull DataSnapshot snap) {
                quickContacts.clear();
                for (DataSnapshot c : snap.getChildren()) {
                    QuickContact q = new QuickContact();
                    q.id = c.getKey();
                    q.name = c.child("name").getValue(String.class);
                    q.phone = c.child("phone").getValue(String.class);
                    q.role = c.child("role").getValue(String.class);
                    if (q.name != null && q.phone != null) quickContacts.add(q);
                }
                rebuild();
            }
            @Override public void onCancelled(@NonNull DatabaseError err) { }
        };
        db.child("settings/quickCallContacts").addValueEventListener(quickListener);
    }

    private void rebuild() {
        List<Row> rows = new ArrayList<>();
        Set<String> phonesShown = new HashSet<>();
        // 1) Aktive Fahrer zuerst (mit Vehicle-Info)
        for (VehicleDriver vd : vehicleDrivers) {
            String phone = vd.userId != null ? userPhoneByUid.get(vd.userId) : null;
            Row r = new Row();
            r.name = vd.driverName;
            r.meta = (vd.vehicleName != null ? vd.vehicleName : "") + (vd.plate != null ? " · " + vd.plate : "");
            r.phone = phone;
            r.online = true;
            rows.add(r);
            if (phone != null) phonesShown.add(phone);
        }
        // 2) Quick-Kontakte (nicht duplizieren wenn Telefon schon dabei)
        for (QuickContact q : quickContacts) {
            if (q.phone != null && phonesShown.contains(q.phone)) continue;
            Row r = new Row();
            r.name = q.name;
            r.meta = q.role;
            r.phone = q.phone;
            r.online = false;
            r.quickId = q.id;
            rows.add(r);
        }
        Collections.sort(rows, (a, b) -> {
            if (a.online != b.online) return a.online ? -1 : 1;
            String an = a.name != null ? a.name : "";
            String bn = b.name != null ? b.name : "";
            return an.compareToIgnoreCase(bn);
        });
        adapter.set(rows);
        empty.setVisibility(rows.isEmpty() ? View.VISIBLE : View.GONE);
    }

    private void showAddContactDialog() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        int pad = (int)(getResources().getDisplayMetrics().density * 20);
        root.setPadding(pad, pad, pad, 0);
        EditText etName = new EditText(this);
        etName.setHint("Name");
        etName.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_WORDS);
        EditText etPhone = new EditText(this);
        etPhone.setHint("+49...");
        etPhone.setInputType(InputType.TYPE_CLASS_PHONE);
        EditText etRole = new EditText(this);
        etRole.setHint("Rolle (z.B. Anwalt, ECOVIS)");
        etRole.setInputType(InputType.TYPE_CLASS_TEXT);
        root.addView(etName);
        root.addView(etPhone);
        root.addView(etRole);
        new AlertDialog.Builder(this)
            .setTitle("+ Kontakt hinzufügen")
            .setView(root)
            .setPositiveButton("Speichern", (d, w) -> {
                String n = etName.getText().toString().trim();
                String p = etPhone.getText().toString().trim();
                String r = etRole.getText().toString().trim();
                if (n.isEmpty() || p.isEmpty()) {
                    Toast.makeText(this, "Name und Nummer sind Pflicht", Toast.LENGTH_SHORT).show();
                    return;
                }
                Map<String, Object> u = new HashMap<>();
                u.put("name", n);
                u.put("phone", p);
                if (!r.isEmpty()) u.put("role", r);
                u.put("createdAt", System.currentTimeMillis());
                db.child("settings/quickCallContacts").push().setValue(u);
            })
            .setNegativeButton("Abbrechen", null)
            .show();
    }

    private void call(String phone) {
        if (phone == null || phone.isEmpty()) {
            Toast.makeText(this, "Keine Nummer hinterlegt", Toast.LENGTH_SHORT).show();
            return;
        }
        try {
            Intent i = new Intent(Intent.ACTION_DIAL);
            i.setData(Uri.parse("tel:" + phone));
            startActivity(i);
        } catch (Exception e) {
            Toast.makeText(this, "Fehler: " + e.getMessage(), Toast.LENGTH_LONG).show();
        }
    }

    private void deleteQuick(String id) {
        if (id == null) return;
        db.child("settings/quickCallContacts/" + id).removeValue();
    }

    static class VehicleDriver {
        String driverName, vehicleName, plate, userId;
    }

    static class QuickContact {
        String id, name, phone, role;
    }

    static class Row {
        String name, meta, phone, quickId;
        boolean online;
    }

    class ColleagueAdapter extends RecyclerView.Adapter<ColleagueAdapter.VH> {
        List<Row> data = new ArrayList<>();
        void set(List<Row> list) { data = list; notifyDataSetChanged(); }

        @NonNull @Override
        public VH onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
            View v = LayoutInflater.from(parent.getContext()).inflate(R.layout.item_colleague_row, parent, false);
            return new VH(v);
        }

        @Override public void onBindViewHolder(@NonNull VH h, int pos) { h.bind(data.get(pos)); }
        @Override public int getItemCount() { return data.size(); }

        class VH extends RecyclerView.ViewHolder {
            TextView tvName, tvMeta, tvPhone, tvOnline;
            MaterialButton btnCall;
            VH(View v) {
                super(v);
                tvName = v.findViewById(R.id.tv_name);
                tvMeta = v.findViewById(R.id.tv_meta);
                tvPhone = v.findViewById(R.id.tv_phone);
                tvOnline = v.findViewById(R.id.tv_online_badge);
                btnCall = v.findViewById(R.id.btn_call);
            }
            void bind(Row r) {
                tvName.setText(r.name != null ? r.name : "?");
                tvMeta.setText(r.meta != null ? r.meta : "");
                tvMeta.setVisibility(r.meta != null && !r.meta.isEmpty() ? View.VISIBLE : View.GONE);
                tvPhone.setText(r.phone != null ? r.phone : "keine Nummer");
                tvOnline.setVisibility(r.online ? View.VISIBLE : View.GONE);
                btnCall.setEnabled(r.phone != null && !r.phone.isEmpty());
                btnCall.setOnClickListener(v -> call(r.phone));
                // Long-Press auf Quick-Kontakt = löschen
                if (r.quickId != null) {
                    itemView.setOnLongClickListener(v -> {
                        new AlertDialog.Builder(ColleagueCallActivity.this)
                            .setTitle("Kontakt löschen?")
                            .setMessage(r.name + " (" + r.phone + ") wirklich entfernen?")
                            .setPositiveButton("Löschen", (d, w) -> deleteQuick(r.quickId))
                            .setNegativeButton("Abbrechen", null)
                            .show();
                        return true;
                    });
                } else {
                    itemView.setOnLongClickListener(null);
                }
            }
        }
    }
}
