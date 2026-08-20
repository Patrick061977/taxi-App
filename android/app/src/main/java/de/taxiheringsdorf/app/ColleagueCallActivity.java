// v6.63.916 (Patrick 20.08.2026 04:52 'Ich möchte meine Kollegen aus der native app anrufen'):
// Kollegen-Anruf-Liste. Kombiniert:
//   1) Aktive Fahrer aus /vehicles.shift (userId → /users/{uid}/phoneNumber)
//   2) Extras aus /settings/quickCallContacts [{name, phone, role}]
// Tap auf 📞 → Android ACTION_DIAL öffnet Dialer mit vorbereiteter Nummer.
// „+ Kontakt"-Button oben öffnet Dialog zum Anlegen (Name + Nummer + Rolle).
package de.taxiheringsdorf.app;

import android.app.AlertDialog;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.provider.ContactsContract;
import android.text.InputType;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
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

    // v6.63.918: Contact-Picker (ACTION_PICK) — braucht KEINE READ_CONTACTS-Permission
    // weil Android das Picking in der Contacts-App macht und uns nur die URI zurückgibt.
    private ActivityResultLauncher<Intent> contactPicker;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_colleague_call);
        db = FirebaseDatabase.getInstance("https://taxi-heringsdorf-default-rtdb.europe-west1.firebasedatabase.app").getReference();
        rv = findViewById(R.id.rv_colleagues);
        empty = findViewById(R.id.empty_state);
        findViewById(R.id.btn_back).setOnClickListener(v -> finish());
        findViewById(R.id.btn_add_contact).setOnClickListener(v -> showAddContactDialog(null, null));

        // v6.63.918: ActivityResultLauncher für Kontakt-Picker registrieren (VOR btn_import onClick).
        contactPicker = registerForActivityResult(
            new ActivityResultContracts.StartActivityForResult(),
            result -> {
                if (result == null || result.getResultCode() != RESULT_OK) return;
                Intent data = result.getData();
                if (data == null || data.getData() == null) return;
                handlePickedContact(data.getData());
            }
        );
        findViewById(R.id.btn_import_contact).setOnClickListener(v -> {
            try {
                Intent pick = new Intent(Intent.ACTION_PICK, ContactsContract.CommonDataKinds.Phone.CONTENT_URI);
                contactPicker.launch(pick);
            } catch (Exception e) {
                Toast.makeText(this, "Telefonbuch nicht erreichbar: " + e.getMessage(), Toast.LENGTH_LONG).show();
            }
        });

        rv.setLayoutManager(new LinearLayoutManager(this));
        adapter = new ColleagueAdapter();
        rv.setAdapter(adapter);
        attach();
    }

    // v6.63.918: Aus dem gepickten Kontakt Name + Nummer lesen und Speichern-Dialog öffnen.
    // Der User kann Name/Rolle noch anpassen bevor gespeichert wird (falls Doppel-Nachname etc.).
    private void handlePickedContact(Uri contactUri) {
        String name = null;
        String phone = null;
        try (Cursor c = getContentResolver().query(contactUri,
                new String[]{
                    ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME,
                    ContactsContract.CommonDataKinds.Phone.NUMBER
                }, null, null, null)) {
            if (c != null && c.moveToFirst()) {
                name = c.getString(0);
                phone = c.getString(1);
            }
        } catch (Exception e) {
            Toast.makeText(this, "Kontakt konnte nicht gelesen werden: " + e.getMessage(), Toast.LENGTH_LONG).show();
            return;
        }
        if (name == null && phone == null) {
            Toast.makeText(this, "Kontakt hat weder Name noch Nummer", Toast.LENGTH_SHORT).show();
            return;
        }
        // Nummer säubern (Leerzeichen/Bindestriche raus; behalte + am Anfang)
        if (phone != null) phone = phone.replaceAll("[^+0-9]", "");
        showAddContactDialog(name, phone);
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
                    q.linkedUserId = c.child("linkedUserId").getValue(String.class);
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
        Set<String> linkedUidsUsed = new HashSet<>();
        // 1) Aktive Fahrer zuerst (mit Vehicle-Info).
        //    Nummer-Priorität: /users/{uid}/phoneNumber -> quickCallContacts.linkedUserId
        for (VehicleDriver vd : vehicleDrivers) {
            String phone = vd.userId != null ? userPhoneByUid.get(vd.userId) : null;
            String quickIdForLinked = null;
            if (phone == null && vd.userId != null) {
                for (QuickContact q : quickContacts) {
                    if (vd.userId.equals(q.linkedUserId)) {
                        phone = q.phone;
                        quickIdForLinked = q.id;
                        linkedUidsUsed.add(vd.userId);
                        break;
                    }
                }
            }
            Row r = new Row();
            r.name = vd.driverName;
            r.meta = (vd.vehicleName != null ? vd.vehicleName : "") + (vd.plate != null ? " · " + vd.plate : "");
            r.phone = phone;
            r.online = true;
            r.userId = vd.userId;
            // Wenn die Nummer aus quickCallContacts kam, die quickId anhängen — sonst
            // greift Long-Press bei "Nummer entfernen" nicht (weil /users ist read-only).
            r.quickId = quickIdForLinked;
            rows.add(r);
            if (phone != null) phonesShown.add(phone);
        }
        // 2) Quick-Kontakte (nicht duplizieren wenn Telefon oder linkedUserId schon dabei)
        for (QuickContact q : quickContacts) {
            if (q.phone != null && phonesShown.contains(q.phone)) continue;
            if (q.linkedUserId != null && linkedUidsUsed.contains(q.linkedUserId)) continue;
            Row r = new Row();
            r.name = q.name;
            r.meta = q.role;
            r.phone = q.phone;
            r.online = false;
            r.quickId = q.id;
            r.role = q.role;
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

    // v6.63.918: Zweiter Signatur — pre-filled Name+Phone bei Telefonbuch-Import.
    private void showAddContactDialog(String prefillName, String prefillPhone) {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        int pad = (int)(getResources().getDisplayMetrics().density * 20);
        root.setPadding(pad, pad, pad, 0);
        EditText etName = new EditText(this);
        etName.setHint("Name");
        etName.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_WORDS);
        if (prefillName != null) etName.setText(prefillName);
        EditText etPhone = new EditText(this);
        etPhone.setHint("+49...");
        etPhone.setInputType(InputType.TYPE_CLASS_PHONE);
        if (prefillPhone != null) etPhone.setText(prefillPhone);
        EditText etRole = new EditText(this);
        etRole.setHint("Rolle (z.B. Anwalt, ECOVIS)");
        etRole.setInputType(InputType.TYPE_CLASS_TEXT);
        root.addView(etName);
        root.addView(etPhone);
        root.addView(etRole);
        new AlertDialog.Builder(this)
            .setTitle(prefillName != null ? "Kontakt aus Telefonbuch übernehmen" : "+ Kontakt hinzufügen")
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

    // v6.63.921: Quick-Kontakt bearbeiten — schreibt zurück auf denselben Key.
    private void showEditQuickDialog(Row r) {
        if (r == null || r.quickId == null) return;
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        int pad = (int)(getResources().getDisplayMetrics().density * 20);
        root.setPadding(pad, pad, pad, 0);
        EditText etName = new EditText(this);
        etName.setHint("Name");
        etName.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_WORDS);
        if (r.name != null) etName.setText(r.name);
        EditText etPhone = new EditText(this);
        etPhone.setHint("+49...");
        etPhone.setInputType(InputType.TYPE_CLASS_PHONE);
        if (r.phone != null) etPhone.setText(r.phone);
        EditText etRole = new EditText(this);
        etRole.setHint("Rolle (z.B. Anwalt, ECOVIS)");
        etRole.setInputType(InputType.TYPE_CLASS_TEXT);
        if (r.role != null) etRole.setText(r.role);
        root.addView(etName);
        root.addView(etPhone);
        root.addView(etRole);
        new AlertDialog.Builder(this)
            .setTitle("✏️ Kontakt bearbeiten")
            .setView(root)
            .setPositiveButton("Speichern", (d, w) -> {
                String n = etName.getText().toString().trim();
                String p = etPhone.getText().toString().trim();
                String ro = etRole.getText().toString().trim();
                if (n.isEmpty() || p.isEmpty()) {
                    Toast.makeText(this, "Name und Nummer sind Pflicht", Toast.LENGTH_SHORT).show();
                    return;
                }
                Map<String, Object> u = new HashMap<>();
                u.put("name", n);
                u.put("phone", p);
                u.put("role", ro.isEmpty() ? null : ro);
                u.put("updatedAt", System.currentTimeMillis());
                db.child("settings/quickCallContacts/" + r.quickId).updateChildren(u)
                    .addOnSuccessListener(v -> Toast.makeText(this, "Gespeichert", Toast.LENGTH_SHORT).show())
                    .addOnFailureListener(err -> Toast.makeText(this, "Fehler: " + err.getMessage(), Toast.LENGTH_LONG).show());
            })
            .setNegativeButton("Abbrechen", null)
            .show();
    }

    // v6.63.921: Fahrer-Nummer bearbeiten.
    // 🐛 v6.63.922 (Patrick 20.08.2026 07:53): /users/{uid} ist per Firebase-Rule
    //    read/write NUR für den Fahrer selbst (auth.uid === $uid). Patrick's
    //    Admin-Login darf NICHT rein → Permission-Denied bei Speichern/Löschen.
    // Fix: Fahrer-Nummer wird in /settings/quickCallContacts mit linkedUserId=<uid>
    //    gespeichert. Rebuild verknüpft Fahrer + Quick-Kontakt automatisch.
    //    Wenn schon ein Quick-Kontakt für diesen Fahrer existiert (r.quickId gesetzt),
    //    wird er aktualisiert. Sonst push().
    private void showEditUserPhoneDialog(Row r) {
        if (r == null || r.userId == null) return;
        EditText etPhone = new EditText(this);
        etPhone.setHint("+49...");
        etPhone.setInputType(InputType.TYPE_CLASS_PHONE);
        if (r.phone != null) etPhone.setText(r.phone);
        etPhone.setSelectAllOnFocus(true);
        int pad = (int)(getResources().getDisplayMetrics().density * 20);
        LinearLayout root = new LinearLayout(this);
        root.setPadding(pad, pad, pad, 0);
        root.addView(etPhone);
        AlertDialog.Builder b = new AlertDialog.Builder(this)
            .setTitle("📞 Nummer von " + (r.name != null ? r.name : "Fahrer"))
            .setView(root)
            .setPositiveButton("Speichern", (d, w) -> {
                String p = etPhone.getText().toString().trim();
                if (p.isEmpty()) {
                    Toast.makeText(this, "Nummer darf nicht leer sein — nutze Entfernen", Toast.LENGTH_LONG).show();
                    return;
                }
                Map<String, Object> u = new HashMap<>();
                u.put("name", r.name != null ? r.name : "Fahrer");
                u.put("phone", p);
                u.put("role", "Fahrer");
                u.put("linkedUserId", r.userId);
                u.put("updatedAt", System.currentTimeMillis());
                if (r.quickId != null) {
                    // Update existierender Quick-Kontakt
                    db.child("settings/quickCallContacts/" + r.quickId).updateChildren(u)
                        .addOnSuccessListener(v -> Toast.makeText(this, "Gespeichert", Toast.LENGTH_SHORT).show())
                        .addOnFailureListener(err -> Toast.makeText(this, "Fehler: " + err.getMessage(), Toast.LENGTH_LONG).show());
                } else {
                    // Neuer Quick-Kontakt
                    u.put("createdAt", System.currentTimeMillis());
                    db.child("settings/quickCallContacts").push().setValue(u)
                        .addOnSuccessListener(v -> Toast.makeText(this, "Gespeichert", Toast.LENGTH_SHORT).show())
                        .addOnFailureListener(err -> Toast.makeText(this, "Fehler: " + err.getMessage(), Toast.LENGTH_LONG).show());
                }
            })
            .setNegativeButton("Abbrechen", null);
        // Entfernen-Button nur wenn eine Nummer via quickContacts hinterlegt ist
        // (die aus /users kann Admin nicht löschen — steht im Message-Text erklärt).
        if (r.quickId != null) {
            b.setNeutralButton("🗑 Nummer entfernen", (d, w) ->
                db.child("settings/quickCallContacts/" + r.quickId).removeValue()
                    .addOnSuccessListener(v -> Toast.makeText(this, "Nummer entfernt", Toast.LENGTH_SHORT).show())
                    .addOnFailureListener(err -> Toast.makeText(this, "Fehler: " + err.getMessage(), Toast.LENGTH_LONG).show())
            );
        } else if (r.phone != null) {
            // Fahrer-Nummer kommt aus /users — Admin kann sie NICHT löschen, nur überschreiben mit Quick-Kontakt
            b.setMessage("Diese Nummer kommt aus dem Fahrer-Profil (/users) und kann nur vom Fahrer selbst entfernt werden. Du kannst sie hier aber überschreiben — dann gilt deine Version.");
        }
        b.show();
    }

    static class VehicleDriver {
        String driverName, vehicleName, plate, userId;
    }

    static class QuickContact {
        String id, name, phone, role, linkedUserId;
    }

    static class Row {
        String name, meta, phone, quickId, role;
        String userId; // nur für aktive Fahrer aus /users
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
                // v6.63.921 (Patrick 20.08.): Long-Press-Menu — Bearbeiten/Löschen für Quick-Kontakte,
                //   Bearbeiten für aktive Fahrer (schreibt in /users/{uid}/phoneNumber).
                itemView.setOnLongClickListener(v -> {
                    if (r.quickId != null) {
                        // Quick-Kontakt: Bearbeiten oder Löschen
                        new AlertDialog.Builder(ColleagueCallActivity.this)
                            .setTitle(r.name != null ? r.name : "Kontakt")
                            .setItems(new CharSequence[]{"✏️ Bearbeiten", "🗑 Löschen"}, (d, w) -> {
                                if (w == 0) showEditQuickDialog(r);
                                else if (w == 1) {
                                    new AlertDialog.Builder(ColleagueCallActivity.this)
                                        .setTitle("Kontakt löschen?")
                                        .setMessage(r.name + " (" + r.phone + ") wirklich entfernen?")
                                        .setPositiveButton("Löschen", (d2, w2) -> deleteQuick(r.quickId))
                                        .setNegativeButton("Abbrechen", null)
                                        .show();
                                }
                            })
                            .show();
                        return true;
                    } else if (r.userId != null) {
                        // Aktiver Fahrer: nur Nummer editieren (in /users/{uid}/phoneNumber)
                        showEditUserPhoneDialog(r);
                        return true;
                    }
                    return false;
                });
            }
        }
    }
}
