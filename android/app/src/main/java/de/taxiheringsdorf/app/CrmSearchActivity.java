package de.taxiheringsdorf.app;

import android.Manifest;
import android.app.AlertDialog;
import android.app.ProgressDialog;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.os.Bundle;
import android.provider.ContactsContract;
import android.text.Editable;
import android.text.InputType;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
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
                // v6.62.348: Patrick (06.05. 10:35) "mach das Kaiserbaeder weg bei der Adresse".
                // Google Places haengt oft Tourismus-Region (Kaiserbaeder), Landkreis (Vorpommern-
                // Greifswald), Bundesland (Mecklenburg-Vorpommern) oder Land (Deutschland) an.
                // → strip aus dem fertigen Label.
                label = stripTouristAndRegion(label);
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

    // v6.62.388: Kontakt-Picker fuer "Aus Telefonbuch waehlen" beim Neuer-Kunde-Dialog.
    // Patrick (06.05. 20:25): "Kunden aus dem Handy importieren beim CRM-Anlegen".
    private EditText pendingContactName;
    private EditText pendingContactPhone;
    private final androidx.activity.result.ActivityResultLauncher<Intent> contactPickerLauncher =
        registerForActivityResult(new androidx.activity.result.contract.ActivityResultContracts.StartActivityForResult(),
            result -> {
                if (result.getResultCode() != RESULT_OK || result.getData() == null) return;
                android.net.Uri uri = result.getData().getData();
                if (uri == null) return;
                String[] proj = { ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME,
                                  ContactsContract.CommonDataKinds.Phone.NUMBER };
                try (Cursor c = getContentResolver().query(uri, proj, null, null, null)) {
                    if (c != null && c.moveToFirst()) {
                        String cName = c.getString(0);
                        String cPhone = c.getString(1);
                        if (pendingContactName != null && cName != null && pendingContactName.getText().length() == 0) {
                            pendingContactName.setText(cName);
                        }
                        if (pendingContactPhone != null && cPhone != null) {
                            pendingContactPhone.setText(cPhone.replaceAll("\\s+", ""));
                        }
                        Toast.makeText(this, "✅ Kontakt uebernommen: " + cName, Toast.LENGTH_SHORT).show();
                    }
                } catch (Throwable t) {
                    Toast.makeText(this, "Kontakt-Import: " + t.getMessage(), Toast.LENGTH_LONG).show();
                }
            });

    private void launchContactPicker(EditText nameField, EditText phoneField) {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.READ_CONTACTS)
                != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this, new String[]{Manifest.permission.READ_CONTACTS}, 91);
            Toast.makeText(this, "Kontakte-Berechtigung wird angefragt — bitte erneut tippen.", Toast.LENGTH_LONG).show();
            return;
        }
        pendingContactName = nameField;
        pendingContactPhone = phoneField;
        Intent i = new Intent(Intent.ACTION_PICK, ContactsContract.CommonDataKinds.Phone.CONTENT_URI);
        contactPickerLauncher.launch(i);
    }

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
                // v6.62.230: Patrick (03.05. 22:18): "Kaiserbäder, Vorpommern-Greifswald,
                // Mecklenburg-Vorpommern, Deutschland brauchen wir nicht — Straße zuerst,
                // dann Hausnummer". Compact-Format aus addressdetails statt display_name.
                // v6.62.348: zusaetzlich Kaiserbäder/Region rausfiltern (compact macht das nicht 100%ig)
                final String display = stripTouristAndRegion(compactNominatimAddress(json, query));
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

    // v6.62.230: Kompakte Adress-Anzeige aus Nominatim-JSON.
    // Patrick (03.05. 22:18): "Kaiserbaeder, Vorpommern-Greifswald, Mecklenburg-Vorpommern,
    // Deutschland brauchen wir nicht — Strasse zuerst, dann Hausnummer".
    // Format: "[POI-Name, ]Strasse Hausnummer, PLZ Ort".
    private static String compactNominatimAddress(String json, String fallbackQuery) {
        try {
            String road = jsonStr(json, "\"road\":\"");
            String houseNr = jsonStr(json, "\"house_number\":\"");
            String postcode = jsonStr(json, "\"postcode\":\"");
            String city = jsonStr(json, "\"city\":\"");
            if (city == null) city = jsonStr(json, "\"town\":\"");
            if (city == null) city = jsonStr(json, "\"village\":\"");
            if (city == null) city = jsonStr(json, "\"municipality\":\"");
            String name = jsonStr(json, "\"name\":\"");
            StringBuilder out = new StringBuilder();
            if (name != null && !name.isEmpty()) out.append(name);
            if (road != null) {
                if (out.length() > 0) out.append(", ");
                out.append(road);
                if (houseNr != null) out.append(" ").append(houseNr);
            }
            if (postcode != null || city != null) {
                if (out.length() > 0) out.append(", ");
                if (postcode != null) out.append(postcode);
                if (city != null) out.append(postcode != null ? " " : "").append(city);
            }
            if (out.length() > 0) return decodeUmlauteJson(out.toString());
            // Fallback: display_name komplett (alt)
            int dispIdx = json.indexOf("\"display_name\":\"");
            if (dispIdx < 0) return fallbackQuery;
            return decodeUmlauteJson(json.substring(dispIdx + 16, json.indexOf("\"", dispIdx + 16)));
        } catch (Throwable _t) {
            return fallbackQuery;
        }
    }

    private static String jsonStr(String json, String keyToken) {
        int idx = json.indexOf(keyToken);
        if (idx < 0) return null;
        int start = idx + keyToken.length();
        int end = json.indexOf("\"", start);
        if (end < 0) return null;
        String val = json.substring(start, end);
        return val.isEmpty() ? null : val;
    }

    private static String decodeUmlauteJson(String s) {
        if (s == null) return null;
        return s.replace("\\u00fc","ü").replace("\\u00f6","ö").replace("\\u00e4","ä")
                .replace("\\u00df","ß").replace("\\u00dc","Ü").replace("\\u00d6","Ö")
                .replace("\\u00c4","Ä").replace("\\/","/");
    }

    // v6.62.348: Patrick (06.05. 10:35): "mach das Kaiserbaeder weg bei der Adresse".
    // Entfernt aus Google-Places-Antworten die Tourismus-Region, den Landkreis, das
    // Bundesland und das Land — alle als ", X" oder " X" am String-Ende oder mittendrin.
    // Beispiel:
    //   "Hotel Vineta, Vinetastr. 1, 17424 Heringsdorf, Kaiserbäder, Vorpommern-Greifswald,
    //    Mecklenburg-Vorpommern, Deutschland"
    // → "Hotel Vineta, Vinetastr. 1, 17424 Heringsdorf"
    public static String stripTouristAndRegion(String s) {
        if (s == null || s.isEmpty()) return s;
        String out = s;
        // v6.62.364: Patrick (06.05. 14:42): "Ahlbeck-Kaiserbäder, Heringsdorf-Kaiserbäder
        // verwirrt die Leute". Erst Kombi-Stadtnamen mit Bindestrich abschneiden:
        // "Heringsdorf-Kaiserbaeder" → "Heringsdorf", "Ahlbeck-Kaiserbäder" → "Ahlbeck".
        out = out.replaceAll("(?i)(Heringsdorf|Ahlbeck|Bansin|Zinnowitz|Trassenheide|Karlshagen|Koserow|Loddin|Ueckeritz|Stubbenfelde|Kolpinsee|Peenemuende|Wolgast)-Kaiserb[äa]eder", "$1");
        String[] junk = {
            "Kaiserbäder", "Kaiserbaeder",
            "Vorpommern-Greifswald", "Vorpommern Greifswald",
            "Mecklenburg-Vorpommern", "Mecklenburg Vorpommern",
            "Deutschland", "Germany"
        };
        for (String j : junk) {
            // Vor dem Junk-Token koennte ein Komma+Space stehen — beides mit weghauen.
            out = out.replaceAll("\\s*,\\s*" + java.util.regex.Pattern.quote(j) + "(?=\\s*(,|$))", "");
            // Auch wenn das Token am Anfang steht (sehr unwahrscheinlich, aber sicher).
            out = out.replaceAll("^\\s*" + java.util.regex.Pattern.quote(j) + "\\s*,\\s*", "");
        }
        // Trailing-Komma falls vorhanden weg
        out = out.replaceAll(",\\s*$", "").trim();
        return out;
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        setContentView(R.layout.activity_crm_search);

        findViewById(R.id.btn_crm_back).setOnClickListener(v -> finish());
        // v6.62.384: Patrick (06.05. 19:40): "Kunde anlegen in der Native-App"
        findViewById(R.id.btn_crm_new).setOnClickListener(v -> openCreateDialog());
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

    // 🆕 v6.62.626: Auto-Show-History — wenn aus CallLogActivity (oder anderswo) aufgerufen
    // mit Intent-Extras "auto_history_customer_id" → direkt nach Load die Fahrt-Historie
    // des Kunden anzeigen. Spart die Code-Duplikation in CallLogActivity.
    private String _pendingHistoryCustomerId = null;

    private void _maybeAutoOpenHistory() {
        String _id = getIntent() != null ? getIntent().getStringExtra("auto_history_customer_id") : null;
        if (_id == null) return;
        _pendingHistoryCustomerId = _id;
        // Intent-Extra entfernen, damit es bei Rotation/Resume nicht wieder feuert
        getIntent().removeExtra("auto_history_customer_id");
    }

    // v6.62.639: Patrick (12.05. 13:04+13:19): "in der Anrufliste 'Neuen Kunden anlegen'
    // soll EXAKT die gleiche Maske wie hier in der CRM-Suche oeffnen". Intent-Extra
    // 'prefill_new_phone' + 'prefill_new_name' triggert openEditDialog mit neuem Eintrag
    // und vorbefuellter Telefonnummer (aus CallLog).
    private void _maybeAutoOpenCreateDialog() {
        if (getIntent() == null) return;
        String _phone = getIntent().getStringExtra("prefill_new_phone");
        if (_phone == null || _phone.isEmpty()) return;
        String _name = getIntent().getStringExtra("prefill_new_name");
        getIntent().removeExtra("prefill_new_phone");
        getIntent().removeExtra("prefill_new_name");
        CrmEntry blank = new CrmEntry();
        blank.id = null; // markiert isNew=true
        blank.name = _name != null ? _name : "";
        blank.mobilePhone = _phone;
        blank.phone = _phone;
        openEditDialog(blank);
    }

    private void _runPendingHistoryIfReady() {
        if (_pendingHistoryCustomerId == null) return;
        for (CrmEntry e : all) {
            if (_pendingHistoryCustomerId.equals(e.id)) {
                _pendingHistoryCustomerId = null;
                showCustomerRideHistory(e);
                return;
            }
        }
        // Kunde nicht in der Liste — vermutlich gerade geloescht. Stilles Fehler-Toast.
        _pendingHistoryCustomerId = null;
        Toast.makeText(this, "❌ Kunde nicht (mehr) im CRM", Toast.LENGTH_LONG).show();
    }

    // 🆕 v6.62.679: Patrick (13.05. 14:55): AdminDashboard Rueckfahrt-Klick laeuft
    //   jetzt durch CrmSearchActivity damit die polierte Vorbestellungs-Maske benutzt
    //   wird (Places-Autocomplete + Stecknadel-Picker). Intent-Extras:
    //     auto_template_ride_id  → die Ride die als Vorlage geladen wird
    //     auto_template_swap     → "true" fuer Rueckfahrt (pickup/dest tauschen)
    private String _pendingTemplateRideId = null;
    private boolean _pendingTemplateSwap = false;

    private void _maybeAutoOpenRideTemplate() {
        String _rid = getIntent() != null ? getIntent().getStringExtra("auto_template_ride_id") : null;
        if (_rid == null) return;
        _pendingTemplateRideId = _rid;
        _pendingTemplateSwap = "true".equals(getIntent().getStringExtra("auto_template_swap"));
        getIntent().removeExtra("auto_template_ride_id");
        getIntent().removeExtra("auto_template_swap");
    }

    private void _runPendingTemplateIfReady() {
        if (_pendingTemplateRideId == null) return;
        final String _rid = _pendingTemplateRideId;
        final boolean _swap = _pendingTemplateSwap;
        _pendingTemplateRideId = null;
        FirebaseDatabase.getInstance(DB_INSTANCE_URL).getReference("rides/" + _rid).get()
            .addOnCompleteListener(task -> {
                if (!task.isSuccessful() || task.getResult() == null || !task.getResult().exists()) {
                    Toast.makeText(this, "❌ Fahrt-Vorlage nicht gefunden", Toast.LENGTH_LONG).show();
                    return;
                }
                Map<String, Object> _full = (Map<String, Object>) task.getResult().getValue();
                if (_full == null) {
                    Toast.makeText(this, "❌ Vorlage-Daten leer", Toast.LENGTH_LONG).show();
                    return;
                }
                // Kunde aus CRM-Liste finden (per customerId), sonst temp-Entry bauen
                String _custId = _full.get("customerId") instanceof String ? (String) _full.get("customerId") : null;
                CrmEntry e = null;
                if (_custId != null) {
                    for (CrmEntry x : all) {
                        if (_custId.equals(x.id)) { e = x; break; }
                    }
                }
                if (e == null) {
                    e = new CrmEntry();
                    e.id = _custId; // kann null sein
                    e.name = _full.get("customerName") instanceof String ? (String) _full.get("customerName") : null;
                    e.phone = _full.get("customerPhone") instanceof String ? (String) _full.get("customerPhone") : null;
                    e.mobilePhone = _full.get("customerMobile") instanceof String ? (String) _full.get("customerMobile") : null;
                }
                // Template-Map bauen — gleiche Strip-Logik wie openRideAsTemplate
                Map<String, Object> _template = new HashMap<>(_full);
                _template.remove("pickupTimestamp"); _template.remove("pickupTime");
                _template.remove("vehicleId"); _template.remove("assignedVehicle");
                _template.remove("assignedTo"); _template.remove("assignedAt");
                _template.remove("assignedBy"); _template.remove("acceptedAt");
                _template.remove("acceptedVia"); _template.remove("status");
                _template.remove("createdAt"); _template.remove("updatedAt");
                _template.remove("completedAt"); _template.remove("cancelledAt");
                _template.remove("cancelReason"); _template.remove("invoiceNumber");
                _template.remove("paymentMethod"); _template.remove("editedAt");
                _template.remove("editedVia"); _template.remove("source");
                // Rueckfahrt: pickup/destination + coords tauschen
                if (_swap) {
                    Object _p = _template.get("pickup");
                    Object _d = _template.get("destination");
                    _template.put("pickup", _d); _template.put("destination", _p);
                    Object _pl = _template.get("pickupLat"); Object _pn = _template.get("pickupLon");
                    Object _dl = _template.get("destinationLat"); Object _dn = _template.get("destinationLon");
                    _template.put("pickupLat", _dl); _template.put("pickupLon", _dn);
                    _template.put("destinationLat", _pl); _template.put("destinationLon", _pn);
                    // pickupCoords / destCoords als Map ebenfalls tauschen
                    Object _pc = _template.get("pickupCoords"); Object _dc = _template.get("destCoords");
                    _template.put("pickupCoords", _dc); _template.put("destCoords", _pc);
                    Toast.makeText(this, "🔄 Rueckfahrt — Abhol-/Zielort getauscht", Toast.LENGTH_SHORT).show();
                } else {
                    Toast.makeText(this, "📋 Vorlage geladen — waehle neuen Termin", Toast.LENGTH_SHORT).show();
                }
                showVorbestellungMaske(e, new ArrayList<>(), new HashMap<>(), null, _template);
            });
    }

    private void loadAll() {
        _maybeAutoOpenHistory();
        _maybeAutoOpenCreateDialog();
        _maybeAutoOpenRideTemplate();
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
                    _runPendingHistoryIfReady();
                    _runPendingTemplateIfReady();
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
                // 🆕 v6.62.543: Suche jetzt ueber ALLE Telefon-Felder
                // (phone + phone2 + mobile + additionalPhones), nicht nur phone+mobile.
                String p = e.allPhonesConcat().toLowerCase();
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
            "📜 Bisherige Fahrten anschauen",
            "📞 Anruf-Mitschnitte (ACR)",
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
                    case 4: showCustomerRideHistory(e); break;
                    case 5: showCallRecordings(e); break;
                }
            }).show();
    }

    // 🆕 v6.62.482: Patrick (08.05. 13:53): "wenn ich den Kunden anklicke, welche Fahrten
    //   er schon gemacht hat, dass ich die einfach kopieren kann oder schauen kann".
    //   Liste der letzten Fahrten dieses CRM-Kunden mit Datum/Route/Preis. Tap → Detail-
    //   Dialog mit Kopieren-in-Clipboard + 'Erneut buchen'-Shortcut.
    private void showCustomerRideHistory(CrmEntry e) {
        final ProgressDialog _pd = new ProgressDialog(this);
        _pd.setMessage("Lade Fahrten…");
        _pd.setCancelable(false);
        _pd.show();
        FirebaseDatabase.getInstance(DB_INSTANCE_URL).getReference("rides")
            .orderByChild("customerId").equalTo(e.id).limitToLast(50)
            .get().addOnCompleteListener(task -> {
                _pd.dismiss();
                if (!task.isSuccessful() || task.getResult() == null) {
                    Toast.makeText(this, "❌ Konnte Fahrten nicht laden", Toast.LENGTH_LONG).show();
                    return;
                }
                List<Map<String, Object>> rides = new ArrayList<>();
                for (DataSnapshot s : task.getResult().getChildren()) {
                    Map<String, Object> r = new HashMap<>();
                    r.put("id", s.getKey());
                    r.put("pickup", s.child("pickup").getValue(String.class));
                    r.put("destination", s.child("destination").getValue(String.class));
                    r.put("status", s.child("status").getValue(String.class));
                    Long _ts = s.child("pickupTimestamp").getValue(Long.class);
                    r.put("pickupTimestamp", _ts != null ? _ts : 0L);
                    Object _price = s.child("price").getValue();
                    r.put("price", _price);
                    Object _pax = s.child("passengers").getValue();
                    r.put("passengers", _pax instanceof Number ? ((Number) _pax).intValue() : 1);
                    String _notes = s.child("notes").getValue(String.class);
                    if (_notes != null) r.put("notes", _notes);
                    // v6.62.598: invoiceNumber laden fuer Retro-Rechnung-Button
                    String _invNr = s.child("invoiceNumber").getValue(String.class);
                    if (_invNr != null) r.put("invoiceNumber", _invNr);
                    // v6.62.601: drivingTimeToPickup laden fuer Push-Zeit-Anzeige
                    Object _drv = s.child("drivingTimeToPickup").getValue();
                    if (_drv instanceof Number) r.put("drivingTimeToPickup", ((Number) _drv).intValue());
                    rides.add(r);
                }
                // Neueste zuerst
                rides.sort((a, b) -> Long.compare((Long) b.get("pickupTimestamp"), (Long) a.get("pickupTimestamp")));

                if (rides.isEmpty()) {
                    new AlertDialog.Builder(this)
                        .setTitle("📜 Bisherige Fahrten")
                        .setMessage("Noch keine Fahrten für " + (e.name != null ? e.name : "diesen Kunden") + ".")
                        .setPositiveButton("OK", null)
                        .show();
                    return;
                }

                String[] labels = new String[rides.size()];
                java.text.SimpleDateFormat fmt = new java.text.SimpleDateFormat("dd.MM.yy HH:mm", Locale.GERMANY);
                fmt.setTimeZone(java.util.TimeZone.getTimeZone("Europe/Berlin"));
                for (int i = 0; i < rides.size(); i++) {
                    Map<String, Object> r = rides.get(i);
                    long ts = (Long) r.get("pickupTimestamp");
                    String dt = ts > 0 ? fmt.format(new java.util.Date(ts)) : "?";
                    String pu = r.get("pickup") != null ? String.valueOf(r.get("pickup")) : "?";
                    String de = r.get("destination") != null ? String.valueOf(r.get("destination")) : "?";
                    String st = r.get("status") != null ? String.valueOf(r.get("status")) : "?";
                    Object pr = r.get("price");
                    String prStr = (pr instanceof Number) ? String.format(Locale.GERMANY, " · %.2f€", ((Number) pr).doubleValue())
                                  : (pr != null ? " · " + pr + "€" : "");
                    String shortPu = pu.length() > 30 ? pu.substring(0, 30) + "…" : pu;
                    String shortDe = de.length() > 30 ? de.substring(0, 30) + "…" : de;
                    labels[i] = dt + " · " + statusEmoji(st) + "\n" + shortPu + " → " + shortDe + prStr;
                }

                new AlertDialog.Builder(this)
                    .setTitle("📜 " + (e.name != null ? e.name : "Fahrten") + " (" + rides.size() + ")")
                    .setItems(labels, (d, w) -> showRideHistoryDetail(e, rides.get(w)))
                    .setNegativeButton("Schließen", null)
                    .show();
            });
    }

    // Status → Emoji für die Liste
    private String statusEmoji(String status) {
        if (status == null) return "?";
        switch (status) {
            case "completed": case "abgeschlossen": return "✅";
            case "cancelled": case "storniert": return "❌";
            case "vorbestellt": return "📅";
            case "assigned": case "accepted": return "🔔";
            case "on_way": case "picked_up": return "🚗";
            case "warteschlange": return "⏳";
            default: return "•";
        }
    }

    // Detail-Dialog für eine einzelne Fahrt der Historie — mit Kopieren + Wiederholen
    private void showRideHistoryDetail(CrmEntry e, Map<String, Object> r) {
        java.text.SimpleDateFormat fmt = new java.text.SimpleDateFormat("EEE dd.MM.yyyy HH:mm", Locale.GERMANY);
        fmt.setTimeZone(java.util.TimeZone.getTimeZone("Europe/Berlin"));
        long ts = (Long) r.get("pickupTimestamp");
        String dt = ts > 0 ? fmt.format(new java.util.Date(ts)) : "?";
        String pu = r.get("pickup") != null ? String.valueOf(r.get("pickup")) : "—";
        String de = r.get("destination") != null ? String.valueOf(r.get("destination")) : "—";
        String st = r.get("status") != null ? String.valueOf(r.get("status")) : "?";
        Object pr = r.get("price");
        String prStr = (pr instanceof Number) ? String.format(Locale.GERMANY, "%.2f €", ((Number) pr).doubleValue())
                      : (pr != null ? pr + " €" : "—");
        int pax = r.get("passengers") instanceof Integer ? (Integer) r.get("passengers") : 1;
        String notes = r.get("notes") != null ? String.valueOf(r.get("notes")) : null;

        StringBuilder msg = new StringBuilder();
        msg.append("📅 ").append(dt).append("\n");
        msg.append(statusEmoji(st)).append(" Status: ").append(st).append("\n\n");
        msg.append("📍 Von: ").append(pu).append("\n");
        msg.append("🎯 Nach: ").append(de).append("\n");
        msg.append("👥 Personen: ").append(pax).append("\n");
        msg.append("💰 Preis: ").append(prStr);
        // v6.62.601: Patrick (11.05. 07:36): "Wann bekommt der Fahrer Push? Sehen wir das
        //   auch im Backlog?" Bei zukuenftigen Vorbestellungen voraussichtliche Push-Zeit
        //   anzeigen: pickup - (15 Min Vorlauf + Anfahrt). Anfahrt aus ride.drivingTimeToPickup
        //   wenn schon gesetzt (auto-assign hat gelaufen), sonst Fallback 10 Min.
        if ("vorbestellt".equalsIgnoreCase(st) && ts > System.currentTimeMillis()) {
            int _anfahrt = r.get("drivingTimeToPickup") instanceof Integer
                ? (Integer) r.get("drivingTimeToPickup") : 10;
            long _pushTs = ts - (15L + _anfahrt) * 60000L;
            if (_pushTs > 0) {
                java.text.SimpleDateFormat _pfmt = new java.text.SimpleDateFormat("HH:mm", Locale.GERMANY);
                _pfmt.setTimeZone(java.util.TimeZone.getTimeZone("Europe/Berlin"));
                String _pStr = _pfmt.format(new java.util.Date(_pushTs));
                msg.append("\n📱 Push voraus.: ").append(_pStr)
                   .append(" (15 + ").append(_anfahrt).append(" Min Anfahrt)");
            }
        }
        if (notes != null && !notes.trim().isEmpty()) {
            msg.append("\n\n📝 Notiz: ").append(notes);
        }
        final String _msgFinal = msg.toString();
        // v6.62.601: Audit-Log (lifecycleLog) der Ride asynchron laden + an Message anhaengen
        // via _logSuffix-Variable. Dialog wird nach dem Fetch gezeigt.
        final String _rideIdForLog = (String) r.get("id");
        if (_rideIdForLog != null) {
            FirebaseDatabase.getInstance(DB_INSTANCE_URL).getReference("rides/" + _rideIdForLog + "/lifecycleLog")
                .get().addOnCompleteListener(task -> {
                    StringBuilder _full = new StringBuilder(_msgFinal);
                    if (task.isSuccessful() && task.getResult() != null && task.getResult().exists()) {
                        java.util.List<Map<String, Object>> evts = new java.util.ArrayList<>();
                        for (com.google.firebase.database.DataSnapshot child : task.getResult().getChildren()) {
                            Map<String, Object> ev = new HashMap<>();
                            Long _t = child.child("time").getValue(Long.class);
                            ev.put("time", _t != null ? _t : 0L);
                            ev.put("icon", child.child("icon").getValue(String.class));
                            ev.put("msg", child.child("msg").getValue(String.class));
                            evts.add(ev);
                        }
                        evts.sort((a, b) -> Long.compare((Long) b.get("time"), (Long) a.get("time")));
                        if (!evts.isEmpty()) {
                            int _n = Math.min(5, evts.size());
                            _full.append("\n\n📋 Audit-Log (letzte ").append(_n).append("):");
                            java.text.SimpleDateFormat _lfmt = new java.text.SimpleDateFormat("HH:mm", Locale.GERMANY);
                            _lfmt.setTimeZone(java.util.TimeZone.getTimeZone("Europe/Berlin"));
                            for (int _i = 0; _i < _n; _i++) {
                                Map<String, Object> ev = evts.get(_i);
                                Long et = (Long) ev.get("time");
                                String emsg = (String) ev.get("msg");
                                String eicon = (String) ev.get("icon");
                                if (et != null && et > 0 && emsg != null) {
                                    _full.append("\n").append(_lfmt.format(new java.util.Date(et)))
                                         .append(" ").append(eicon != null ? eicon : "·").append(" ")
                                         .append(emsg.length() > 70 ? emsg.substring(0, 70) + "…" : emsg);
                                }
                            }
                        }
                    }
                    _showRideHistoryDetailDialog(e, r, _full.toString(), st, ts, pr);
                });
            return;  // Dialog wird im Callback gezeigt
        }
        _showRideHistoryDetailDialog(e, r, _msgFinal, st, ts, pr);
    }

    // v6.62.601: Helper — zeigt den Detail-Dialog mit dem (ggf. erweiterten) Message-Text
    private void _showRideHistoryDetailDialog(CrmEntry e, Map<String, Object> r, String _msgFinal, String st, long ts, Object pr) {

        // 🆕 v6.62.483: Bearbeiten-Option nur fuer zukuenftige Vorbestellungen.
        //   Vergangene/abgeschlossene/stornierte Fahrten sind read-only.
        final boolean _editable = "vorbestellt".equals(st) && ts > System.currentTimeMillis();
        final String _rideIdFinal = (String) r.get("id");

        AlertDialog.Builder _b = new AlertDialog.Builder(this)
            .setTitle("Fahrt-Details")
            .setMessage(_msgFinal);

        if (_editable && _rideIdFinal != null) {
            _b.setPositiveButton("✏️ Bearbeiten", (d, w) -> openRideEditDialog(e, _rideIdFinal, r));
            _b.setNeutralButton("📋 Kopieren", (d, w) -> {
                android.content.ClipboardManager cm = (android.content.ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
                if (cm != null) {
                    cm.setPrimaryClip(android.content.ClipData.newPlainText("Fahrt", _msgFinal));
                    Toast.makeText(this, "📋 In Zwischenablage kopiert", Toast.LENGTH_SHORT).show();
                }
            });
            _b.setNegativeButton("Zurück", null);
        } else {
            // v6.62.598: Patrick (11.05. 07:26): "Wenn ich eine Rechnung erstellen moechte
            //   die aber gestern war, wie kann ich das ueber die Native-App?"
            //   Wenn Fahrt completed + KEINE invoiceNumber + Preis>0 → "🧾 Rechnung erstellen"
            //   ersetzt die Erneut-Buchen-Action als primaere Geste, weil das das haeufigere
            //   Bedurfnis bei vergangenen Fahrten ist (Vorlage-Kopieren steht im Neutral-Slot).
            final boolean _isCompleted = "completed".equalsIgnoreCase(st) || "abgeschlossen".equalsIgnoreCase(st);
            final boolean _hasInvoice = r.get("invoiceNumber") != null && !String.valueOf(r.get("invoiceNumber")).trim().isEmpty();
            final boolean _hasPrice = pr instanceof Number && ((Number) pr).doubleValue() > 0;
            final boolean _canCreateInvoice = _isCompleted && !_hasInvoice && _hasPrice && _rideIdFinal != null;

            if (_canCreateInvoice) {
                _b.setPositiveButton("🧾 Rechnung erstellen", (d, w) -> triggerRetroInvoice(_rideIdFinal, r));
                _b.setNeutralButton("📅 Erneut buchen", (d, w) -> openRideAsTemplate(e, _rideIdFinal, r));
            } else {
                // 🆕 v6.62.503: Patrick (08.05. 16:56): "vergangene fahrten kopieren für die
                //   zukunft also dann auch als fahrt anlegen". Vergangene/abgeschlossene
                //   Fahrten lassen sich jetzt als Vorlage fuer eine neue Buchung nehmen —
                //   Pickup/Ziel/Waypoints/Personen/Notiz werden uebernommen, nur Datum
                //   waehlt Patrick neu.
                _b.setPositiveButton("📅 Erneut buchen (als Vorlage)", (d, w) -> openRideAsTemplate(e, _rideIdFinal, r));
                _b.setNeutralButton("📋 Kopieren", (d, w) -> {
                    android.content.ClipboardManager cm = (android.content.ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
                    if (cm != null) {
                        cm.setPrimaryClip(android.content.ClipData.newPlainText("Fahrt", _msgFinal));
                        Toast.makeText(this, "📋 In Zwischenablage kopiert", Toast.LENGTH_SHORT).show();
                    }
                });
            }
            _b.setNegativeButton("Zurück", null);
        }

        _b.show();
    }

    // v6.62.598: Retro-Rechnung fuer vergangene completed-Fahrt anstossen.
    // Setzt invoiceRequested+needsInvoice=true → onRideUpdated Cloud Function erstellt
    // /invoices/{nr}-Eintrag (server-seitig), Admin-Browser-Listener generiert PDF.
    private void triggerRetroInvoice(String rideId, Map<String, Object> rideListEntry) {
        if (rideId == null) {
            Toast.makeText(this, "❌ Fahrt-ID fehlt", Toast.LENGTH_LONG).show();
            return;
        }
        new AlertDialog.Builder(this)
            .setTitle("🧾 Rechnung erstellen")
            .setMessage("Soll fuer diese vergangene Fahrt nachtraeglich eine Rechnung erstellt werden?\n\n" +
                        "Es wird eine Belegnr. (GoBD-konform luekenlos) angelegt und die Rechnung " +
                        "kann anschliessend per Email oder im Web abgerufen werden.")
            .setPositiveButton("Ja, erstellen", (d, w) -> {
                FirebaseDatabase db = FirebaseDatabase.getInstance(DB_INSTANCE_URL);
                java.util.Map<String, Object> _upd = new java.util.HashMap<>();
                _upd.put("invoiceRequested", true);
                _upd.put("needsInvoice", true);
                _upd.put("invoiceRetroRequestedAt", System.currentTimeMillis());
                _upd.put("invoiceRetroRequestedBy", "native-crm-history");
                db.getReference("rides/" + rideId).updateChildren(_upd, (err, ref) -> {
                    if (err != null) {
                        Toast.makeText(this, "❌ Fehler: " + err.getMessage(), Toast.LENGTH_LONG).show();
                    } else {
                        Toast.makeText(this, "✅ Rechnungs-Auftrag in Firebase — Belegnr wird gleich vergeben.", Toast.LENGTH_LONG).show();
                    }
                });
            })
            .setNegativeButton("Abbrechen", null)
            .show();
    }

    // 🆕 v6.62.503: Vergangene Fahrt als Vorlage öffnen.
    //   Patrick (08.05.2026 16:56): "vergangene fahrten kopieren für die zukunft
    //   also dann auch als fahrt anlegen".
    //   Lädt die volle Ride aus Firebase und öffnet showVorbestellungMaske mit Pre-Fill
    //   ABER editRideId=null → Save erzeugt eine NEUE Buchung (push), keine Update.
    //   Wichtige Felder werden vor dem Pre-Fill genullt damit Patrick neu setzen kann:
    //   pickupTimestamp/pickupTime/vehicleId/status (und alle Audit-/Assign-Felder).
    private void openRideAsTemplate(CrmEntry e, String rideId, Map<String, Object> rideListEntry) {
        if (rideId == null) {
            Toast.makeText(this, "❌ Fahrt-ID fehlt", Toast.LENGTH_LONG).show();
            return;
        }
        final ProgressDialog _pd = new ProgressDialog(this);
        _pd.setMessage("Lade Fahrt-Daten als Vorlage…");
        _pd.setCancelable(false);
        _pd.show();
        FirebaseDatabase.getInstance(DB_INSTANCE_URL).getReference("rides/" + rideId).get()
            .addOnCompleteListener(task -> {
                _pd.dismiss();
                if (!task.isSuccessful() || task.getResult() == null || !task.getResult().exists()) {
                    Toast.makeText(this, "❌ Fahrt nicht gefunden", Toast.LENGTH_LONG).show();
                    return;
                }
                Map<String, Object> _full = (Map<String, Object>) task.getResult().getValue();
                if (_full == null) {
                    Toast.makeText(this, "❌ Daten leer", Toast.LENGTH_LONG).show();
                    return;
                }
                // 🔧 v6.62.713: Hard-Diagnose-Toast SOFORT nach Firebase-Load.
                //   Zeigt was Firebase geliefert hat — falls destination fehlt sehen wir es hier.
                String _diagP1 = _full.get("pickup") != null ? String.valueOf(_full.get("pickup")) : "(null)";
                String _diagD1 = _full.get("destination") != null ? String.valueOf(_full.get("destination")) : "(null)";
                Toast.makeText(this,
                    "🔬 Firebase: pickup=" + (_diagP1.length() > 30 ? _diagP1.substring(0, 30) + "…" : _diagP1)
                    + " | dest=" + (_diagD1.length() > 30 ? _diagD1.substring(0, 30) + "…" : _diagD1)
                    + " | rideId=" + rideId.substring(rideId.length() - 6),
                    Toast.LENGTH_LONG).show();
                // Audit-/Assign-/Status-Felder entfernen damit das Template eine
                // NEUE Buchung wird — Patrick setzt Datum neu, Cloud weist Fahrzeug
                // neu zu.
                Map<String, Object> _template = new HashMap<>(_full);
                _template.remove("pickupTimestamp");
                _template.remove("pickupTime");
                _template.remove("vehicleId");
                _template.remove("assignedVehicle");
                _template.remove("assignedTo");
                _template.remove("assignedAt");
                _template.remove("assignedBy");
                _template.remove("acceptedAt");
                _template.remove("acceptedVia");
                _template.remove("status");
                _template.remove("createdAt");
                _template.remove("updatedAt");
                _template.remove("completedAt");
                _template.remove("cancelledAt");
                _template.remove("cancelReason");
                _template.remove("invoiceNumber");
                _template.remove("paymentMethod");
                // 🆕 v6.62.546: Patrick (10.05.): "wir können den Preis nicht eintragen
                // oder verändern, dass wir als Vorlage schon den Festpreis eintragen
                // können. Sonst Stammfahrten dass ich die einfach bloss dupliziere und
                // der Preis übernommen wird." → price BLEIBT als Default im Template,
                // wird in der Maske vorbefuellt + ist editierbar. Kein remove mehr.
                _template.remove("editedAt");
                _template.remove("editedVia");
                _template.remove("source"); // wird auf 'native_vorbestellung_crmsearch' gesetzt
                Toast.makeText(this, "📋 Vorlage geladen — wähle neuen Termin", Toast.LENGTH_SHORT).show();
                showVorbestellungMaske(e, new ArrayList<>(), new HashMap<>(), null, _template);
            });
    }

    // 🆕 v6.62.483: Bearbeiten-Dialog für eine bestehende Vorbestellung. Lädt die volle
    //   Ride-Daten aus Firebase (nicht nur das Liste-Subset) und öffnet showVorbestellungMaske
    //   im Edit-Modus mit Pre-Fill aller Felder.
    private void openRideEditDialog(CrmEntry e, String rideId, Map<String, Object> rideListEntry) {
        final ProgressDialog _pd = new ProgressDialog(this);
        _pd.setMessage("Lade Fahrt-Details…");
        _pd.setCancelable(false);
        _pd.show();
        FirebaseDatabase.getInstance(DB_INSTANCE_URL).getReference("rides/" + rideId).get()
            .addOnCompleteListener(task -> {
                _pd.dismiss();
                if (!task.isSuccessful() || task.getResult() == null || !task.getResult().exists()) {
                    Toast.makeText(this, "❌ Fahrt nicht gefunden", Toast.LENGTH_LONG).show();
                    return;
                }
                Map<String, Object> _full = (Map<String, Object>) task.getResult().getValue();
                if (_full == null) {
                    Toast.makeText(this, "❌ Daten leer", Toast.LENGTH_LONG).show();
                    return;
                }
                // Top-Ziele für die Quick-Chips analog zum Anlegen-Flow
                showVorbestellungMaske(e, new ArrayList<>(), new HashMap<>(), rideId, _full);
            });
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

    // v6.62.293: Unified Vorbestellungs-Maske. Patrick (04.05. 22:30):
    // "Diese ganze CRM-Vorbestellungs-Dingsbums in der CRM-Suche ist nicht so wie eigentlich
    // wieder schoen waere — die gleiche Maske moechte ich haben fuer Stammkunden, aber halt
    // schon vorausgefuellt mit den Werten, die man so hat. Auch fuer Hotel mit Gastname und
    // Telefonnummer. Die gleiche Maske als wenn ein Fremder anruft und man darueber eine
    // Vorbestellung macht — Tausch-Button + Zwischenstops + Personen-Spinner + Datum/Zeit."
    // → Frueheres askGuestName-Popup entfaellt; Felder sind jetzt in der Maske.
    private void showVorbestellungDialogWithGuest(CrmEntry e) {
        showVorbestellungDialog(e);
    }

    // v6.62.293: Top-5 Ziele dieses Kunden laden, dann unified Maske oeffnen.
    private void showVorbestellungDialog(CrmEntry e) {
        if (e.id == null) {
            // Kein CRM-ID → Maske ohne Quick-Ziele oeffnen
            showVorbestellungMaske(e, new ArrayList<>(), new HashMap<>());
            return;
        }
        FirebaseDatabase.getInstance(DB_INSTANCE_URL).getReference("rides")
            .orderByChild("customerId").equalTo(e.id).limitToLast(80)
            .addListenerForSingleValueEvent(new ValueEventListener() {
                @Override public void onDataChange(@NonNull DataSnapshot snap) {
                    Map<String, Integer> destCount = new HashMap<>();
                    Map<String, double[]> destCoordsMap = new HashMap<>();
                    for (DataSnapshot c : snap.getChildren()) {
                        String dest = c.child("destination").getValue(String.class);
                        if (dest == null || dest.isEmpty()) continue;
                        destCount.merge(dest, 1, Integer::sum);
                        Object dl = c.child("destinationLat").getValue();
                        Object dn = c.child("destinationLon").getValue();
                        if (dl == null) dl = c.child("destCoords").child("lat").getValue();
                        if (dn == null) dn = c.child("destCoords").child("lon").getValue();
                        if (dl instanceof Number && dn instanceof Number && !destCoordsMap.containsKey(dest)) {
                            destCoordsMap.put(dest, new double[]{((Number)dl).doubleValue(), ((Number)dn).doubleValue()});
                        }
                    }
                    List<Map.Entry<String,Integer>> sorted = new ArrayList<>(destCount.entrySet());
                    sorted.sort((a,b) -> b.getValue() - a.getValue());
                    List<Map.Entry<String,Integer>> top = sorted.subList(0, Math.min(5, sorted.size()));
                    showVorbestellungMaske(e, top, destCoordsMap);
                }
                @Override public void onCancelled(@NonNull DatabaseError err) {
                    showVorbestellungMaske(e, new ArrayList<>(), new HashMap<>());
                }
            });
    }

    // v6.62.293: Die unified Vorbestellungs-Maske. Felder analog zu CallLogActivity:
    // Name, Pickup, Tausch, Quick-Ziele (Chips), Zielort, Zwischenstops, Personen-Spinner,
    // Datum/Zeit, Anlegen. Stammkunde: Pickup vorausgefuellt mit CRM-Adresse.
    // Hotel/Firma: Pickup leer, Ziel = Hotel-Adresse, plus Gastname + Gast-Telefon-Felder.
    // Default-Variante (Anlegen-Modus) — neue Vorbestellung pushen.
    private void showVorbestellungMaske(CrmEntry e, List<Map.Entry<String,Integer>> topDests, Map<String, double[]> destCoordsMap) {
        showVorbestellungMaske(e, topDests, destCoordsMap, null, null);
    }

    // 🆕 v6.62.483: Edit-Variante — bestehende Vorbestellung bearbeiten und updaten.
    //   Patrick (08.05. 14:54): "warum kann ich denn die Fahrten der Kunden nicht bearbeiten?"
    //   Wenn editRideId != null → ALLE Felder werden mit dem Ride pre-filled, Save updated
    //   die existierende Ride statt neue zu pushen. Bei Adress-/Termin-Änderung wird
    //   vehicleId/assignedAt/assignedBy genullt damit autoResolveConflicts neu zuweist.
    private void showVorbestellungMaske(CrmEntry e, List<Map.Entry<String,Integer>> topDests, Map<String, double[]> destCoordsMap, String editRideId, Map<String, Object> editRide) {
        final boolean isEdit = (editRideId != null && editRide != null);
        // 🆕 v6.62.503: hasTemplate = Pre-Fill aus altem Ride aktivieren auch wenn nicht
        //   im Edit-Modus (Patrick: 'vergangene fahrten kopieren für die zukunft als
        //   fahrt anlegen' — also Vorlage). isEdit bleibt false → Save = push neue.
        final boolean hasTemplate = (editRide != null);
        final boolean isHotel = isAuftraggeberCrm(e);
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        int pad = (int) (getResources().getDisplayMetrics().density * 16);
        int padHalf = (int) (getResources().getDisplayMetrics().density * 8);
        layout.setPadding(pad, pad, pad, pad);

        // v6.62.298: Patrick (05.05. 11:25): "speichern fehlt" — auf S9 wurde die
        // Buttons-Reihe vom AlertDialog abgeschnitten weil setMessage + langer setView
        // zusammen die Dialog-Hoehe ueberlaufen liessen. Loesung: Message in Layout-
        // TextView statt setMessage → Buttons-Reihe bleibt unten sichtbar.
        TextView tvKundeInfo = new TextView(this);
        tvKundeInfo.setText(isHotel
            ? "🏨 " + e.name + (telOrMobile(e).equals("—") ? "" : "  📞 " + telOrMobile(e))
            : "Kunde: " + (e.name != null ? e.name : "?") + (telOrMobile(e).equals("—") ? "" : "  📞 " + telOrMobile(e)));
        tvKundeInfo.setTextSize(12);
        tvKundeInfo.setTextColor(0xFF64748B);
        tvKundeInfo.setPadding(0, 0, 0, padHalf);
        layout.addView(tvKundeInfo);

        // 🔧 v6.62.711: Patrick (14.05. 10:27): "Wozu soll ich einen Kundennamen eingeben?
        //   Bei Frau Schindel? Brauche ich keinen Kundennamen eingeben — das ist eine
        //   Stammkundin." → Bei Stammkunden Name-Feld komplett weg, der Name wird
        //   automatisch aus e.name (CRM) im Save-Code uebernommen. Nur bei Hotels/Firmen
        //   bleibt das Feld sichtbar (Gastname-Erfassung fuer wen gebucht wird).
        final EditText etName;
        if (isHotel) {
            etName = new EditText(this);
            etName.setHint("Gastname (für den gebucht wird)");
            if (hasTemplate && editRide.get("guestName") != null) {
                etName.setText(String.valueOf(editRide.get("guestName")));
            }
            etName.setInputType(InputType.TYPE_TEXT_FLAG_CAP_WORDS);
            layout.addView(etName);
        } else {
            // Stammkunde — Name kommt aus e.name, kein Eingabefeld noetig
            etName = null;
            TextView tvKundeFest = new TextView(this);
            tvKundeFest.setText("👤 " + (e.name != null ? e.name : "—"));
            tvKundeFest.setTextSize(15);
            tvKundeFest.setTextColor(0xFF0F172A);
            tvKundeFest.setPadding(0, padHalf, 0, padHalf);
            layout.addView(tvKundeFest);
        }

        // 🔧 v6.62.711: Diagnose-Toast fuer Patricks Bug-Report (14.05. 10:11):
        //   "Bei vergangenen Fahrten uebernimmt er das Ziel nicht". Zeigt was im Template
        //   ankommt — falls destination wirklich null ist sehen wir es sofort.
        if (hasTemplate) {
            String _diagP = editRide.get("pickup") != null ? String.valueOf(editRide.get("pickup")) : "(null)";
            String _diagD = editRide.get("destination") != null ? String.valueOf(editRide.get("destination")) : "(null)";
            Toast.makeText(this,
                "📋 Template: pickup=" + (_diagP.length() > 30 ? _diagP.substring(0, 30) + "…" : _diagP)
                + " | dest=" + (_diagD.length() > 30 ? _diagD.substring(0, 30) + "…" : _diagD),
                Toast.LENGTH_LONG).show();
        }

        if (isHotel) {
            TextView tvAuftrag = new TextView(this);
            tvAuftrag.setText("📨 Auftraggeber: " + e.name + " (" + e.customerKind + ")");
            tvAuftrag.setTextSize(11);
            tvAuftrag.setTextColor(0xFF64748B);
            tvAuftrag.setPadding(0, 0, 0, padHalf);
            layout.addView(tvAuftrag);
        }

        // Gast-Telefon nur fuer Hotel/Firma sichtbar (wenn leer → Hotel-Tel als Fallback)
        final EditText etGuestPhone;
        if (isHotel) {
            etGuestPhone = new EditText(this);
            etGuestPhone.setHint("Telefon des Gastes (optional)");
            etGuestPhone.setInputType(InputType.TYPE_CLASS_PHONE);
            layout.addView(etGuestPhone);
        } else {
            etGuestPhone = null;
        }

        // Pickup + Destination als TextView-Buttons (Tap → MapPicker via launchPlaces)
        // Stammkunde: Pickup = CRM-Adresse, Ziel leer.
        // Hotel: Pickup leer, Ziel = Hotel-Adresse (per Tausch-Button umkehrbar).
        final double[] pickupCoords = { Double.NaN, Double.NaN };
        final double[] destCoords = { Double.NaN, Double.NaN };

        // v6.62.315: Patrick (05.05. 20:28): "Warum wird bei Stammkunden nicht der
        //   Abholort nicht automatisch gesetzt?" + (17:33): "warum wird bei der CRM-Suche
        //   nicht gleich der Abholort, also die Heimadresse, uebernommen". Vorher: bei
        //   Stammkunden Pickup vorausgefuellt, bei Hotels Adresse als Ziel (50/50-Annahme).
        //   Jetzt: ALLE CRM-Eintraege haben Pickup = e.address (Default = Adresse ist
        //   Abholort). Patrick fuellt nur Zielort. Tausch-Button kehrt um falls Gast
        //   ZUM Hotel/Kunden gefahren werden soll.
        TextView tvPickup = new TextView(this);
        // v6.62.483/.503: Im Edit-/Template-Modus Pickup aus Ride pre-fillen, sonst CRM-Adresse.
        if (hasTemplate && editRide.get("pickup") != null) {
            tvPickup.setText("📍 " + editRide.get("pickup"));
            Object _pl = editRide.get("pickupLat"), _po = editRide.get("pickupLon");
            if (_pl instanceof Number && _po instanceof Number) {
                pickupCoords[0] = ((Number) _pl).doubleValue();
                pickupCoords[1] = ((Number) _po).doubleValue();
            }
        } else if (e.address != null && !e.address.isEmpty()) {
            tvPickup.setText("📍 " + e.address);
            if (e.lat != null && e.lon != null) {
                pickupCoords[0] = e.lat; pickupCoords[1] = e.lon;
            } else {
                geocodeAddressIfNeeded(e, (lat, lon) -> {
                    if (lat != null) { pickupCoords[0] = lat; pickupCoords[1] = lon; }
                });
            }
        } else {
            tvPickup.setText("📍 Abholort wählen…");
        }
        tvPickup.setPadding(pad / 2, pad, pad / 2, pad);
        tvPickup.setOnClickListener(v -> launchPlaces(tvPickup, pickupCoords));
        layout.addView(tvPickup);

        TextView btnSwap = new TextView(this);
        btnSwap.setText("⇅ Abholort ↔ Ziel tauschen");
        btnSwap.setTextSize(13);
        btnSwap.setTextColor(0xFF1E40AF);
        btnSwap.setBackgroundColor(0xFFEFF6FF);
        btnSwap.setGravity(android.view.Gravity.CENTER);
        btnSwap.setPadding(padHalf, padHalf, padHalf, padHalf);
        LinearLayout.LayoutParams swapLp = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        swapLp.setMargins(0, padHalf / 2, 0, padHalf / 2);
        btnSwap.setLayoutParams(swapLp);
        layout.addView(btnSwap);

        TextView tvDest = new TextView(this);
        // v6.62.315: Zielort immer leer beim Oeffnen (Patrick fuellt aus)
        // v6.62.483/.503: Im Edit-/Template-Modus pre-fillen.
        if (hasTemplate && editRide.get("destination") != null) {
            tvDest.setText("🎯 " + editRide.get("destination"));
            Object _dl = editRide.get("destinationLat"), _do = editRide.get("destinationLon");
            if (_dl instanceof Number && _do instanceof Number) {
                destCoords[0] = ((Number) _dl).doubleValue();
                destCoords[1] = ((Number) _do).doubleValue();
            }
        } else {
            tvDest.setText("🎯 Zielort wählen…");
        }
        tvDest.setPadding(pad / 2, pad, pad / 2, pad);
        tvDest.setOnClickListener(v -> launchPlaces(tvDest, destCoords));
        layout.addView(tvDest);

        btnSwap.setOnClickListener(_v -> {
            String pickTxt = tvPickup.getText().toString();
            String destTxt = tvDest.getText().toString();
            String pickAddr = pickTxt.replaceFirst("^📍\\s*", "").replaceFirst("^🎯\\s*", "").trim();
            String destAddr = destTxt.replaceFirst("^📍\\s*", "").replaceFirst("^🎯\\s*", "").trim();
            tvPickup.setText("📍 " + (destAddr.endsWith("wählen…") ? "Abholort wählen…" : destAddr));
            tvDest.setText("🎯 " + (pickAddr.endsWith("wählen…") ? "Zielort wählen…" : pickAddr));
            double pl = pickupCoords[0], pn = pickupCoords[1];
            pickupCoords[0] = destCoords[0]; pickupCoords[1] = destCoords[1];
            destCoords[0] = pl; destCoords[1] = pn;
            Toast.makeText(this, "🔄 Getauscht", Toast.LENGTH_SHORT).show();
        });

        // Haeufige Ziele als Quick-Tap-Chips (Tap fuellt Zielfeld + Coords)
        if (!topDests.isEmpty()) {
            TextView tvQuickHeader = new TextView(this);
            tvQuickHeader.setText("⭐ Häufige Ziele (Tap füllt Zielort):");
            tvQuickHeader.setTextSize(12);
            tvQuickHeader.setTextColor(0xFF64748B);
            tvQuickHeader.setPadding(0, padHalf, 0, padHalf / 2);
            layout.addView(tvQuickHeader);

            for (Map.Entry<String, Integer> d : topDests) {
                final String destStr = d.getKey();
                final double[] coords = destCoordsMap.get(destStr);
                TextView chip = new TextView(this);
                chip.setText("⭐ " + destStr + "  (" + d.getValue() + "x)");
                chip.setTextSize(13);
                chip.setTextColor(0xFF1E40AF);
                chip.setBackgroundColor(0xFFEFF6FF);
                chip.setPadding(padHalf, padHalf, padHalf, padHalf);
                LinearLayout.LayoutParams chipLp = new LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
                chipLp.setMargins(0, padHalf / 4, 0, padHalf / 4);
                chip.setLayoutParams(chipLp);
                chip.setOnClickListener(_v -> {
                    tvDest.setText("🎯 " + destStr);
                    if (coords != null) { destCoords[0] = coords[0]; destCoords[1] = coords[1]; }
                    else { destCoords[0] = Double.NaN; destCoords[1] = Double.NaN; }
                    Toast.makeText(this, "🎯 Ziel: " + destStr, Toast.LENGTH_SHORT).show();
                });
                layout.addView(chip);
            }
        }

        // Zwischenstops-Sektion
        TextView tvWpHeader = new TextView(this);
        tvWpHeader.setText("🔶 Zwischenstops");
        tvWpHeader.setTextSize(13);
        tvWpHeader.setTextColor(0xFF374151);
        tvWpHeader.setPadding(0, pad, 0, padHalf);
        layout.addView(tvWpHeader);

        final LinearLayout wpContainer = new LinearLayout(this);
        wpContainer.setOrientation(LinearLayout.VERTICAL);
        layout.addView(wpContainer);

        final List<TextView> waypointFields = new ArrayList<>();
        final List<double[]> waypointCoords = new ArrayList<>();

        TextView btnAddWp = new TextView(this);
        btnAddWp.setText("+ Zwischenstopp hinzufügen");
        btnAddWp.setTextSize(13);
        btnAddWp.setTextColor(0xFF1E40AF);
        btnAddWp.setBackgroundColor(0xFFEFF6FF);
        btnAddWp.setGravity(android.view.Gravity.CENTER);
        btnAddWp.setPadding(padHalf, padHalf, padHalf, padHalf);
        LinearLayout.LayoutParams addLp = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        addLp.setMargins(0, padHalf / 2, 0, padHalf);
        btnAddWp.setLayoutParams(addLp);
        btnAddWp.setOnClickListener(_v -> {
            final double[] wpC = new double[]{Double.NaN, Double.NaN};
            waypointCoords.add(wpC);

            LinearLayout wpRow = new LinearLayout(this);
            wpRow.setOrientation(LinearLayout.HORIZONTAL);

            TextView tvWp = new TextView(this);
            tvWp.setText("🔶 Zwischenstopp wählen…");
            tvWp.setPadding(pad / 2, pad, pad / 2, pad);
            LinearLayout.LayoutParams wpLp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
            tvWp.setLayoutParams(wpLp);
            tvWp.setOnClickListener(__v -> launchPlaces(tvWp, wpC));
            wpRow.addView(tvWp);
            waypointFields.add(tvWp);

            TextView btnRemove = new TextView(this);
            btnRemove.setText("✕");
            btnRemove.setTextSize(18);
            btnRemove.setTextColor(0xFFDC2626);
            btnRemove.setPadding(pad, pad, pad, pad);
            btnRemove.setOnClickListener(__v -> {
                int pos = waypointFields.indexOf(tvWp);
                if (pos >= 0) {
                    waypointFields.remove(pos);
                    waypointCoords.remove(pos);
                }
                wpContainer.removeView(wpRow);
            });
            wpRow.addView(btnRemove);

            wpContainer.addView(wpRow);
            launchPlaces(tvWp, wpC);
        });
        layout.addView(btnAddWp);

        // v6.62.483/.503: Bei Edit/Template existierende Waypoints hinzufügen.
        if (hasTemplate && editRide.get("waypoints") != null) {
            try {
                Object _wpRaw = editRide.get("waypoints");
                List<Map<String, Object>> _existingWps = new ArrayList<>();
                if (_wpRaw instanceof List) {
                    for (Object o : (List<?>) _wpRaw) {
                        if (o instanceof Map) _existingWps.add((Map<String, Object>) o);
                    }
                } else if (_wpRaw instanceof Map) {
                    for (Object o : ((Map<?, ?>) _wpRaw).values()) {
                        if (o instanceof Map) _existingWps.add((Map<String, Object>) o);
                    }
                }
                for (Map<String, Object> _wp : _existingWps) {
                    String _addr = _wp.get("address") != null ? String.valueOf(_wp.get("address")) : "";
                    if (_addr.isEmpty()) continue;
                    final double[] wpC = new double[]{Double.NaN, Double.NaN};
                    Object _wlat = _wp.get("lat"), _wlon = _wp.get("lon");
                    if (_wlat instanceof Number && _wlon instanceof Number) {
                        wpC[0] = ((Number) _wlat).doubleValue();
                        wpC[1] = ((Number) _wlon).doubleValue();
                    }
                    waypointCoords.add(wpC);

                    LinearLayout wpRow = new LinearLayout(this);
                    wpRow.setOrientation(LinearLayout.HORIZONTAL);
                    TextView tvWp = new TextView(this);
                    tvWp.setText("🔶 " + _addr);
                    tvWp.setPadding(pad / 2, pad, pad / 2, pad);
                    LinearLayout.LayoutParams wpLp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
                    tvWp.setLayoutParams(wpLp);
                    tvWp.setOnClickListener(__v -> launchPlaces(tvWp, wpC));
                    wpRow.addView(tvWp);
                    waypointFields.add(tvWp);

                    TextView btnRemove = new TextView(this);
                    btnRemove.setText("✕");
                    btnRemove.setTextSize(18);
                    btnRemove.setTextColor(0xFFDC2626);
                    btnRemove.setPadding(pad, pad, pad, pad);
                    btnRemove.setOnClickListener(__v -> {
                        int pos = waypointFields.indexOf(tvWp);
                        if (pos >= 0) {
                            waypointFields.remove(pos);
                            waypointCoords.remove(pos);
                        }
                        wpContainer.removeView(wpRow);
                    });
                    wpRow.addView(btnRemove);
                    wpContainer.addView(wpRow);
                }
            } catch (Throwable _wpErr) { Log.w("CrmSearch", "Waypoint-Prefill: " + _wpErr.getMessage()); }
        }

        // Personen-Spinner (1-8, ab 5 = Bus)
        TextView tvPaxLabel = new TextView(this);
        tvPaxLabel.setText("👥 Personen:");
        tvPaxLabel.setTextSize(13);
        tvPaxLabel.setTextColor(0xFF374151);
        tvPaxLabel.setPadding(0, pad, 0, padHalf);
        layout.addView(tvPaxLabel);

        final android.widget.Spinner spnPax = new android.widget.Spinner(this);
        android.widget.ArrayAdapter<String> paxAdapter = new android.widget.ArrayAdapter<>(
            this, android.R.layout.simple_spinner_item,
            new String[]{"1 Person", "2 Personen", "3 Personen", "4 Personen",
                         "5 Personen (Bus)", "6 Personen (Bus)", "7 Personen (Bus)", "8 Personen (Bus)"});
        paxAdapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        spnPax.setAdapter(paxAdapter);
        // v6.62.483/.503: Personenzahl aus Edit-/Template-Ride pre-fillen
        if (hasTemplate && editRide.get("passengers") instanceof Number) {
            int _pax = ((Number) editRide.get("passengers")).intValue();
            if (_pax < 1) _pax = 1;
            if (_pax > 8) _pax = 8;
            spnPax.setSelection(_pax - 1);
        } else {
            spnPax.setSelection(0);
        }
        layout.addView(spnPax);

        // Datum + Zeit (Default: jetzt + 1h, im Edit-Modus = pickupTimestamp der Ride)
        java.util.Calendar cal = java.util.Calendar.getInstance();
        if (isEdit && editRide.get("pickupTimestamp") instanceof Number) {
            cal.setTimeInMillis(((Number) editRide.get("pickupTimestamp")).longValue());
        } else {
            cal.add(java.util.Calendar.HOUR_OF_DAY, 1);
        }
        final long[] datetime = { cal.getTimeInMillis() };

        TextView tvDate = new TextView(this);
        java.text.SimpleDateFormat dateFmt = new java.text.SimpleDateFormat("EEE dd.MM.yyyy HH:mm", Locale.GERMANY);
        tvDate.setPadding(0, pad, 0, pad);
        // 🆕 v6.62.540: Patrick (10.05.): "speere einbauen für bestellungen in der
        // vergangenheit". Inline-Hinweis am Label sobald gewaehlte Zeit < now.
        Runnable refreshDateLabel = () -> {
            long _now = System.currentTimeMillis();
            long _picked = datetime[0];
            if (_picked < _now) {
                long _minPast = (_now - _picked) / 60_000L;
                tvDate.setText("⚠️ " + dateFmt.format(_picked) + "  (" + _minPast + " Min in der Vergangenheit)");
                tvDate.setTextColor(0xFFDC2626); // rot
            } else if (_picked < _now + 5L * 60_000L) {
                tvDate.setText("⚠️ " + dateFmt.format(_picked) + "  (zu nah — nimm SOFORT-Fahrt)");
                tvDate.setTextColor(0xFFEA580C); // orange
            } else {
                tvDate.setText("📅 " + dateFmt.format(_picked));
                tvDate.setTextColor(0xFF1F2937); // dunkel
            }
        };
        refreshDateLabel.run();
        tvDate.setOnClickListener(v -> {
            java.util.Calendar curr = java.util.Calendar.getInstance();
            curr.setTimeInMillis(datetime[0]);
            android.app.DatePickerDialog dpd = new android.app.DatePickerDialog(this, (dp, y, mo, d) -> {
                new android.app.TimePickerDialog(this, (tp, h, mi) -> {
                    java.util.Calendar nc = java.util.Calendar.getInstance();
                    nc.set(y, mo, d, h, mi, 0);
                    datetime[0] = nc.getTimeInMillis();
                    refreshDateLabel.run();
                }, curr.get(java.util.Calendar.HOUR_OF_DAY), curr.get(java.util.Calendar.MINUTE), true).show();
            }, curr.get(java.util.Calendar.YEAR), curr.get(java.util.Calendar.MONTH), curr.get(java.util.Calendar.DAY_OF_MONTH));
            // 🆕 v6.62.540: kein Datum vor heute waehlbar
            java.util.Calendar _today = java.util.Calendar.getInstance();
            _today.set(java.util.Calendar.HOUR_OF_DAY, 0);
            _today.set(java.util.Calendar.MINUTE, 0);
            _today.set(java.util.Calendar.SECOND, 0);
            _today.set(java.util.Calendar.MILLISECOND, 0);
            dpd.getDatePicker().setMinDate(_today.getTimeInMillis());
            dpd.show();
        });
        layout.addView(tvDate);

        // 🆕 v6.62.608: Live-Konflikt-Check unter dem Datum-Picker
        // Patrick (11.05. 12:44): "baue das mal ein, dass ich zumindest weiss, ob der
        // Termin ueberlappt oder nicht ueberlappt".
        // Bei jeder Aenderung des datetime[]-Werts: Async Firebase-Query auf alle
        // aktiven Rides im Zeitfenster +/- 2h, dann pro Fahrzeug pruefen ob Overlap.
        // Zeigt 🟢 N Fahrer frei / 🟡 1 Fahrer frei / 🔴 alle besetzt unter dem Date-Picker.
        TextView tvKonflikt = new TextView(this);
        tvKonflikt.setText("🔍 Pruefe Konflikte...");
        tvKonflikt.setTextSize(13);
        tvKonflikt.setPadding(padHalf, padHalf, padHalf, padHalf);
        tvKonflikt.setBackgroundColor(0xFFF1F5F9);
        layout.addView(tvKonflikt);
        Runnable refreshKonflikt = () -> {
            tvKonflikt.setText("🔍 Pruefe Konflikte...");
            tvKonflikt.setBackgroundColor(0xFFF1F5F9);
            tvKonflikt.setTextColor(0xFF475569);
            final long newPickupTs = datetime[0];
            final long newEndTs = newPickupTs + 20L * 60_000L; // 20 Min Default-Dauer
            final long windowFrom = newPickupTs - 2L * 3600_000L;
            final long windowTo = newPickupTs + 2L * 3600_000L;
            final String _editRideIdFinal = editRideId;
            FirebaseDatabase.getInstance(DB_INSTANCE_URL).getReference("rides")
                .orderByChild("pickupTimestamp").startAt((double) windowFrom).endAt((double) windowTo)
                .get().addOnCompleteListener(task -> {
                    if (!task.isSuccessful() || task.getResult() == null) {
                        tvKonflikt.setText("⚠️ Konflikt-Check fehlgeschlagen — nimm an es passt");
                        tvKonflikt.setTextColor(0xFF92400E);
                        tvKonflikt.setBackgroundColor(0xFFFEF3C7);
                        return;
                    }
                    java.util.Map<String, java.util.List<long[]>> slotsPerVeh = new HashMap<>();
                    for (com.google.firebase.database.DataSnapshot s : task.getResult().getChildren()) {
                        String _rId = s.getKey();
                        if (_editRideIdFinal != null && _editRideIdFinal.equals(_rId)) continue;  // eigene Ride exkludieren
                        String _st = s.child("status").getValue(String.class);
                        if (_st == null) continue;
                        String _stLow = _st.toLowerCase();
                        if (_stLow.equals("deleted") || _stLow.equals("cancelled") || _stLow.equals("storniert")
                            || _stLow.equals("completed") || _stLow.equals("abgeschlossen")) continue;
                        String vid = s.child("assignedVehicle").getValue(String.class);
                        if (vid == null) vid = s.child("vehicleId").getValue(String.class);
                        if (vid == null) continue;
                        Long _pts = s.child("pickupTimestamp").getValue(Long.class);
                        if (_pts == null) continue;
                        Object _durObj = s.child("duration").getValue();
                        if (_durObj == null) _durObj = s.child("estimatedDuration").getValue();
                        int _dur = _durObj instanceof Number ? ((Number) _durObj).intValue() : 20;
                        long _rideEnd = _pts + (_dur + 4L) * 60_000L; // +4 Min Puffer (Boarding+Alighting)
                        if (!slotsPerVeh.containsKey(vid)) slotsPerVeh.put(vid, new ArrayList<>());
                        slotsPerVeh.get(vid).add(new long[]{ _pts, _rideEnd });
                    }
                    // Welche Fahrzeuge haben KEINEN Konflikt mit [newPickupTs, newEndTs]?
                    java.util.List<String> freie = new java.util.ArrayList<>();
                    java.util.List<String> konflikte = new java.util.ArrayList<>();
                    java.util.List<String> bekannteFzg = new java.util.ArrayList<>(java.util.Arrays.asList(
                        "pw-ik-222","pw-ki-222","pw-my-222-e","pw-ym-222-e","pw-sj-222","pw-sk-222","ovp-ii-600","ovp-ik-222","sbg-v-104","vg-lk-111"
                    ));
                    for (String vid : bekannteFzg) {
                        java.util.List<long[]> slots = slotsPerVeh.get(vid);
                        boolean hasConflict = false;
                        String konfDetail = "";
                        if (slots != null) {
                            for (long[] slot : slots) {
                                if (slot[0] < newEndTs && newPickupTs < slot[1]) {
                                    hasConflict = true;
                                    java.text.SimpleDateFormat _hm = new java.text.SimpleDateFormat("HH:mm", Locale.GERMANY);
                                    _hm.setTimeZone(java.util.TimeZone.getTimeZone("Europe/Berlin"));
                                    konfDetail = _hm.format(new java.util.Date(slot[0])) + "–" + _hm.format(new java.util.Date(slot[1]));
                                    break;
                                }
                            }
                        }
                        if (hasConflict) konflikte.add(vid + " (" + konfDetail + ")");
                        else freie.add(vid);
                    }
                    int free = freie.size();
                    if (free >= 3) {
                        tvKonflikt.setText("✅ " + free + " Fahrer haben um diese Zeit Platz");
                        tvKonflikt.setTextColor(0xFF065F46);
                        tvKonflikt.setBackgroundColor(0xFFD1FAE5);
                    } else if (free >= 1) {
                        tvKonflikt.setText("🟡 Nur " + free + " Fahrer frei — knapp besetzt");
                        tvKonflikt.setTextColor(0xFF92400E);
                        tvKonflikt.setBackgroundColor(0xFFFEF3C7);
                    } else {
                        StringBuilder sb = new StringBuilder("🔴 ALLE Fahrer um diese Zeit belegt!");
                        if (!konflikte.isEmpty()) {
                            sb.append("\nBelegt: ");
                            for (int i = 0; i < Math.min(3, konflikte.size()); i++) {
                                if (i > 0) sb.append(", ");
                                sb.append(konflikte.get(i));
                            }
                        }
                        tvKonflikt.setText(sb.toString());
                        tvKonflikt.setTextColor(0xFF991B1B);
                        tvKonflikt.setBackgroundColor(0xFFFEE2E2);
                    }
                });
        };
        // Bei DatePicker-Aenderung mit ausloesen
        Runnable origRefreshDate = refreshDateLabel;
        Runnable combinedRefresh = () -> { origRefreshDate.run(); refreshKonflikt.run(); };
        // tvDate-Click-Listener nutzt schon refreshDateLabel — ersetzen wir nicht, sondern
        // pollen via Handler die datetime[0]-Aenderung.
        final long[] lastPolledDt = { datetime[0] };
        final android.os.Handler _pollH = new android.os.Handler(android.os.Looper.getMainLooper());
        final Runnable _pollR = new Runnable() {
            @Override public void run() {
                if (datetime[0] != lastPolledDt[0]) {
                    lastPolledDt[0] = datetime[0];
                    refreshKonflikt.run();
                }
                _pollH.postDelayed(this, 500);
            }
        };
        _pollH.postDelayed(_pollR, 500);
        // Initial-Check
        refreshKonflikt.run();

        // 🆕 v6.62.479: Patrick (08.05. 12:43): "notizen bemerkungen fehlen".
        TextView tvNotesLabel = new TextView(this);
        tvNotesLabel.setText("📝 Notizen / Bemerkungen (optional)");
        tvNotesLabel.setTextSize(13);
        tvNotesLabel.setTextColor(0xFF374151);
        tvNotesLabel.setPadding(0, pad, 0, padHalf);
        layout.addView(tvNotesLabel);

        final EditText etNotes = new EditText(this);
        etNotes.setHint("z.B. Gepäck, Abholung am Hintereingang, Rollstuhl, …");
        etNotes.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES);
        etNotes.setMinLines(2);
        etNotes.setMaxLines(4);
        etNotes.setGravity(android.view.Gravity.TOP | android.view.Gravity.START);
        // v6.62.483/.503: Notizen pre-fillen
        if (hasTemplate && editRide.get("notes") != null) {
            etNotes.setText(String.valueOf(editRide.get("notes")));
        }
        layout.addView(etNotes);

        // 🆕 v6.62.570: Patrick (10.05. 15:46): "SMS verschicken muesste man auch
        // anwaehlen koennen, in der Vorbestellung Toggle setzen, SMS verschicken bei
        // Verspaetung oder nicht." Flag ride.notifyLateSms, default true.
        final android.widget.CheckBox cbLateSms = new android.widget.CheckBox(this);
        cbLateSms.setText("📲 Verspätungs-SMS an Kunde wenn Wagen sich verzögert");
        cbLateSms.setTextSize(13);
        cbLateSms.setChecked(true);
        if (hasTemplate && editRide != null && editRide.get("notifyLateSms") != null) {
            try { cbLateSms.setChecked(!Boolean.FALSE.equals(editRide.get("notifyLateSms"))); }
            catch (Throwable _ig) {}
        }
        LinearLayout.LayoutParams cbLp = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        cbLp.setMargins(0, padHalf, 0, 0);
        cbLateSms.setLayoutParams(cbLp);
        layout.addView(cbLateSms);

        // ═══ 🆕 v6.62.546: PREIS-FELD + FESTPREIS-AUTO-ANWENDUNG ═══
        // Patrick (10.05.): Festpreise sollen automatisch eingetragen werden wenn
        // pickup+dest mit hinterlegter Strecke matchen. Plus manueller Override
        // (Duplizieren-Flow: alter Preis vorbelegt, editierbar).
        TextView lblPrice = new TextView(this);
        lblPrice.setText("💰 Preis (leer = automatisch berechnen)");
        lblPrice.setTextSize(13);
        lblPrice.setTextColor(0xFF374151);
        lblPrice.setPadding(0, pad, 0, padHalf);
        layout.addView(lblPrice);

        final TextView tvFpBadge = new TextView(this);
        tvFpBadge.setTextSize(12);
        tvFpBadge.setTypeface(null, android.graphics.Typeface.BOLD);
        tvFpBadge.setPadding(pad / 2, pad / 4, pad / 2, pad / 4);
        tvFpBadge.setVisibility(View.GONE);
        layout.addView(tvFpBadge);

        final EditText etPrice = new EditText(this);
        etPrice.setHint("z.B. 12.50 (leer = OSRM-Tarifberechnung)");
        etPrice.setInputType(InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_FLAG_DECIMAL);
        // Vorbelegung im Edit/Template-Modus
        if (hasTemplate && editRide != null && editRide.get("price") != null) {
            Object _p = editRide.get("price");
            if (_p instanceof Number) etPrice.setText(String.format(Locale.GERMANY, "%.2f", ((Number)_p).doubleValue()));
            else if (_p != null) etPrice.setText(String.valueOf(_p));
        }
        layout.addView(etPrice);

        // Match-Logik: Festpreis-Suche wenn Coords aktualisiert werden
        final Runnable[] _checkFestpreis = { null };
        _checkFestpreis[0] = () -> {
            if (e == null || e.fixedRoutes == null || e.fixedRoutes.isEmpty()) return;
            if (Double.isNaN(pickupCoords[0]) || Double.isNaN(destCoords[0])) return;
            // Match: 200m-Toleranz auf BEIDEN Enden (Haversine)
            for (Map<String, Object> fr : e.fixedRoutes) {
                if (fr == null) continue;
                Object _fLat = fr.get("fromLat"), _fLon = fr.get("fromLon");
                Object _tLat = fr.get("toLat"), _tLon = fr.get("toLon");
                if (!(_fLat instanceof Number) || !(_fLon instanceof Number)) continue;
                if (!(_tLat instanceof Number) || !(_tLon instanceof Number)) continue;
                double frLat = ((Number)_fLat).doubleValue(), frLon = ((Number)_fLon).doubleValue();
                double toLat = ((Number)_tLat).doubleValue(), toLon = ((Number)_tLon).doubleValue();
                double d1 = haversineMeters(pickupCoords[0], pickupCoords[1], frLat, frLon);
                double d2 = haversineMeters(destCoords[0], destCoords[1], toLat, toLon);
                if (d1 <= 200 && d2 <= 200) {
                    Object _pr = fr.get("price");
                    double price = (_pr instanceof Number) ? ((Number)_pr).doubleValue() : 0;
                    String name = String.valueOf(fr.getOrDefault("name", ""));
                    tvFpBadge.setVisibility(View.VISIBLE);
                    tvFpBadge.setBackgroundColor(0xFFFEF3C7);
                    tvFpBadge.setTextColor(0xFF92400E);
                    tvFpBadge.setText("💰 FESTPREIS aktiv: " + (name.isEmpty() ? "Strecken-Pauschale" : name) + " — " + String.format(Locale.GERMANY, "%.2f", price) + " €");
                    // Nur ueberschreiben wenn etPrice leer ODER Festpreis-Match seit letztem Mal anders
                    if (etPrice.getText().toString().trim().isEmpty()) {
                        etPrice.setText(String.format(Locale.GERMANY, "%.2f", price));
                    }
                    return;
                }
            }
            // Kein Match → Badge wieder verstecken
            tvFpBadge.setVisibility(View.GONE);
        };
        // Trigger nach Picker-Returns: launchPlaces schreibt erst setText(addr) und
        // DANACH die Coords. TextWatcher feuert SYNCHRON im setText → Coords sind dann
        // noch NaN. Daher posten wir den Check mit 150ms Delay damit Coords gesetzt
        // sind. Funktioniert fuer alle Picker-Returns (pickup, dest, sowie Manual-Geocode).
        final android.os.Handler _fpHandler = new android.os.Handler(android.os.Looper.getMainLooper());
        final Runnable _fpDelayed = () -> _checkFestpreis[0].run();
        android.text.TextWatcher _fpWatcher = new android.text.TextWatcher() {
            @Override public void beforeTextChanged(CharSequence s, int start, int count, int after) {}
            @Override public void onTextChanged(CharSequence s, int start, int before, int count) {}
            @Override public void afterTextChanged(android.text.Editable s) {
                _fpHandler.removeCallbacks(_fpDelayed);
                _fpHandler.postDelayed(_fpDelayed, 150);
            }
        };
        tvPickup.addTextChangedListener(_fpWatcher);
        tvDest.addTextChangedListener(_fpWatcher);
        _checkFestpreis[0].run();

        // 🔧 v6.62.479: Patrick (08.05. 12:48): Speichern + Abbrechen sollen GROSS auf der
        //   Karte sein, nicht klein darunter. Buttons direkt ins Layout statt AlertDialog-Buttons.
        LinearLayout btnRow = new LinearLayout(this);
        btnRow.setOrientation(LinearLayout.HORIZONTAL);
        LinearLayout.LayoutParams btnRowLp = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        btnRowLp.setMargins(0, pad, 0, padHalf);
        btnRow.setLayoutParams(btnRowLp);

        TextView btnCancel = new TextView(this);
        btnCancel.setText("ABBRECHEN");
        btnCancel.setTextSize(14);
        btnCancel.setTextColor(0xFF64748B);
        btnCancel.setBackgroundColor(0xFFF1F5F9);
        btnCancel.setGravity(android.view.Gravity.CENTER);
        btnCancel.setPadding(pad, pad + padHalf / 2, pad, pad + padHalf / 2);
        LinearLayout.LayoutParams cancelLp2 = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        cancelLp2.setMargins(0, 0, padHalf / 2, 0);
        btnCancel.setLayoutParams(cancelLp2);
        btnRow.addView(btnCancel);

        TextView btnSave = new TextView(this);
        btnSave.setText(isEdit ? "✅ SPEICHERN" : "✅ ANLEGEN");
        btnSave.setTextSize(14);
        btnSave.setTypeface(null, android.graphics.Typeface.BOLD);
        btnSave.setTextColor(0xFFFFFFFF);
        btnSave.setBackgroundColor(0xFF1E40AF);
        btnSave.setGravity(android.view.Gravity.CENTER);
        btnSave.setPadding(pad, pad + padHalf / 2, pad, pad + padHalf / 2);
        LinearLayout.LayoutParams saveLp2 = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        saveLp2.setMargins(padHalf / 2, 0, 0, 0);
        btnSave.setLayoutParams(saveLp2);
        btnRow.addView(btnSave);
        layout.addView(btnRow);

        ScrollView scrollWrap = new ScrollView(this);
        scrollWrap.addView(layout);

        final AlertDialog dlg = new AlertDialog.Builder(this)
            .setTitle(isEdit ? "📝 Vorbestellung bearbeiten" : "📅 Vorbestellung anlegen")
            .setView(scrollWrap)
            .setCancelable(true)
            .create();

        btnCancel.setOnClickListener(_btn -> dlg.dismiss());

        // 🆕 v6.62.507: Save-Once-Flag (final Array fuer Lambda-Closure).
        //   Patrick (08.05. 17:47): Confirmation-OK-Klick triggerte zweiten Save.
        final boolean[] _alreadySavedRef = { false };

        btnSave.setOnClickListener(_btn -> {
                // 🔧 v6.62.711: etName ist null bei Stammkunden — Name aus e.name nehmen.
                String name = (etName != null)
                    ? etName.getText().toString().trim()
                    : (e.name != null ? e.name.trim() : "");
                String pickup = tvPickup.getText().toString()
                    .replaceFirst("^📍\\s*", "").replaceFirst("^🎯\\s*", "").trim();
                String dest = tvDest.getText().toString()
                    .replaceFirst("^🎯\\s*", "").replaceFirst("^📍\\s*", "").trim();
                if (name.isEmpty() || pickup.isEmpty() || pickup.endsWith("wählen…") ||
                    dest.isEmpty() || dest.endsWith("wählen…")) {
                    Toast.makeText(this, "Name + Abholort + Zielort wählen", Toast.LENGTH_LONG).show();
                    return;
                }
                if (Double.isNaN(pickupCoords[0]) || Double.isNaN(destCoords[0])) {
                    Toast.makeText(this, "❌ Adresse(n) noch nicht geocodiert — bitte Abholort/Zielort antippen + auswählen", Toast.LENGTH_LONG).show();
                    return;
                }
                int pax = spnPax.getSelectedItemPosition() + 1;
                if (pax < 1) pax = 1;
                if (pax > 8) pax = 8;

                long pickupTs = datetime[0];
                long now = System.currentTimeMillis();
                if (pickupTs < now + 5L * 60_000L) {
                    long minutesPast = (now - pickupTs) / 60_000L;
                    String msg = pickupTs < now
                        ? "❌ Pickup-Zeit liegt " + minutesPast + " Min in der Vergangenheit. Bitte Datum/Zeit ändern."
                        : "⚠️ Pickup-Zeit ist zu nah am Jetzt (<5 Min). Nutze SOFORT-Fahrt statt Vorbestellung.";
                    Toast.makeText(this, msg, Toast.LENGTH_LONG).show();
                    return;
                }

                final List<Map<String, Object>> waypointsList = new ArrayList<>();
                for (int wi = 0; wi < waypointFields.size(); wi++) {
                    String wpAddr = waypointFields.get(wi).getText().toString()
                        .replaceFirst("^🔶\\s*", "").replaceFirst("^📍\\s*", "").trim();
                    if (wpAddr.isEmpty() || wpAddr.endsWith("wählen…")) continue;
                    double[] wpC = waypointCoords.get(wi);
                    Map<String, Object> wpData = new HashMap<>();
                    wpData.put("address", wpAddr);
                    if (!Double.isNaN(wpC[0])) {
                        wpData.put("lat", wpC[0]);
                        wpData.put("lon", wpC[1]);
                    }
                    waypointsList.add(wpData);
                }

                Map<String, Object> r = new HashMap<>();
                if (isHotel) {
                    r.put("customerName", e.name);
                    r.put("guestName", name);
                    r.put("_isAuftraggeberBooking", true);
                    r.put("_auftraggeberAddress", e.address != null ? e.address : "");
                    r.put("_auftraggeberKind", e.customerKind);
                    if (e.lat != null) r.put("_auftraggeberLat", e.lat);
                    if (e.lon != null) r.put("_auftraggeberLon", e.lon);
                    String guestPhone = etGuestPhone != null ? etGuestPhone.getText().toString().trim() : "";
                    if (!guestPhone.isEmpty()) {
                        r.put("customerPhone", guestPhone);
                        r.put("customerMobile", guestPhone);
                    } else if (e.phone != null && !e.phone.isEmpty()) {
                        r.put("customerPhone", e.phone);
                    } else if (e.mobilePhone != null && !e.mobilePhone.isEmpty()) {
                        r.put("customerMobile", e.mobilePhone);
                    }
                } else {
                    r.put("customerName", name);
                    if (e.phone != null) r.put("customerPhone", e.phone);
                    if (e.mobilePhone != null) r.put("customerMobile", e.mobilePhone);
                }
                r.put("customerId", e.id);
                r.put("status", "vorbestellt");
                r.put("pickup", pickup);
                r.put("pickupLat", pickupCoords[0]);
                r.put("pickupLon", pickupCoords[1]);
                Map<String, Object> pc = new HashMap<>();
                pc.put("lat", pickupCoords[0]); pc.put("lon", pickupCoords[1]);
                r.put("pickupCoords", pc);
                r.put("destination", dest);
                r.put("destinationLat", destCoords[0]);
                r.put("destinationLon", destCoords[1]);
                Map<String, Object> dc = new HashMap<>();
                dc.put("lat", destCoords[0]); dc.put("lon", destCoords[1]);
                r.put("destCoords", dc);
                if (!waypointsList.isEmpty()) r.put("waypoints", waypointsList);
                r.put("pickupTimestamp", pickupTs);
                java.text.SimpleDateFormat tf = new java.text.SimpleDateFormat("HH:mm", Locale.GERMANY);
                tf.setTimeZone(java.util.TimeZone.getTimeZone("Europe/Berlin"));
                r.put("pickupTime", tf.format(new java.util.Date(pickupTs)));
                r.put("updatedAt", now);
                r.put("passengers", pax);
                // 🆕 v6.62.479: Notizen mitschreiben falls ausgefüllt
                String _notes = etNotes.getText().toString().trim();
                if (!_notes.isEmpty()) r.put("notes", _notes);
                else r.put("notes", null); // im Edit-Modus muss leer auch persistieren
                // 🆕 v6.62.570: Verspätungs-SMS-Flag persistieren
                r.put("notifyLateSms", cbLateSms.isChecked());

                // 🆕 v6.62.546: Manueller Preis (Festpreis-Match oder Duplizieren-Override).
                // Wenn etPrice gefuellt ist → wird in Firebase als 'price' gesetzt + isFixedPrice
                // Flag markiert; Cloud-Function ueberschreibt den nicht. Leer = OSRM-Tarif.
                String _priceStr = etPrice.getText().toString().trim().replace(',', '.');
                if (!_priceStr.isEmpty()) {
                    try {
                        double _pVal = Double.parseDouble(_priceStr);
                        if (_pVal > 0) {
                            r.put("price", _pVal);
                            // Festpreis-Flag NUR wenn Badge sichtbar (also Match war erfolgreich).
                            // Sonst ist's ein manueller Preis (z.B. Duplizieren-Override).
                            r.put("priceSource", tvFpBadge.getVisibility() == View.VISIBLE ? "fixedRoute" : "manual");
                            if (tvFpBadge.getVisibility() == View.VISIBLE) r.put("isFixedPrice", true);
                        }
                    } catch (Exception _ig) { /* Preis-Parse-Fehler: ignorieren, Backend rechnet */ }
                }

                // 🆕 v6.62.507: Patrick (08.05. 17:47): "fahrt wird angelegt → bestätigung →
                //   ok drücken → wird nochmal angelegt". Defensive Safety-Flag zusätzlich
                //   zum Click-Lock — verhindert ALLE Reentries (UI-Tap-Throughs etc.).
                if (_alreadySavedRef[0]) {
                    Log.w("CrmSearch", "Save bereits durchgeführt — ignoriere zweiten Klick");
                    return;
                }
                _alreadySavedRef[0] = true;

                // 🆕 v6.62.504: Click-Lock
                btnSave.setEnabled(false);
                btnSave.setText(isEdit ? "⏳ Speichere…" : "⏳ Anlege…");
                btnSave.setBackgroundColor(0xFF94A3B8);

                if (isEdit) {
                    // 🆕 v6.62.483: Update bestehende Ride. createdAt/source/customerId
                    //   bleiben erhalten (werden nicht überschrieben).
                    // Bei Adress- oder Termin-Änderung: vehicleId/assignedAt/assignedBy
                    //   nullen, damit autoResolveConflicts neu zuweist.
                    Object _oldPickupTs = editRide.get("pickupTimestamp");
                    Object _oldPickup = editRide.get("pickup");
                    Object _oldDest = editRide.get("destination");
                    boolean _termChanged = !(_oldPickupTs instanceof Number) || ((Number) _oldPickupTs).longValue() != pickupTs;
                    boolean _addrChanged = !pickup.equals(_oldPickup) || !dest.equals(_oldDest);
                    if (_termChanged || _addrChanged) {
                        r.put("vehicleId", null);
                        r.put("assignedVehicle", null);
                        r.put("assignedTo", null);
                        r.put("assignedAt", null);
                        r.put("assignedBy", null);
                        r.put("acceptedAt", null);
                        r.put("acceptedVia", null);
                        // status auf 'vorbestellt' zurücksetzen falls schon assigned/accepted war
                        if (!"vorbestellt".equals(editRide.get("status"))) {
                            r.put("status", "vorbestellt");
                        }
                    }
                    r.put("editedAt", now);
                    r.put("editedVia", "native_crm_history_edit");

                    final String _notesFinal = _notes;
                    final int _paxFinal = pax;
                    FirebaseDatabase.getInstance(DB_INSTANCE_URL).getReference("rides/" + editRideId).updateChildren(r)
                        .addOnSuccessListener(_v -> {
                            dlg.dismiss();
                            showBookingConfirmation(true, name, pickup, dest, pickupTs, _paxFinal, _notesFinal, isHotel ? e.name : null);
                        })
                        .addOnFailureListener(ex -> {
                            Toast.makeText(this, "Fehler: " + ex.getMessage(), Toast.LENGTH_LONG).show();
                            // v6.62.504/.507: Bei Fehler Button reaktivieren + Save-Flag zurueck
                            _alreadySavedRef[0] = false;
                            btnSave.setEnabled(true);
                            btnSave.setText("✅ SPEICHERN");
                            btnSave.setBackgroundColor(0xFF1E40AF);
                        });
                } else {
                    r.put("createdAt", now);
                    r.put("source", "native_vorbestellung_crmsearch");
                    final String _notesFinal2 = _notes;
                    final int _paxFinal2 = pax;
                    final String _custIdForDup = e.id;
                    final long _pickupTsFinal = pickupTs;
                    final boolean _isHotelFinal = isHotel;
                    final String _hotelNameFinal = e.name;
                    final String _customerNameFinal = name;
                    final String _pickupFinal = pickup;
                    final String _destFinal = dest;
                    // Closure: eigentlicher Save-Vorgang (gleicher Code wie vorher)
                    Runnable doActualSave = () -> {
                        FirebaseDatabase.getInstance(DB_INSTANCE_URL).getReference("rides").push().setValue(r)
                            .addOnSuccessListener(_v -> {
                                dlg.dismiss();
                                showBookingConfirmation(false, _customerNameFinal, _pickupFinal, _destFinal, _pickupTsFinal, _paxFinal2, _notesFinal2, _isHotelFinal ? _hotelNameFinal : null);
                            })
                            .addOnFailureListener(ex -> {
                                Toast.makeText(this, "Fehler: " + ex.getMessage(), Toast.LENGTH_LONG).show();
                                // v6.62.504/.507: Bei Fehler Button reaktivieren + Save-Flag zurueck
                                _alreadySavedRef[0] = false;
                                btnSave.setEnabled(true);
                                btnSave.setText("✅ ANLEGEN");
                                btnSave.setBackgroundColor(0xFF1E40AF);
                            });
                    };
                    // 🆕 v6.62.523: Duplikat-Erkennung — Patrick (09.05.): Werner hatte gestern
                    // Abend ZWEI Buchungen (eine aus Anrufliste, eine via CRM-Suche), die als
                    // Duplikat unentdeckt blieben. Dariusz ist heute morgen trotz Storno
                    // der zweiten zur ersten gefahren. Jetzt: vor jedem CRM-Suche-Anlegen
                    // prüfen ob für diesen Kunden schon eine aktive Buchung ±15 Min vorliegt.
                    if (_custIdForDup == null || _custIdForDup.isEmpty()) {
                        doActualSave.run();
                    } else {
                        FirebaseDatabase.getInstance(DB_INSTANCE_URL).getReference("rides")
                            .orderByChild("customerId").equalTo(_custIdForDup)
                            .addListenerForSingleValueEvent(new ValueEventListener() {
                                @Override
                                public void onDataChange(@NonNull DataSnapshot snap) {
                                    java.util.List<DataSnapshot> dups = new java.util.ArrayList<>();
                                    for (DataSnapshot c : snap.getChildren()) {
                                        String st = c.child("status").getValue(String.class);
                                        if (st == null) continue;
                                        String stl = st.toLowerCase();
                                        if (stl.equals("completed") || stl.equals("abgeschlossen") || stl.equals("cancelled") || stl.equals("canceled") || stl.equals("storniert") || stl.equals("deleted") || stl.equals("rejected")) continue;
                                        Long pt = c.child("pickupTimestamp").getValue(Long.class);
                                        if (pt == null) continue;
                                        if (Math.abs(pt - _pickupTsFinal) > 15L * 60_000L) continue;
                                        dups.add(c);
                                    }
                                    if (dups.isEmpty()) {
                                        doActualSave.run();
                                        return;
                                    }
                                    StringBuilder msg = new StringBuilder();
                                    msg.append("Für ").append(_customerNameFinal).append(" gibt es bereits ")
                                       .append(dups.size()).append(dups.size() == 1 ? " Buchung" : " Buchungen")
                                       .append(" in der Nähe dieser Zeit (±15 Min):\n\n");
                                    java.text.SimpleDateFormat dtf = new java.text.SimpleDateFormat("dd.MM. HH:mm", Locale.GERMANY);
                                    dtf.setTimeZone(java.util.TimeZone.getTimeZone("Europe/Berlin"));
                                    for (DataSnapshot c : dups) {
                                        Long pt = c.child("pickupTimestamp").getValue(Long.class);
                                        String src = c.child("source").getValue(String.class);
                                        String pickup2 = c.child("pickup").getValue(String.class);
                                        String st2 = c.child("status").getValue(String.class);
                                        msg.append("• ").append(dtf.format(new java.util.Date(pt)));
                                        if (st2 != null) msg.append(" [").append(st2).append("]");
                                        msg.append("\n  ").append(pickup2 != null ? pickup2 : "?");
                                        if (src != null) msg.append("\n  Quelle: ").append(src);
                                        msg.append("\n");
                                    }
                                    msg.append("\nTrotzdem zusätzlich anlegen?");
                                    new AlertDialog.Builder(CrmSearchActivity.this)
                                        .setTitle("⚠️ Mögliches Duplikat")
                                        .setMessage(msg.toString())
                                        .setPositiveButton("Trotzdem anlegen", (d2, w2) -> doActualSave.run())
                                        .setNegativeButton("Abbrechen", (d2, w2) -> {
                                            _alreadySavedRef[0] = false;
                                            btnSave.setEnabled(true);
                                            btnSave.setText("✅ ANLEGEN");
                                            btnSave.setBackgroundColor(0xFF1E40AF);
                                        })
                                        .setCancelable(false)
                                        .show();
                                }
                                @Override public void onCancelled(@NonNull DatabaseError err) {
                                    Log.w("CrmSearch", "Duplikat-Check fehlgeschlagen: " + err.getMessage() + " — lege trotzdem an");
                                    doActualSave.run();
                                }
                            });
                    }
                }
        });

        dlg.show();
    }

    // 🆕 v6.62.485: Confirmation-Screen nach erfolgreichem Anlegen/Bearbeiten.
    //   Patrick (08.05.2026 13:18): "kann man das so machen, wenn ich das erstelle im Handy,
    //   dass ich dann nochmal eine Übersicht sehe, was alles drinnen steht, damit ich das
    //   abspeichern kann". Vorher: Toast 'angelegt' und Activity finish — Patrick sah nicht
    //   nochmal alle Werte.
    private void showBookingConfirmation(boolean isUpdate, String name, String pickup,
                                         String dest, long pickupTs, int passengers,
                                         String notes, String auftraggeberName) {
        java.text.SimpleDateFormat fmt = new java.text.SimpleDateFormat("EEEE, dd.MM.yyyy 'um' HH:mm 'Uhr'", Locale.GERMANY);
        fmt.setTimeZone(java.util.TimeZone.getTimeZone("Europe/Berlin"));
        StringBuilder msg = new StringBuilder();
        msg.append(isUpdate ? "✅ Vorbestellung AKTUALISIERT\n\n" : "✅ Vorbestellung GESPEICHERT\n\n");
        if (auftraggeberName != null) {
            msg.append("🏨 Auftraggeber: ").append(auftraggeberName).append("\n");
            msg.append("👤 Gast: ").append(name).append("\n");
        } else {
            msg.append("👤 Name: ").append(name).append("\n");
        }
        msg.append("📅 Termin: ").append(fmt.format(new java.util.Date(pickupTs))).append("\n");
        msg.append("📍 Pickup: ").append(pickup).append("\n");
        msg.append("🎯 Ziel: ").append(dest).append("\n");
        msg.append("👥 Personen: ").append(passengers);
        if (notes != null && !notes.trim().isEmpty()) {
            msg.append("\n📝 Notiz: ").append(notes);
        }

        new AlertDialog.Builder(this)
            .setTitle(isUpdate ? "📝 Aktualisiert" : "📅 Angelegt")
            .setMessage(msg.toString())
            .setPositiveButton("OK", (d, w) -> {
                if (!isUpdate) finish(); // beim Anlegen: Activity schließen
                // beim Bearbeiten: nur Dialog schließen, User bleibt in der Fahrt-Historie
            })
            .setNeutralButton("📋 Kopieren", (d, w) -> {
                android.content.ClipboardManager cm = (android.content.ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
                if (cm != null) {
                    cm.setPrimaryClip(android.content.ClipData.newPlainText("Vorbestellung", msg.toString()));
                    Toast.makeText(this, "📋 In Zwischenablage kopiert", Toast.LENGTH_SHORT).show();
                }
                if (!isUpdate) finish();
            })
            .setCancelable(false)
            .show();
    }

    // v6.62.384: Patrick (06.05. 19:40): "Kunde anlegen in der Native-App".
    // Leerer Entry → Dialog laeuft im Anlegen-Modus, beim Speichern push() statt update.
    private void openCreateDialog() {
        CrmEntry empty = new CrmEntry();
        openEditDialog(empty);
    }

    // 🆕 v6.62.546: Haversine-Distanz in Metern fuer Festpreis-Match-Toleranz (200m).
    private static double haversineMeters(double lat1, double lon1, double lat2, double lon2) {
        if (Double.isNaN(lat1) || Double.isNaN(lon1) || Double.isNaN(lat2) || Double.isNaN(lon2)) return Double.MAX_VALUE;
        final double R = 6371000.0;
        double dLat = Math.toRadians(lat2 - lat1);
        double dLon = Math.toRadians(lon2 - lon1);
        double a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
                 + Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2))
                 * Math.sin(dLon / 2) * Math.sin(dLon / 2);
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    // 🆕 v6.62.545: Modal zum Hinzufuegen/Bearbeiten eines einzelnen Festpreises.
    // Patrick (10.05.): "wenn jetzt zum Beispiel Bahnhof Hotel, dass ich dahinter
    // dann auch den Preis eintragen kann was das kostet". Picker via launchPlaces
    // (gleiche Maps-Autocomplete-Komponente wie der Adress-Picker im CRM-Edit).
    private interface FixedRouteCallback { void onSave(Map<String, Object> fr); }
    private void openFestpreisEditDialog(Map<String, Object> existing, FixedRouteCallback cb) {
        ScrollView scroll = new ScrollView(this);
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        int pad = (int) (getResources().getDisplayMetrics().density * 16);
        layout.setPadding(pad, pad, pad, pad);
        scroll.addView(layout);

        TextView lblName = new TextView(this);
        lblName.setText("📛 Bezeichnung (z.B. Bahnhof → Hotel)");
        lblName.setTextSize(12);
        layout.addView(lblName);
        EditText etName = new EditText(this);
        etName.setHint("z.B. Bahnhof Heringsdorf zum Hotel");
        if (existing != null) etName.setText(String.valueOf(existing.getOrDefault("name", "")));
        layout.addView(etName);

        final double[] fromCoords = { Double.NaN, Double.NaN };
        if (existing != null) {
            Object _l = existing.get("fromLat"); if (_l instanceof Number) fromCoords[0] = ((Number)_l).doubleValue();
            Object _o = existing.get("fromLon"); if (_o instanceof Number) fromCoords[1] = ((Number)_o).doubleValue();
        }
        TextView lblFrom = new TextView(this);
        lblFrom.setText("🚏 Von");
        lblFrom.setTextSize(12);
        lblFrom.setPadding(0, pad, 0, pad / 4);
        layout.addView(lblFrom);
        TextView tvFrom = new TextView(this);
        tvFrom.setPadding(pad / 2, pad, pad / 2, pad);
        String _existingFrom = existing != null ? String.valueOf(existing.getOrDefault("fromName", "")) : "";
        tvFrom.setText(_existingFrom.isEmpty() ? "📍 Von-Adresse waehlen…" : "📍 " + _existingFrom);
        tvFrom.setOnClickListener(_v -> launchPlaces(tvFrom, fromCoords));
        layout.addView(tvFrom);

        final double[] toCoords = { Double.NaN, Double.NaN };
        if (existing != null) {
            Object _l = existing.get("toLat"); if (_l instanceof Number) toCoords[0] = ((Number)_l).doubleValue();
            Object _o = existing.get("toLon"); if (_o instanceof Number) toCoords[1] = ((Number)_o).doubleValue();
        }
        TextView lblTo = new TextView(this);
        lblTo.setText("🎯 Nach");
        lblTo.setTextSize(12);
        lblTo.setPadding(0, pad, 0, pad / 4);
        layout.addView(lblTo);
        TextView tvTo = new TextView(this);
        tvTo.setPadding(pad / 2, pad, pad / 2, pad);
        String _existingTo = existing != null ? String.valueOf(existing.getOrDefault("toName", "")) : "";
        tvTo.setText(_existingTo.isEmpty() ? "🎯 Nach-Adresse waehlen…" : "🎯 " + _existingTo);
        tvTo.setOnClickListener(_v -> launchPlaces(tvTo, toCoords));
        layout.addView(tvTo);

        TextView lblPr = new TextView(this);
        lblPr.setText("💰 Preis (in Euro)");
        lblPr.setTextSize(12);
        lblPr.setPadding(0, pad, 0, pad / 4);
        layout.addView(lblPr);
        EditText etPrice = new EditText(this);
        etPrice.setHint("z.B. 12.50");
        etPrice.setInputType(InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_FLAG_DECIMAL);
        if (existing != null) {
            Object _p = existing.get("price");
            if (_p instanceof Number) etPrice.setText(String.format(Locale.GERMANY, "%.2f", ((Number)_p).doubleValue()));
            else if (_p != null) etPrice.setText(String.valueOf(_p));
        }
        layout.addView(etPrice);

        new AlertDialog.Builder(this)
            .setTitle(existing != null ? "✏️ Festpreis bearbeiten" : "➕ Festpreis hinzufuegen")
            .setView(scroll)
            .setPositiveButton(existing != null ? "Speichern" : "Hinzufuegen", (d, w) -> {
                String name = etName.getText().toString().trim();
                String fromName = tvFrom.getText().toString().replaceFirst("^📍 ", "").trim();
                String toName = tvTo.getText().toString().replaceFirst("^🎯 ", "").trim();
                String priceStr = etPrice.getText().toString().trim().replace(',', '.');
                if (fromName.isEmpty() || fromName.endsWith("waehlen…") || toName.isEmpty() || toName.endsWith("waehlen…")) {
                    Toast.makeText(this, "Von- und Nach-Adresse waehlen", Toast.LENGTH_LONG).show();
                    return;
                }
                double price;
                try { price = Double.parseDouble(priceStr); } catch (Exception _e) {
                    Toast.makeText(this, "Preis als Zahl angeben (z.B. 12.50)", Toast.LENGTH_LONG).show();
                    return;
                }
                if (price <= 0) {
                    Toast.makeText(this, "Preis muss > 0 sein", Toast.LENGTH_LONG).show();
                    return;
                }
                Map<String, Object> fr = existing != null ? new HashMap<>(existing) : new HashMap<>();
                if (!fr.containsKey("id")) fr.put("id", "fp_" + System.currentTimeMillis());
                fr.put("name", name);
                fr.put("fromName", fromName);
                if (!Double.isNaN(fromCoords[0])) { fr.put("fromLat", fromCoords[0]); fr.put("fromLon", fromCoords[1]); }
                fr.put("toName", toName);
                if (!Double.isNaN(toCoords[0])) { fr.put("toLat", toCoords[0]); fr.put("toLon", toCoords[1]); }
                fr.put("price", price);
                fr.put("updatedAt", System.currentTimeMillis());
                cb.onSave(fr);
            })
            .setNegativeButton("Abbrechen", null)
            .show();
    }

    // v6.62.603: Patrick (11.05. 08:38): "wichtig hier in der Native-App nochmal drauf
    //   zu drücken, wenn ich es manuell ändern will, dass ich den Anruf nochmal abhören
    //   kann, direkt aus der App."
    //
    // ACR Phone-Recorder speichert Aufnahmen lokal nach folgendem Pfad-Schema:
    //   /sdcard/ACRCalls/ACRPhone/YYYY/MM/DD/+TelNr/...m4a
    // Wir scannen den Ordner, filtern nach Telefon-Nummern dieses CRM-Kunden (Last-9-Match
    // gegen phone, mobilePhone, phone2, additionalPhones[*]), und zeigen die Liste in einem
    // Dialog. Tap → Player via Intent.ACTION_VIEW (System-Music-App).
    //
    // Permission: MANAGE_EXTERNAL_STORAGE noetig auf Android 11+ — wenn nicht erteilt,
    // oeffnet die Methode die System-Einstellungen.
    private void showCallRecordings(CrmEntry e) {
        // 1) Permission-Check Android 11+
        if (android.os.Build.VERSION.SDK_INT >= 30) {  // Android 11
            if (!android.os.Environment.isExternalStorageManager()) {
                new AlertDialog.Builder(this)
                    .setTitle("📞 Berechtigung benoetigt")
                    .setMessage("Um ACR-Aufnahmen zu lesen, brauche ich Zugriff auf den /sdcard-Ordner.\n\nIch oeffne jetzt die Einstellungen — bitte 'Alle Dateien verwalten' fuer Funk-Taxi aktivieren und zurueck.")
                    .setPositiveButton("Einstellungen oeffnen", (d, w) -> {
                        try {
                            Intent intent = new Intent(android.provider.Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION);
                            intent.setData(android.net.Uri.parse("package:" + getPackageName()));
                            startActivity(intent);
                        } catch (Exception ex) {
                            startActivity(new Intent(android.provider.Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION));
                        }
                    })
                    .setNegativeButton("Abbrechen", null)
                    .show();
                return;
            }
        }

        // 2) Telefon-Nummern dieses Kunden sammeln (last-9-digits-Match)
        java.util.Set<String> phoneSuffixes = new java.util.HashSet<>();
        java.util.function.Consumer<String> _addP = p -> {
            if (p == null) return;
            String digits = p.replaceAll("[^0-9]", "");
            if (digits.length() >= 9) phoneSuffixes.add(digits.substring(digits.length() - 9));
        };
        _addP.accept(e.phone);
        _addP.accept(e.mobilePhone);
        _addP.accept(e.phone2);
        if (e.additionalPhones != null) for (String p : e.additionalPhones) _addP.accept(p);

        if (phoneSuffixes.isEmpty()) {
            Toast.makeText(this, "❌ Keine Telefonnummer im CRM-Kunden hinterlegt.", Toast.LENGTH_LONG).show();
            return;
        }

        // 3) ACR-Ordner scannen (im Background-Thread)
        ProgressDialog pd = new ProgressDialog(this);
        pd.setMessage("📞 Scanne /sdcard/ACRCalls...");
        pd.setCancelable(false);
        pd.show();

        new Thread(() -> {
            java.util.List<java.io.File> matched = new java.util.ArrayList<>();
            java.io.File root = new java.io.File("/sdcard/ACRCalls");
            if (root.exists() && root.isDirectory()) {
                scanAcrRecursive(root, phoneSuffixes, matched, 0);
            }
            // Sortiere nach Modifikationsdatum descending
            matched.sort((a, b) -> Long.compare(b.lastModified(), a.lastModified()));

            runOnUiThread(() -> {
                pd.dismiss();
                if (matched.isEmpty()) {
                    new AlertDialog.Builder(this)
                        .setTitle("📞 Keine Aufnahmen")
                        .setMessage("Im /sdcard/ACRCalls-Ordner wurden keine Aufnahmen fuer diese Telefonnummern gefunden.\n\nGesucht nach Last-9 Match auf: " + String.join(", ", phoneSuffixes))
                        .setPositiveButton("OK", null)
                        .show();
                    return;
                }
                // Liste der Aufnahmen anzeigen
                String[] labels = new String[matched.size()];
                java.text.SimpleDateFormat fmt = new java.text.SimpleDateFormat("dd.MM.yy HH:mm", Locale.GERMANY);
                fmt.setTimeZone(java.util.TimeZone.getTimeZone("Europe/Berlin"));
                for (int i = 0; i < matched.size(); i++) {
                    java.io.File f = matched.get(i);
                    String date = fmt.format(new java.util.Date(f.lastModified()));
                    long sizeMb = f.length() / 1024 / 1024;
                    long sizeKb = (f.length() / 1024) % 1024;
                    String size = sizeMb > 0 ? sizeMb + "." + (sizeKb * 10 / 1024) + " MB" : (f.length() / 1024) + " KB";
                    labels[i] = "📅 " + date + " · " + size + "\n" + f.getName();
                }
                new AlertDialog.Builder(this)
                    .setTitle("📞 " + (e.name != null ? e.name : "Kunde") + " — " + matched.size() + " Anruf" + (matched.size() == 1 ? "" : "e"))
                    .setItems(labels, (d, w) -> playCallRecording(matched.get(w)))
                    .setNegativeButton("Schliessen", null)
                    .show();
            });
        }, "acr-scanner").start();
    }

    // Recursive scan — sucht nach m4a-Dateien deren Pfad eine der Telefon-Suffixe enthaelt.
    // Maximale Rekursionstiefe 6 (YYYY/MM/DD/+TelNr/file = 5 Levels unter ACRCalls/).
    private void scanAcrRecursive(java.io.File dir, java.util.Set<String> phoneSuffixes,
                                  java.util.List<java.io.File> out, int depth) {
        if (depth > 6 || out.size() > 100) return;
        java.io.File[] children = dir.listFiles();
        if (children == null) return;
        for (java.io.File c : children) {
            if (c.isDirectory()) {
                scanAcrRecursive(c, phoneSuffixes, out, depth + 1);
            } else if (c.getName().toLowerCase().endsWith(".m4a") || c.getName().toLowerCase().endsWith(".mp3") || c.getName().toLowerCase().endsWith(".wav")) {
                // Pfad-Match: enthaelt der absolute Pfad eine der Phone-Suffixe?
                String fullPath = c.getAbsolutePath();
                String fullDigits = fullPath.replaceAll("[^0-9]", "");
                for (String suffix : phoneSuffixes) {
                    if (fullDigits.contains(suffix)) {
                        out.add(c);
                        break;
                    }
                }
            }
        }
    }

    private void playCallRecording(java.io.File f) {
        try {
            android.net.Uri uri = androidx.core.content.FileProvider.getUriForFile(
                this, getPackageName() + ".fileprovider", f);
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(uri, "audio/*");
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            startActivity(Intent.createChooser(intent, "Aufnahme oeffnen mit..."));
        } catch (Exception ex) {
            Toast.makeText(this, "❌ Kann Aufnahme nicht oeffnen: " + ex.getMessage(), Toast.LENGTH_LONG).show();
            Log.e("ACR", "playCallRecording fail", ex);
        }
    }

    private void openEditDialog(CrmEntry e) {
        final boolean isNew = (e.id == null || e.id.isEmpty());
        ScrollView scroll = new ScrollView(this);
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        int pad = (int) (getResources().getDisplayMetrics().density * 16);
        layout.setPadding(pad, pad, pad, pad);
        scroll.addView(layout);

        // 🆕 v6.62.544: Patrick (10.05.): "wenn ich einen neuen Kunden anlegen moechte,
        //   dann muss Stammkunde, Hotel, Gelegenheitskunde, muss auch alles auswaehlbar
        //   sein... wenn es jetzt ein Hotel ist, dass es gleich als Hotel angelegt wird."
        //   Form-Reihenfolge wie Web-CRM: KUNDENART OBEN als grosse Buttons, der Rest
        //   passt sich an (Hotel/Firma blendet Vorname aus, Nachname-Label wird zu
        //   "Hotelname"/"Firmenname", Anrede springt automatisch).

        // ═══ KUNDENART (ganz oben, gross) ═══
        TextView lblKind = new TextView(this);
        lblKind.setText("👥 Kundenart");
        lblKind.setPadding(0, 0, 0, pad / 4);
        lblKind.setTextSize(13);
        lblKind.setTypeface(null, android.graphics.Typeface.BOLD);
        layout.addView(lblKind);

        // v6.62.640: Patrick (12.05. 14:08): "Pension einfuegen, See Perle Ahlbeck — Hotel
        // passt da nicht". Plus Praxis/Klinik fuer Krankenfahrten-Auftraggeber.
        final String[] kinds = { "Stammkunde", "Gelegenheit", "Hotel", "Pension", "Firma", "Praxis", "Klinik" };
        final String[] kindLabels = { "🔁 Stamm", "👤 Gelegenh.", "🏨 Hotel", "🏠 Pension", "🏢 Firma", "🩺 Praxis", "🏥 Klinik" };
        final int[] kindIdx = { Math.max(0, Arrays.asList(kinds).indexOf(e.customerKind != null ? e.customerKind : "Stammkunde")) };

        LinearLayout kindRow = new LinearLayout(this);
        kindRow.setOrientation(LinearLayout.HORIZONTAL);
        final android.widget.Button[] kindBtns = new android.widget.Button[kinds.length];
        for (int i = 0; i < kinds.length; i++) {
            android.widget.Button b = new android.widget.Button(this);
            b.setText(kindLabels[i]);
            b.setTextSize(13);
            b.setAllCaps(false);
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
            lp.setMargins(pad / 8, 0, pad / 8, 0);
            b.setLayoutParams(lp);
            b.setMinimumWidth(0);
            b.setMinHeight((int)(getResources().getDisplayMetrics().density * 50));
            b.setPadding(pad / 6, pad / 4, pad / 6, pad / 4);
            kindBtns[i] = b;
            kindRow.addView(b);
        }
        layout.addView(kindRow);

        // ═══ ANREDE (Hotel/Firma/Familie inkludiert) ═══
        TextView lblSal = new TextView(this);
        lblSal.setText("👤 Anrede");
        lblSal.setTextSize(12);
        lblSal.setPadding(0, pad, 0, pad / 4);
        layout.addView(lblSal);
        // 🆕 v6.62.544: Anrede-Optionen erweitert um Hotel/Firma/Familie
        // v6.62.640: Patrick (12.05. 14:08): "Pension einfuegen, Doktor fehlt auch — schau
        // was die Web-App fuer Anreden hat". Web-Anreden uebernommen + Familie behalten.
        final String[] _saluts = { "—", "Herr", "Frau", "Familie", "Dr.", "Prof.", "Prof. Dr.", "Hotel", "Pension", "Firma", "Praxis", "Klinik", "Divers" };
        final android.widget.Spinner spSal = new android.widget.Spinner(this);
        android.widget.ArrayAdapter<String> _salAd = new android.widget.ArrayAdapter<>(this,
            android.R.layout.simple_spinner_item, _saluts);
        _salAd.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        spSal.setAdapter(_salAd);
        // Vorbelegen aus existing entry — anrede oder salutation Feld
        try {
            spSal.setSelection(0);
            if (e.anrede != null && !e.anrede.trim().isEmpty()) {
                for (int _si = 0; _si < _saluts.length; _si++) {
                    if (_saluts[_si].equalsIgnoreCase(e.anrede.trim())) { spSal.setSelection(_si); break; }
                }
            }
        } catch (Throwable _ex) { spSal.setSelection(0); }
        layout.addView(spSal);

        // ═══ NACHNAME / HOTELNAME / FIRMENNAME (label haengt von Kundenart ab) ═══
        TextView lblLast = new TextView(this);
        lblLast.setTextSize(12);
        lblLast.setPadding(0, pad, 0, pad / 4);
        layout.addView(lblLast);
        EditText etLastName = new EditText(this);
        if (e.name != null && !e.name.isEmpty()) {
            String _n = e.name.trim();
            int _spc = _n.lastIndexOf(' ');
            // Bei Hotel/Firma bleibt der ganze Name im Nachname-Feld (kein Trennen)
            String _kind = e.customerKind != null ? e.customerKind : "Stammkunde";
            // v6.62.640: Pension/Praxis/Klinik auch als Org behandelt (kein Vor/Nach-Split)
            boolean _isOrg = "Hotel".equals(_kind) || "Firma".equals(_kind) || "Pension".equals(_kind) || "Praxis".equals(_kind) || "Klinik".equals(_kind);
            if (_isOrg) etLastName.setText(_n);
            else etLastName.setText(_spc > 0 ? _n.substring(_spc + 1) : _n);
        }
        layout.addView(etLastName);

        // ═══ VORNAME (nur bei Person; bei Hotel/Firma ausgeblendet) ═══
        TextView lblFirst = new TextView(this);
        lblFirst.setText("✍️ Vorname (optional)");
        lblFirst.setTextSize(12);
        lblFirst.setPadding(0, pad, 0, pad / 4);
        layout.addView(lblFirst);
        EditText etFirstName = new EditText(this);
        etFirstName.setHint("z.B. Anja");
        if (e.name != null && !e.name.isEmpty()) {
            String _kind = e.customerKind != null ? e.customerKind : "Stammkunde";
            // v6.62.640: Pension/Praxis/Klinik auch als Org behandelt (kein Vor/Nach-Split)
            boolean _isOrg = "Hotel".equals(_kind) || "Firma".equals(_kind) || "Pension".equals(_kind) || "Praxis".equals(_kind) || "Klinik".equals(_kind);
            if (!_isOrg) {
                String _n = e.name.trim();
                int _spc = _n.lastIndexOf(' ');
                etFirstName.setText(_spc > 0 ? _n.substring(0, _spc) : "");
            }
        }
        layout.addView(etFirstName);

        // ═══ Live-Wechsel: Kundenart-Klick passt Labels + Vorname-Sichtbarkeit + Anrede an ═══
        Runnable refreshKind = () -> {
            for (int i = 0; i < kindBtns.length; i++) {
                boolean sel = (i == kindIdx[0]);
                kindBtns[i].setBackgroundColor(sel ? 0xFF10B981 : 0xFFE2E8F0);
                kindBtns[i].setTextColor(sel ? 0xFFFFFFFF : 0xFF1E293B);
            }
            String _k = kinds[kindIdx[0]];
            if ("Hotel".equals(_k)) {
                lblLast.setText("🏨 Hotelname (Pflicht)");
                etLastName.setHint("z.B. Steigenberger");
                lblFirst.setVisibility(View.GONE);
                etFirstName.setVisibility(View.GONE);
                // Anrede automatisch auf "Hotel" setzen wenn aktuell — oder Familie
                if (spSal.getSelectedItemPosition() == 0 ||
                    "Herr".equals(_saluts[spSal.getSelectedItemPosition()]) ||
                    "Frau".equals(_saluts[spSal.getSelectedItemPosition()])) {
                    for (int i = 0; i < _saluts.length; i++) if ("Hotel".equals(_saluts[i])) { spSal.setSelection(i); break; }
                }
            } else if ("Pension".equals(_k)) {
                // v6.62.640
                lblLast.setText("🏠 Pensionsname (Pflicht)");
                etLastName.setHint("z.B. See Perle Ahlbeck");
                lblFirst.setVisibility(View.GONE);
                etFirstName.setVisibility(View.GONE);
                if (spSal.getSelectedItemPosition() == 0 ||
                    "Herr".equals(_saluts[spSal.getSelectedItemPosition()]) ||
                    "Frau".equals(_saluts[spSal.getSelectedItemPosition()])) {
                    for (int i = 0; i < _saluts.length; i++) if ("Pension".equals(_saluts[i])) { spSal.setSelection(i); break; }
                }
            } else if ("Firma".equals(_k)) {
                lblLast.setText("🏢 Firmenname (Pflicht)");
                etLastName.setHint("z.B. Vetter Reisen");
                lblFirst.setVisibility(View.GONE);
                etFirstName.setVisibility(View.GONE);
                if (spSal.getSelectedItemPosition() == 0 ||
                    "Herr".equals(_saluts[spSal.getSelectedItemPosition()]) ||
                    "Frau".equals(_saluts[spSal.getSelectedItemPosition()])) {
                    for (int i = 0; i < _saluts.length; i++) if ("Firma".equals(_saluts[i])) { spSal.setSelection(i); break; }
                }
            } else if ("Praxis".equals(_k)) {
                // v6.62.640
                lblLast.setText("🩺 Praxisname (Pflicht)");
                etLastName.setHint("z.B. Dr. Mustermann Hausarzt");
                lblFirst.setVisibility(View.GONE);
                etFirstName.setVisibility(View.GONE);
                if (spSal.getSelectedItemPosition() == 0 ||
                    "Herr".equals(_saluts[spSal.getSelectedItemPosition()]) ||
                    "Frau".equals(_saluts[spSal.getSelectedItemPosition()])) {
                    for (int i = 0; i < _saluts.length; i++) if ("Praxis".equals(_saluts[i])) { spSal.setSelection(i); break; }
                }
            } else if ("Klinik".equals(_k)) {
                // v6.62.640
                lblLast.setText("🏥 Klinikname (Pflicht)");
                etLastName.setHint("z.B. MEDIGREIF Inselklinikum");
                lblFirst.setVisibility(View.GONE);
                etFirstName.setVisibility(View.GONE);
                if (spSal.getSelectedItemPosition() == 0 ||
                    "Herr".equals(_saluts[spSal.getSelectedItemPosition()]) ||
                    "Frau".equals(_saluts[spSal.getSelectedItemPosition()])) {
                    for (int i = 0; i < _saluts.length; i++) if ("Klinik".equals(_saluts[i])) { spSal.setSelection(i); break; }
                }
            } else {
                lblLast.setText("📛 Nachname (Pflicht)");
                etLastName.setHint("z.B. Schoening");
                lblFirst.setVisibility(View.VISIBLE);
                etFirstName.setVisibility(View.VISIBLE);
            }
        };
        for (int i = 0; i < kinds.length; i++) {
            final int idx = i;
            kindBtns[i].setOnClickListener(_v -> { kindIdx[0] = idx; refreshKind.run(); });
        }
        refreshKind.run();

        // Dummy etName-Variable damit existierender Code weiter laeuft (wird beim Save zusammengesetzt)
        final EditText etName = new EditText(this);

        // v6.62.388: Patrick (06.05. 20:25): "Aus Handy-Kontakten importieren beim CRM-Anlegen".
        // Nur beim Anlegen sinnvoll (nicht beim Bearbeiten).
        if (isNew) {
            android.widget.Button btnContact = new android.widget.Button(this);
            btnContact.setText("📱 Aus Telefonbuch waehlen");
            btnContact.setAllCaps(false);
            btnContact.setTextSize(13);
            btnContact.setBackgroundColor(0xFFE0E7FF);
            btnContact.setTextColor(0xFF3730A3);
            LinearLayout.LayoutParams bcLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
            bcLp.setMargins(0, pad / 2, 0, pad / 2);
            btnContact.setLayoutParams(bcLp);
            layout.addView(btnContact);
            // Click-Handler kommt unten gesetzt — etMobile muss zuerst angelegt sein.
            btnContact.setOnClickListener(v -> {
                // Nutze etMobile als Telefonziel (= Mobilnummer ist Standard fuer Handy-Kontakte)
                EditText nameRef = etName;
                EditText phoneRef = (EditText) layout.findViewWithTag("contactPhoneTarget");
                launchContactPicker(nameRef, phoneRef);
            });
        }

        // v6.62.384: Mobil ZUERST (wichtigste Spalte fuer SMS) + klare Beschriftung
        TextView lblMobile = new TextView(this);
        lblMobile.setText("📱 Mobilnummer  (fuer SMS, WhatsApp, Track-Link)");
        lblMobile.setPadding(0, pad, 0, pad / 4);
        lblMobile.setTextSize(12);
        layout.addView(lblMobile);
        EditText etMobile = new EditText(this);
        etMobile.setHint("z.B. +491731234567");
        etMobile.setInputType(InputType.TYPE_CLASS_PHONE);
        etMobile.setText(e.mobilePhone != null ? e.mobilePhone : "");
        etMobile.setTag("contactPhoneTarget");
        layout.addView(etMobile);

        TextView lblPhone = new TextView(this);
        lblPhone.setText("📞 Festnetz 1  (fuer Hotels/Anrufer-ID, optional)");
        lblPhone.setPadding(0, pad, 0, pad / 4);
        lblPhone.setTextSize(12);
        layout.addView(lblPhone);
        EditText etPhone = new EditText(this);
        etPhone.setHint("z.B. 038378 12345");
        etPhone.setInputType(InputType.TYPE_CLASS_PHONE);
        etPhone.setText(e.phone != null ? e.phone : "");
        layout.addView(etPhone);

        // 🆕 v6.62.544: Festnetz 2 (Hotels haben oft mehrere Anschluesse, z.B. Steigenberger 3 Nummern)
        TextView lblPhone2 = new TextView(this);
        lblPhone2.setText("📞 Festnetz 2  (optional, z.B. Rezeption 2)");
        lblPhone2.setPadding(0, pad, 0, pad / 4);
        lblPhone2.setTextSize(12);
        layout.addView(lblPhone2);
        EditText etPhone2 = new EditText(this);
        etPhone2.setHint("z.B. 038378 12346");
        etPhone2.setInputType(InputType.TYPE_CLASS_PHONE);
        etPhone2.setText(e.phone2 != null ? e.phone2 : "");
        layout.addView(etPhone2);

        // 🆕 v6.62.544: Weitere Nummern (additionalPhones-Array). Plus-Button laesst
        // Patrick beliebig viele Nummern hinzufuegen — z.B. Hotel mit 3+ Anschluessen.
        TextView lblAddPh = new TextView(this);
        lblAddPh.setText("📞 Weitere Nummern");
        lblAddPh.setPadding(0, pad, 0, pad / 4);
        lblAddPh.setTextSize(12);
        layout.addView(lblAddPh);
        final LinearLayout addPhBox = new LinearLayout(this);
        addPhBox.setOrientation(LinearLayout.VERTICAL);
        layout.addView(addPhBox);
        final java.util.List<EditText> _addPhFields = new java.util.ArrayList<>();
        final Runnable[] _addRowRef = { null };
        _addRowRef[0] = () -> {
            LinearLayout row = new LinearLayout(this);
            row.setOrientation(LinearLayout.HORIZONTAL);
            EditText et = new EditText(this);
            et.setHint("Weitere Nummer");
            et.setInputType(InputType.TYPE_CLASS_PHONE);
            LinearLayout.LayoutParams etLp = new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 4f);
            et.setLayoutParams(etLp);
            row.addView(et);
            android.widget.Button btnDel = new android.widget.Button(this);
            btnDel.setText("✗");
            btnDel.setAllCaps(false);
            LinearLayout.LayoutParams delLp = new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
            btnDel.setLayoutParams(delLp);
            btnDel.setOnClickListener(_v -> {
                _addPhFields.remove(et);
                addPhBox.removeView(row);
            });
            row.addView(btnDel);
            addPhBox.addView(row);
            _addPhFields.add(et);
        };
        for (String _ap : e.additionalPhones) {
            _addRowRef[0].run();
            _addPhFields.get(_addPhFields.size() - 1).setText(_ap);
        }
        android.widget.Button btnAddPh = new android.widget.Button(this);
        btnAddPh.setText("+ Weitere Nummer hinzufuegen");
        btnAddPh.setAllCaps(false);
        btnAddPh.setTextSize(12);
        btnAddPh.setBackgroundColor(0xFFE0E7FF);
        btnAddPh.setTextColor(0xFF3730A3);
        btnAddPh.setOnClickListener(_v -> _addRowRef[0].run());
        layout.addView(btnAddPh);

        EditText etEmail = new EditText(this);
        etEmail.setHint("Email (optional)");
        etEmail.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS);
        etEmail.setText(e.email != null ? e.email : "");
        LinearLayout.LayoutParams emLp = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        emLp.setMargins(0, pad, 0, 0);
        etEmail.setLayoutParams(emLp);
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

        // 🆕 v6.62.544: Bevorzugte Zahlungsart (Web-CRM-Schema: preferredPayment)
        TextView lblPay = new TextView(this);
        lblPay.setText("💰 Bevorzugte Zahlungsart");
        lblPay.setPadding(0, pad, 0, pad / 4);
        lblPay.setTextSize(12);
        layout.addView(lblPay);
        final String[] _pays = { "—", "bar", "ec", "rechnung", "kreditkarte", "ueberweisung" };
        final String[] _payLabels = { "—", "💵 Bar", "💳 EC", "📄 Rechnung", "💳 Kreditkarte", "🏦 Ueberweisung" };
        final android.widget.Spinner spPay = new android.widget.Spinner(this);
        android.widget.ArrayAdapter<String> _payAd = new android.widget.ArrayAdapter<>(this,
            android.R.layout.simple_spinner_item, _payLabels);
        _payAd.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        spPay.setAdapter(_payAd);
        spPay.setSelection(0);
        if (e.preferredPayment != null && !e.preferredPayment.trim().isEmpty()) {
            for (int _pi = 0; _pi < _pays.length; _pi++) {
                if (_pays[_pi].equalsIgnoreCase(e.preferredPayment.trim())) { spPay.setSelection(_pi); break; }
            }
        }
        layout.addView(spPay);

        // 🆕 v6.62.544: Notizen (Web-CRM-Schema: notes)
        TextView lblNotes = new TextView(this);
        lblNotes.setText("📝 Notizen (interne Bemerkungen)");
        lblNotes.setPadding(0, pad, 0, pad / 4);
        lblNotes.setTextSize(12);
        layout.addView(lblNotes);
        EditText etNotes = new EditText(this);
        etNotes.setHint("z.B. 'Bevorzugt Tesla', 'nur barzahlen', 'Allergie auf...'");
        etNotes.setMinLines(2);
        etNotes.setMaxLines(5);
        etNotes.setGravity(android.view.Gravity.TOP | android.view.Gravity.START);
        etNotes.setText(e.notes != null ? e.notes : "");
        layout.addView(etNotes);

        // ═══ 🆕 v6.62.545: FESTPREISE (Strecken-Pauschalen) ═══
        // Patrick (10.05.): "wenn ich jetzt zum Beispiel ein Hotel habe, dass immer
        // irgendwelche Festpreise hinterlegt sind. Also, dass ich die auswaehlen kann."
        // Schema (gleich wie Web-CRM seit v6.62.512): customers/{id}/fixedRoutes ist
        // ein Array von { id, name, fromName, fromLat, fromLon, toName, toLat, toLon, price }.
        // Auto-Anwendung beim Buchen folgt in v6.62.546 (Match-Toleranz 200m).
        TextView lblFP = new TextView(this);
        lblFP.setText("💰 Festpreise (Strecken-Pauschalen)");
        lblFP.setPadding(0, pad, 0, pad / 4);
        lblFP.setTextSize(12);
        lblFP.setTypeface(null, android.graphics.Typeface.BOLD);
        layout.addView(lblFP);
        final LinearLayout fpBox = new LinearLayout(this);
        fpBox.setOrientation(LinearLayout.VERTICAL);
        layout.addView(fpBox);
        // Mutable Liste — initial aus e.fixedRoutes vorbefuellt, alle CRUD passieren
        // direkt in dieser Liste, am Ende beim Speichern wird sie nach Firebase geschrieben.
        final java.util.List<Map<String, Object>> _fpList = new java.util.ArrayList<>();
        if (e.fixedRoutes != null) {
            for (Map<String, Object> fr : e.fixedRoutes) {
                if (fr != null) _fpList.add(new HashMap<>(fr));
            }
        }
        final Runnable[] _renderFp = { null };
        _renderFp[0] = () -> {
            fpBox.removeAllViews();
            if (_fpList.isEmpty()) {
                TextView tvEmpty = new TextView(this);
                tvEmpty.setText("(Noch keine Festpreise hinterlegt)");
                tvEmpty.setTextColor(0xFF94A3B8);
                tvEmpty.setPadding(pad / 2, pad / 4, 0, pad / 4);
                tvEmpty.setTextSize(11);
                fpBox.addView(tvEmpty);
                return;
            }
            for (int i = 0; i < _fpList.size(); i++) {
                final int idx = i;
                Map<String, Object> fr = _fpList.get(i);
                LinearLayout row = new LinearLayout(this);
                row.setOrientation(LinearLayout.HORIZONTAL);
                row.setPadding(0, pad / 4, 0, pad / 4);

                TextView tvFp = new TextView(this);
                String _name = String.valueOf(fr.getOrDefault("name", ""));
                String _from = String.valueOf(fr.getOrDefault("fromName", "?"));
                String _to = String.valueOf(fr.getOrDefault("toName", "?"));
                Object _pr = fr.get("price");
                String _prStr = (_pr instanceof Number) ? String.format(Locale.GERMANY, "%.2f", ((Number)_pr).doubleValue()) : String.valueOf(_pr);
                tvFp.setText("💰 " + (_name.isEmpty() ? (_from + " → " + _to) : _name) + "  ·  " + _prStr + " €\n" + _from.substring(0, Math.min(_from.length(), 32)) + " → " + _to.substring(0, Math.min(_to.length(), 32)));
                tvFp.setTextSize(11);
                tvFp.setTextColor(0xFF1E293B);
                LinearLayout.LayoutParams tvLp = new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 4f);
                tvFp.setLayoutParams(tvLp);
                row.addView(tvFp);

                android.widget.Button btnEdit = new android.widget.Button(this);
                btnEdit.setText("✏️");
                btnEdit.setAllCaps(false);
                LinearLayout.LayoutParams beLp = new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
                btnEdit.setLayoutParams(beLp);
                btnEdit.setOnClickListener(_v -> openFestpreisEditDialog(fr, (updated) -> {
                    _fpList.set(idx, updated);
                    _renderFp[0].run();
                }));
                row.addView(btnEdit);

                android.widget.Button btnDel = new android.widget.Button(this);
                btnDel.setText("✗");
                btnDel.setAllCaps(false);
                LinearLayout.LayoutParams bdLp = new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
                btnDel.setLayoutParams(bdLp);
                btnDel.setOnClickListener(_v -> {
                    new AlertDialog.Builder(this)
                        .setTitle("Festpreis loeschen?")
                        .setMessage("'" + _name + "' wirklich entfernen?")
                        .setPositiveButton("Loeschen", (_d, _w) -> { _fpList.remove(idx); _renderFp[0].run(); })
                        .setNegativeButton("Abbrechen", null)
                        .show();
                });
                row.addView(btnDel);
                fpBox.addView(row);
            }
        };
        _renderFp[0].run();
        android.widget.Button btnAddFp = new android.widget.Button(this);
        btnAddFp.setText("+ Festpreis hinzufuegen");
        btnAddFp.setAllCaps(false);
        btnAddFp.setTextSize(12);
        btnAddFp.setBackgroundColor(0xFFFEF3C7);
        btnAddFp.setTextColor(0xFF92400E);
        btnAddFp.setOnClickListener(_v -> openFestpreisEditDialog(null, (created) -> {
            _fpList.add(created);
            _renderFp[0].run();
        }));
        layout.addView(btnAddFp);

        String dialogTitle = isNew
            ? "➕ Neuen Kunden anlegen"
            : "📋 " + (e.name != null ? e.name : "?") + " bearbeiten";
        new AlertDialog.Builder(this)
            .setTitle(dialogTitle)
            .setView(scroll)
            .setPositiveButton(isNew ? "Anlegen" : "Speichern", (d, w) -> {
                // 🔧 v6.62.431: getrennte Felder Nachname (Pflicht) + Vorname (optional) + Anrede
                // 🆕 v6.62.544: Bei Hotel/Firma ist nur ein Name-Feld da (firstName ausgeblendet).
                String _lastName = etLastName.getText().toString().trim();
                String _firstName = etFirstName.getText().toString().trim();
                String _kindSel = kinds[kindIdx[0]];
                // v6.62.640: Pension/Praxis/Klinik auch als Org
                boolean _isOrgKind = "Hotel".equals(_kindSel) || "Firma".equals(_kindSel) || "Pension".equals(_kindSel) || "Praxis".equals(_kindSel) || "Klinik".equals(_kindSel);
                if (_lastName.isEmpty()) {
                    Toast.makeText(this, _isOrgKind ? (_kindSel + "name Pflicht") : "Nachname Pflicht", Toast.LENGTH_SHORT).show();
                    return;
                }
                // Bei Hotel/Firma: ganzer Name = lastName-Feld, kein Vorname
                String name = _isOrgKind ? _lastName : (_firstName.isEmpty() ? _lastName : _firstName + " " + _lastName);
                int _salPos = spSal.getSelectedItemPosition();
                String _salutation = _salPos > 0 ? _saluts[_salPos] : "";
                String phone = etPhone.getText().toString().trim();
                String phone2 = etPhone2.getText().toString().trim();
                String mobile = etMobile.getText().toString().trim();
                String email = etEmail.getText().toString().trim();
                String notes = etNotes.getText().toString().trim();
                int _payPos = spPay.getSelectedItemPosition();
                String _preferredPayment = _payPos > 0 ? _pays[_payPos] : "";
                // additionalPhones aus den dynamischen Edit-Feldern lesen
                java.util.List<String> _additionalPhones = new java.util.ArrayList<>();
                for (EditText _ape : _addPhFields) {
                    String _v = _ape.getText().toString().trim();
                    if (!_v.isEmpty()) _additionalPhones.add(_v);
                }
                // v6.62.384: Mindestens EINE Telefonnummer ist Pflicht — sonst kann der
                // Kunde weder angerufen noch via SMS erreicht werden.
                if (isNew && phone.isEmpty() && mobile.isEmpty() && phone2.isEmpty() && _additionalPhones.isEmpty()) {
                    Toast.makeText(this, "Mindestens eine Telefonnummer angeben", Toast.LENGTH_LONG).show();
                    return;
                }
                Map<String, Object> upd = new HashMap<>();
                upd.put("name", name);
                if (!_isOrgKind && !_firstName.isEmpty()) upd.put("firstName", _firstName);
                else if (_isOrgKind) upd.put("firstName", null);
                upd.put("lastName", _lastName);
                if (!_salutation.isEmpty()) {
                    upd.put("salutation", _salutation);
                    upd.put("anrede", _salutation);
                }
                upd.put("phone", phone);
                upd.put("phone2", phone2);
                upd.put("mobilePhone", mobile);
                if (!email.isEmpty()) upd.put("email", email);
                upd.put("notes", notes);
                upd.put("preferredPayment", _preferredPayment);
                upd.put("additionalPhones", _additionalPhones);
                // 🆕 v6.62.545: fixedRoutes Array (Festpreise) speichern
                upd.put("fixedRoutes", _fpList);
                String addr = tvAddr.getText().toString().replaceFirst("^📍 ", "").trim();
                if (!addr.isEmpty() && !addr.endsWith("wählen…")) {
                    upd.put("address", addr);
                    if (!Double.isNaN(addrCoords[0])) {
                        upd.put("addressLat", addrCoords[0]);
                        upd.put("addressLon", addrCoords[1]);
                    }
                }
                upd.put("customerKind", _kindSel);
                // 🆕 v6.62.544: type folgt aus Kundenart — Hotel/Firma → "supplier" (Web-Schema),
                // sonst "customer". Hotel-Erkennung in Booking-Flow + Calendar-Sync funktioniert
                // ueber type=supplier + category=hotel.
                upd.put("type", _isOrgKind ? "supplier" : "customer");
                if ("Hotel".equals(_kindSel)) upd.put("category", "hotel");
                else if ("Firma".equals(_kindSel)) upd.put("category", "firma");
                upd.put("updatedAt", System.currentTimeMillis());
                upd.put("updatedVia", "native_crm_search");
                if (isNew) {
                    upd.put("createdAt", System.currentTimeMillis());
                    upd.put("createdVia", "native_crm_search");
                    FirebaseDatabase.getInstance(DB_INSTANCE_URL).getReference("customers")
                        .push().setValue(upd)
                        .addOnSuccessListener(_v -> {
                            Toast.makeText(this, "✅ " + name + " angelegt", Toast.LENGTH_SHORT).show();
                            loadAll();
                        })
                        .addOnFailureListener(ex ->
                            Toast.makeText(this, "❌ " + ex.getMessage(), Toast.LENGTH_LONG).show());
                } else {
                    FirebaseDatabase.getInstance(DB_INSTANCE_URL).getReference("customers/" + e.id)
                        .updateChildren(upd)
                        .addOnSuccessListener(_v -> {
                            Toast.makeText(this, "✅ " + name + " gespeichert", Toast.LENGTH_SHORT).show();
                            loadAll();
                        })
                        .addOnFailureListener(ex ->
                            Toast.makeText(this, "❌ " + ex.getMessage(), Toast.LENGTH_LONG).show());
                }
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
        String id, name, phone, phone2, mobilePhone, email, address, customerKind;
        // 🆕 v6.62.544: anrede + notes + preferredPayment fuer Anlegen-Form
        String anrede, notes, preferredPayment, type;
        String firstName, lastName;
        // 🆕 v6.62.545: Festpreise pro Hotel/Kunde — Strecken-Pauschalen.
        // Schema: { id, name, fromName, fromLat, fromLon, toName, toLat, toLon, price }
        java.util.List<Map<String, Object>> fixedRoutes = new java.util.ArrayList<>();
        // 🆕 v6.62.543: Patrick (10.05.): "Steigenberger hat 3 Festnetznummern,
        // sind auch im regulären CRM so hinterlegt, aber hier in der Native-App
        // im CRM ist es nicht hinterlegt. Deswegen erkennt er jetzt Steigenberger
        // nicht." Web-CRM-Schema kennt phone (1.), phone2 (2.) und additionalPhones
        // (Array, 3.+). Native las nur phone+mobilePhone → 2.+ unsichtbar.
        java.util.List<String> additionalPhones = new java.util.ArrayList<>();
        Double lat, lon;
        static CrmEntry fromSnap(DataSnapshot s) {
            try {
                CrmEntry e = new CrmEntry();
                e.id = s.getKey();
                e.name = s.child("name").getValue(String.class);
                e.phone = s.child("phone").getValue(String.class);
                e.phone2 = s.child("phone2").getValue(String.class);
                e.mobilePhone = s.child("mobilePhone").getValue(String.class);
                e.email = s.child("email").getValue(String.class);
                e.address = s.child("address").getValue(String.class);
                e.customerKind = s.child("customerKind").getValue(String.class);
                // 🆕 v6.62.544: anrede + notes + preferredPayment + type/firstName/lastName
                e.anrede = s.child("anrede").getValue(String.class);
                if (e.anrede == null) e.anrede = s.child("salutation").getValue(String.class);
                e.notes = s.child("notes").getValue(String.class);
                e.preferredPayment = s.child("preferredPayment").getValue(String.class);
                e.type = s.child("type").getValue(String.class);
                e.firstName = s.child("firstName").getValue(String.class);
                e.lastName = s.child("lastName").getValue(String.class);
                // 🆕 v6.62.545: Festpreise einlesen (Web-Schema: customers/{id}/fixedRoutes)
                DataSnapshot frSnap = s.child("fixedRoutes");
                if (frSnap.exists()) {
                    for (DataSnapshot c : frSnap.getChildren()) {
                        Object _val = c.getValue();
                        if (_val instanceof Map) {
                            try {
                                @SuppressWarnings("unchecked")
                                Map<String, Object> _map = (Map<String, Object>) _val;
                                e.fixedRoutes.add(new HashMap<>(_map));
                            } catch (Throwable _ig) {}
                        }
                    }
                }
                // additionalPhones: kann String-Array oder Object-Map (Firebase)
                DataSnapshot apSnap = s.child("additionalPhones");
                if (apSnap.exists()) {
                    for (DataSnapshot c : apSnap.getChildren()) {
                        String v = c.getValue(String.class);
                        if (v != null && !v.trim().isEmpty()) e.additionalPhones.add(v.trim());
                    }
                }
                Object lat = s.child("addressLat").getValue();
                if (lat instanceof Number) e.lat = ((Number) lat).doubleValue();
                Object lon = s.child("addressLon").getValue();
                if (lon instanceof Number) e.lon = ((Number) lon).doubleValue();
                return e;
            } catch (Throwable _t) { return null; }
        }
        // v6.62.543: Alle Telefon-Felder als String, fuer Filter/Suche.
        String allPhonesConcat() {
            StringBuilder sb = new StringBuilder();
            if (phone != null) sb.append(phone).append(' ');
            if (phone2 != null) sb.append(phone2).append(' ');
            if (mobilePhone != null) sb.append(mobilePhone).append(' ');
            for (String ap : additionalPhones) sb.append(ap).append(' ');
            return sb.toString();
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
                // 🆕 v6.62.569: Patrick (10.05. 15:45): "Vielleicht kann man in der CRM-Suche
                // alles was angegeben ist mit eingeben — dass ich genau sehe ob die Anrede
                // oder die Email-Adresse drin ist." Anrede + Customer-Kind als Praefix vor
                // dem Namen, sonstige Felder im Untertitel.
                StringBuilder t1Builder = new StringBuilder();
                t1Builder.append(namePrefix);
                // Anrede vorn anstellen wenn gepflegt (Herr/Frau/Familie/Hotel/Firma)
                if (e.anrede != null && !e.anrede.trim().isEmpty()) {
                    t1Builder.append(e.anrede.trim()).append(' ');
                }
                t1Builder.append(e.name != null ? e.name : "?");
                t1.setText(t1Builder.toString());
                String sub = "";
                // v6.62.222: Empty-String ignorieren (Hasbargen hatte phone="" → vorher
                // wurde "📞 " mit leerem Wert angezeigt → sah aus als wäre keine Nummer da).
                boolean hasPhone = e.phone != null && !e.phone.trim().isEmpty();
                boolean hasPhone2 = e.phone2 != null && !e.phone2.trim().isEmpty();
                boolean hasMobile = e.mobilePhone != null && !e.mobilePhone.trim().isEmpty();
                // 🆕 v6.62.569: Customer-Kind-Badge als allerstes (Stammkunde/Hotel/Firma/Gelegenheit)
                if (e.customerKind != null && !e.customerKind.trim().isEmpty()) {
                    String _kindIcon = "🔁";
                    if (e.customerKind.equalsIgnoreCase("Hotel")) _kindIcon = "🏨";
                    else if (e.customerKind.equalsIgnoreCase("Firma")) _kindIcon = "🏢";
                    else if (e.customerKind.equalsIgnoreCase("Gelegenheit")) _kindIcon = "👤";
                    sub += _kindIcon + " " + e.customerKind;
                }
                if (hasPhone) sub += (sub.isEmpty() ? "" : "  ") + "📞 " + e.phone;
                // 🆕 v6.62.543: phone2 + additionalPhones im Listen-Item zeigen
                // damit Patrick sieht dass Steigenberger seine 3 Festnetznummern hat.
                if (hasPhone2 && !e.phone2.equals(e.phone)) sub += (sub.isEmpty() ? "" : "  ") + "📞 " + e.phone2;
                if (hasMobile && !e.mobilePhone.equals(e.phone)) sub += (sub.isEmpty() ? "" : "  ") + "📱 " + e.mobilePhone;
                if (!e.additionalPhones.isEmpty()) {
                    for (String ap : e.additionalPhones) {
                        if (ap == null || ap.trim().isEmpty()) continue;
                        if (ap.equals(e.phone) || ap.equals(e.phone2) || ap.equals(e.mobilePhone)) continue;
                        sub += (sub.isEmpty() ? "" : "  ") + "📞 " + ap;
                    }
                }
                if (e.address != null && !e.address.isEmpty()) {
                    String addrLabel = (e.lat != null && e.lon != null) ? "📍 " : "📍❓ ";
                    sub += (sub.isEmpty() ? "" : "\n") + addrLabel + e.address;
                }
                // 🆕 v6.62.569: Email + Notizen-Indikator + Festpreis-Anzahl in 2. Zeile
                StringBuilder _extras = new StringBuilder();
                if (e.email != null && !e.email.trim().isEmpty()) {
                    _extras.append("✉️ ").append(e.email);
                }
                if (e.notes != null && !e.notes.trim().isEmpty()) {
                    if (_extras.length() > 0) _extras.append("  ");
                    _extras.append("📝 Notiz");
                }
                if (e.fixedRoutes != null && !e.fixedRoutes.isEmpty()) {
                    if (_extras.length() > 0) _extras.append("  ");
                    _extras.append("💰 ").append(e.fixedRoutes.size()).append(" Festpreis").append(e.fixedRoutes.size() > 1 ? "e" : "");
                }
                if (_extras.length() > 0) {
                    sub += (sub.isEmpty() ? "" : "\n") + _extras.toString();
                }
                t2.setText(sub.isEmpty() ? "—" : sub);
                itemView.setOnClickListener(_v -> showActionDialog(e));
            }
        }
    }
}
