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
                // v6.62.91: SDK 4.x APIs — getName→getDisplayName, getAddress→getFormattedAddress, getLatLng→getLocation
                String _name = p.getDisplayName();
                String _addr = p.getFormattedAddress();
                String label;
                if (_name == null || _name.isEmpty()) {
                    label = _addr != null ? _addr : "";
                } else if (_addr == null || _addr.isEmpty() || _addr.equals(_name)) {
                    label = _name;
                } else if (_addr.startsWith(_name)) {
                    label = _addr;
                } else {
                    label = _name + ", " + _addr;
                }
                if (pendingPlaceField != null) pendingPlaceField.setText(label);
                if (pendingPlaceCoords != null && p.getLocation() != null) {
                    pendingPlaceCoords[0] = p.getLocation().latitude;
                    pendingPlaceCoords[1] = p.getLocation().longitude;
                }
                // v6.62.79: Wenn Adresse keine Hausnummer enthaelt → Reverse-Geocode via Nominatim
                // Patrick: 'Hotel Villa Neptun ohne Hausnummer'. Places liefert oft nur POI-Name +
                // Stadt, ohne Strasse/HN. Nominatim-Reverse auf Lat/Lon ergaenzt das.
                final TextView _field = pendingPlaceField;
                final String _label = label;
                final boolean _needsHN = _label != null && !_label.matches(".*\\d+\\s*[a-zA-Z]?[,\\s].*") && !_label.matches(".*\\d+\\s*[a-zA-Z]?$");
                if (_needsHN && p.getLocation() != null) {
                    final double _lat = p.getLocation().latitude;
                    final double _lon = p.getLocation().longitude;
                    new Thread(() -> {
                        try {
                            String url = "https://nominatim.openstreetmap.org/reverse?format=json&zoom=18&addressdetails=1&lat=" + _lat + "&lon=" + _lon;
                            java.net.HttpURLConnection conn = (java.net.HttpURLConnection) new java.net.URL(url).openConnection();
                            conn.setRequestProperty("User-Agent", "FunkTaxiHeringsdorf-NativeApp");
                            conn.setConnectTimeout(5000);
                            conn.setReadTimeout(5000);
                            if (conn.getResponseCode() != 200) { conn.disconnect(); return; }
                            java.io.BufferedReader br = new java.io.BufferedReader(new java.io.InputStreamReader(conn.getInputStream()));
                            StringBuilder sb = new StringBuilder();
                            String line; while ((line = br.readLine()) != null) sb.append(line);
                            br.close(); conn.disconnect();
                            org.json.JSONObject json = new org.json.JSONObject(sb.toString());
                            org.json.JSONObject addr = json.optJSONObject("address");
                            if (addr == null) return;
                            String hn = addr.optString("house_number", "");
                            String road = addr.optString("road", "");
                            if (road.isEmpty() || hn.isEmpty()) return; // nichts zu erweitern
                            String enriched = _label;
                            // Falls 'road' im Label fehlt → vor Stadt einsetzen
                            if (!_label.toLowerCase().contains(road.toLowerCase())) {
                                // Format: 'Name, Stadt' → 'Name, Strasse HN, Stadt'
                                int komma = _label.lastIndexOf(',');
                                if (komma > 0) {
                                    enriched = _label.substring(0, komma) + ", " + road + " " + hn + _label.substring(komma);
                                } else {
                                    enriched = _label + ", " + road + " " + hn;
                                }
                            } else {
                                // road ist da aber HN fehlt → HN nach road einfuegen
                                enriched = _label.replaceFirst("(?i)" + java.util.regex.Pattern.quote(road), road + " " + hn);
                            }
                            final String _enrichedFinal = enriched;
                            runOnUiThread(() -> {
                                if (_field != null) _field.setText(_enrichedFinal);
                            });
                        } catch (Throwable _e) { Log.w(TAG, "Hausnummer-Reverse fehlgeschlagen: " + _e.getMessage()); }
                    }, "hn-reverse").start();
                }
            } catch (Throwable t) {
                Toast.makeText(this, "Places-Parse: " + t.getMessage(), Toast.LENGTH_LONG).show();
            }
        }
    );

    // v6.62.220: ActivityResultLauncher fuer den OSM-Map-Picker.
    private final androidx.activity.result.ActivityResultLauncher<Intent> mapPickerLauncher =
        registerForActivityResult(new androidx.activity.result.contract.ActivityResultContracts.StartActivityForResult(),
            result -> {
                if (result.getResultCode() != RESULT_OK || result.getData() == null) return;
                Intent d = result.getData();
                String addr = d.getStringExtra(MapPickerActivity.EXTRA_RESULT_ADDR);
                double lat = d.getDoubleExtra(MapPickerActivity.EXTRA_RESULT_LAT, Double.NaN);
                double lon = d.getDoubleExtra(MapPickerActivity.EXTRA_RESULT_LON, Double.NaN);
                if (pendingPlaceField != null && addr != null) pendingPlaceField.setText(addr);
                if (pendingPlaceCoords != null && !Double.isNaN(lat) && !Double.isNaN(lon)) {
                    pendingPlaceCoords[0] = lat;
                    pendingPlaceCoords[1] = lon;
                }
            });

    private void launchPlaces(TextView field, double[] coordsOut) {
        // v6.62.220: OSM-Map-Picker statt Places-SDK (9011) oder Manual-Dialog.
        // Patrick: "Stecknadel-Picker einbauen". Tap auf Karte → Reverse-Geocode.
        pendingPlaceField = field;
        pendingPlaceCoords = coordsOut;
        Intent i = new Intent(this, MapPickerActivity.class);
        if (field != null) {
            String pre = field.getText() != null ? field.getText().toString() : "";
            pre = pre.replaceFirst("^📍\\s*", "").replaceFirst("^🎯\\s*", "").trim();
            if (!pre.isEmpty() && !pre.endsWith("wählen…")) {
                i.putExtra(MapPickerActivity.EXTRA_INITIAL_QUERY, pre);
            }
        }
        mapPickerLauncher.launch(i);
    }

    // v6.62.219: Manual-Adress-Dialog mit Nominatim-Geocode, parallel zu
    // CallLogActivity.showManualAddressDialog/geocodeWithNominatim.
    private void showManualAddressDialog() {
        final EditText input = new EditText(this);
        input.setHint("z.B. Strandpromenade 12, 17424 Heringsdorf");
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_WORDS);
        new AlertDialog.Builder(this)
            .setTitle("📍 Adresse eingeben")
            .setMessage("Tippe die Adresse moeglichst vollstaendig (Strasse, Nr, PLZ, Ort).\nWir suchen sie ueber OpenStreetMap.")
            .setView(input)
            .setPositiveButton("Suchen", (d, w) -> {
                String q = input.getText().toString().trim();
                if (q.isEmpty()) return;
                geocodeWithNominatim(q);
            })
            .setNegativeButton("Abbrechen", null)
            .show();
    }

    private void geocodeWithNominatim(final String query) {
        Toast.makeText(this, "🔍 Suche: " + query, Toast.LENGTH_SHORT).show();
        new Thread(() -> {
            try {
                String urlStr = "https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=de&addressdetails=1&q="
                    + java.net.URLEncoder.encode(query, "UTF-8");
                java.net.HttpURLConnection conn = (java.net.HttpURLConnection) new java.net.URL(urlStr).openConnection();
                conn.setRequestProperty("User-Agent", "TaxiHeringsdorf/6.62.219 (admin@funk-taxi-heringsdorf.de)");
                conn.setConnectTimeout(8000); conn.setReadTimeout(8000);
                java.io.BufferedReader br = new java.io.BufferedReader(new java.io.InputStreamReader(conn.getInputStream(), "UTF-8"));
                StringBuilder sb = new StringBuilder();
                String line; while ((line = br.readLine()) != null) sb.append(line);
                br.close(); conn.disconnect();
                String json = sb.toString();
                int latIdx = json.indexOf("\"lat\":\"");
                int lonIdx = json.indexOf("\"lon\":\"");
                if (latIdx < 0 || lonIdx < 0) {
                    runOnUiThread(() -> Toast.makeText(this, "❌ Adresse nicht gefunden — bitte detaillierter eingeben", Toast.LENGTH_LONG).show());
                    return;
                }
                latIdx += 7; lonIdx += 7;
                final double lat = Double.parseDouble(json.substring(latIdx, json.indexOf("\"", latIdx)));
                final double lon = Double.parseDouble(json.substring(lonIdx, json.indexOf("\"", lonIdx)));
                int dispIdx = json.indexOf("\"display_name\":\"");
                final String displayRaw = (dispIdx < 0) ? query : json.substring(dispIdx + 16, json.indexOf("\"", dispIdx + 16));
                final String display = displayRaw.replace("\\u00fc","ü").replace("\\u00f6","ö").replace("\\u00e4","ä")
                    .replace("\\u00df","ß").replace("\\u00dc","Ü").replace("\\u00d6","Ö").replace("\\u00c4","Ä")
                    .replace("\\/","/");
                runOnUiThread(() -> {
                    if (pendingPlaceField != null) pendingPlaceField.setText(display);
                    if (pendingPlaceCoords != null) {
                        pendingPlaceCoords[0] = lat;
                        pendingPlaceCoords[1] = lon;
                    }
                    Toast.makeText(this, "✅ Gefunden via OpenStreetMap", Toast.LENGTH_SHORT).show();
                });
            } catch (Throwable t) {
                runOnUiThread(() -> Toast.makeText(this, "❌ Geocode-Fehler: " + t.getMessage(), Toast.LENGTH_LONG).show());
            }
        }).start();
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

    // v6.62.90: Geocoding-Helper. Wenn CRM keine Coords hat, vor dem Speichern via
    // Nominatim Lat/Lon holen + dann callback ausfuehren. Async, im Background-Thread.
    private interface GeocodeCallback {
        void onResult(Double lat, Double lon);
    }

    private void geocodeAddressIfNeeded(CrmEntry e, GeocodeCallback cb) {
        if (e == null || e.address == null || e.address.isEmpty()) { cb.onResult(null, null); return; }
        if (e.lat != null && e.lon != null) { cb.onResult(e.lat, e.lon); return; }
        new Thread(() -> {
            try {
                String url = "https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=de&q=" + java.net.URLEncoder.encode(e.address, "UTF-8");
                java.net.HttpURLConnection conn = (java.net.HttpURLConnection) new java.net.URL(url).openConnection();
                conn.setRequestProperty("User-Agent", "FunkTaxiHeringsdorf-NativeApp");
                conn.setConnectTimeout(5000); conn.setReadTimeout(5000);
                if (conn.getResponseCode() != 200) { conn.disconnect(); runOnUiThread(() -> cb.onResult(null, null)); return; }
                java.io.BufferedReader br = new java.io.BufferedReader(new java.io.InputStreamReader(conn.getInputStream()));
                StringBuilder sb = new StringBuilder(); String line;
                while ((line = br.readLine()) != null) sb.append(line);
                br.close(); conn.disconnect();
                org.json.JSONArray arr = new org.json.JSONArray(sb.toString());
                if (arr.length() == 0) { runOnUiThread(() -> cb.onResult(null, null)); return; }
                org.json.JSONObject hit = arr.getJSONObject(0);
                final double _lat = hit.getDouble("lat");
                final double _lon = hit.getDouble("lon");
                // CRM nachtragen — damit beim naechsten Mal kein Lookup noetig
                if (e.id != null) {
                    java.util.Map<String, Object> upd = new java.util.HashMap<>();
                    upd.put("addressLat", _lat); upd.put("addressLon", _lon);
                    upd.put("addressGeocodedAt", System.currentTimeMillis());
                    upd.put("addressGeocodedVia", "nominatim-auto");
                    FirebaseDatabase.getInstance(DB_INSTANCE_URL).getReference("customers/" + e.id).updateChildren(upd);
                    e.lat = _lat; e.lon = _lon;
                }
                runOnUiThread(() -> cb.onResult(_lat, _lon));
            } catch (Throwable _err) {
                Log.w(TAG, "Geocoding fehlgeschlagen: " + _err.getMessage());
                runOnUiThread(() -> cb.onResult(null, null));
            }
        }, "geocode").start();
    }

    // v6.62.92: Hotel/Firma-Erkennung — Patrick: 'bei Hotels muessen die Restriktionen
    // uebernommen werden, Hotel bucht fuer Gast'. customerKind = Hotel/Firma → Auftraggeber-Buchung.
    private boolean isAuftraggeberCrm(CrmEntry e) {
        if (e == null || e.customerKind == null) return false;
        String k = e.customerKind.toLowerCase();
        return k.equals("hotel") || k.equals("firma") || k.equals("klinik") || k.equals("supplier") || k.equals("lieferant");
    }

    // v6.62.92: Frag Gastnamen ab, dann ruf Callback mit dem Namen auf
    private interface GuestNameCallback { void onGuest(String guestName, String guestPhone); }
    private void askGuestName(CrmEntry e, GuestNameCallback cb) {
        if (!isAuftraggeberCrm(e)) { cb.onGuest(null, null); return; }
        LinearLayout lay = new LinearLayout(this);
        lay.setOrientation(LinearLayout.VERTICAL);
        int pad = (int) (getResources().getDisplayMetrics().density * 16);
        lay.setPadding(pad, pad, pad, pad);
        EditText etGuest = new EditText(this);
        etGuest.setHint("Gastname (fuer den gebucht wird)");
        etGuest.setInputType(InputType.TYPE_TEXT_FLAG_CAP_WORDS);
        lay.addView(etGuest);
        EditText etPhone = new EditText(this);
        etPhone.setHint("Telefon des Gastes (optional)");
        etPhone.setInputType(InputType.TYPE_CLASS_PHONE);
        lay.addView(etPhone);
        new AlertDialog.Builder(this)
            .setTitle("🏨 " + (e.name != null ? e.name : "Auftraggeber") + " bucht für Gast")
            .setView(lay)
            .setPositiveButton("Weiter", (d, w) -> {
                String guest = etGuest.getText().toString().trim();
                String phone = etPhone.getText().toString().trim();
                if (guest.isEmpty()) {
                    Toast.makeText(this, "Gastname fehlt", Toast.LENGTH_SHORT).show();
                    return;
                }
                cb.onGuest(guest, phone.isEmpty() ? null : phone);
            })
            .setNegativeButton("Abbrechen", null)
            .show();
    }

    // v6.62.78: Action-Dialog statt direktem Edit. Patrick: 'aus CRM-Suche eine
    // Vorbestellung erstellen, mit haeufigsten Zielen als Quick-Buttons'.
    private void showActionDialog(CrmEntry e) {
        // v6.62.90: Wenn keine Coords im CRM → Background-Geocoding triggern damit
        // sie beim spaeteren Save da sind. Falls schon da → no-op.
        if (e.address != null && !e.address.isEmpty() && (e.lat == null || e.lon == null)) {
            Toast.makeText(this, "📍 Adresse wird automatisch geocoded...", Toast.LENGTH_SHORT).show();
            geocodeAddressIfNeeded(e, (lat, lon) -> {
                if (lat != null) Toast.makeText(this, "✅ Koordinaten ermittelt", Toast.LENGTH_SHORT).show();
                else Toast.makeText(this, "⚠️ Konnte Koordinaten nicht ermitteln", Toast.LENGTH_LONG).show();
            });
        }
        String title = e.name != null ? e.name : "?";
        if (e.address != null && !e.address.isEmpty()) title += "\n📍 " + e.address;
        if (e.lat == null || e.lon == null) title += " ❓";
        String[] options = new String[]{
            "🚗 SOFORT-Fahrt (ich fahre hin)",
            "🚖 EINSTEIGER (Kunde steht am Auto)",
            "📅 Vorbestellung erstellen",
            "✏️ CRM-Eintrag bearbeiten",
            "Abbrechen"
        };
        new AlertDialog.Builder(this)
            .setTitle(title)
            .setItems(options, (d, w) -> {
                switch (w) {
                    case 0: createSofortFahrtFromCrm(e); break;
                    case 1: createEinsteigerFromCrm(e); break;
                    case 2: showVorbestellungDialogWithGuest(e); break;
                    case 3: openEditDialog(e); break;
                }
            }).show();
    }

    private void createSofortFahrtFromCrm(CrmEntry e) {
        // v6.62.92: Wenn Hotel/Firma → erst Gastname abfragen, dann Auftraggeber-Buchung
        askGuestName(e, (guestName, guestPhone) -> doCreateSofortFahrt(e, guestName, guestPhone));
    }
    private void doCreateSofortFahrt(CrmEntry e, String guestName, String guestPhone) {
        String vehicleId = getSharedPreferences("driver", MODE_PRIVATE).getString("vehicleId", null);
        if (vehicleId == null) { Toast.makeText(this, "Kein Fahrzeug ausgewaehlt", Toast.LENGTH_SHORT).show(); return; }
        boolean isAuftrag = isAuftraggeberCrm(e) && guestName != null;
        String displayName = isAuftrag ? guestName : e.name;
        new AlertDialog.Builder(this)
            .setTitle("🚗 SOFORT-Fahrt anlegen?")
            .setMessage((isAuftrag ? "🏨 Auftraggeber: " + e.name + "\n👤 Gast: " + guestName : "Kunde: " + e.name) + "\n📍 Pickup: " + (e.address != null ? e.address : "Adresse fehlt!") + "\n📞 " + (telOrMobile(e)) + "\n\nStatus 'angenommen' → du tippst dann Losfahren / BIN DA / Eingestiegen.")
            .setPositiveButton("✅ Anlegen", (d, w) -> {
                long now = System.currentTimeMillis();
                Map<String, Object> r = new HashMap<>();
                if (isAuftrag) {
                    r.put("customerName", e.name);
                    r.put("guestName", guestName);
                    r.put("_isAuftraggeberBooking", true);
                    r.put("_auftraggeberAddress", e.address != null ? e.address : "");
                    r.put("_auftraggeberKind", e.customerKind);
                    if (e.lat != null) { r.put("_auftraggeberLat", e.lat); r.put("_auftraggeberLon", e.lon); }
                    if (guestPhone != null) {
                        r.put("customerPhone", guestPhone);
                        r.put("customerMobile", guestPhone);
                    } else if (e.phone != null) {
                        r.put("customerPhone", e.phone);
                    }
                } else {
                    r.put("customerName", e.name);
                    if (e.phone != null) r.put("customerPhone", e.phone);
                    if (e.mobilePhone != null) r.put("customerMobile", e.mobilePhone);
                }
                r.put("customerId", e.id);
                r.put("vehicleId", vehicleId);
                r.put("assignedVehicle", vehicleId);
                r.put("status", "accepted");
                r.put("pickup", e.address != null ? e.address : "");
                if (e.lat != null) { r.put("pickupLat", e.lat); r.put("pickupLon", e.lon); }
                r.put("destination", "");
                r.put("pickupTimestamp", now);
                r.put("createdAt", now);
                r.put("updatedAt", now);
                r.put("acceptedAt", now);
                r.put("assignedAt", now);
                r.put("assignedBy", "native_sofort_crmsearch");
                r.put("acceptedVia", "native_sofort_crmsearch");
                r.put("source", "native_sofort_crmsearch");
                r.put("isSofort", true);
                r.put("passengers", 1);
                FirebaseDatabase.getInstance(DB_INSTANCE_URL).getReference("rides").push().setValue(r)
                    .addOnSuccessListener(_v -> {
                        Toast.makeText(this, "✅ SOFORT-Fahrt: " + displayName, Toast.LENGTH_SHORT).show();
                        startActivity(new Intent(this, DriverDashboardActivity.class));
                        finish();
                    })
                    .addOnFailureListener(ex -> Toast.makeText(this, "Fehler: " + ex.getMessage(), Toast.LENGTH_LONG).show());
            })
            .setNegativeButton("Abbrechen", null).show();
    }

    private void createEinsteigerFromCrm(CrmEntry e) {
        // v6.62.92: Auftraggeber-Erkennung
        askGuestName(e, (guestName, guestPhone) -> doCreateEinsteiger(e, guestName, guestPhone));
    }
    private void doCreateEinsteiger(CrmEntry e, String guestName, String guestPhone) {
        String vehicleId = getSharedPreferences("driver", MODE_PRIVATE).getString("vehicleId", null);
        if (vehicleId == null) { Toast.makeText(this, "Kein Fahrzeug ausgewaehlt", Toast.LENGTH_SHORT).show(); return; }
        boolean isAuftrag = isAuftraggeberCrm(e) && guestName != null;
        String displayName = isAuftrag ? guestName : e.name;
        new AlertDialog.Builder(this)
            .setTitle("🚖 EINSTEIGER anlegen?")
            .setMessage((isAuftrag ? "🏨 Auftraggeber: " + e.name + "\n👤 Gast: " + guestName : "Kunde: " + e.name) + "\n📍 Pickup: " + (e.address != null ? e.address : "Standort Fahrer") + "\n📞 " + (telOrMobile(e)) + "\n\nFahrt sofort als 'abgeholt' eingetragen.")
            .setPositiveButton("✅ Anlegen", (d, w) -> {
                long now = System.currentTimeMillis();
                Map<String, Object> r = new HashMap<>();
                if (isAuftrag) {
                    r.put("customerName", e.name);
                    r.put("guestName", guestName);
                    r.put("_isAuftraggeberBooking", true);
                    r.put("_auftraggeberAddress", e.address != null ? e.address : "");
                    r.put("_auftraggeberKind", e.customerKind);
                    if (e.lat != null) { r.put("_auftraggeberLat", e.lat); r.put("_auftraggeberLon", e.lon); }
                    if (guestPhone != null) { r.put("customerPhone", guestPhone); r.put("customerMobile", guestPhone); }
                    else if (e.phone != null) r.put("customerPhone", e.phone);
                } else {
                    r.put("customerName", e.name);
                    if (e.phone != null) r.put("customerPhone", e.phone);
                    if (e.mobilePhone != null) r.put("customerMobile", e.mobilePhone);
                }
                r.put("customerId", e.id);
                r.put("vehicleId", vehicleId);
                r.put("status", "picked_up");
                r.put("pickup", e.address != null ? e.address : "Standort Fahrer");
                if (e.lat != null) { r.put("pickupLat", e.lat); r.put("pickupLon", e.lon); }
                r.put("destination", "");
                r.put("pickupTimestamp", now);
                r.put("createdAt", now);
                r.put("updatedAt", now);
                r.put("acceptedAt", now);
                r.put("acceptedVia", "native_einsteiger_crmsearch");
                r.put("source", "native_einsteiger_crmsearch");
                r.put("isInsteiger", true);
                r.put("passengers", 1);
                FirebaseDatabase.getInstance(DB_INSTANCE_URL).getReference("rides").push().setValue(r)
                    .addOnSuccessListener(_v -> {
                        Toast.makeText(this, "✅ EINSTEIGER: " + displayName, Toast.LENGTH_SHORT).show();
                        startActivity(new Intent(this, DriverDashboardActivity.class));
                        finish();
                    })
                    .addOnFailureListener(ex -> Toast.makeText(this, "Fehler: " + ex.getMessage(), Toast.LENGTH_LONG).show());
            })
            .setNegativeButton("Abbrechen", null).show();
    }

    // v6.62.92: Vor Vorbestellung-Workflow Gast abfragen wenn Hotel/Firma
    private String _vorbestGuestName = null;
    private String _vorbestGuestPhone = null;
    private void showVorbestellungDialogWithGuest(CrmEntry e) {
        askGuestName(e, (guestName, guestPhone) -> {
            _vorbestGuestName = guestName;
            _vorbestGuestPhone = guestPhone;
            showVorbestellungDialog(e);
        });
    }

    // v6.62.78: Vorbestellungs-Dialog mit haeufigsten Zielen dieses Kunden als Quick-Buttons
    private void showVorbestellungDialog(CrmEntry e) {
        if (e.id == null) {
            Toast.makeText(this, "CRM ohne ID — kann nicht nach haeufigen Zielen suchen", Toast.LENGTH_LONG).show();
            return;
        }
        // Lade alle Rides dieses Kunden
        FirebaseDatabase.getInstance(DB_INSTANCE_URL).getReference("rides")
            .orderByChild("customerId").equalTo(e.id).limitToLast(80)
            .addListenerForSingleValueEvent(new ValueEventListener() {
                @Override public void onDataChange(@NonNull DataSnapshot snap) {
                    Map<String, Integer> destCount = new HashMap<>();
                    Map<String, double[]> destCoords = new HashMap<>();
                    for (DataSnapshot c : snap.getChildren()) {
                        String dest = c.child("destination").getValue(String.class);
                        if (dest == null || dest.isEmpty()) continue;
                        destCount.merge(dest, 1, Integer::sum);
                        Object dl = c.child("destinationLat").getValue();
                        Object dn = c.child("destinationLon").getValue();
                        if (dl == null) dl = c.child("destCoords").child("lat").getValue();
                        if (dn == null) dn = c.child("destCoords").child("lon").getValue();
                        if (dl instanceof Number && dn instanceof Number && !destCoords.containsKey(dest)) {
                            destCoords.put(dest, new double[]{((Number)dl).doubleValue(), ((Number)dn).doubleValue()});
                        }
                    }
                    List<Map.Entry<String,Integer>> sorted = new ArrayList<>(destCount.entrySet());
                    sorted.sort((a,b) -> b.getValue() - a.getValue());
                    List<Map.Entry<String,Integer>> top = sorted.subList(0, Math.min(5, sorted.size()));
                    showVorbestellungOptions(e, top, destCoords);
                }
                @Override public void onCancelled(@NonNull DatabaseError err) {
                    showVorbestellungOptions(e, new ArrayList<>(), new HashMap<>());
                }
            });
    }

    private void showVorbestellungOptions(CrmEntry e, List<Map.Entry<String,Integer>> topDests, Map<String, double[]> destCoords) {
        List<String> items = new ArrayList<>();
        for (Map.Entry<String,Integer> d : topDests) {
            items.add("⭐ " + d.getKey() + "  (" + d.getValue() + "x)");
        }
        // v6.62.88: Manuell-Ziel-Eingabe direkt im Dialog (war bisher Toast 'kommt spaeter')
        items.add("📍 Ziel via Google Places suchen");
        items.add("❌ Abbrechen");
        String[] options = items.toArray(new String[0]);
        String title = "📅 Vorbestellung — " + e.name;
        if (topDests.isEmpty()) title += "\n(Kein vorheriges Ziel im CRM — Ziel via Places eingeben)";
        else title += "\nHaeufigste Ziele:";
        new AlertDialog.Builder(this)
            .setTitle(title)
            .setItems(options, (d, w) -> {
                if (w < topDests.size()) {
                    String dest = topDests.get(w).getKey();
                    double[] coords = destCoords.get(dest);
                    askPickupTimeForVorbestellung(e, dest, coords);
                } else if (w == topDests.size()) {
                    // v6.62.88: Places-Picker fuer freies Ziel
                    askDestinationViaPlaces(e);
                }
            }).show();
    }

    // v6.62.88: Places-Autocomplete fuer freies Ziel bei Vorbestellung
    private CrmEntry _vorbestPendingCrm = null;
    private void askDestinationViaPlaces(CrmEntry e) {
        _vorbestPendingCrm = e;
        // pendingPlaceField = ein temporaerer TextView um den Label zu fangen
        TextView tv = new TextView(this);
        double[] coords = new double[]{ Double.NaN, Double.NaN };
        pendingPlaceField = tv;
        pendingPlaceCoords = coords;
        // Wenn Places-Result kommt → in placesLauncher-Callback wird tv gesetzt; danach hier weiter
        // Wir hooken einen kurzen Polling-Mechanismus weil Places-Result async kommt
        try {
            if (!Places.isInitialized()) {
                Places.initializeWithNewPlacesApiEnabled(getApplicationContext(), "AIzaSyAu9CsnLMLLQbXkWckWSV7uIzLB94hJ-HE");
            }
            List<Place.Field> fields = Arrays.asList(Place.Field.ID, Place.Field.DISPLAY_NAME, Place.Field.FORMATTED_ADDRESS, Place.Field.LOCATION);
            Intent intent = new Autocomplete.IntentBuilder(AutocompleteActivityMode.FULLSCREEN, fields)
                .setCountries(Arrays.asList("DE"))
                .build(this);
            // Eigener Launcher mit Spezial-Handling
            vorbestPlacesLauncher.launch(intent);
        } catch (Throwable t) {
            Toast.makeText(this, "Places-Fehler: " + t.getMessage(), Toast.LENGTH_LONG).show();
        }
    }

    private final ActivityResultLauncher<Intent> vorbestPlacesLauncher = registerForActivityResult(
        new ActivityResultContracts.StartActivityForResult(),
        result -> {
            if (result.getResultCode() != RESULT_OK || result.getData() == null || _vorbestPendingCrm == null) {
                _vorbestPendingCrm = null;
                return;
            }
            try {
                Place p = Autocomplete.getPlaceFromIntent(result.getData());
                String name = p.getDisplayName();
                String addr = p.getFormattedAddress();
                String label = (name == null || name.isEmpty()) ? (addr != null ? addr : "")
                    : (addr == null || addr.isEmpty() || addr.equals(name) ? name
                    : (addr.startsWith(name) ? addr : name + ", " + addr));
                double[] coords = null;
                if (p.getLocation() != null) coords = new double[]{ p.getLocation().latitude, p.getLocation().longitude };
                askPickupTimeForVorbestellung(_vorbestPendingCrm, label, coords);
            } catch (Throwable t) {
                Toast.makeText(this, "Places-Parse: " + t.getMessage(), Toast.LENGTH_LONG).show();
            } finally {
                _vorbestPendingCrm = null;
            }
        }
    );

    private void askPickupTimeForVorbestellung(CrmEntry e, String destination, double[] destCoords) {
        // Datum + Uhrzeit Picker
        java.util.Calendar cal = java.util.Calendar.getInstance();
        new android.app.DatePickerDialog(this, (dp, year, month, day) -> {
            cal.set(year, month, day);
            new android.app.TimePickerDialog(this, (tp, hour, minute) -> {
                cal.set(java.util.Calendar.HOUR_OF_DAY, hour);
                cal.set(java.util.Calendar.MINUTE, minute);
                cal.set(java.util.Calendar.SECOND, 0);
                cal.set(java.util.Calendar.MILLISECOND, 0);
                long pickupTs = cal.getTimeInMillis();
                long now = System.currentTimeMillis();
                // v6.62.88: Patrick: 'es duerfte jetzt keine Fahrt eingetragen werden koennen
                // die in der Vergangenheit liegt'. Mindestens 5 Min Vorlauf erzwingen.
                if (pickupTs < now + 5L * 60_000L) {
                    long minutesPast = (now - pickupTs) / 60_000L;
                    String msg = pickupTs < now
                        ? "❌ Pickup-Zeit liegt " + minutesPast + " Min in der Vergangenheit. Wähle eine Zeit in der Zukunft."
                        : "⚠️ Pickup-Zeit ist zu nah am Jetzt (<5 Min). Nutze SOFORT-Fahrt statt Vorbestellung.";
                    new androidx.appcompat.app.AlertDialog.Builder(this)
                        .setTitle("Ungueltige Pickup-Zeit")
                        .setMessage(msg)
                        .setPositiveButton("Andere Zeit waehlen", (d, w) -> askPickupTimeForVorbestellung(e, destination, destCoords))
                        .setNegativeButton("Abbrechen", null)
                        .show();
                    return;
                }
                createVorbestellung(e, destination, destCoords, pickupTs);
            }, cal.get(java.util.Calendar.HOUR_OF_DAY), cal.get(java.util.Calendar.MINUTE), true).show();
        }, cal.get(java.util.Calendar.YEAR), cal.get(java.util.Calendar.MONTH), cal.get(java.util.Calendar.DAY_OF_MONTH)).show();
    }

    private void createVorbestellung(CrmEntry e, String destination, double[] destCoords, long pickupTs) {
        long now = System.currentTimeMillis();
        Map<String, Object> r = new HashMap<>();
        boolean isAuftrag = isAuftraggeberCrm(e) && _vorbestGuestName != null;
        if (isAuftrag) {
            r.put("customerName", e.name);
            r.put("guestName", _vorbestGuestName);
            r.put("_isAuftraggeberBooking", true);
            r.put("_auftraggeberAddress", e.address != null ? e.address : "");
            r.put("_auftraggeberKind", e.customerKind);
            if (e.lat != null) { r.put("_auftraggeberLat", e.lat); r.put("_auftraggeberLon", e.lon); }
            if (_vorbestGuestPhone != null) { r.put("customerPhone", _vorbestGuestPhone); r.put("customerMobile", _vorbestGuestPhone); }
            else if (e.phone != null) r.put("customerPhone", e.phone);
        } else {
            r.put("customerName", e.name);
            if (e.phone != null) r.put("customerPhone", e.phone);
            if (e.mobilePhone != null) r.put("customerMobile", e.mobilePhone);
        }
        r.put("customerId", e.id);
        r.put("status", "vorbestellt");
        r.put("pickup", e.address != null ? e.address : "");
        if (e.lat != null) { r.put("pickupLat", e.lat); r.put("pickupLon", e.lon); }
        r.put("destination", destination);
        if (destCoords != null) { r.put("destinationLat", destCoords[0]); r.put("destinationLon", destCoords[1]); }
        r.put("pickupTimestamp", pickupTs);
        java.text.SimpleDateFormat tf = new java.text.SimpleDateFormat("HH:mm", Locale.GERMANY);
        tf.setTimeZone(java.util.TimeZone.getTimeZone("Europe/Berlin"));
        r.put("pickupTime", tf.format(new java.util.Date(pickupTs)));
        r.put("createdAt", now);
        r.put("updatedAt", now);
        r.put("source", "native_vorbestellung_crmsearch");
        r.put("passengers", 1);
        FirebaseDatabase.getInstance(DB_INSTANCE_URL).getReference("rides").push().setValue(r)
            .addOnSuccessListener(_v -> {
                Toast.makeText(this, "✅ Vorbestellung: " + e.name + " → " + destination, Toast.LENGTH_LONG).show();
                finish();
            })
            .addOnFailureListener(ex -> Toast.makeText(this, "Fehler: " + ex.getMessage(), Toast.LENGTH_LONG).show());
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

    // v6.62.222: Telefonnummer-Anzeige mit mobilePhone-Fallback. Hasbargen-Fall:
    // phone="" (Empty-String, nicht null) + mobilePhone gefuellt → vorher zeigte
    // Dialog "📞 " (leer hinter Symbol). Jetzt: erst phone, sonst mobile, sonst "—".
    private static String telOrMobile(CrmEntry e) {
        if (e == null) return "—";
        if (e.phone != null && !e.phone.trim().isEmpty()) return e.phone;
        if (e.mobilePhone != null && !e.mobilePhone.trim().isEmpty()) return e.mobilePhone;
        return "—";
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
                // v6.62.90: Patrick will sehen welche CRM-Eintraege keine Koordinaten haben
                String namePrefix = "";
                if (e.address != null && !e.address.isEmpty() && (e.lat == null || e.lon == null)) {
                    namePrefix = "⚠️ ";
                }
                t1.setText(namePrefix + (e.name != null ? e.name : "?"));
                String sub = "";
                // v6.62.222: Empty-String ignorieren (Hasbargen hatte phone="" → vorher
                // wurde "📞 " mit leerem Wert angezeigt → sah aus als wäre keine Nummer da).
                boolean hasPhone = e.phone != null && !e.phone.trim().isEmpty();
                boolean hasMobile = e.mobilePhone != null && !e.mobilePhone.trim().isEmpty();
                if (hasPhone) sub += "📞 " + e.phone;
                if (hasMobile && !e.mobilePhone.equals(e.phone)) sub += (hasPhone ? "  " : "") + "📱 " + e.mobilePhone;
                if (e.address != null && !e.address.isEmpty()) {
                    String addrLabel = (e.lat != null && e.lon != null) ? "📍 " : "📍❓ ";
                    sub += (sub.isEmpty() ? "" : "\n") + addrLabel + e.address;
                }
                t2.setText(sub.isEmpty() ? "—" : sub);
                itemView.setOnClickListener(_v -> showActionDialog(e));
            }
        }
    }
}
