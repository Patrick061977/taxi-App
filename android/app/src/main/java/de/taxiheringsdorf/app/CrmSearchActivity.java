package de.taxiheringsdorf.app;

import android.app.AlertDialog;
import android.content.Intent;
import android.os.Bundle;
import android.text.Editable;
import android.text.InputType;
import android.text.TextWatcher;
import android.util.Log;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.RecyclerView;
import com.google.android.gms.common.api.Status;
import com.google.android.libraries.places.api.Places;
import com.google.android.libraries.places.api.model.Place;
import com.google.android.libraries.places.widget.Autocomplete;
import com.google.android.libraries.places.widget.AutocompleteActivity;
import com.google.android.libraries.places.widget.model.AutocompleteActivityMode;
import com.google.android.material.button.MaterialButton;
import com.google.android.material.textfield.TextInputEditText;
import com.google.firebase.database.DataSnapshot;
import com.google.firebase.database.DatabaseError;
import com.google.firebase.database.FirebaseDatabase;
import com.google.firebase.database.ValueEventListener;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

// v6.57.0: CRM-Suche-Activity — Patrick: 'CRM nach und nach in der Native-App'.
// Direkter Zugriff auf alle Kunden ohne Anrufliste-Umweg. Tap → Edit-Modal.
public class CrmSearchActivity extends AppCompatActivity {
    private static final String TAG = "CrmSearch";
    private static final String DB_INSTANCE_URL = "https://taxi-heringsdorf-default-rtdb.europe-west1.firebasedatabase.app";

    private TextInputEditText etQuery;
    private TextView tvCount;
    private RecyclerView rv;
    private CrmAdapter adapter;
    private final List<CrmEntry> all = new ArrayList<>();
    private final List<CrmEntry> filtered = new ArrayList<>();

    // Places-Autocomplete für Edit-Modal
    private TextView pendingPlaceField;
    private double[] pendingPlaceCoords;
    private final ActivityResultLauncher<Intent> placesLauncher = registerForActivityResult(
        new ActivityResultContracts.StartActivityForResult(),
        result -> {
            int rc = result.getResultCode();
            Intent data = result.getData();
            if (rc == AutocompleteActivity.RESULT_ERROR && data != null) {
                Status status = Autocomplete.getStatusFromIntent(data);
                String msg = status != null ? (status.getStatusCode() + ": " + status.getStatusMessage()) : "?";
                Toast.makeText(this, "❌ Places: " + msg, Toast.LENGTH_LONG).show();
                return;
            }
            if (rc != RESULT_OK || data == null) return;
            try {
                Place p = Autocomplete.getPlaceFromIntent(data);
                String label = p.getName() != null ? p.getName() : p.getAddress();
                if (p.getAddress() != null && !p.getAddress().equals(p.getName())) {
                    label = p.getName() + " — " + p.getAddress();
                }
                if (pendingPlaceField != null) pendingPlaceField.setText(label);
                if (pendingPlaceCoords != null && p.getLatLng() != null) {
                    pendingPlaceCoords[0] = p.getLatLng().latitude;
                    pendingPlaceCoords[1] = p.getLatLng().longitude;
                }
            } catch (Throwable t) {
                Toast.makeText(this, "Places-Parse: " + t.getMessage(), Toast.LENGTH_LONG).show();
            }
        }
    );

    private void launchPlaces(TextView field, double[] coordsOut) {
        try {
            if (!Places.isInitialized()) {
                Places.initializeWithNewPlacesApiEnabled(getApplicationContext(), "AIzaSyCEL-wtoIrVm0-PXpILLabGQXfuFaA17lg");
            }
            pendingPlaceField = field;
            pendingPlaceCoords = coordsOut;
            List<Place.Field> fields = Arrays.asList(
                Place.Field.ID, Place.Field.NAME, Place.Field.ADDRESS, Place.Field.LAT_LNG
            );
            Intent intent = new Autocomplete.IntentBuilder(AutocompleteActivityMode.OVERLAY, fields)
                .setCountries(Arrays.asList("DE"))
                .build(this);
            placesLauncher.launch(intent);
        } catch (Throwable t) {
            Toast.makeText(this, "Places-Init: " + t.getMessage(), Toast.LENGTH_LONG).show();
        }
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        setContentView(R.layout.activity_crm_search);

        findViewById(R.id.btn_crm_back).setOnClickListener(v -> finish());
        etQuery = findViewById(R.id.et_crm_query);
        tvCount = findViewById(R.id.tv_crm_count);
        rv = findViewById(R.id.rv_crm);
        rv.setLayoutManager(new LinearLayoutManager(this));
        adapter = new CrmAdapter();
        rv.setAdapter(adapter);

        etQuery.addTextChangedListener(new TextWatcher() {
            @Override public void beforeTextChanged(CharSequence s, int a, int b, int c) {}
            @Override public void onTextChanged(CharSequence s, int a, int b, int c) { applyFilter(s.toString()); }
            @Override public void afterTextChanged(Editable s) {}
        });

        loadAll();
    }

    private void loadAll() {
        tvCount.setText("Lade…");
        FirebaseDatabase.getInstance(DB_INSTANCE_URL).getReference("customers")
            .addListenerForSingleValueEvent(new ValueEventListener() {
                @Override public void onDataChange(@NonNull DataSnapshot s) {
                    all.clear();
                    for (DataSnapshot c : s.getChildren()) {
                        CrmEntry e = CrmEntry.fromSnap(c);
                        if (e != null) all.add(e);
                    }
                    all.sort((a, b) -> (a.name != null ? a.name : "").compareToIgnoreCase(b.name != null ? b.name : ""));
                    applyFilter(etQuery.getText() != null ? etQuery.getText().toString() : "");
                }
                @Override public void onCancelled(@NonNull DatabaseError error) {
                    tvCount.setText("Fehler: " + error.getMessage());
                }
            });
    }

    private void applyFilter(String q) {
        filtered.clear();
        String qLow = q.trim().toLowerCase(Locale.GERMANY);
        if (qLow.isEmpty()) {
            filtered.addAll(all.subList(0, Math.min(all.size(), 50)));
        } else {
            for (CrmEntry e : all) {
                String n = (e.name != null ? e.name : "").toLowerCase(Locale.GERMANY);
                String p = ((e.phone != null ? e.phone : "") + (e.mobilePhone != null ? e.mobilePhone : "")).toLowerCase();
                if (n.contains(qLow) || p.contains(qLow)) filtered.add(e);
                if (filtered.size() >= 100) break;
            }
        }
        tvCount.setText(filtered.size() + " von " + all.size() + " Kunden");
        adapter.notifyDataSetChanged();
    }

    private void openEditDialog(CrmEntry e) {
        ScrollView scroll = new ScrollView(this);
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        int pad = (int) (getResources().getDisplayMetrics().density * 16);
        layout.setPadding(pad, pad, pad, pad);
        scroll.addView(layout);

        EditText etName = new EditText(this);
        etName.setHint("Name (Pflicht)");
        etName.setText(e.name != null ? e.name : "");
        layout.addView(etName);

        EditText etPhone = new EditText(this);
        etPhone.setHint("Telefon");
        etPhone.setInputType(InputType.TYPE_CLASS_PHONE);
        etPhone.setText(e.phone != null ? e.phone : "");
        layout.addView(etPhone);

        EditText etMobile = new EditText(this);
        etMobile.setHint("Mobil");
        etMobile.setInputType(InputType.TYPE_CLASS_PHONE);
        etMobile.setText(e.mobilePhone != null ? e.mobilePhone : "");
        layout.addView(etMobile);

        EditText etEmail = new EditText(this);
        etEmail.setHint("Email");
        etEmail.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS);
        etEmail.setText(e.email != null ? e.email : "");
        layout.addView(etEmail);

        final double[] addrCoords = {
            e.lat != null ? e.lat : Double.NaN,
            e.lon != null ? e.lon : Double.NaN
        };
        TextView tvAddr = new TextView(this);
        tvAddr.setText(e.address != null && !e.address.isEmpty() ? "📍 " + e.address : "📍 Adresse wählen…");
        tvAddr.setPadding(pad / 2, pad, pad / 2, pad);
        tvAddr.setOnClickListener(_v -> launchPlaces(tvAddr, addrCoords));
        layout.addView(tvAddr);

        final String[] kinds = { "Stammkunde", "Gelegenheit", "Hotel", "Firma" };
        final int[] kindIdx = { Math.max(0, Arrays.asList(kinds).indexOf(e.customerKind != null ? e.customerKind : "Stammkunde")) };
        TextView tvKind = new TextView(this);
        tvKind.setText("👥 " + kinds[kindIdx[0]] + " (tippen zum Wechseln)");
        tvKind.setPadding(pad / 2, pad, pad / 2, pad);
        tvKind.setOnClickListener(_v -> {
            kindIdx[0] = (kindIdx[0] + 1) % kinds.length;
            tvKind.setText("👥 " + kinds[kindIdx[0]] + " (tippen zum Wechseln)");
        });
        layout.addView(tvKind);

        new AlertDialog.Builder(this)
            .setTitle("📋 " + (e.name != null ? e.name : "?") + " bearbeiten")
            .setView(scroll)
            .setPositiveButton("Speichern", (d, w) -> {
                String name = etName.getText().toString().trim();
                if (name.isEmpty()) { Toast.makeText(this, "Name Pflicht", Toast.LENGTH_SHORT).show(); return; }
                Map<String, Object> upd = new HashMap<>();
                upd.put("name", name);
                String phone = etPhone.getText().toString().trim();
                String mobile = etMobile.getText().toString().trim();
                String email = etEmail.getText().toString().trim();
                if (!phone.isEmpty()) upd.put("phone", phone);
                if (!mobile.isEmpty()) upd.put("mobilePhone", mobile);
                if (!email.isEmpty()) upd.put("email", email);
                String addr = tvAddr.getText().toString().replaceFirst("^📍 ", "").trim();
                if (!addr.isEmpty() && !addr.endsWith("wählen…")) {
                    upd.put("address", addr);
                    if (!Double.isNaN(addrCoords[0])) {
                        upd.put("addressLat", addrCoords[0]);
                        upd.put("addressLon", addrCoords[1]);
                    }
                }
                upd.put("customerKind", kinds[kindIdx[0]]);
                upd.put("updatedAt", System.currentTimeMillis());
                upd.put("updatedVia", "native_crm_search");
                FirebaseDatabase.getInstance(DB_INSTANCE_URL).getReference("customers/" + e.id)
                    .updateChildren(upd)
                    .addOnSuccessListener(_v -> {
                        Toast.makeText(this, "✅ " + name + " gespeichert", Toast.LENGTH_SHORT).show();
                        loadAll();
                    })
                    .addOnFailureListener(ex ->
                        Toast.makeText(this, "❌ " + ex.getMessage(), Toast.LENGTH_LONG).show());
            })
            .setNegativeButton("Abbrechen", null)
            .show();
    }

    static class CrmEntry {
        String id, name, phone, mobilePhone, email, address, customerKind;
        Double lat, lon;
        static CrmEntry fromSnap(DataSnapshot s) {
            try {
                CrmEntry e = new CrmEntry();
                e.id = s.getKey();
                e.name = s.child("name").getValue(String.class);
                e.phone = s.child("phone").getValue(String.class);
                e.mobilePhone = s.child("mobilePhone").getValue(String.class);
                e.email = s.child("email").getValue(String.class);
                e.address = s.child("address").getValue(String.class);
                e.customerKind = s.child("customerKind").getValue(String.class);
                Object lat = s.child("addressLat").getValue();
                if (lat instanceof Number) e.lat = ((Number) lat).doubleValue();
                Object lon = s.child("addressLon").getValue();
                if (lon instanceof Number) e.lon = ((Number) lon).doubleValue();
                return e;
            } catch (Throwable _t) { return null; }
        }
    }

    class CrmAdapter extends RecyclerView.Adapter<CrmAdapter.VH> {
        @NonNull @Override
        public VH onCreateViewHolder(@NonNull ViewGroup p, int t) {
            View v = LayoutInflater.from(p.getContext()).inflate(android.R.layout.simple_list_item_2, p, false);
            v.setBackgroundColor(0xFF1E293B);
            v.setPadding(24, 24, 24, 24);
            return new VH(v);
        }
        @Override public void onBindViewHolder(@NonNull VH h, int pos) { h.bind(filtered.get(pos)); }
        @Override public int getItemCount() { return filtered.size(); }
        class VH extends RecyclerView.ViewHolder {
            TextView t1, t2;
            VH(View v) {
                super(v);
                t1 = v.findViewById(android.R.id.text1);
                t2 = v.findViewById(android.R.id.text2);
                t1.setTextColor(0xFFF8FAFC);
                t2.setTextColor(0xFF94A3B8);
            }
            void bind(CrmEntry e) {
                t1.setText(e.name != null ? e.name : "?");
                String sub = "";
                if (e.phone != null) sub += "📞 " + e.phone;
                if (e.mobilePhone != null && !e.mobilePhone.equals(e.phone)) sub += "  📱 " + e.mobilePhone;
                if (e.address != null && !e.address.isEmpty()) sub += (sub.isEmpty() ? "" : "\n") + "📍 " + e.address;
                t2.setText(sub.isEmpty() ? "—" : sub);
                itemView.setOnClickListener(_v -> openEditDialog(e));
            }
        }
    }
}
