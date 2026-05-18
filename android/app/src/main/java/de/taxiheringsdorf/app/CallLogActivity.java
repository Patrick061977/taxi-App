package de.taxiheringsdorf.app;

import android.Manifest;
import android.app.AlertDialog;
import android.app.DatePickerDialog;
import android.app.TimePickerDialog;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.database.ContentObserver;
import android.database.Cursor;
import android.os.Bundle;
import android.util.Log;
import android.os.Handler;
import android.os.Looper;
import android.provider.CallLog;
import android.text.InputType;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.recyclerview.widget.ItemTouchHelper;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.RecyclerView;
import com.google.android.libraries.places.api.Places;
import com.google.android.libraries.places.api.model.Place;
import com.google.android.libraries.places.widget.Autocomplete;
import com.google.android.libraries.places.widget.AutocompleteActivity;
import com.google.android.libraries.places.widget.model.AutocompleteActivityMode;
import com.google.android.gms.common.api.Status;
import com.google.firebase.database.DataSnapshot;
import com.google.firebase.database.DatabaseError;
import com.google.firebase.database.DatabaseReference;
import com.google.firebase.database.FirebaseDatabase;
import com.google.firebase.database.ValueEventListener;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Arrays;
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
    // 🆕 v6.62.519: ContentObserver für Live-Refresh bei eingehenden Anrufen
    private ContentObserver callLogObserver;
    private Map<String, CrmCustomer> crmByPhone = new HashMap<>();

    // v6.53.0: Google Places Autocomplete — eine Launcher-Instanz, mehrere Ziel-Felder.
    // pendingPlaceField + pendingPlaceCoords werden VOR launch gesetzt, der Callback liest sie.
    private TextView pendingPlaceField;
    private double[] pendingPlaceCoords; // [lat, lon] — null wenn place keine Koords liefert
    private final ActivityResultLauncher<Intent> placesLauncher = registerForActivityResult(
        new ActivityResultContracts.StartActivityForResult(),
        result -> {
            // v6.53.3: Patrick: 'da geht es wieder weg' — bisher kein Error-Feedback bei
            // RESULT_ERROR oder RESULT_CANCELED. Jetzt: Toast mit konkretem Status-Text damit
            // wir API-Key-Restrictions / Quota / etc. sofort diagnostizieren können.
            int rc = result.getResultCode();
            Intent data = result.getData();
            if (rc == AutocompleteActivity.RESULT_ERROR && data != null) {
                Status status = Autocomplete.getStatusFromIntent(data);
                String msg = status != null ? (status.getStatusCode() + ": " + status.getStatusMessage()) : "unbekannter Status";
                Toast.makeText(this, "⚠️ Places: " + msg + " — verwende OSM-Fallback", Toast.LENGTH_LONG).show();
                // v6.62.28: bei Places-Fehler OSM-Fallback statt nur abzubrechen
                showOsmFallbackPrompt();
                return;
            }
            if (rc != RESULT_OK || data == null) {
                // v6.62.28: bei Cancel → OSM/Nominatim-Fallback anbieten.
                // Patrick: 'in der anrufliste in autocomplete laeuft es nicht'.
                // Manche Adressen findet Google Places nicht (zu klein, zu speziell)
                // — Nominatim hat oft mehr Detail in Heringsdorf-Region.
                showOsmFallbackPrompt();
                return;
            }
            try {
                Place place = Autocomplete.getPlaceFromIntent(data);
                // v6.62.19: POI-Name VOR Adresse erhalten (Patrick: 'sinnvoller Lidl
                // hinzuschreiben'). Format: "Lidl, Ahlbecker Ch 9, 17429 Heringsdorf".
                // Konvention im Rest des Projekts ist Komma — siehe Hotel-Geocache-Strings.
                // Doppelung vermeiden falls Address den Namen schon enthält.
                // v6.62.91: SDK 4.x APIs
                String _name = place.getDisplayName();
                String _addr = place.getFormattedAddress();
                String label;
                if (_name == null || _name.isEmpty()) {
                    label = _addr != null ? _addr : "";
                } else if (_addr == null || _addr.isEmpty() || _addr.equals(_name)) {
                    label = _name;
                } else if (_addr.startsWith(_name)) {
                    label = _addr;  // Name schon vorne → keine Doppelung
                } else {
                    label = _name + ", " + _addr;
                }
                // v6.62.348: Patrick (06.05. 10:35) "mach das Kaiserbaeder weg".
                label = CrmSearchActivity.stripTouristAndRegion(label);
                if (pendingPlaceField != null) pendingPlaceField.setText(label);
                if (pendingPlaceCoords != null && place.getLocation() != null) {
                    pendingPlaceCoords[0] = place.getLocation().latitude;
                    pendingPlaceCoords[1] = place.getLocation().longitude;
                }
            } catch (Throwable t) {
                Toast.makeText(this, "Places-Parse-Fehler: " + t.getMessage(), Toast.LENGTH_LONG).show();
            }
        }
    );

    // v6.62.35: Hintergrund-Geocoding fuer CRM-Vorbelegung. Bricht still ab wenn fehlschlaegt.
    // v6.62.39: Patrick: 'ich brauche nicht Mecklenburg-Vorpommern, Vorpommern-Greifswald — nur
    // Strasse + PLZ + Ort'. Compact-Format aus addressdetails statt full display_name.
    private void geocodeAndFill(String query, TextView field, double[] coordsOut) {
        if (query == null || query.trim().isEmpty()) return;
        new Thread(() -> {
            try {
                String urlStr = "https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=de&addressdetails=1&q="
                    + URLEncoder.encode(query, "UTF-8");
                HttpURLConnection conn = (HttpURLConnection) new URL(urlStr).openConnection();
                conn.setRequestProperty("User-Agent", "TaxiHeringsdorf/6.62.39 (admin@funk-taxi-heringsdorf.de)");
                conn.setConnectTimeout(8000);
                conn.setReadTimeout(8000);
                BufferedReader br = new BufferedReader(new InputStreamReader(conn.getInputStream(), "UTF-8"));
                StringBuilder sb = new StringBuilder();
                String line;
                while ((line = br.readLine()) != null) sb.append(line);
                br.close(); conn.disconnect();
                String json = sb.toString();
                int latIdx = json.indexOf("\"lat\":\"");
                int lonIdx = json.indexOf("\"lon\":\"");
                if (latIdx < 0 || lonIdx < 0) return;
                latIdx += 7; lonIdx += 7;
                final double lat = Double.parseDouble(json.substring(latIdx, json.indexOf("\"", latIdx)));
                final double lon = Double.parseDouble(json.substring(lonIdx, json.indexOf("\"", lonIdx)));
                final String display = compactNominatimAddress(json);
                runOnUiThread(() -> {
                    coordsOut[0] = lat; coordsOut[1] = lon;
                    if (display != null && field != null) {
                        // v6.62.42: Prefix vom existierenden Text uebernehmen (📍 oder 🎯)
                        // statt hardcoded 📍 — sonst wurde Hotel-Ziel mit 📍 statt 🎯 gesetzt,
                        // landete dann mit '📍'-Prefix in DB (Lenzkes-Folgebug bei Promenadenhotel
                        // Admiral 27.04. 21:11).
                        String existing = field.getText().toString();
                        String prefix = existing.startsWith("🎯") ? "🎯 " : "📍 ";
                        field.setText(prefix + display);
                    }
                });
            } catch (Throwable _t) { /* still — User merkt's beim Anlegen-Tap */ }
        }).start();
    }

    // v6.62.39: kompakte Adresse aus Nominatim-JSON. Format: "Strasse Nr, PLZ Ort".
    // Patrick: 'ich brauche keine Mecklenburg-Vorpommern, Vorpommern-Greifswald, Deutschland —
    // nur Adresse, PLZ, Ort'. Vorher wurde display_name komplett genommen.
    private String compactNominatimAddress(String json) {
        try {
            String road = jsonString(json, "\"road\":\"");
            String houseNr = jsonString(json, "\"house_number\":\"");
            String postcode = jsonString(json, "\"postcode\":\"");
            String city = jsonString(json, "\"city\":\"");
            if (city == null) city = jsonString(json, "\"town\":\"");
            if (city == null) city = jsonString(json, "\"village\":\"");
            if (city == null) city = jsonString(json, "\"municipality\":\"");
            String name = jsonString(json, "\"name\":\""); // POI/Hotel-Name wenn vorhanden
            StringBuilder out = new StringBuilder();
            if (name != null && !name.isEmpty()) {
                out.append(name);
            }
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
            if (out.length() > 0) return decodeUmlaute(out.toString());
            // Fallback: display_name komplett (alt)
            int dispIdx = json.indexOf("\"display_name\":\"");
            if (dispIdx < 0) return null;
            return decodeUmlaute(json.substring(dispIdx + 16, json.indexOf("\"", dispIdx + 16)));
        } catch (Throwable _t) {
            return null;
        }
    }

    private String jsonString(String json, String keyToken) {
        int idx = json.indexOf(keyToken);
        if (idx < 0) return null;
        int start = idx + keyToken.length();
        int end = json.indexOf("\"", start);
        if (end < 0) return null;
        String v = json.substring(start, end);
        return v.isEmpty() ? null : v;
    }

    // 🆕 v6.62.198: ECHTE Umlaute statt 'ue/oe/ae' — Patrick: 'schroeder ist schroder'
    // Vorher wandelte die Funktion JSON-Unicode-Escapes (ö) zu 'oe', weil
    // einige Renderings UTF-8 nicht hatten. Heute laeuft alles UTF-8 → Umlaute zurueck.
    private String decodeUmlaute(String s) {
        if (s == null) return null;
        return s.replace("\\u00fc","ü").replace("\\u00f6","ö").replace("\\u00e4","ä")
                .replace("\\u00df","ß").replace("\\u00dc","Ü").replace("\\u00d6","Ö")
                .replace("\\u00c4","Ä").replace("\\/","/");
    }

    // v6.62.28: OSM/Nominatim-Fallback wenn Places fehlschlaegt oder nichts findet.
    // Patrick: 'in der anrufliste in autocomplete macht er einen fehler — kannst Google
    // mit OSM als Fallback nehmen'. Manche Adressen findet Google nicht (zu klein,
    // Ferienwohnungen, Hausnummern-Detail), Nominatim hat oft mehr Detail in Heringsdorf.
    private void showOsmFallbackPrompt() {
        new AlertDialog.Builder(this)
            .setTitle("Adresse nicht gefunden")
            .setMessage("Google Places hat die Adresse nicht gefunden.\n\nMoechtest du sie manuell eingeben? Wir suchen sie dann ueber OpenStreetMap.")
            .setPositiveButton("Manuell eingeben", (d, w) -> showManualAddressDialog())
            .setNegativeButton("Abbrechen", null)
            .show();
    }

    private void showManualAddressDialog() {
        final EditText input = new EditText(this);
        input.setHint("z.B. Strandpromenade 12, 17424 Heringsdorf");
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_WORDS);
        new AlertDialog.Builder(this)
            .setTitle("Adresse manuell eingeben")
            .setMessage("Tippe die Adresse moeglichst vollstaendig (Strasse, Nr, PLZ, Ort).")
            .setView(input)
            .setPositiveButton("Suchen", (d, w) -> {
                String q = input.getText().toString().trim();
                if (q.isEmpty()) return;
                geocodeWithNominatim(q);
            })
            .setNegativeButton("Abbrechen", null)
            .show();
    }

    // 🆕 v6.62.198: Kaskade Places Text Search → Nominatim
    // Patrick: 'D' (Kaskade Places → Geocoder → Nominatim). Geocoding-API
    // ist bei Patricks Key nicht enabled — stattdessen Places Text Search,
    // funktioniert mit gleichem Key und findet z.B. 'Waldbuehnenweg 1 Heringsdorf'.
    // Bei jedem Schritt Toast mit Quelle damit Patrick sieht WAS geholfen hat.
    private void geocodeWithNominatim(String query) {
        geocodeWithCascade(query);
    }

    private void geocodeWithCascade(String query) {
        if (query == null || query.trim().isEmpty()) return;
        Toast.makeText(this, "🔍 Suche: " + query, Toast.LENGTH_SHORT).show();
        new Thread(() -> {
            // STUFE 1: Places Text Search (New API) — gleicher Key wie Autocomplete
            if (tryPlacesTextSearch(query)) return;
            // STUFE 2: Nominatim (OpenStreetMap)
            runOnUiThread(() -> Toast.makeText(this, "↪ Places leer — versuche OpenStreetMap...", Toast.LENGTH_SHORT).show());
            tryNominatimSearch(query);
        }).start();
    }

    // Stufe 1: Places Text Search via REST. Returns true wenn Treffer.
    private boolean tryPlacesTextSearch(String query) {
        HttpURLConnection conn = null;
        try {
            URL url = new URL("https://places.googleapis.com/v1/places:searchText");
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            conn.setRequestProperty("X-Goog-Api-Key", "AIzaSyAu9CsnLMLLQbXkWckWSV7uIzLB94hJ-HE");
            conn.setRequestProperty("X-Goog-FieldMask", "places.formattedAddress,places.location,places.displayName");
            conn.setConnectTimeout(8000);
            conn.setReadTimeout(8000);
            conn.setDoOutput(true);
            String body = "{\"textQuery\":\"" + query.replace("\\", "\\\\").replace("\"", "\\\"") + "\",\"regionCode\":\"de\",\"maxResultCount\":1}";
            conn.getOutputStream().write(body.getBytes("UTF-8"));
            int code = conn.getResponseCode();
            BufferedReader br = new BufferedReader(new InputStreamReader(
                code >= 200 && code < 300 ? conn.getInputStream() : conn.getErrorStream(), "UTF-8"));
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = br.readLine()) != null) sb.append(line);
            br.close();
            String json = sb.toString();
            if (code < 200 || code >= 300) return false;
            int latIdx = json.indexOf("\"latitude\"");
            int lonIdx = json.indexOf("\"longitude\"");
            int addrIdx = json.indexOf("\"formattedAddress\":\"");
            if (latIdx < 0 || lonIdx < 0 || addrIdx < 0) return false;
            latIdx = json.indexOf(":", latIdx) + 1;
            int latEnd = findNumberEnd(json, latIdx);
            lonIdx = json.indexOf(":", lonIdx) + 1;
            int lonEnd = findNumberEnd(json, lonIdx);
            final double lat = Double.parseDouble(json.substring(latIdx, latEnd).trim());
            final double lon = Double.parseDouble(json.substring(lonIdx, lonEnd).trim());
            int addrStart = addrIdx + 20;
            int addrEnd = json.indexOf("\"", addrStart);
            // Quote-escape ueberspringen
            while (addrEnd > 0 && json.charAt(addrEnd - 1) == '\\') {
                addrEnd = json.indexOf("\"", addrEnd + 1);
            }
            final String display = decodeUmlaute(json.substring(addrStart, addrEnd));
            runOnUiThread(() -> {
                applyGeocodeResult(lat, lon, display, "Google Places");
            });
            return true;
        } catch (Throwable t) {
            return false;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private int findNumberEnd(String json, int start) {
        int end = start;
        while (end < json.length()) {
            char c = json.charAt(end);
            if ((c >= '0' && c <= '9') || c == '.' || c == '-' || c == 'e' || c == 'E' || c == '+') {
                end++;
            } else break;
        }
        return end;
    }

    // Stufe 2: Nominatim — letzte Stufe der Kaskade
    private void tryNominatimSearch(String query) {
        try {
            String urlStr = "https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=de&addressdetails=1&q="
                + URLEncoder.encode(query, "UTF-8");
            HttpURLConnection conn = (HttpURLConnection) new URL(urlStr).openConnection();
            conn.setRequestProperty("User-Agent", "TaxiHeringsdorf/6.62.198 (admin@funk-taxi-heringsdorf.de)");
            conn.setConnectTimeout(8000);
            conn.setReadTimeout(8000);
            BufferedReader br = new BufferedReader(new InputStreamReader(conn.getInputStream(), "UTF-8"));
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = br.readLine()) != null) sb.append(line);
            br.close();
            conn.disconnect();
            String json = sb.toString();
            int latIdx = json.indexOf("\"lat\":\"");
            int lonIdx = json.indexOf("\"lon\":\"");
            if (latIdx < 0 || lonIdx < 0) {
                runOnUiThread(() -> Toast.makeText(this, "❌ Auch OpenStreetMap fand nichts fuer '" + query + "'", Toast.LENGTH_LONG).show());
                return;
            }
            latIdx += 7; lonIdx += 7;
            final double lat = Double.parseDouble(json.substring(latIdx, json.indexOf("\"", latIdx)));
            final double lon = Double.parseDouble(json.substring(lonIdx, json.indexOf("\"", lonIdx)));
            final String display = compactNominatimAddress(json);
            if (display == null || display.isEmpty()) {
                runOnUiThread(() -> Toast.makeText(this, "❌ Adresse konnte nicht geparst werden", Toast.LENGTH_LONG).show());
                return;
            }
            runOnUiThread(() -> applyGeocodeResult(lat, lon, display, "OpenStreetMap"));
        } catch (Throwable t) {
            runOnUiThread(() -> Toast.makeText(this, "OSM-Fehler: " + t.getMessage(), Toast.LENGTH_LONG).show());
        }
    }

    // Schreibt Geocode-Ergebnis ins pendingPlaceField + zeigt Quelle
    private void applyGeocodeResult(double lat, double lon, String display, String source) {
        if (pendingPlaceField != null) {
            String existing = pendingPlaceField.getText().toString();
            String prefix = existing.startsWith("🎯") ? "🎯 " : "📍 ";
            pendingPlaceField.setText(prefix + display);
        }
        if (pendingPlaceCoords != null) {
            pendingPlaceCoords[0] = lat;
            pendingPlaceCoords[1] = lon;
        }
        Toast.makeText(this, "✅ Gefunden via " + source, Toast.LENGTH_SHORT).show();
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

    private void launchPlaces(TextView targetField, double[] coordsOut) {
        // v6.62.220: Patrick (03.05. 17:49): "kannst du da so einen Stecknadel-
        // Picker einbauen, dass man vielleicht auch ueber die Stecknadel auf
        // der Karte die Adressen suchen kann?". Statt Google Places (9011-Block)
        // oder simplen EditText-Dialog: OSM-Karte mit Tap-zum-Setzen + Suchfeld
        // oben (Nominatim). Map-Picker ist deutlich besser fuer Adressen
        // ohne Hausnummer/Ferienwohnungen.
        pendingPlaceField = targetField;
        pendingPlaceCoords = coordsOut;
        Intent i = new Intent(this, MapPickerActivity.class);
        // Vorbefuellung: vorhandener Text als Such-Initial-Query mitgeben
        if (targetField != null) {
            String pre = targetField.getText() != null ? targetField.getText().toString() : "";
            pre = pre.replaceFirst("^📍\\s*", "").replaceFirst("^🎯\\s*", "")
                .replaceFirst("^🔶\\s*", "").trim();
            if (!pre.isEmpty() && !pre.endsWith("wählen…") && !pre.equals("(optional)")) {
                i.putExtra(MapPickerActivity.EXTRA_INITIAL_QUERY, pre);
            }
        }
        mapPickerLauncher.launch(i);
    }

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

        // v6.58.0: Swipe-zum-Verstecken für Anrufliste — Patrick: 'Liste übersichtlicher,
        // alte Anrufe rausswipen'. Eintrag wird LOKAL versteckt (SharedPrefs), Android-System-
        // Anrufverlauf bleibt unverändert. Snackbar mit Rückgängig falls aus Versehen.
        ItemTouchHelper.SimpleCallback swipe = new ItemTouchHelper.SimpleCallback(0,
                ItemTouchHelper.LEFT | ItemTouchHelper.RIGHT) {
            @Override
            public boolean onMove(@NonNull RecyclerView rv, @NonNull RecyclerView.ViewHolder vh1, @NonNull RecyclerView.ViewHolder vh2) {
                return false;
            }
            @Override
            public void onSwiped(@NonNull RecyclerView.ViewHolder vh, int direction) {
                int pos = vh.getAdapterPosition();
                if (pos < 0 || pos >= adapter.data.size()) return;
                CallEntry removed = adapter.data.remove(pos);
                adapter.notifyItemRemoved(pos);
                addHiddenNumber(removed.number);
                // Snackbar mit Rückgängig
                com.google.android.material.snackbar.Snackbar
                    .make(rv, "🗑 Anruf versteckt", com.google.android.material.snackbar.Snackbar.LENGTH_LONG)
                    .setAction("Rückgängig", v -> {
                        removeHiddenNumber(removed.number);
                        adapter.data.add(pos, removed);
                        adapter.notifyItemInserted(pos);
                    })
                    .show();
            }
        };
        new ItemTouchHelper(swipe).attachToRecyclerView(rv);

        // 🆕 v6.62.725 (Patrick 17.05. 09:19): Manueller Refresh-Button.
        // Samsung-OneUI killt regelmaessig den 30s-Polling-Handler waehrend
        // Patrick die Anrufliste-Activity offen hat → letzte Anrufe fehlen.
        // Refresh-Button erzwingt loadCalls() — kein App-Neustart noetig.
        android.widget.Button btnRefresh = findViewById(R.id.btn_calls_refresh);
        if (btnRefresh != null) {
            btnRefresh.setOnClickListener(v -> {
                if (ContextCompat.checkSelfPermission(this, Manifest.permission.READ_CALL_LOG) == PackageManager.PERMISSION_GRANTED) {
                    Toast.makeText(this, "🔄 Anrufliste wird aktualisiert", Toast.LENGTH_SHORT).show();
                    loadCalls();
                } else {
                    Toast.makeText(this, "Berechtigung 'Anrufprotokoll' fehlt — bitte in Einstellungen aktivieren", Toast.LENGTH_LONG).show();
                    ActivityCompat.requestPermissions(this, new String[]{Manifest.permission.READ_CALL_LOG}, REQ_PERM);
                }
            });
        }

        // v6.62.386: Patrick (06.05. 19:46): "Andre/Lothar/Wegener nicht in der Anrufliste".
        // Versehentliches Wegswipen ist die wahrscheinlichste Ursache → Reset-Button macht
        // die hidden-Liste zentral aufloesbar ohne App-Daten-Cleanup.
        android.widget.Button btnHidden = findViewById(R.id.btn_calls_hidden);
        if (btnHidden != null) {
            btnHidden.setOnClickListener(v -> {
                java.util.Set<String> hiddenSet = getHiddenNumbers();
                if (hiddenSet.isEmpty()) {
                    Toast.makeText(this, "Keine versteckten Anrufe", Toast.LENGTH_SHORT).show();
                    return;
                }
                new AlertDialog.Builder(this)
                    .setTitle("🗑 " + hiddenSet.size() + " versteckte Anrufe")
                    .setMessage("Versehentlich weggeswipet?\n\nAlle wieder einblenden?")
                    .setPositiveButton("Alle einblenden", (d, w) -> {
                        getSharedPreferences(PREFS_HIDDEN, MODE_PRIVATE).edit().remove(KEY_HIDDEN).apply();
                        Toast.makeText(this, "✅ " + hiddenSet.size() + " Anrufe wieder sichtbar", Toast.LENGTH_SHORT).show();
                        loadCalls();
                        updateHiddenButtonLabel();
                    })
                    .setNegativeButton("Abbrechen", null)
                    .show();
            });
            updateHiddenButtonLabel();
            // 🆕 v6.62.669: LONG-Press auf Versteckt-Button → CallLog-Debug-Dump.
            //   Patrick (13.05. 11:17): "André Luther Und Wegener taucht NIE auf egal wann."
            //   Schreibt die letzten 300 CallLog-Eintraege roh nach /debug/callLog/{deviceId}
            //   damit Claude analysieren kann ob die Nummer ueberhaupt im Android-System-CallLog ist
            //   oder ob es ein WhatsApp/Telegram-Call ist (nicht im CallLog).
            btnHidden.setOnLongClickListener(v -> {
                new AlertDialog.Builder(this)
                    .setTitle("🔬 CallLog-Debug-Dump")
                    .setMessage("Schickt die letzten 300 Android-System-Anrufe an Claude (anonymisiert: Nummern bleiben, keine Namen).\n\nNur fuer Diagnose der \"keine Nummer in Anrufliste\" Bugs.\n\nFortfahren?")
                    .setPositiveButton("Dump senden", (d, w) -> dumpCallLogToFirebase())
                    .setNegativeButton("Abbrechen", null)
                    .show();
                return true;
            });
        }

        // CRM-Cache parallel laden
        loadCrmCache();

        if (ContextCompat.checkSelfPermission(this, Manifest.permission.READ_CALL_LOG) != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this, new String[]{Manifest.permission.READ_CALL_LOG, Manifest.permission.READ_CONTACTS}, REQ_PERM);
        } else {
            loadCalls();
        }

        // 🆕 v6.62.519: ContentObserver für Live-Refresh — neuer Anruf kommt rein → Liste
        // wird sofort neu geladen, ohne Activity-Wechsel oder manuellen Refresh.
        // Patrick (09.05.): "warum wird in der nativ ab nicht der letzt anruf angezeigt der gerade reinkam"
        callLogObserver = new ContentObserver(new Handler(Looper.getMainLooper())) {
            @Override
            public void onChange(boolean selfChange) {
                if (ContextCompat.checkSelfPermission(CallLogActivity.this, Manifest.permission.READ_CALL_LOG) == PackageManager.PERMISSION_GRANTED) {
                    loadCalls();
                }
            }
        };
        try {
            getContentResolver().registerContentObserver(CallLog.Calls.CONTENT_URI, true, callLogObserver);
        } catch (Throwable t) {
            // Permission noch nicht da — Observer wird beim Permission-Grant nochmal versucht
        }
    }

    // 🆕 v6.62.635: Polling-Handler als Backup falls ContentObserver auf Samsung-OneUI
    // unzuverlaessig feuert (Patrick 12.05. 08:46: neue Anrufe erscheinen erst beim Tab-Wechsel,
    // nicht waehrend Anrufliste offen ist).
    private Handler _refreshHandler = new Handler(Looper.getMainLooper());
    private final Runnable _refreshTick = new Runnable() {
        @Override
        public void run() {
            if (ContextCompat.checkSelfPermission(CallLogActivity.this, Manifest.permission.READ_CALL_LOG) == PackageManager.PERMISSION_GRANTED) {
                loadCalls();
            }
            _refreshHandler.postDelayed(this, 30000);
        }
    };

    @Override
    protected void onResume() {
        super.onResume();
        // 🆕 v6.62.519: Beim Zurückkommen in die Activity Liste auffrischen.
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.READ_CALL_LOG) == PackageManager.PERMISSION_GRANTED) {
            loadCalls();
        }
        // 🆕 v6.62.635: Polling alle 30s waehrend Activity sichtbar ist.
        _refreshHandler.postDelayed(_refreshTick, 30000);
    }

    @Override
    protected void onPause() {
        super.onPause();
        // 🆕 v6.62.635: Polling stoppen wenn Activity nicht mehr sichtbar.
        _refreshHandler.removeCallbacks(_refreshTick);
    }

    @Override
    protected void onDestroy() {
        if (callLogObserver != null) {
            try { getContentResolver().unregisterContentObserver(callLogObserver); } catch (Throwable _t) {}
            callLogObserver = null;
        }
        super.onDestroy();
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
                        // 🆕 v6.62.669: ALLE Format-Varianten als Schluessel in die Map,
                        //   damit Match egal ob CallLog +49.../00 49.../0... liefert.
                        if (cust.phone != null) addAllPhoneVariants(cust.phone, cust);
                        if (cust.mobilePhone != null) addAllPhoneVariants(cust.mobilePhone, cust);
                    }
                    adapter.notifyDataSetChanged();
                }
                @Override public void onCancelled(@NonNull DatabaseError error) {}
            });
    }

    // 🆕 v6.62.669: Patrick (13.05. 11:17): "André Luther Und Wegener taucht nie auf egal
    //   wann er anruft." Theorie: CallLog liefert die Nummer in einem Format, das CRM nicht
    //   matcht. Wir indexieren jetzt alle 3 deutschen Format-Varianten:
    //     +491626050075   (international)
    //     00491626050075  (international mit 00-Prefix, manche Samsung-CallLogs)
    //     01626050075     (national)
    //   Plus: last7 (letzte 7 Ziffern) als Fallback-Key, falls Format ganz anders ist.
    private void addAllPhoneVariants(String phone, CrmCustomer cust) {
        if (phone == null) return;
        String norm = normalizePhone(phone);
        if (norm.isEmpty()) return;
        crmByPhone.put(norm, cust);
        // +49xxx → 0xxx und 0049xxx
        if (norm.startsWith("+49") && norm.length() > 3) {
            String national = "0" + norm.substring(3);
            crmByPhone.put(national, cust);
            crmByPhone.put("00" + norm.substring(1), cust); // +49xxx → 0049xxx
        } else if (norm.startsWith("0049") && norm.length() > 4) {
            crmByPhone.put("+" + norm.substring(2), cust);
            crmByPhone.put("0" + norm.substring(4), cust);
        } else if (norm.startsWith("0") && !norm.startsWith("00") && norm.length() > 1) {
            // 01626... → +491626... und 00491626...
            crmByPhone.put("+49" + norm.substring(1), cust);
            crmByPhone.put("0049" + norm.substring(1), cust);
        }
        // Last-7-Ziffern als Notnagel-Match (Eindeutigkeit bei deutschen Mobilnummern)
        if (norm.length() >= 7) {
            String last7 = norm.substring(norm.length() - 7);
            // Nur als Fallback — nicht ueberschreiben falls schon ein praeziserer Match da
            if (!crmByPhone.containsKey("LAST7:" + last7)) {
                crmByPhone.put("LAST7:" + last7, cust);
            }
        }
    }

    private static String normalizePhone(String p) {
        if (p == null) return "";
        return p.replaceAll("[^+0-9]", "");
    }

    private CrmCustomer lookupCrm(String phone) {
        String norm = normalizePhone(phone);
        CrmCustomer c = crmByPhone.get(norm);
        if (c != null) return c;
        // 🆕 v6.62.669: Last-7-Fallback
        if (norm.length() >= 7) {
            return crmByPhone.get("LAST7:" + norm.substring(norm.length() - 7));
        }
        return null;
    }

    private void loadCalls() {
        progress.setVisibility(View.VISIBLE);
        java.util.Set<String> hidden = getHiddenNumbers();
        new Thread(() -> {
            List<CallEntry> result = new ArrayList<>();
            try {
                String[] proj = {CallLog.Calls.NUMBER, CallLog.Calls.CACHED_NAME, CallLog.Calls.DATE, CallLog.Calls.TYPE, CallLog.Calls.DURATION};
                // 🛑 v6.62.630: Patrick (11.05. 21:14): Fahrer-App zeigt "Anrufliste-Fehler:
                //   Invalid token LIMIT" weil Android 11+ (Samsung mit Security-Layer) das
                //   LIMIT-Keyword in der ORDER BY-Clause als SQL-Injection blockiert.
                //   Fix: LIMIT via Uri-Query-Parameter (alle Android-Versionen) — KEIN
                //   String-Concat mehr in der ORDER BY-Clause.
                // 🆕 v6.62.669: Patrick (13.05.): LIMIT 50 zu klein fuer Taxi-Betrieb,
                //   manche Anrufer (z.B. André Luther Und Wegener +491626050075) fielen
                //   raus. Auf 300 gehoben — Samsung-CallLog haelt eh max ~500 Eintraege.
                android.net.Uri _callsUri = CallLog.Calls.CONTENT_URI.buildUpon()
                    .appendQueryParameter("limit", "300").build();
                Cursor c = getContentResolver().query(_callsUri, proj, null, null, CallLog.Calls.DATE + " DESC");
                if (c != null) {
                    while (c.moveToNext()) {
                        CallEntry e = new CallEntry();
                        e.number = c.getString(0);
                        e.name = c.getString(1);
                        e.date = c.getLong(2);
                        e.type = c.getInt(3);
                        e.durationSec = c.getLong(4);
                        if (e.number == null || e.number.isEmpty()) continue;
                        // v6.58.0: hidden-Filter
                        if (hidden.contains(normalizePhone(e.number))) continue;
                        result.add(e);
                    }
                    c.close();
                }
            } catch (Throwable t) {
                runOnUiThread(() -> Toast.makeText(this, "Anrufliste-Fehler: " + t.getMessage(), Toast.LENGTH_LONG).show());
            }
            runOnUiThread(() -> {
                progress.setVisibility(View.GONE);
                adapter.set(result);
                if (result.isEmpty()) Toast.makeText(this, "Keine Anrufe gefunden (oder alle versteckt)", Toast.LENGTH_SHORT).show();
            });
        }).start();
    }

    // 🆕 v6.62.669: CallLog-Debug-Dump fuer "Anrufer taucht nicht auf"-Diagnose.
    //   Schreibt die letzten 300 Eintraege aus CallLog.Calls roh nach
    //   /debug/callLog/{deviceId}/{timestamp} damit Claude analysieren kann
    //   warum z.B. +491626050075 (André Luther Und Wegener) nie auftaucht
    //   (CallLog enthaelt ihn vielleicht gar nicht — WhatsApp-Anrufe?).
    private void dumpCallLogToFirebase() {
        new Thread(() -> {
            try {
                String[] proj = {CallLog.Calls.NUMBER, CallLog.Calls.CACHED_NAME, CallLog.Calls.DATE,
                                 CallLog.Calls.TYPE, CallLog.Calls.DURATION, CallLog.Calls.NEW};
                android.net.Uri uri = CallLog.Calls.CONTENT_URI.buildUpon()
                    .appendQueryParameter("limit", "300").build();
                Cursor c = getContentResolver().query(uri, proj, null, null, CallLog.Calls.DATE + " DESC");
                List<Map<String, Object>> rows = new ArrayList<>();
                if (c != null) {
                    while (c.moveToNext()) {
                        Map<String, Object> row = new HashMap<>();
                        String num = c.getString(0);
                        row.put("number", num != null ? num : "");
                        // CACHED_NAME wird mit-geliefert, koennte aber sensible Daten enthalten.
                        // Wir behalten ihn — du musst eh sehen was Android sagt.
                        String nm = c.getString(1);
                        if (nm != null && !nm.isEmpty()) row.put("cachedName", nm);
                        row.put("date", c.getLong(2));
                        row.put("type", c.getInt(3));
                        row.put("duration", c.getLong(4));
                        try { row.put("isNew", c.getInt(5)); } catch (Throwable _t) {}
                        // Normalisiert + alle Varianten zum Selbst-Pruefen
                        if (num != null) {
                            row.put("normalized", normalizePhone(num));
                            if (num.length() >= 7) row.put("last7", normalizePhone(num).substring(Math.max(0, normalizePhone(num).length() - 7)));
                        }
                        rows.add(row);
                    }
                    c.close();
                }
                Map<String, Object> dump = new HashMap<>();
                dump.put("createdAt", System.currentTimeMillis());
                dump.put("deviceModel", android.os.Build.MODEL);
                dump.put("androidVersion", android.os.Build.VERSION.SDK_INT);
                dump.put("appVersion", de.taxiheringsdorf.app.BuildConfig.VERSION_NAME);
                dump.put("totalRows", rows.size());
                dump.put("rows", rows);
                String deviceId = DeviceIdHelper.getOrCreate(this);
                FirebaseDatabase.getInstance(DB_INSTANCE_URL)
                    .getReference("debug/callLog/" + deviceId + "/" + System.currentTimeMillis())
                    .setValue(dump);
                runOnUiThread(() -> Toast.makeText(this, "✅ " + rows.size() + " CallLog-Eintraege an Claude gesendet (debug/callLog/" + deviceId.substring(0,8) + "...)", Toast.LENGTH_LONG).show());
            } catch (Throwable t) {
                runOnUiThread(() -> Toast.makeText(this, "❌ CallLog-Dump Fehler: " + t.getMessage(), Toast.LENGTH_LONG).show());
            }
        }).start();
    }

    // v6.58.0: SharedPrefs-basiertes Hidden-Set für ausgeswipete Anrufe.
    // Bleibt lokal pro Gerät (kein Firebase) — schneller, offline-tauglich.
    private static final String PREFS_HIDDEN = "callLogHidden";
    private static final String KEY_HIDDEN = "numbers";

    private java.util.Set<String> getHiddenNumbers() {
        java.util.Set<String> empty = new java.util.HashSet<>();
        java.util.Set<String> stored = getSharedPreferences(PREFS_HIDDEN, MODE_PRIVATE).getStringSet(KEY_HIDDEN, empty);
        return new java.util.HashSet<>(stored);
    }

    private void addHiddenNumber(String phone) {
        if (phone == null) return;
        java.util.Set<String> set = getHiddenNumbers();
        set.add(normalizePhone(phone));
        getSharedPreferences(PREFS_HIDDEN, MODE_PRIVATE).edit().putStringSet(KEY_HIDDEN, set).apply();
        updateHiddenButtonLabel();
    }

    private void removeHiddenNumber(String phone) {
        if (phone == null) return;
        java.util.Set<String> set = getHiddenNumbers();
        set.remove(normalizePhone(phone));
        getSharedPreferences(PREFS_HIDDEN, MODE_PRIVATE).edit().putStringSet(KEY_HIDDEN, set).apply();
        updateHiddenButtonLabel();
    }

    // v6.62.386: Anzahl versteckter Nummern im Header-Button anzeigen.
    private void updateHiddenButtonLabel() {
        android.widget.Button b = findViewById(R.id.btn_calls_hidden);
        if (b == null) return;
        int n = getHiddenNumbers().size();
        b.setText("🗑 Versteckt (" + n + ")");
    }

    // v6.51.0/v6.56.0: Admin-Modus — entweder explizit (AdminDashboardActivity hat
    // SharedPref 'isAdminMode'=true gesetzt) ODER User hat Rolle 'admin' aus Firebase.
    private boolean isAdminMode() {
        if (getSharedPreferences("admin", MODE_PRIVATE).getBoolean("isAdminMode", false)) return true;
        return PermissionsHelper.isAdmin(this);
    }

    private void showActionDialog(CallEntry e) {
        CrmCustomer crm = lookupCrm(e.number);
        boolean admin = isAdminMode();
        if (crm != null) {
            // v6.62.74: Patrick: 'Anrufer ruft an, ich fahre noch hin' → SOFORT-Fahrt mit
            // Status='accepted' damit normaler Flow durchlaufen wird (on_way → BIN DA → Eingestiegen).
            // EINSTEIGER bleibt fuer Walk-in (Person steht schon am Auto, sofort 'picked_up').
            // 🆕 v6.62.626: Patrick (11.05. 19:18): "Bisherige Fahrten" auch im CallLog —
            // launchet CrmSearchActivity mit auto_history_customer_id Intent-Extra, das die
            // dort vorhandene History-Logik direkt aufruft (keine Code-Duplikation).
            String[] options = admin
                ? new String[]{ "🚗 SOFORT-Fahrt (ich fahre hin)", "📅 Vorbestellung erstellen", "📋 CRM-Eintrag bearbeiten", "📜 Bisherige Fahrten anschauen", "Abbrechen" }
                : new String[]{ "🚖 EINSTEIGER (Kunde steht am Auto)", "🚗 SOFORT-Fahrt (ich fahre hin)", "📅 Vorbestellung erstellen", "📋 CRM-Eintrag bearbeiten", "📜 Bisherige Fahrten anschauen", "Abbrechen" };
            String title = "📞 " + crm.name + " — " + e.number;
            if (crm.address != null) title += "\n📍 " + crm.address;
            new AlertDialog.Builder(this)
                .setTitle(title)
                .setItems(options, (d, which) -> {
                    if (admin) {
                        switch (which) {
                            case 0: createSofortFahrtCrm(e, crm); break;
                            // v6.62.801: unified CRM-Maske statt eigener Prebooking-Dialog
                            case 1: openVorbestellungInCrmSearch(e, crm); break;
                            case 2: showCrmEditDialog(crm); break;
                            case 3: openRideHistoryForCustomer(crm); break;
                        }
                    } else {
                        switch (which) {
                            case 0: createEinsteigerCrm(e, crm); break;
                            case 1: createSofortFahrtCrm(e, crm); break;
                            case 2: openVorbestellungInCrmSearch(e, crm); break;
                            case 3: showCrmEditDialog(crm); break;
                            case 4: openRideHistoryForCustomer(crm); break;
                        }
                    }
                }).show();
        } else {
            String[] options = admin
                ? new String[]{ "👤 Als CRM-Kunde anlegen", "🚗 SOFORT-Fahrt (ich fahre hin)", "📅 Vorbestellung erstellen", "Abbrechen" }
                : new String[]{ "👤 Als CRM-Kunde anlegen", "🚖 EINSTEIGER (Kunde steht am Auto)", "🚗 SOFORT-Fahrt (ich fahre hin)", "📅 Vorbestellung erstellen", "Abbrechen" };
            new AlertDialog.Builder(this)
                .setTitle("❓ " + e.number + " — nicht im CRM")
                .setItems(options, (d, which) -> {
                    if (admin) {
                        switch (which) {
                            case 0: openCrmCreateInSearchActivity(e); break;
                            case 1: createSofortFahrtPhone(e); break;
                            case 2: openVorbestellungInCrmSearch(e, null); break;
                        }
                    } else {
                        switch (which) {
                            case 0: openCrmCreateInSearchActivity(e); break;
                            case 1: createEinsteigerWithPhone(e); break;
                            case 2: createSofortFahrtPhone(e); break;
                            case 3: openVorbestellungInCrmSearch(e, null); break;
                        }
                    }
                }).show();
        }
    }

    // v6.62.639: Patrick (12.05. 13:04+13:19): "in der Anrufliste CRM Kunde anlegen soll
    // EXAKT die gleiche Maske wie in der CRM-Suche" (= openEditDialog in CrmSearchActivity).
    // Statt eigenen Dialog mit weniger Feldern: starte CrmSearchActivity mit Prefill-Extras,
    // _maybeAutoOpenCreateDialog() dort oeffnet automatisch openEditDialog mit der vollen
    // Maske (Kundenart-Buttons, Hotel/Firma-Modus, alle Felder). Kein Code-Duplikat.
    private void openCrmCreateInSearchActivity(CallEntry e) {
        android.content.Intent i = new android.content.Intent(this, CrmSearchActivity.class);
        i.putExtra("prefill_new_phone", e.number != null ? e.number : "");
        i.putExtra("prefill_new_name", e.name != null ? e.name : "");
        startActivity(i);
    }

    // 🆕 v6.62.801 (Patrick 18.05. 11:31): "Vorbestellung erstellen aus der Anrufliste ist
    // nicht die gleiche Maske wie über das CRM." Genau wie openCrmCreateInSearchActivity:
    // CrmSearchActivity mit Intent-Extras → _maybeAutoOpenVorbestellung() öffnet die unified
    // Maske (Tausch-Button, Zwischenstops, Top-5-Ziele, Personen-Spinner, Datum/Zeit).
    private void openVorbestellungInCrmSearch(CallEntry e, CrmCustomer crm) {
        android.content.Intent i = new android.content.Intent(this, CrmSearchActivity.class);
        if (crm != null && crm.id != null) {
            i.putExtra("auto_vorbestellung_customer_id", crm.id);
        } else {
            i.putExtra("auto_vorbestellung_phone", e.number != null ? e.number : "");
            if (e.name != null) i.putExtra("auto_vorbestellung_name", e.name);
        }
        startActivity(i);
    }

    // 🆕 v6.62.626: Bisherige-Fahrten Button — startet CrmSearchActivity mit Intent-Extra,
    // das dort die showCustomerRideHistory()-Logik triggert. Kein Code-Duplikat.
    private void openRideHistoryForCustomer(CrmCustomer crm) {
        if (crm == null || crm.id == null) {
            Toast.makeText(this, "❌ Kunden-ID fehlt", Toast.LENGTH_LONG).show();
            return;
        }
        android.content.Intent i = new android.content.Intent(this, CrmSearchActivity.class);
        i.putExtra("auto_history_customer_id", crm.id);
        i.putExtra("auto_history_customer_name", crm.name != null ? crm.name : "");
        startActivity(i);
    }

    // v6.62.74: SOFORT-Fahrt — Pickup steht beim Anrufer, ich fahre hin.
    // Status='accepted' damit DriverDashboard den vollen Flow zeigt: on_way / BIN DA / Eingestiegen.
    // CRM-Variante: Pickup vorbelegt mit CRM-Adresse, Patrick kann via Picker aendern.
    private void createSofortFahrtCrm(CallEntry e, CrmCustomer crm) {
        showSofortFahrtPickerDialog(e, crm);
    }

    // v6.62.74: SOFORT-Fahrt ohne CRM (nur Telefonnummer) — gleicher Picker-Dialog
    private void createSofortFahrtPhone(CallEntry e) {
        showSofortFahrtPickerDialog(e, null);
    }

    // v6.62.387: Patrick (06.05. 20:20): "Bei Sofort-Fahrt brauche ich auch den
    // Kartenpicker, sonst kann ich Pickup/Ziel nicht eingeben". Picker-Dialog wie
    // bei Vorbestellung, nur ohne Datum/Uhrzeit (sofort = jetzt).
    private void showSofortFahrtPickerDialog(CallEntry e, CrmCustomer crm) {
        String vehicleId = getSharedPreferences("driver", MODE_PRIVATE).getString("vehicleId", null);
        if (vehicleId == null) { Toast.makeText(this, "Kein Fahrzeug ausgewählt", Toast.LENGTH_SHORT).show(); return; }

        ScrollView scroll = new ScrollView(this);
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        int pad = (int) (getResources().getDisplayMetrics().density * 16);
        int padHalf = pad / 2;
        layout.setPadding(pad, pad, pad, pad);
        scroll.addView(layout);

        String custName = (crm != null) ? crm.name : (e.name != null && !e.name.isEmpty() ? e.name : "Anrufer");
        TextView tvHead = new TextView(this);
        tvHead.setText("👤 " + custName + "\n📞 " + e.number);
        tvHead.setTextSize(13);
        tvHead.setPadding(0, 0, 0, pad);
        layout.addView(tvHead);

        boolean isHotel = crm != null && crm.customerKind != null && crm.customerKind.equalsIgnoreCase("Hotel");

        final double[] pickupCoords = { Double.NaN, Double.NaN };
        final double[] destCoords = { Double.NaN, Double.NaN };

        TextView tvPickup = new TextView(this);
        if (!isHotel && crm != null && crm.address != null) {
            tvPickup.setText("📍 " + crm.address);
            if (crm.lat != null && crm.lon != null) {
                pickupCoords[0] = crm.lat; pickupCoords[1] = crm.lon;
            } else if (!crm.address.isEmpty()) {
                geocodeAndFill(crm.address, tvPickup, pickupCoords);
            }
        } else {
            tvPickup.setText("📍 Abholort wählen…");
        }
        tvPickup.setPadding(padHalf, pad, padHalf, pad);
        tvPickup.setBackgroundColor(0xFFF1F5F9);
        tvPickup.setOnClickListener(v -> launchPlaces(tvPickup, pickupCoords));
        layout.addView(tvPickup);

        TextView btnSwap = new TextView(this);
        btnSwap.setText("⇅ Abholort ↔ Ziel tauschen");
        btnSwap.setTextSize(12);
        btnSwap.setTextColor(0xFF1E40AF);
        btnSwap.setBackgroundColor(0xFFEFF6FF);
        btnSwap.setGravity(android.view.Gravity.CENTER);
        btnSwap.setPadding(padHalf, padHalf, padHalf, padHalf);
        LinearLayout.LayoutParams swapLp = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        swapLp.setMargins(0, padHalf, 0, padHalf);
        btnSwap.setLayoutParams(swapLp);
        btnSwap.setClickable(true);
        layout.addView(btnSwap);

        TextView tvDest = new TextView(this);
        if (isHotel && crm != null && crm.address != null) {
            tvDest.setText("🎯 " + crm.address);
            if (crm.lat != null && crm.lon != null) {
                destCoords[0] = crm.lat; destCoords[1] = crm.lon;
            } else if (!crm.address.isEmpty()) {
                geocodeAndFill(crm.address, tvDest, destCoords);
            }
        } else {
            tvDest.setText("🎯 Zielort wählen…");
        }
        tvDest.setPadding(padHalf, pad, padHalf, pad);
        tvDest.setBackgroundColor(0xFFF1F5F9);
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

        // 🆕 v6.62.777 (Patrick 16.05. 11:26): Name-Eingabefeld in Sofort-Fahrt.
        //   "Hallo Anrufer" in der Kunden-SMS sah unprofessionell aus. Patrick kann
        //   jetzt den Namen waehrend des Anrufs eingeben — Default ist custName
        //   (CRM-Name / Telefon-Anzeige-Name / 'Anrufer'), aber editierbar.
        TextView lblName = new TextView(this);
        lblName.setText("👤 Name fuer SMS-Anrede");
        lblName.setTextSize(12);
        lblName.setPadding(0, pad, 0, padHalf);
        layout.addView(lblName);
        EditText etName = new EditText(this);
        etName.setHint("z.B. Schmidt — wird in 'Hallo Schmidt' verwendet");
        etName.setInputType(InputType.TYPE_TEXT_FLAG_CAP_WORDS);
        if (custName != null && !custName.equals("Anrufer")) etName.setText(custName);
        layout.addView(etName);

        // Personenzahl
        TextView lblPax = new TextView(this);
        lblPax.setText("👥 Personenzahl");
        lblPax.setTextSize(12);
        lblPax.setPadding(0, pad, 0, padHalf);
        layout.addView(lblPax);
        android.widget.Spinner spPax = new android.widget.Spinner(this);
        Integer[] paxOpts = { 1, 2, 3, 4, 5, 6, 7, 8 };
        spPax.setAdapter(new android.widget.ArrayAdapter<>(this, android.R.layout.simple_spinner_dropdown_item, paxOpts));
        spPax.setSelection(0);
        layout.addView(spPax);

        new AlertDialog.Builder(this)
            .setTitle("🚗 SOFORT-Fahrt anlegen")
            .setView(scroll)
            .setPositiveButton("✅ Anlegen", (d, w) -> {
                String pickup = tvPickup.getText().toString().replaceFirst("^📍\\s*", "").trim();
                String destination = tvDest.getText().toString().replaceFirst("^🎯\\s*", "").trim();
                if (pickup.isEmpty() || pickup.endsWith("wählen…")) {
                    Toast.makeText(this, "Abholort fehlt", Toast.LENGTH_SHORT).show(); return;
                }
                int pax = (Integer) spPax.getSelectedItem();
                String enteredName = etName.getText().toString().trim();
                String finalName = !enteredName.isEmpty() ? enteredName : custName;
                DatabaseReference ref = FirebaseDatabase.getInstance(DB_INSTANCE_URL).getReference("rides").push();
                long now = System.currentTimeMillis();
                Map<String, Object> r = new HashMap<>();
                r.put("customerName", finalName);
                if (crm != null) r.put("customerId", crm.id);
                r.put("customerPhone", e.number);
                r.put("customerMobile", crm != null && crm.mobilePhone != null ? crm.mobilePhone : e.number);
                r.put("vehicleId", vehicleId);
                r.put("assignedVehicle", vehicleId);
                r.put("status", "accepted");
                r.put("pickup", pickup);
                if (!Double.isNaN(pickupCoords[0])) {
                    r.put("pickupLat", pickupCoords[0]);
                    r.put("pickupLon", pickupCoords[1]);
                }
                if (!destination.isEmpty() && !destination.endsWith("wählen…")) {
                    r.put("destination", destination);
                    if (!Double.isNaN(destCoords[0])) {
                        r.put("destinationLat", destCoords[0]);
                        r.put("destinationLon", destCoords[1]);
                    }
                } else {
                    r.put("destination", "");
                }
                r.put("pickupTimestamp", now);
                r.put("createdAt", now);
                r.put("updatedAt", now);
                r.put("acceptedAt", now);
                r.put("assignedAt", now);
                r.put("assignedBy", crm != null ? "native_sofort_calllog_crm" : "native_sofort_calllog");
                r.put("acceptedVia", crm != null ? "native_sofort_calllog_crm" : "native_sofort_calllog");
                r.put("source", crm != null ? "native_sofort_call_crm" : "native_sofort_call");
                r.put("isSofort", true);
                r.put("passengers", pax);
                ref.setValue(r).addOnSuccessListener(_v -> {
                    Toast.makeText(this, "✅ SOFORT-Fahrt angelegt: " + custName, Toast.LENGTH_SHORT).show();
                    startActivity(new Intent(this, DriverDashboardActivity.class));
                    finish();
                }).addOnFailureListener(ex -> Toast.makeText(this, "Fehler: " + ex.getMessage(), Toast.LENGTH_LONG).show());
            })
            .setNegativeButton("Abbrechen", null).show();
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

        // v6.62.325: Patrick (06.05. 08:19): "Anrede + Vorname + Nachname sauber trennen
        // beim Stammkundenanlegen". 3 Felder statt einem 'name'-String. Backwards-compat:
        // name = firstName + ' ' + lastName wird trotzdem geschrieben fuer Web-Stellen
        // die nur customer.name lesen.
        android.widget.Spinner spSalutation = new android.widget.Spinner(this);
        String[] _salutations = { "—", "Herr", "Frau", "Divers" };
        android.widget.ArrayAdapter<String> _adapt = new android.widget.ArrayAdapter<>(
            this, android.R.layout.simple_spinner_item, _salutations);
        _adapt.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        spSalutation.setAdapter(_adapt);
        layout.addView(spSalutation);

        EditText etFirstName = new EditText(this);
        etFirstName.setHint("Vorname");
        layout.addView(etFirstName);

        EditText etLastName = new EditText(this);
        etLastName.setHint("Nachname");
        layout.addView(etLastName);

        // Pre-fill aus e.name falls vorhanden — versuche zu splitten an Leerzeichen
        if (e.name != null && !e.name.isEmpty()) {
            String _trim = e.name.trim();
            if (_trim.startsWith("Frau ")) { spSalutation.setSelection(2); _trim = _trim.substring(5).trim(); }
            else if (_trim.startsWith("Herr ")) { spSalutation.setSelection(1); _trim = _trim.substring(5).trim(); }
            String[] _parts = _trim.split("\\s+", 2);
            if (_parts.length == 2) {
                etFirstName.setText(_parts[0]);
                etLastName.setText(_parts[1]);
            } else {
                etLastName.setText(_trim);
            }
        }

        // Versteckter Legacy 'name'-Helper: liefert "Vorname Nachname"
        EditText etName = new EditText(this);
        etName.setVisibility(View.GONE);
        layout.addView(etName);

        // v6.53.0: Adresse via Places-Autocomplete statt freitext-EditText.
        // Speichert lat/lon in addressLat/addressLon — gleicher Schema wie Web-CRM.
        final double[] addrCoords = { Double.NaN, Double.NaN };
        TextView tvAddress = new TextView(this);
        tvAddress.setText("📍 Adresse wählen… (optional)");
        tvAddress.setPadding(pad / 2, pad, pad / 2, pad);
        tvAddress.setOnClickListener(_v -> launchPlaces(tvAddress, addrCoords));
        layout.addView(tvAddress);

        // v6.62.616: Patrick (11.05. 15:34): "Kann ich jetzt auch aus der Anrufliste
        //   Hotel/Firma anlegen?" — Chip-Row Kundenart statt freitext-Typ.
        // v6.62.617: padHalf gibt's in dieser Methode nicht — pad/2 inline.
        final int _kindPadHalf = pad / 2;
        TextView lblKind = new TextView(this);
        lblKind.setText("👥 Kundenart");
        lblKind.setPadding(0, pad, 0, _kindPadHalf);
        lblKind.setTextSize(13);
        layout.addView(lblKind);
        final String[] kinds = { "Stammkunde", "Gelegenheit", "Hotel", "Firma" };
        final String[] kindLabels = { "🔁 Stamm", "👤 Gelegenh.", "🏨 Hotel", "🏢 Firma" };
        final int[] kindIdx = { 0 };
        LinearLayout kindRow = new LinearLayout(this);
        kindRow.setOrientation(LinearLayout.HORIZONTAL);
        kindRow.setPadding(0, _kindPadHalf, 0, _kindPadHalf);
        final TextView[] kindChips = new TextView[kinds.length];
        java.util.function.IntConsumer applyKindChips = (selected) -> {
            for (int i = 0; i < kinds.length; i++) {
                kindChips[i].setBackgroundColor(i == selected ? 0xFF10B981 : 0xFFE2E8F0);
                kindChips[i].setTextColor(i == selected ? 0xFFFFFFFF : 0xFF475569);
            }
        };
        for (int i = 0; i < kinds.length; i++) {
            final int idx = i;
            TextView chip = new TextView(this);
            chip.setText(kindLabels[i]);
            chip.setTextSize(12);
            chip.setPadding(_kindPadHalf, _kindPadHalf, _kindPadHalf, _kindPadHalf);
            chip.setGravity(android.view.Gravity.CENTER);
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
            lp.setMargins(_kindPadHalf / 2, 0, _kindPadHalf / 2, 0);
            chip.setLayoutParams(lp);
            chip.setOnClickListener(_v -> { kindIdx[0] = idx; applyKindChips.accept(idx); });
            kindChips[i] = chip;
            kindRow.addView(chip);
        }
        applyKindChips.accept(0);
        layout.addView(kindRow);

        new AlertDialog.Builder(this)
            .setTitle("👤 Neuer CRM-Kunde — " + e.number)
            .setView(layout)
            .setPositiveButton("Speichern", (d, w) -> {
                // v6.62.325: Vorname + Nachname + Anrede sauber separat speichern
                String _firstName = etFirstName.getText().toString().trim();
                String _lastName = etLastName.getText().toString().trim();
                String _name = (_firstName + " " + _lastName).trim();
                if (_name.isEmpty()) {
                    // Fallback: alter etName-String falls Splitting nichts ergab
                    _name = etName.getText().toString().trim();
                }
                if (_name.isEmpty()) { Toast.makeText(this, "Name ist Pflicht (Vorname und/oder Nachname)", Toast.LENGTH_SHORT).show(); return; }
                final String name = _name;
                int _salPos = spSalutation.getSelectedItemPosition();
                String _salutation = _salPos > 0 ? _salutations[_salPos] : "";
                DatabaseReference ref = FirebaseDatabase.getInstance(DB_INSTANCE_URL).getReference("customers").push();
                long now = System.currentTimeMillis();
                Map<String, Object> c = new HashMap<>();
                c.put("name", name);
                if (!_firstName.isEmpty()) c.put("firstName", _firstName);
                if (!_lastName.isEmpty()) c.put("lastName", _lastName);
                if (!_salutation.isEmpty()) {
                    c.put("salutation", _salutation);
                    c.put("anrede", _salutation); // Web-Code liest 'anrede'
                }
                c.put("phone", e.number);
                c.put("mobilePhone", e.number);
                String addr = tvAddress.getText().toString().replaceFirst("^📍 ", "").trim();
                if (!addr.isEmpty() && !addr.endsWith("wählen… (optional)")) {
                    c.put("address", addr);
                    if (!Double.isNaN(addrCoords[0])) {
                        c.put("addressLat", addrCoords[0]);
                        c.put("addressLon", addrCoords[1]);
                    }
                }
                // v6.62.616: customerKind aus Chip-Row statt freitext
                c.put("customerKind", kinds[kindIdx[0]]);
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

    // v6.55.0: Native CRM-Edit-Modal — Patrick: 'wie das normale CRM bauen damit man
    // sich nicht umgewöhnen muss'. Volle Felder: Name, Phone, Mobile, Email, Adresse
    // mit Places-Autocomplete, CustomerKind. Speichert per update auf /customers/{id}.
    private void showCrmEditDialog(CrmCustomer crm) {
        if (crm == null || crm.id == null) {
            Toast.makeText(this, "Kein CRM-Eintrag — kann nicht bearbeiten", Toast.LENGTH_SHORT).show();
            return;
        }

        // v6.62.37: Patrick: 'CRM-Modal schicker — sieht altbacken aus'.
        // Sections mit Header, Cards mit weissem BG + Schatten via Padding-Trick,
        // Pflichtfelder rot-gerahmt, Kundenart als Chip-Row statt Tap-Cycle.
        final float density = getResources().getDisplayMetrics().density;
        final int pad = (int) (density * 16);
        final int padHalf = (int) (density * 8);
        ScrollView scroll = new ScrollView(this);
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setPadding(pad, pad, pad, pad);
        layout.setBackgroundColor(0xFFF1F5F9); // helles Slate-Grau
        scroll.addView(layout);

        // Section-Helper
        java.util.function.BiConsumer<String, String> addSection = (emoji, title) -> {
            TextView h = new TextView(this);
            h.setText(emoji + "  " + title.toUpperCase());
            h.setTextSize(12);
            h.setTextColor(0xFF64748B);
            h.setPadding(padHalf, pad, 0, padHalf);
            h.setLetterSpacing(0.05f);
            android.graphics.Typeface bold = android.graphics.Typeface.create(android.graphics.Typeface.DEFAULT, android.graphics.Typeface.BOLD);
            h.setTypeface(bold);
            layout.addView(h);
        };

        // Card-Helper (weisser Container fuer Felder)
        java.util.function.Supplier<LinearLayout> newCard = () -> {
            LinearLayout c = new LinearLayout(this);
            c.setOrientation(LinearLayout.VERTICAL);
            c.setBackgroundColor(0xFFFFFFFF);
            c.setPadding(pad, padHalf, pad, padHalf);
            // Margin via LayoutParams
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
            lp.setMargins(0, 0, 0, padHalf);
            c.setLayoutParams(lp);
            // Subtle shadow via top+bottom border
            c.setElevation(2f * density);
            return c;
        };

        // ─── STAMMDATEN ───────────────
        // v6.62.326: Patrick: "Vornahme und Nachnahme — sauber separat"
        addSection.accept("👤", "Stammdaten");
        LinearLayout cardName = newCard.get();
        // Anrede-Spinner
        android.widget.Spinner spSalutation = new android.widget.Spinner(this);
        final String[] _editSalutations = { "—", "Herr", "Frau", "Divers" };
        android.widget.ArrayAdapter<String> _salAdapt = new android.widget.ArrayAdapter<>(
            this, android.R.layout.simple_spinner_item, _editSalutations);
        _salAdapt.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        spSalutation.setAdapter(_salAdapt);
        // Pre-Fill anrede aus CRM (firstName/lastName/salutation -- wenn nicht da, aus name splitten)
        String _initSal = crm.salutation != null ? crm.salutation : (crm.anrede != null ? crm.anrede : "");
        for (int _i = 0; _i < _editSalutations.length; _i++) if (_editSalutations[_i].equals(_initSal)) spSalutation.setSelection(_i);
        cardName.addView(spSalutation);
        // Vorname
        EditText etFirstName = new EditText(this);
        etFirstName.setHint("Vorname");
        etFirstName.setTextSize(15);
        cardName.addView(etFirstName);
        // Nachname
        EditText etLastName = new EditText(this);
        etLastName.setHint("Nachname");
        etLastName.setTextSize(15);
        cardName.addView(etLastName);
        // Pre-Fill: firstName/lastName aus CRM, sonst aus name splitten
        String _initFn = crm.firstName != null ? crm.firstName : "";
        String _initLn = crm.lastName != null ? crm.lastName : "";
        if (_initFn.isEmpty() && _initLn.isEmpty() && crm.name != null && !crm.name.trim().isEmpty()) {
            String _trim = crm.name.trim();
            if (_trim.startsWith("Frau ")) { spSalutation.setSelection(2); _trim = _trim.substring(5).trim(); }
            else if (_trim.startsWith("Herr ")) { spSalutation.setSelection(1); _trim = _trim.substring(5).trim(); }
            String[] _parts = _trim.split("\\s+", 2);
            if (_parts.length == 2) { _initFn = _parts[0]; _initLn = _parts[1]; }
            else _initLn = _trim;
        }
        etFirstName.setText(_initFn);
        etLastName.setText(_initLn);
        // Versteckter Legacy etName fuer Backwards-Compat im Speichern-Pfad weiter unten
        EditText etName = new EditText(this);
        etName.setVisibility(View.GONE);
        etName.setText(crm.name != null ? crm.name : "");
        cardName.addView(etName);
        layout.addView(cardName);

        // ─── KONTAKT ─────────────────
        addSection.accept("📞", "Kontakt");
        LinearLayout cardKontakt = newCard.get();
        EditText etPhone = new EditText(this);
        etPhone.setHint("Telefon (Festnetz)");
        etPhone.setInputType(InputType.TYPE_CLASS_PHONE);
        etPhone.setText(crm.phone != null ? crm.phone : "");
        etPhone.setTextSize(15);
        cardKontakt.addView(etPhone);
        EditText etMobile = new EditText(this);
        etMobile.setHint("Mobil");
        etMobile.setInputType(InputType.TYPE_CLASS_PHONE);
        etMobile.setText(crm.mobilePhone != null ? crm.mobilePhone : "");
        etMobile.setTextSize(15);
        cardKontakt.addView(etMobile);
        EditText etEmail = new EditText(this);
        etEmail.setHint("E-Mail");
        etEmail.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS);
        etEmail.setTextSize(15);
        cardKontakt.addView(etEmail);
        layout.addView(cardKontakt);

        // ─── ADRESSE ──────────────────
        addSection.accept("📍", "Adresse");
        final double[] addrCoords = {
            crm.lat != null ? crm.lat : Double.NaN,
            crm.lon != null ? crm.lon : Double.NaN
        };
        LinearLayout cardAddr = newCard.get();
        TextView tvAddress = new TextView(this);
        tvAddress.setText(crm.address != null && !crm.address.isEmpty() ? crm.address : "Tippen — Adresse wählen");
        tvAddress.setTextSize(15);
        tvAddress.setTextColor(crm.address != null && !crm.address.isEmpty() ? 0xFF1E293B : 0xFF94A3B8);
        tvAddress.setPadding(0, padHalf, 0, padHalf);
        tvAddress.setOnClickListener(_v -> launchPlaces(tvAddress, addrCoords));
        cardAddr.addView(tvAddress);
        TextView tvAddrHint = new TextView(this);
        tvAddrHint.setText(crm.lat == null && crm.address != null ? "⚠ Keine Koordinaten — bitte neu auswählen" : "Tippen öffnet Suche (Google + OSM-Fallback)");
        tvAddrHint.setTextSize(11);
        tvAddrHint.setTextColor(crm.lat == null && crm.address != null ? 0xFFB45309 : 0xFF94A3B8);
        cardAddr.addView(tvAddrHint);
        layout.addView(cardAddr);

        // ─── KUNDENART ────────────────
        addSection.accept("👥", "Kundenart");
        final String[] kinds = { "Stammkunde", "Gelegenheit", "Hotel", "Firma" };
        final int[] kindIdx = { java.util.Arrays.asList(kinds).indexOf(crm.customerKind != null ? crm.customerKind : "Stammkunde") };
        if (kindIdx[0] < 0) kindIdx[0] = 0;
        LinearLayout cardKind = newCard.get();
        LinearLayout chipRow = new LinearLayout(this);
        chipRow.setOrientation(LinearLayout.HORIZONTAL);
        chipRow.setPadding(0, padHalf, 0, padHalf);
        TextView[] chips = new TextView[kinds.length];
        java.util.function.IntConsumer applyChips = (selected) -> {
            for (int i = 0; i < kinds.length; i++) {
                chips[i].setBackgroundColor(i == selected ? 0xFF10B981 : 0xFFE2E8F0);
                chips[i].setTextColor(i == selected ? 0xFFFFFFFF : 0xFF475569);
            }
        };
        for (int i = 0; i < kinds.length; i++) {
            final int idx = i;
            TextView chip = new TextView(this);
            chip.setText(kinds[i]);
            chip.setTextSize(13);
            chip.setPadding(padHalf, padHalf, padHalf, padHalf);
            chip.setGravity(android.view.Gravity.CENTER);
            LinearLayout.LayoutParams clp = new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
            clp.setMargins(i == 0 ? 0 : (int)(density * 4), 0, i == kinds.length - 1 ? 0 : (int)(density * 4), 0);
            chip.setLayoutParams(clp);
            chip.setOnClickListener(_v -> { kindIdx[0] = idx; applyChips.accept(idx); });
            chips[i] = chip;
            chipRow.addView(chip);
        }
        applyChips.accept(kindIdx[0]);
        cardKind.addView(chipRow);
        layout.addView(cardKind);

        new AlertDialog.Builder(this)
            .setTitle("📋 " + (crm.name != null ? crm.name : "CRM-Kunde") + " bearbeiten")
            .setView(scroll)
            .setPositiveButton("Speichern", (d, w) -> {
                // v6.62.326: Vor/Nachname/Anrede getrennt — name = concat fuer Backwards-Compat
                String _eFirstName = etFirstName.getText().toString().trim();
                String _eLastName = etLastName.getText().toString().trim();
                String _eName = (_eFirstName + " " + _eLastName).trim();
                if (_eName.isEmpty()) _eName = etName.getText().toString().trim();
                if (_eName.isEmpty()) {
                    Toast.makeText(this, "Name ist Pflicht (Vor- und/oder Nachname)", Toast.LENGTH_SHORT).show();
                    return;
                }
                final String name = _eName;
                int _eSalPos = spSalutation.getSelectedItemPosition();
                String _eSalutation = _eSalPos > 0 ? _editSalutations[_eSalPos] : "";
                Map<String, Object> updates = new HashMap<>();
                updates.put("name", name);
                updates.put("firstName", _eFirstName.isEmpty() ? null : _eFirstName);
                updates.put("lastName", _eLastName.isEmpty() ? null : _eLastName);
                updates.put("salutation", _eSalutation.isEmpty() ? null : _eSalutation);
                updates.put("anrede", _eSalutation.isEmpty() ? null : _eSalutation);
                String phone = etPhone.getText().toString().trim();
                String mobile = etMobile.getText().toString().trim();
                String email = etEmail.getText().toString().trim();
                if (!phone.isEmpty()) updates.put("phone", phone);
                if (!mobile.isEmpty()) updates.put("mobilePhone", mobile);
                if (!email.isEmpty()) updates.put("email", email);
                String addr = tvAddress.getText().toString().replaceFirst("^📍\\s*", "").trim();
                // v6.62.37: neuer Hint-Text 'Tippen — Adresse waehlen' statt alter '... wählen…'
                // v6.62.253: alle drei Hint-Varianten ignorieren
                if (!addr.isEmpty() && !addr.contains("Adresse wählen") && !addr.contains("Adresse waehlen") && !addr.endsWith("wählen…")) {
                    updates.put("address", addr);
                    if (!Double.isNaN(addrCoords[0])) {
                        updates.put("addressLat", addrCoords[0]);
                        updates.put("addressLon", addrCoords[1]);
                    }
                }
                updates.put("customerKind", kinds[kindIdx[0]]);
                updates.put("updatedAt", System.currentTimeMillis());
                updates.put("updatedVia", "native_crm_edit");

                FirebaseDatabase.getInstance(DB_INSTANCE_URL).getReference("customers/" + crm.id)
                    .updateChildren(updates)
                    .addOnSuccessListener(_v -> {
                        Toast.makeText(this, "✅ " + name + " gespeichert", Toast.LENGTH_SHORT).show();
                        loadCrmCache();
                    })
                    .addOnFailureListener(ex ->
                        Toast.makeText(this, "❌ Fehler: " + ex.getMessage(), Toast.LENGTH_LONG).show());
            })
            .setNegativeButton("Abbrechen", null)
            .show();
    }

    private void showPrebookingDialog(CallEntry e, CrmCustomer crm) {
        // v6.51.0: Im Admin-Modus kein Fahrzeug nötig — Buchung landet in Warteschlange,
        // Cloud-AutoAssign kümmert sich. Im Driver-Modus weiterhin Fahrzeug Pflicht.
        String vehicleId = getSharedPreferences("driver", MODE_PRIVATE).getString("vehicleId", null);
        if (vehicleId == null && !isAdminMode()) {
            Toast.makeText(this, "Kein Fahrzeug ausgewählt", Toast.LENGTH_SHORT).show();
            return;
        }

        // v6.62.38: Schnellbuchungs-Maske aus index.html portiert (Hotel/Auftraggeber-Logik).
        // Patrick: 'wenn ein Hotel anruft, ist Hotel-Adresse Pickup oder Ziel — und Gastname
        // muss separat erfasst werden. Auch Pickup/Ziel tauschen muss gehen wie im Browser'.
        final boolean isHotelCustomer = crm != null && (
            "Hotel".equalsIgnoreCase(crm.customerKind) ||
            "Firma".equalsIgnoreCase(crm.customerKind)
        );
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        int pad = (int) (getResources().getDisplayMetrics().density * 16);
        int padHalf = (int) (getResources().getDisplayMetrics().density * 8);
        layout.setPadding(pad, pad, pad, pad);

        // v6.62.332: Patrick (06.05. 08:43): "Aus der Telefonliste gleich den Kunden mit
        // Herr/Frau einstellen koennen, Vorname (optional), Nachname — vernuenftiger Flow,
        // nicht erst Kunde anlegen muss". Quick-Anrede + Vorname + Nachname direkt im
        // Vorbestellungs-Dialog. Bei Stammkunden: Pre-Fill aus crm.firstName/lastName/anrede.
        // Bei Hotels: 3-Felder fuer den GAST (Hotel selbst ist Auftraggeber).
        android.widget.Spinner spSal = new android.widget.Spinner(this);
        final String[] _qfSalutations = { "—", "Herr", "Frau", "Divers" };
        android.widget.ArrayAdapter<String> _qfSalAdapt = new android.widget.ArrayAdapter<>(
            this, android.R.layout.simple_spinner_item, _qfSalutations);
        _qfSalAdapt.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        spSal.setAdapter(_qfSalAdapt);
        layout.addView(spSal);

        // 🔧 v6.62.479: Patrick (08.05. 12:43): "vorname soll unten sein und name oben".
        //   Pflichtfeld Nachname zuerst, dann optionaler Vorname — passt zur intuitiven
        //   Eingabereihenfolge wenn jemand "Endress" als Nachname schreibt und Vorname leer lässt.
        EditText etLastName = new EditText(this);
        etLastName.setHint(isHotelCustomer ? "Nachname (Gast)" : "Nachname");
        layout.addView(etLastName);

        EditText etFirstName = new EditText(this);
        etFirstName.setHint(isHotelCustomer ? "Vorname (Gast)" : "Vorname (optional)");
        layout.addView(etFirstName);

        // Pre-Fill aus CRM oder e.name (auto-split)
        String _preSal = !isHotelCustomer && crm != null && (crm.salutation != null || crm.anrede != null)
            ? (crm.salutation != null ? crm.salutation : crm.anrede) : "";
        for (int _i = 0; _i < _qfSalutations.length; _i++) if (_qfSalutations[_i].equals(_preSal)) spSal.setSelection(_i);
        String _preFn = !isHotelCustomer && crm != null && crm.firstName != null ? crm.firstName : "";
        String _preLn = !isHotelCustomer && crm != null && crm.lastName != null ? crm.lastName : "";
        if (_preFn.isEmpty() && _preLn.isEmpty()) {
            String _src = isHotelCustomer ? "" : (crm != null && crm.name != null ? crm.name : (e.name != null ? e.name : ""));
            if (!_src.trim().isEmpty()) {
                String _t = _src.trim();
                if (_t.startsWith("Frau ")) { spSal.setSelection(2); _t = _t.substring(5).trim(); }
                else if (_t.startsWith("Herr ")) { spSal.setSelection(1); _t = _t.substring(5).trim(); }
                String[] _p = _t.split("\\s+", 2);
                if (_p.length == 2) { _preFn = _p[0]; _preLn = _p[1]; }
                else _preLn = _t;
            }
        }
        etFirstName.setText(_preFn);
        etLastName.setText(_preLn);

        // Legacy etName (hidden) — der bestehende Speichern-Code nutzt es. Wird beim Save aus
        // firstname+lastname befuellt.
        EditText etName = new EditText(this);
        etName.setVisibility(View.GONE);
        etName.setText((_preFn + " " + _preLn).trim());
        layout.addView(etName);

        // Hotel-Auftraggeber-Hint
        if (isHotelCustomer) {
            TextView tvAuftrag = new TextView(this);
            tvAuftrag.setText("📨 Auftraggeber: " + crm.name + " (" + crm.customerKind + ")");
            tvAuftrag.setTextSize(11);
            tvAuftrag.setTextColor(0xFF64748B);
            tvAuftrag.setPadding(0, 0, 0, padHalf);
            layout.addView(tvAuftrag);
        }

        // v6.53.0: Pickup + Destination als TextView-Buttons → öffnen Places-Autocomplete.
        final double[] pickupCoords = { Double.NaN, Double.NaN };
        final double[] destCoords = { Double.NaN, Double.NaN };
        TextView tvPickup = new TextView(this);
        // Hotel: Pickup default LEER (Hotel ist Ziel — Gast wird zum Hotel gefahren).
        // Stammkunde: Pickup = CRM-Adresse (Default-Verhalten beibehalten).
        if (!isHotelCustomer && crm != null && crm.address != null) {
            tvPickup.setText("📍 " + crm.address);
        } else {
            tvPickup.setText("📍 Abholort wählen…");
        }
        tvPickup.setPadding(pad / 2, pad, pad / 2, pad);
        tvPickup.setOnClickListener(v -> launchPlaces(tvPickup, pickupCoords));
        layout.addView(tvPickup);
        // CRM-Koords nur als Pickup-Vorbelegung wenn NICHT Hotel
        if (!isHotelCustomer && crm != null && crm.lat != null && crm.lon != null) {
            pickupCoords[0] = crm.lat; pickupCoords[1] = crm.lon;
        } else if (!isHotelCustomer && crm != null && crm.address != null && !crm.address.isEmpty()) {
            // v6.62.35: Patrick: 'Birgit Lenzkes Abholort nicht geocodierbar'.
            // Background-Geocode bei CRM-Adresse ohne Coords.
            geocodeAndFill(crm.address, tvPickup, pickupCoords);
        }

        // v6.62.38: Tausch-Button zwischen Pickup und Ziel (analog index.html swapPickupDest).
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
        btnSwap.setClickable(true);
        layout.addView(btnSwap);

        TextView tvDest = new TextView(this);
        // Hotel: Ziel default = Hotel-Adresse (Gast wird zum Hotel gefahren).
        if (isHotelCustomer && crm.address != null) {
            tvDest.setText("🎯 " + crm.address);
            if (crm.lat != null && crm.lon != null) {
                destCoords[0] = crm.lat; destCoords[1] = crm.lon;
            } else if (!crm.address.isEmpty()) {
                geocodeAndFill(crm.address, tvDest, destCoords);
            }
        } else {
            tvDest.setText("🎯 Zielort wählen…");
        }
        tvDest.setPadding(pad / 2, pad, pad / 2, pad);
        tvDest.setOnClickListener(v -> launchPlaces(tvDest, destCoords));
        layout.addView(tvDest);

        // v6.62.38: Tausch-Click — vertauscht tvPickup-Text und tvDest-Text + die Coords-Arrays.
        // Der placesLauncher-Callback nutzt die Array-Refs (pickupCoords / destCoords), die
        // bleiben dabei dieselben Refs — wir tauschen nur die Werte in den Arrays.
        btnSwap.setOnClickListener(_v -> {
            String pickTxt = tvPickup.getText().toString();
            String destTxt = tvDest.getText().toString();
            // Symbol-Prefix beibehalten: tvPickup → 📍, tvDest → 🎯
            String pickAddr = pickTxt.replaceFirst("^📍\\s*", "").replaceFirst("^🎯\\s*", "").trim();
            String destAddr = destTxt.replaceFirst("^📍\\s*", "").replaceFirst("^🎯\\s*", "").trim();
            tvPickup.setText("📍 " + (destAddr.endsWith("wählen…") ? "Abholort wählen…" : destAddr));
            tvDest.setText("🎯 " + (pickAddr.endsWith("wählen…") ? "Zielort wählen…" : pickAddr));
            double pl = pickupCoords[0], pn = pickupCoords[1];
            pickupCoords[0] = destCoords[0]; pickupCoords[1] = destCoords[1];
            destCoords[0] = pl; destCoords[1] = pn;
            Toast.makeText(this, "🔄 Getauscht", Toast.LENGTH_SHORT).show();
        });

        // v6.62.152: Zwischenstops-Sektion (Patrick: 'Zwischenstops fehlen in den Native-Apps').
        // Pro Klick auf '+' wird eine Zeile mit Places-Autocomplete + Entfernen-Button angelegt.
        TextView tvWpHeader = new TextView(this);
        tvWpHeader.setText("🔶 Zwischenstops");
        tvWpHeader.setTextSize(13);
        tvWpHeader.setTextColor(0xFF374151);
        tvWpHeader.setPadding(0, pad, 0, padHalf);
        layout.addView(tvWpHeader);

        final LinearLayout wpContainer = new LinearLayout(this);
        wpContainer.setOrientation(LinearLayout.VERTICAL);
        layout.addView(wpContainer);

        // Tracking pro Waypoint-Zeile: TextView (für Adresse) + double[2] (für Coords)
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
            // Direkt Places-Picker oeffnen — Patrick will schnell tippen
            launchPlaces(tvWp, wpC);
        });
        layout.addView(btnAddWp);

        // v6.62.152: Personenzahl als Spinner statt verstecktem EditText (Patrick: 'muss
        // feststehen, nicht nur Default'). Spinner zeigt 1-8 Personen mit Bus-Hinweis ab 5.
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
        spnPax.setSelection(0);
        layout.addView(spnPax);

        // 🆕 v6.62.479: Patrick (08.05. 12:43): "notizen bemerkungen fehlen".
        TextView tvNotesLabel = new TextView(this);
        tvNotesLabel.setText("📝 Notizen / Bemerkungen (optional)");
        tvNotesLabel.setTextSize(13);
        tvNotesLabel.setTextColor(0xFF374151);
        tvNotesLabel.setPadding(0, pad, 0, padHalf);
        layout.addView(tvNotesLabel);

        EditText etNotes = new EditText(this);
        etNotes.setHint("z.B. Gepäck, Abholung am Hintereingang, Rollstuhl, …");
        etNotes.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES);
        etNotes.setMinLines(2);
        etNotes.setMaxLines(4);
        etNotes.setGravity(android.view.Gravity.TOP | android.view.Gravity.START);
        layout.addView(etNotes);

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

        // 🆕 v6.62.626: Live-Konflikt-Ampel im CallLog-Vorbestell-Dialog (Port von CrmSearchActivity v6.62.608).
        // Patrick (11.05. 19:18): "mach die 3 Sachen fertig" — Bisherige Fahrten + Konflikt-Ampel im CallLog.
        // Pollt datetime[0] alle 500ms, bei Aenderung Firebase-Query auf aktive Rides im Fenster +/-2h, dann
        // pro Fahrzeug Overlap-Check. Zeigt 🟢 frei / 🟡 knapp / 🔴 alle belegt.
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
            final long newEndTs = newPickupTs + 20L * 60_000L;
            final long windowFrom = newPickupTs - 2L * 3600_000L;
            final long windowTo = newPickupTs + 2L * 3600_000L;
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
                        long _rideEnd = _pts + (_dur + 4L) * 60_000L;
                        if (!slotsPerVeh.containsKey(vid)) slotsPerVeh.put(vid, new ArrayList<>());
                        slotsPerVeh.get(vid).add(new long[]{ _pts, _rideEnd });
                    }
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
        final long[] _lastPolledDt = { datetime[0] };
        final android.os.Handler _pollH = new android.os.Handler(android.os.Looper.getMainLooper());
        final Runnable _pollR = new Runnable() {
            @Override public void run() {
                if (datetime[0] != _lastPolledDt[0]) {
                    _lastPolledDt[0] = datetime[0];
                    refreshKonflikt.run();
                }
                _pollH.postDelayed(this, 500);
            }
        };
        _pollH.postDelayed(_pollR, 500);
        refreshKonflikt.run();

        // 🔧 v6.62.479: Patrick (08.05. 12:48): "Speichern und Abbrechen ist nur ganz klein
        //   zu sehen. Das kann man unter dieser Karte hin und her schieben, aber das müsste
        //   doch eigentlich auf der Karte mit drauf sein". Patrick meinte mit "Karte" das
        //   Modal-Card. Lösung: keine kleinen AlertDialog-Buttons mehr — stattdessen GROSSE
        //   Anlegen + Abbrechen Buttons direkt unten im Layout, im ScrollView mit drin.
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
        btnSave.setText("✅ ANLEGEN");
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

        // v6.62.152: ScrollView-Wrap. Buttons sind jetzt mit drin → Patrick scrollt notfalls
        // zu ihnen runter, aber sie werden NIE vom Bildschirm abgeschnitten weil Teil des
        // ScrollView-Inhalts.
        ScrollView scrollWrap = new ScrollView(this);
        scrollWrap.addView(layout);

        // Telefon als TextView ganz oben ins Layout (statt setMessage) → Dialog flacher.
        TextView tvPhoneInfo = new TextView(this);
        tvPhoneInfo.setText("📞 " + (e.number != null ? e.number : "—"));
        tvPhoneInfo.setTextSize(12);
        tvPhoneInfo.setTextColor(0xFF64748B);
        tvPhoneInfo.setPadding(0, 0, 0, padHalf);
        layout.addView(tvPhoneInfo, 0);

        final AlertDialog dlg = new AlertDialog.Builder(this)
            .setTitle("📅 Vorbestellung anlegen")
            .setView(scrollWrap)
            .setCancelable(true)
            .create();

        btnCancel.setOnClickListener(_btn -> dlg.dismiss());

        // 🆕 v6.62.507: Save-Once-Flag — Patrick (08.05. 17:47): "Confirmation-OK-Klick
        //   triggerte zweiten Save". Defensive Safety zusätzlich zum Click-Lock.
        final boolean[] _alreadySavedRef = { false };

        btnSave.setOnClickListener(_btn -> {
                // v6.62.332: Quick-Flow — Name aus Vorname + Nachname concat (Anrede separat)
                String _qfFn = etFirstName.getText().toString().trim();
                String _qfLn = etLastName.getText().toString().trim();
                String _qfName = (_qfFn + " " + _qfLn).trim();
                if (_qfName.isEmpty()) _qfName = etName.getText().toString().trim();
                String name = _qfName;
                int _qfSalPos = spSal.getSelectedItemPosition();
                final String _qfSalutation = _qfSalPos > 0 ? _qfSalutations[_qfSalPos] : "";
                // CRM-Update wenn schon Customer existiert + Felder leer waren — sonst neuen anlegen
                final String _qfFirstName = _qfFn;
                final String _qfLastName = _qfLn;
                if (crm != null && !isHotelCustomer) {
                    Map<String, Object> _crmUpd = new HashMap<>();
                    if (!_qfSalutation.isEmpty() && (crm.salutation == null || crm.salutation.isEmpty())) {
                        _crmUpd.put("salutation", _qfSalutation);
                        _crmUpd.put("anrede", _qfSalutation);
                    }
                    if (!_qfFirstName.isEmpty() && (crm.firstName == null || crm.firstName.isEmpty())) _crmUpd.put("firstName", _qfFirstName);
                    if (!_qfLastName.isEmpty() && (crm.lastName == null || crm.lastName.isEmpty())) _crmUpd.put("lastName", _qfLastName);
                    if (!_crmUpd.isEmpty()) {
                        _crmUpd.put("name", _qfName);
                        FirebaseDatabase.getInstance(DB_INSTANCE_URL)
                            .getReference("customers/" + crm.id).updateChildren(_crmUpd);
                    }
                }
                // v6.62.42: defensive — Symbol-Prefix von BEIDEN moeglichen Symbolen entfernen
                // (📍 oder 🎯), falls geocodeAndFill oder Tausch den falschen Prefix
                // hineingeschrieben hat (Promenadenhotel-Admiral 27.04. landete mit
                // '📍'-Prefix als pickup-String in DB).
                String pickup = tvPickup.getText().toString()
                    .replaceFirst("^📍\\s*", "").replaceFirst("^🎯\\s*", "").trim();
                String dest = tvDest.getText().toString()
                    .replaceFirst("^🎯\\s*", "").replaceFirst("^📍\\s*", "").trim();
                if (name.isEmpty() || pickup.isEmpty() || pickup.endsWith("wählen…") ||
                    dest.isEmpty() || dest.endsWith("wählen…")) {
                    Toast.makeText(this, "Name + Abholort + Zielort wählen", Toast.LENGTH_LONG).show();
                    return;
                }
                // v6.62.35: Pflicht-Coords — verhindert dass Buchungen ohne lat/lon in die DB
                // kommen (passierte bei Birgit Lenzkes wo CRM-Adresse ohne addressLat/Lon
                // vorbelegt wurde). geocodeAndFill versucht im Hintergrund zu fuellen aber
                // wenn der User vor dem Geocode-Result tippt, blockieren wir hier.
                if (Double.isNaN(pickupCoords[0]) || Double.isNaN(destCoords[0])) {
                    Toast.makeText(this, "❌ Adresse(n) noch nicht geocodiert — bitte Abholort/Zielort antippen + auswaehlen", Toast.LENGTH_LONG).show();
                    return;
                }
                // v6.62.152: Personenzahl aus Spinner (1-8)
                int pax = spnPax.getSelectedItemPosition() + 1;
                if (pax < 1) pax = 1;
                if (pax > 8) pax = 8;

                // v6.62.152: Zwischenstops-Liste bauen — nur ausgefuellte (nicht 'wählen…')
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

                DatabaseReference ref = FirebaseDatabase.getInstance(DB_INSTANCE_URL).getReference("rides").push();
                long now = System.currentTimeMillis();
                Map<String, Object> r = new HashMap<>();
                // v6.62.38: Hotel/Firma als Auftraggeber → 'name' ist Gastname, Hotel-Name
                // wandert in guestName-Sektion. Stammkunde: name = customerName direkt.
                if (isHotelCustomer && crm != null) {
                    r.put("customerName", crm.name);                  // Hotel/Firma
                    r.put("guestName", name);                          // Gast
                    r.put("_isAuftraggeberBooking", true);
                    r.put("_auftraggeberAddress", crm.address != null ? crm.address : "");
                    r.put("_auftraggeberKind", crm.customerKind);
                    if (crm.lat != null) r.put("_auftraggeberLat", crm.lat);
                    if (crm.lon != null) r.put("_auftraggeberLon", crm.lon);
                } else {
                    r.put("customerName", name);
                }
                // v6.62.152: Auto-CRM-Anlage wenn unbekannte Nummer (Patrick: 'sonst finde
                // ich den im Fahrtenkalender ja nachher nicht'). Push customer FIRST damit
                // wir die customerId in der Ride mitschreiben koennen.
                String autoCustomerId = null;
                if (crm != null) {
                    r.put("customerId", crm.id);
                } else if (e.number != null && !e.number.trim().isEmpty()) {
                    try {
                        DatabaseReference custRef = FirebaseDatabase.getInstance(DB_INSTANCE_URL)
                            .getReference("customers").push();
                        autoCustomerId = custRef.getKey();
                        Map<String, Object> custData = new HashMap<>();
                        custData.put("name", name);
                        // v6.62.332: Quick-Flow-Felder ans Auto-CRM weitergeben
                        if (!_qfFirstName.isEmpty()) custData.put("firstName", _qfFirstName);
                        if (!_qfLastName.isEmpty()) custData.put("lastName", _qfLastName);
                        if (!_qfSalutation.isEmpty()) {
                            custData.put("salutation", _qfSalutation);
                            custData.put("anrede", _qfSalutation);
                        }
                        // Mobil/Festnetz routen anhand 015/016/017-Prefix (DE) oder +491
                        String _digits = e.number.replaceAll("[^0-9+]", "");
                        boolean _isMobile = _digits.startsWith("+4915") || _digits.startsWith("+4916")
                            || _digits.startsWith("+4917") || _digits.startsWith("015")
                            || _digits.startsWith("016") || _digits.startsWith("017");
                        custData.put("phone", _isMobile ? "" : e.number);
                        custData.put("mobilePhone", _isMobile ? e.number : "");
                        // Adresse + billingAddress LEER lassen (Pickup ist NIEMALS Rechnungsadresse)
                        custData.put("address", "");
                        custData.put("createdAt", now);
                        custData.put("createdBy", "native_calllog_prebooking_auto");
                        custData.put("source", "native_call_prebooking");
                        custData.put("totalRides", 0);
                        custData.put("isVIP", false);
                        custData.put("notes", "Auto-angelegt aus Native-Vorbestellung v6.62.152");
                        custRef.setValue(custData);
                        r.put("customerId", autoCustomerId);
                    } catch (Throwable _ce) {
                        // Wenn CRM-Anlage scheitert, Ride trotzdem ohne customerId anlegen
                        autoCustomerId = null;
                    }
                }
                r.put("customerPhone", e.number);
                r.put("customerMobile", e.number);
                r.put("pickup", pickup);
                r.put("destination", dest);
                // v6.62.152: Zwischenstops mitschreiben (mit lat/lon falls vorhanden)
                if (!waypointsList.isEmpty()) r.put("waypoints", waypointsList);
                // v6.53.0: Koords aus Places-Pick (oder CRM-Vorbelegung) — keine String-Adressen mehr ohne lat/lon!
                // v6.62.42: + pickupCoords/destCoords als Object schreiben — Browser-Code legt
                // beides an, Cloud-Function 'Daten-Inkonsistenz' triggerte sonst weil onRideCreated
                // pickup-coords-Object suchte (Promenadenhotel-Admiral 27.04.).
                if (!Double.isNaN(pickupCoords[0])) {
                    r.put("pickupLat", pickupCoords[0]); r.put("pickupLon", pickupCoords[1]);
                    java.util.Map<String,Object> pc = new java.util.HashMap<>();
                    pc.put("lat", pickupCoords[0]); pc.put("lon", pickupCoords[1]);
                    r.put("pickupCoords", pc);
                }
                if (!Double.isNaN(destCoords[0])) {
                    r.put("destinationLat", destCoords[0]); r.put("destinationLon", destCoords[1]);
                    java.util.Map<String,Object> dc = new java.util.HashMap<>();
                    dc.put("lat", destCoords[0]); dc.put("lon", destCoords[1]);
                    r.put("destCoords", dc);
                }
                r.put("pickupTimestamp", datetime[0]);
                r.put("pickupTime", new SimpleDateFormat("HH:mm", Locale.GERMANY).format(new java.util.Date(datetime[0])));
                // 🆕 v6.62.479: Notizen mitschreiben falls ausgefüllt
                String _notes = etNotes.getText().toString().trim();
                if (!_notes.isEmpty()) r.put("notes", _notes);
                r.put("status", "vorbestellt");
                r.put("createdAt", now);
                r.put("updatedAt", now);
                r.put("source", "native_calllog_prebooking");
                r.put("passengers", pax);
                final String _notesFinal = _notes;
                final int _paxFinal = pax;
                final String _pickupFinal = pickup;
                final String _destFinal = dest;
                final String _nameFinal = name;
                final long _pickupTsFinal = datetime[0];
                final boolean _isHotelFinal = isHotelCustomer;
                final String _crmNameFinal = (crm != null) ? crm.name : null;
                // 🆕 v6.62.507/.510: Save-Once-Flag — verhindert ALLE Reentries
                if (_alreadySavedRef[0]) {
                    android.util.Log.w("CallLogActivity", "Save bereits durchgeführt — ignoriere zweiten Klick");
                    return;
                }
                _alreadySavedRef[0] = true;

                // 🆕 v6.62.504: Click-Lock
                btnSave.setEnabled(false);
                btnSave.setText("⏳ Speichere…");
                btnSave.setBackgroundColor(0xFF94A3B8);
                // Closure: eigentlicher Save (gleicher Code wie vorher)
                final DatabaseReference _refFinal = ref;
                Runnable doActualSaveCl = () -> {
                    _refFinal.setValue(r).addOnSuccessListener(_v -> {
                        dlg.dismiss();
                        // 🆕 v6.62.485: Confirmation-Screen statt nur Toast.
                        showCallLogBookingConfirmation(_nameFinal, _pickupFinal, _destFinal,
                            _pickupTsFinal, _paxFinal, _notesFinal,
                            _isHotelFinal ? _crmNameFinal : null);
                    }).addOnFailureListener(ex -> {
                        Toast.makeText(this, "Fehler: " + ex.getMessage(), Toast.LENGTH_LONG).show();
                        // v6.62.504/.507: Bei Fehler Button reaktivieren + Save-Flag zurueck
                        _alreadySavedRef[0] = false;
                        btnSave.setEnabled(true);
                        btnSave.setText("✅ ANLEGEN");
                        btnSave.setBackgroundColor(0xFF1E40AF);
                    });
                };
                // 🆕 v6.62.523: Duplikat-Erkennung — gleicher Mechanismus wie CrmSearchActivity.
                // Werner-Vorfall 09.05.: ZWEI Buchungen via Anrufliste + CRM-Suche, beide
                // wurden ungeprueft angelegt. Jetzt: vor jedem Anlegen schauen ob fuer den
                // Kunden schon eine aktive Buchung ±15 Min existiert.
                final String _custIdForDupCl = (crm != null && crm.id != null) ? crm.id
                    : (autoCustomerId != null ? autoCustomerId : null);
                if (_custIdForDupCl == null || _custIdForDupCl.isEmpty()) {
                    // Neuer auto-CRM-Eintrag → es kann logisch noch keine andere Fahrt geben
                    doActualSaveCl.run();
                } else {
                    FirebaseDatabase.getInstance(DB_INSTANCE_URL).getReference("rides")
                        .orderByChild("customerId").equalTo(_custIdForDupCl)
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
                                if (dups.isEmpty()) { doActualSaveCl.run(); return; }
                                StringBuilder msg = new StringBuilder();
                                msg.append("Für ").append(_nameFinal).append(" gibt es bereits ")
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
                                new AlertDialog.Builder(CallLogActivity.this)
                                    .setTitle("⚠️ Mögliches Duplikat")
                                    .setMessage(msg.toString())
                                    .setPositiveButton("Trotzdem anlegen", (d2, w2) -> doActualSaveCl.run())
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
                                android.util.Log.w("CallLogActivity", "Duplikat-Check fehlgeschlagen: " + err.getMessage() + " — lege trotzdem an");
                                doActualSaveCl.run();
                            }
                        });
                }
        });

        dlg.show();
    }

    // 🆕 v6.62.485: Patrick (08.05.2026 13:18): "kann man das so machen, wenn ich das
    //   erstelle im Handy, dass ich dann nochmal eine Übersicht sehe was alles drinnen
    //   steht, damit ich das dann abspeichern kann". Vorher: Toast 'angelegt' und finish.
    private void showCallLogBookingConfirmation(String name, String pickup, String dest,
                                                long pickupTs, int passengers, String notes,
                                                String auftraggeberName) {
        SimpleDateFormat fmt = new SimpleDateFormat("EEEE, dd.MM.yyyy 'um' HH:mm 'Uhr'", Locale.GERMANY);
        fmt.setTimeZone(java.util.TimeZone.getTimeZone("Europe/Berlin"));
        StringBuilder msg = new StringBuilder();
        msg.append("✅ Vorbestellung GESPEICHERT\n\n");
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
        final String _msgFinal = msg.toString();

        new AlertDialog.Builder(this)
            .setTitle("📅 Angelegt")
            .setMessage(_msgFinal)
            .setPositiveButton("OK", (d, w) -> finish())
            .setNeutralButton("📋 Kopieren", (d, w) -> {
                android.content.ClipboardManager cm = (android.content.ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
                if (cm != null) {
                    cm.setPrimaryClip(android.content.ClipData.newPlainText("Vorbestellung", _msgFinal));
                    Toast.makeText(this, "📋 In Zwischenablage kopiert", Toast.LENGTH_SHORT).show();
                }
                finish();
            })
            .setCancelable(false)
            .show();
    }

    static class CrmCustomer {
        String id, name, phone, mobilePhone, address, customerKind;
        // v6.62.326: getrennte Felder fuer Anrede + Vor/Nachname
        String salutation, anrede, firstName, lastName;
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
                c.salutation = s.child("salutation").getValue(String.class);
                c.anrede = s.child("anrede").getValue(String.class);
                c.firstName = s.child("firstName").getValue(String.class);
                c.lastName = s.child("lastName").getValue(String.class);
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
        java.io.File acrFile; // 🆕 v6.62.676: gematchte ACR-Aufnahme (falls vorhanden)
    }

    // 🆕 v6.62.676: Patrick (13.05. 12:59): "Anrufliste, wuerde ich ganz gerne die
    //   Anrufe anhoeren oder abhoeren, damit ich die dann in den Kalender eintragen kann."
    //   ACR speichert unter /sdcard/ACRCalls/ACRPhone/{YYYY}/{MM}/{DD}/{+nummer}/...m4a.
    //   Wir suchen pro CallEntry die passende m4a (gleicher Tag + gleiche Nummer).
    private java.io.File findAcrRecording(String phone, long callDate) {
        if (phone == null || phone.isEmpty()) return null;
        try {
            java.util.Calendar cal = java.util.Calendar.getInstance();
            cal.setTimeInMillis(callDate);
            String yyyy = String.valueOf(cal.get(java.util.Calendar.YEAR));
            String mm = String.format(Locale.GERMANY, "%02d", cal.get(java.util.Calendar.MONTH) + 1);
            String dd = String.format(Locale.GERMANY, "%02d", cal.get(java.util.Calendar.DAY_OF_MONTH));
            // ACR normalisiert die Nummer auf +49... Format. Wir versuchen mehrere Varianten.
            String norm = normalizePhone(phone);
            String[] variants;
            if (norm.startsWith("+49")) {
                variants = new String[]{ norm, "0" + norm.substring(3), "0049" + norm.substring(3) };
            } else if (norm.startsWith("00")) {
                variants = new String[]{ "+" + norm.substring(2), norm, "0" + norm.substring(4) };
            } else if (norm.startsWith("0")) {
                variants = new String[]{ "+49" + norm.substring(1), norm, "0049" + norm.substring(1) };
            } else {
                variants = new String[]{ norm, "+49" + norm, "0" + norm };
            }
            String basePath = "/sdcard/ACRCalls/ACRPhone/" + yyyy + "/" + mm + "/" + dd + "/";
            for (String v : variants) {
                java.io.File dir = new java.io.File(basePath + v);
                if (dir.exists() && dir.isDirectory()) {
                    java.io.File[] files = dir.listFiles((f) -> f.getName().endsWith(".m4a"));
                    if (files != null && files.length > 0) {
                        // Nimm die zeitnaechste (am dichtesten am callDate)
                        java.io.File best = null;
                        long bestDelta = Long.MAX_VALUE;
                        for (java.io.File f : files) {
                            // Filename-Schema: +49xxx-{0/1}-{tsMs}.m4a → ts extrahieren
                            String n = f.getName();
                            int p1 = n.lastIndexOf('-');
                            int p2 = n.lastIndexOf('.');
                            if (p1 < 0 || p2 < p1) continue;
                            try {
                                long ts = Long.parseLong(n.substring(p1 + 1, p2));
                                long delta = Math.abs(ts - callDate);
                                if (delta < bestDelta) { bestDelta = delta; best = f; }
                            } catch (Throwable _ig) {}
                        }
                        if (best != null) return best;
                        return files[0];
                    }
                }
            }
        } catch (Throwable _t) { Log.w("CallLogActivity", "findAcrRecording Fehler: " + _t.getMessage()); }
        return null;
    }

    // 🆕 v6.62.676: MediaPlayer-Dialog fuer ACR-Aufnahme. SeekBar + Play/Pause + Auto-Stop.
    private android.media.MediaPlayer _acrPlayer;
    private void showAcrPlayerDialog(java.io.File audioFile, String label) {
        if (audioFile == null || !audioFile.exists()) {
            Toast.makeText(this, "Audio-Datei nicht gefunden", Toast.LENGTH_SHORT).show();
            return;
        }
        try { if (_acrPlayer != null) { try { _acrPlayer.stop(); } catch (Throwable _t) {} _acrPlayer.release(); _acrPlayer = null; } } catch (Throwable _ig) {}
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        int pad = (int) (getResources().getDisplayMetrics().density * 16);
        layout.setPadding(pad, pad, pad, pad);
        TextView lbl = new TextView(this);
        lbl.setText(label + "\n" + audioFile.getName() + " · " + (audioFile.length() / 1024) + " KB");
        lbl.setTextSize(13);
        lbl.setPadding(0, 0, 0, 16);
        layout.addView(lbl);
        final android.widget.SeekBar seek = new android.widget.SeekBar(this);
        seek.setMax(1000);
        layout.addView(seek);
        final TextView pos = new TextView(this);
        pos.setText("0:00 / ?:??");
        pos.setTextSize(12);
        pos.setPadding(0, 8, 0, 0);
        layout.addView(pos);

        final android.media.MediaPlayer mp = new android.media.MediaPlayer();
        _acrPlayer = mp;
        try {
            mp.setDataSource(audioFile.getAbsolutePath());
            mp.prepare();
        } catch (Throwable t) {
            Toast.makeText(this, "MediaPlayer-Fehler: " + t.getMessage(), Toast.LENGTH_LONG).show();
            return;
        }
        final int duration = mp.getDuration();
        final Handler[] hh = new Handler[]{ new Handler(getMainLooper()) };
        final Runnable[] tick = new Runnable[1];
        tick[0] = () -> {
            try {
                int p = mp.getCurrentPosition();
                seek.setProgress((int) Math.min(1000, (long) p * 1000 / Math.max(1, duration)));
                pos.setText(formatMs(p) + " / " + formatMs(duration));
                if (mp.isPlaying() && hh[0] != null) hh[0].postDelayed(tick[0], 200);
            } catch (Throwable _t) {}
        };
        seek.setOnSeekBarChangeListener(new android.widget.SeekBar.OnSeekBarChangeListener() {
            @Override public void onProgressChanged(android.widget.SeekBar s, int progress, boolean fromUser) {
                if (fromUser) try { mp.seekTo((int) ((long) progress * duration / 1000)); } catch (Throwable _t) {}
            }
            @Override public void onStartTrackingTouch(android.widget.SeekBar s) {}
            @Override public void onStopTrackingTouch(android.widget.SeekBar s) {}
        });

        AlertDialog dlg = new AlertDialog.Builder(this)
            .setTitle("🎵 Anruf-Aufnahme")
            .setView(layout)
            .setPositiveButton("▶ Play", null)
            .setNeutralButton("⏸ Pause", null)
            .setNegativeButton("Stop / Schliessen", (d, w) -> {
                try { mp.stop(); } catch (Throwable _t) {}
                mp.release();
                _acrPlayer = null;
                if (hh[0] != null) hh[0].removeCallbacks(tick[0]);
            })
            .setOnCancelListener(d -> {
                try { mp.stop(); } catch (Throwable _t) {}
                mp.release();
                _acrPlayer = null;
                if (hh[0] != null) hh[0].removeCallbacks(tick[0]);
            })
            .create();
        dlg.show();
        // Buttons: Play startet, Pause toggelt
        dlg.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(_v -> {
            try { if (!mp.isPlaying()) { mp.start(); hh[0].post(tick[0]); } } catch (Throwable _t) {}
        });
        dlg.getButton(AlertDialog.BUTTON_NEUTRAL).setOnClickListener(_v -> {
            try { if (mp.isPlaying()) mp.pause(); } catch (Throwable _t) {}
        });
        // Auto-start
        try { mp.start(); hh[0].post(tick[0]); } catch (Throwable _t) {}
    }

    private static String formatMs(int ms) {
        int s = ms / 1000;
        return (s / 60) + ":" + String.format(Locale.GERMANY, "%02d", s % 60);
    }

    class CallAdapter extends RecyclerView.Adapter<CallAdapter.VH> {
        // v6.58.0: package-private damit Swipe-Callback (in onCreate) die Liste manipulieren kann
        List<CallEntry> data = new ArrayList<>();
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

                // 🆕 v6.62.676: ACR-Aufnahme suchen (cache am CallEntry damit nicht jedes
                //   Rebind die Filesystem-Abfrage triggert).
                if (e.acrFile == null) {
                    try { e.acrFile = findAcrRecording(e.number, e.date); } catch (Throwable _t) {}
                }
                String audioHint = (e.acrFile != null) ? "  🎵 ACR" : "";
                tvTime.setText("vor " + age + (e.durationSec > 0 ? " · Dauer " + e.durationSec + "s" : "") + audioHint);

                itemView.setOnClickListener(_v -> showActionDialog(e));
                // 🆕 v6.62.676: Long-Press → Audio-Player. Patrick: "Anrufe abhoeren, dann
                //   in den Kalender eintragen".
                itemView.setOnLongClickListener(_v -> {
                    if (e.acrFile != null) {
                        String _lbl = (crm != null ? crm.name : (e.name != null && !e.name.isEmpty() ? e.name : "Unbekannt")) + " · " + e.number;
                        showAcrPlayerDialog(e.acrFile, _lbl);
                        return true;
                    }
                    Toast.makeText(itemView.getContext(), "Keine ACR-Aufnahme fuer diesen Anruf", Toast.LENGTH_SHORT).show();
                    return true;
                });
            }
        }
    }
}
