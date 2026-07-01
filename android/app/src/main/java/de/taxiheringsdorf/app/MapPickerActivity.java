package de.taxiheringsdorf.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.inputmethod.EditorInfo;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.ArrayAdapter;
import android.widget.EditText;
import android.widget.ImageButton;
import android.widget.ListPopupWindow;
import android.widget.TextView;
import android.widget.Toast;
import androidx.appcompat.app.AppCompatActivity;
import com.google.android.material.button.MaterialButton;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

// v6.62.220: Stecknadel-Picker fuer Adresseingabe.
// v6.63.577 (Patrick 01.07. 14:39): Google Places Autocomplete beim Tippen.
//   - 400ms Debounce → Google Places (New) Autocomplete API
//   - Nominatim als Fallback wenn Places nichts findet
//   - window._setMarker() fuer direktes Koordinatensetzen ohne weiteren Geocode-Call
public class MapPickerActivity extends AppCompatActivity {

    public static final String EXTRA_INITIAL_QUERY = "initial_query";
    public static final String EXTRA_RESULT_ADDR = "result_addr";
    public static final String EXTRA_RESULT_LAT = "result_lat";
    public static final String EXTRA_RESULT_LON = "result_lon";

    private WebView wv;
    private EditText etSearch;
    private TextView tvAddr;
    private MaterialButton btnConfirm;

    private double pickedLat = Double.NaN;
    private double pickedLon = Double.NaN;
    private String pickedAddr = null;

    // v6.63.577: Autocomplete state
    private final Handler _suggestHandler = new Handler(Looper.getMainLooper());
    private Runnable _suggestRunnable;
    private ListPopupWindow _suggestPopup;
    // Unified suggestion list — one entry per row
    private final List<String> _suggestLabels = new ArrayList<>();
    private final List<String> _suggestPlaceIds = new ArrayList<>();   // "" wenn Nominatim
    private final List<double[]> _suggestCoords = new ArrayList<>();   // null wenn Places
    private String _mapsApiKey;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_map_picker);

        // Maps/Places API Key aus AndroidManifest (com.google.android.geo.API_KEY)
        try {
            ApplicationInfo ai = getPackageManager()
                .getApplicationInfo(getPackageName(), android.content.pm.PackageManager.GET_META_DATA);
            _mapsApiKey = ai.metaData != null ? ai.metaData.getString("com.google.android.geo.API_KEY") : null;
        } catch (Exception ignored) {}

        wv = findViewById(R.id.wv_map);
        etSearch = findViewById(R.id.et_map_search);
        tvAddr = findViewById(R.id.tv_map_addr);
        btnConfirm = findViewById(R.id.btn_map_confirm);

        ImageButton btnBack = findViewById(R.id.btn_map_back);
        btnBack.setOnClickListener(v -> finish());

        wv.getSettings().setJavaScriptEnabled(true);
        wv.getSettings().setDomStorageEnabled(true);
        wv.setWebViewClient(new WebViewClient());
        wv.addJavascriptInterface(new MapBridge(), "MapBridge");

        String initialQuery = getIntent().getStringExtra(EXTRA_INITIAL_QUERY);
        wv.loadDataWithBaseURL("https://taxi-heringsdorf.local/",
            buildMapHtml(initialQuery), "text/html", "UTF-8", null);

        // v6.63.577: Autocomplete-Popup
        _suggestPopup = new ListPopupWindow(this);
        _suggestPopup.setAnchorView(etSearch);
        _suggestPopup.setModal(false);
        _suggestPopup.setWidth(ListPopupWindow.MATCH_PARENT);
        _suggestPopup.setOnItemClickListener((parent, view, pos, id) -> onSuggestionPicked(pos));

        // Beim Tippen → debounced Suggestions
        etSearch.addTextChangedListener(new android.text.TextWatcher() {
            @Override public void beforeTextChanged(CharSequence s, int start, int count, int after) {}
            @Override public void afterTextChanged(android.text.Editable s) {}
            @Override public void onTextChanged(CharSequence s, int start, int before, int count) {
                String q = s.toString().trim();
                _suggestHandler.removeCallbacks(_suggestRunnable != null ? _suggestRunnable : () -> {});
                if (q.length() < 3) { _suggestPopup.dismiss(); return; }
                _suggestRunnable = () -> fetchSuggestions(q);
                _suggestHandler.postDelayed(_suggestRunnable, 400);
            }
        });

        // Enter/Lupe → Nominatim-Suche direkt (Fallback / manuelle Volladresse)
        etSearch.setOnEditorActionListener((v, actionId, event) -> {
            if (actionId == EditorInfo.IME_ACTION_SEARCH) {
                _suggestPopup.dismiss();
                String q = etSearch.getText().toString().trim();
                if (!q.isEmpty()) {
                    wv.evaluateJavascript("window._searchAddress(" + jsString(q) + ")", null);
                }
                return true;
            }
            return false;
        });

        if (initialQuery != null && !initialQuery.isEmpty()) etSearch.setText(initialQuery);

        btnConfirm.setOnClickListener(v -> {
            if (Double.isNaN(pickedLat) || pickedAddr == null) {
                Toast.makeText(this, "Bitte erst auf die Karte tippen", Toast.LENGTH_SHORT).show();
                return;
            }
            Intent r = new Intent();
            r.putExtra(EXTRA_RESULT_ADDR, pickedAddr);
            r.putExtra(EXTRA_RESULT_LAT, pickedLat);
            r.putExtra(EXTRA_RESULT_LON, pickedLon);
            setResult(Activity.RESULT_OK, r);
            finish();
        });
    }

    // Gemeinsamer Click-Handler fuer alle Suggestion-Typen
    private void onSuggestionPicked(int pos) {
        if (pos >= _suggestLabels.size()) return;
        String addr = _suggestLabels.get(pos);
        String placeId = pos < _suggestPlaceIds.size() ? _suggestPlaceIds.get(pos) : "";
        double[] coords = pos < _suggestCoords.size() ? _suggestCoords.get(pos) : null;

        etSearch.setText(addr);
        etSearch.setSelection(addr.length());
        _suggestPopup.dismiss();

        if (!placeId.isEmpty()) {
            // Places-Vorschlag: Koordinaten via Place Details holen
            fetchPlaceCoords(placeId, addr);
        } else if (coords != null && !Double.isNaN(coords[0])) {
            // Nominatim-Vorschlag: Koordinaten schon bekannt
            wv.evaluateJavascript("window._setMarker(" + coords[0] + "," + coords[1] + "," + jsString(addr) + ")", null);
        } else {
            // Fallback: Nominatim-Suche per Text
            wv.evaluateJavascript("window._searchAddress(" + jsString(addr) + ")", null);
        }
    }

    // Google Places Autocomplete (New) — Vorschlaege beim Tippen
    private void fetchSuggestions(String q) {
        if (_mapsApiKey == null || _mapsApiKey.isEmpty()) {
            fetchSuggestionsNominatim(q);
            return;
        }
        new Thread(() -> {
            try {
                URL url = new URL("https://places.googleapis.com/v1/places:autocomplete");
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod("POST");
                conn.setRequestProperty("Content-Type", "application/json; charset=UTF-8");
                conn.setRequestProperty("X-Goog-Api-Key", _mapsApiKey);
                conn.setDoOutput(true);
                conn.setConnectTimeout(4000);
                conn.setReadTimeout(4000);
                String body = "{\"input\":" + jsonStr(q)
                    + ",\"languageCode\":\"de\",\"regionCode\":\"DE\""
                    + ",\"locationBias\":{\"circle\":{\"center\":{\"latitude\":53.95,\"longitude\":14.10},\"radius\":80000.0}}}";
                try (OutputStream os = conn.getOutputStream()) {
                    os.write(body.getBytes(StandardCharsets.UTF_8));
                }
                int code = conn.getResponseCode();
                if (code != 200) { fetchSuggestionsNominatim(q); return; }

                BufferedReader br = new BufferedReader(
                    new InputStreamReader(conn.getInputStream(), StandardCharsets.UTF_8));
                StringBuilder sb = new StringBuilder();
                String line;
                while ((line = br.readLine()) != null) sb.append(line);
                br.close();

                JSONObject resp = new JSONObject(sb.toString());
                JSONArray suggestions = resp.optJSONArray("suggestions");
                List<String> labels = new ArrayList<>();
                List<String> placeIds = new ArrayList<>();
                if (suggestions != null) {
                    for (int i = 0; i < suggestions.length() && labels.size() < 5; i++) {
                        JSONObject s = suggestions.getJSONObject(i);
                        JSONObject pp = s.optJSONObject("placePrediction");
                        if (pp == null) continue;
                        String pid = pp.optString("placeId", "");
                        JSONObject textObj = pp.optJSONObject("text");
                        String text = textObj != null ? textObj.optString("text", "") : "";
                        text = stripRegionSuffix(text);
                        if (!text.isEmpty() && !pid.isEmpty() && !labels.contains(text)) {
                            labels.add(text);
                            placeIds.add(pid);
                        }
                    }
                }
                if (labels.isEmpty()) { fetchSuggestionsNominatim(q); return; }

                runOnUiThread(() -> showSuggestionsPlaces(labels, placeIds));
            } catch (Exception e) {
                fetchSuggestionsNominatim(q);
            }
        }).start();
    }

    // Place Details (New) — Koordinaten fuer einen Places-Vorschlag holen
    private void fetchPlaceCoords(String placeId, String addr) {
        new Thread(() -> {
            try {
                URL url = new URL("https://places.googleapis.com/v1/places/" + placeId
                    + "?fields=location&languageCode=de");
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                conn.setRequestProperty("X-Goog-Api-Key", _mapsApiKey);
                conn.setConnectTimeout(4000);
                conn.setReadTimeout(4000);
                if (conn.getResponseCode() != 200) {
                    runOnUiThread(() -> wv.evaluateJavascript("window._searchAddress(" + jsString(addr) + ")", null));
                    return;
                }
                BufferedReader br = new BufferedReader(
                    new InputStreamReader(conn.getInputStream(), StandardCharsets.UTF_8));
                StringBuilder sb = new StringBuilder();
                String line;
                while ((line = br.readLine()) != null) sb.append(line);
                br.close();

                JSONObject resp = new JSONObject(sb.toString());
                JSONObject loc = resp.optJSONObject("location");
                double lat = loc != null ? loc.optDouble("latitude", Double.NaN) : Double.NaN;
                double lon = loc != null ? loc.optDouble("longitude", Double.NaN) : Double.NaN;
                final String js = !Double.isNaN(lat)
                    ? "window._setMarker(" + lat + "," + lon + "," + jsString(addr) + ")"
                    : "window._searchAddress(" + jsString(addr) + ")";
                runOnUiThread(() -> wv.evaluateJavascript(js, null));
            } catch (Exception e) {
                runOnUiThread(() -> wv.evaluateJavascript("window._searchAddress(" + jsString(addr) + ")", null));
            }
        }).start();
    }

    // Nominatim-Fallback (wenn Places keinen Key / nichts findet)
    private void fetchSuggestionsNominatim(String q) {
        new Thread(() -> {
            try {
                String encoded = URLEncoder.encode(q, "UTF-8");
                HttpURLConnection conn = (HttpURLConnection) new URL(
                    "https://nominatim.openstreetmap.org/search"
                    + "?format=json&limit=5&countrycodes=de&addressdetails=1&q=" + encoded).openConnection();
                conn.setRequestProperty("User-Agent", "TaxiHeringsdorf/6.63.577");
                conn.setConnectTimeout(4000);
                conn.setReadTimeout(4000);
                BufferedReader br = new BufferedReader(
                    new InputStreamReader(conn.getInputStream(), StandardCharsets.UTF_8));
                StringBuilder sb = new StringBuilder();
                String line;
                while ((line = br.readLine()) != null) sb.append(line);
                br.close();

                JSONArray arr = new JSONArray(sb.toString());
                List<String> labels = new ArrayList<>();
                List<double[]> coords = new ArrayList<>();
                for (int i = 0; i < arr.length() && labels.size() < 5; i++) {
                    JSONObject hit = arr.getJSONObject(i);
                    JSONObject a = hit.optJSONObject("address");
                    String label = formatNominatimAddress(hit.optString("name", ""), a);
                    if (!label.isEmpty() && !labels.contains(label)) {
                        labels.add(label);
                        coords.add(new double[]{hit.optDouble("lat", Double.NaN), hit.optDouble("lon", Double.NaN)});
                    }
                }
                runOnUiThread(() -> showSuggestionsNominatim(labels, coords));
            } catch (Exception ignored) {}
        }).start();
    }

    private void showSuggestionsPlaces(List<String> labels, List<String> placeIds) {
        _suggestLabels.clear(); _suggestLabels.addAll(labels);
        _suggestPlaceIds.clear(); _suggestPlaceIds.addAll(placeIds);
        _suggestCoords.clear();
        updatePopup();
    }

    private void showSuggestionsNominatim(List<String> labels, List<double[]> coords) {
        if (labels.isEmpty()) { _suggestPopup.dismiss(); return; }
        _suggestLabels.clear(); _suggestLabels.addAll(labels);
        _suggestPlaceIds.clear();                           // leer → Nominatim-Pfad in onSuggestionPicked
        _suggestCoords.clear(); _suggestCoords.addAll(coords);
        updatePopup();
    }

    private void updatePopup() {
        ArrayAdapter<String> adp = new ArrayAdapter<>(this, android.R.layout.simple_list_item_1, _suggestLabels);
        _suggestPopup.setAdapter(adp);
        if (!_suggestPopup.isShowing()) _suggestPopup.show();
        else adp.notifyDataSetChanged();
    }

    private String formatNominatimAddress(String name, JSONObject a) {
        if (a == null) return "";
        String road = a.optString("road", a.optString("pedestrian", a.optString("path", "")));
        String nr = a.optString("house_number", "");
        String pc = a.optString("postcode", "");
        String city = a.optString("city", a.optString("town", a.optString("village",
                      a.optString("municipality", ""))));
        String suburb = a.optString("suburb", a.optString("neighbourhood", a.optString("hamlet", "")));
        List<String> parts = new ArrayList<>();
        if (!name.isEmpty() && !name.equals(road)) parts.add(name);
        if (!road.isEmpty()) parts.add(nr.isEmpty() ? road : road + " " + nr);
        String cc = suburb.isEmpty() || suburb.equals(city) ? city : (city.isEmpty() ? suburb : city + "-" + suburb);
        String cityPart = pc.isEmpty() ? cc : (cc.isEmpty() ? pc : pc + " " + cc);
        if (!cityPart.isEmpty()) parts.add(cityPart);
        return String.join(", ", parts);
    }

    private String stripRegionSuffix(String s) {
        return s == null ? "" : s
            .replaceAll(",?\\s*(Usedom|Rügen|Ostsee|Vorpommern-Greifswald|Mecklenburg-Vorpommern|Deutschland)$", "")
            .trim().replaceAll(",\\s*$", "").trim();
    }

    private static String jsString(String s) {
        if (s == null) return "''";
        return "'" + s.replace("\\", "\\\\").replace("'", "\\'") + "'";
    }

    private static String jsonStr(String s) {
        if (s == null) return "\"\"";
        return "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"") + "\"";
    }

    public class MapBridge {
        @JavascriptInterface
        public void onPick(double lat, double lon, String addr) {
            runOnUiThread(() -> {
                pickedLat = lat;
                pickedLon = lon;
                pickedAddr = addr;
                tvAddr.setText("📌 " + (addr == null ? "(keine Adresse)" : addr));
                btnConfirm.setEnabled(addr != null && !addr.isEmpty());
            });
        }
    }

    private String buildMapHtml(String initialQuery) {
        return "<!DOCTYPE html><html><head><meta charset='utf-8'>"
            + "<meta name='viewport' content='width=device-width,initial-scale=1,maximum-scale=1'>"
            + "<link rel='stylesheet' href='https://unpkg.com/leaflet@1.9/dist/leaflet.css'>"
            + "<style>html,body,#map{margin:0;padding:0;height:100%;width:100%;background:#0f172a}"
            + ".lf{position:absolute;left:8px;bottom:8px;background:rgba(15,23,42,0.85);color:#fff;"
            + "padding:6px 8px;border-radius:6px;font:12px sans-serif;z-index:500}"
            + "</style></head><body>"
            + "<div id='map'></div>"
            + "<div class='lf'>OpenStreetMap</div>"
            + "<script src='https://unpkg.com/leaflet@1.9/dist/leaflet.js'></script>"
            + "<script>"
            + "var map=L.map('map',{zoomControl:true,attributionControl:false}).setView([53.95,14.10],12);"
            + "L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19}).addTo(map);"
            + "var marker=null;"
            + "function setMarker(lat,lon,addr){"
            + " if(marker)map.removeLayer(marker);"
            + " marker=L.marker([lat,lon]).addTo(map);"
            + " map.setView([lat,lon],Math.max(map.getZoom(),15));"
            + " if(addr)marker.bindPopup(addr).openPopup();"
            + " if(window.MapBridge&&window.MapBridge.onPick)window.MapBridge.onPick(lat,lon,addr||'');"
            + "}"
            // v6.63.577: Direkter Setter fuer Autocomplete (kein erneuter Geocode-Call)
            + "window._setMarker=function(lat,lon,addr){setMarker(lat,lon,addr);};"
            + "function reverseGeocode(lat,lon,cb){"
            + " fetch('https://nominatim.openstreetmap.org/reverse?format=json&zoom=18&addressdetails=1&lat='+lat+'&lon='+lon,"
            + "  {headers:{'User-Agent':'TaxiHeringsdorf/6.62.220'}})"
            + " .then(r=>r.json()).then(d=>{"
            + "  var a=d.address||{};"
            + "  var name=d.name||a.amenity||a.shop||a.tourism||a.leisure||'';"
            + "  var road=a.road||'';var nr=a.house_number||'';var pc=a.postcode||'';"
            + "  var city=a.city||a.town||a.village||a.municipality||'';"
            + "  var parts=[];if(name)parts.push(name);"
            + "  if(road){var s=road;if(nr)s+=' '+nr;parts.push(s);}"
            + "  if(pc||city){var s='';if(pc)s+=pc;if(city)s+=(s?' ':'')+city;parts.push(s);}"
            + "  cb(parts.length?parts.join(', '):d.display_name||'');"
            + " }).catch(()=>cb(''));"
            + "}"
            + "window._searchAddress=function(q){"
            + " fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=de&addressdetails=1&q='+encodeURIComponent(q),"
            + "  {headers:{'User-Agent':'TaxiHeringsdorf/6.62.253'}})"
            + " .then(r=>r.json()).then(arr=>{"
            + "  if(!arr||!arr.length){alert('Adresse nicht gefunden: '+q);return;}"
            + "  var hit=arr[0];var lat=parseFloat(hit.lat);var lon=parseFloat(hit.lon);"
            + "  var a=hit.address||{};"
            + "  var name=hit.name||a.amenity||a.shop||a.tourism||a.leisure||'';"
            + "  var road=a.road||a.pedestrian||a.path||'';"
            + "  var nr=a.house_number||'';var pc=a.postcode||'';"
            + "  var city=a.city||a.town||a.village||a.municipality||'';"
            + "  var suburb=a.suburb||a.neighbourhood||a.hamlet||'';"
            + "  var parts=[];if(name&&name!==road)parts.push(name);"
            + "  if(road){var s=road;if(nr)s+=' '+nr;parts.push(s);}"
            + "  var cc=city;if(suburb&&suburb!==city)cc=city?(city+'-'+suburb):suburb;"
            + "  if(pc||cc){var s='';if(pc)s+=pc;if(cc)s+=(s?' ':'')+cc;parts.push(s);}"
            + "  setMarker(lat,lon,parts.length?parts.join(', '):hit.display_name||'');"
            + " });"
            + "};"
            + "map.on('click',function(e){"
            + " var lat=e.latlng.lat,lon=e.latlng.lng;"
            + " if(marker)map.removeLayer(marker);"
            + " marker=L.marker([lat,lon]).addTo(map).bindPopup('Lade Adresse...').openPopup();"
            + " reverseGeocode(lat,lon,function(addr){"
            + "  marker.bindPopup(addr||'(keine Adresse gefunden)').openPopup();"
            + "  if(window.MapBridge&&window.MapBridge.onPick)window.MapBridge.onPick(lat,lon,addr||'');"
            + " });"
            + "});"
            + (initialQuery != null && !initialQuery.isEmpty()
                ? "setTimeout(function(){window._searchAddress(" + jsString(initialQuery) + ");},400);"
                : "")
            + "</script></body></html>";
    }
}
