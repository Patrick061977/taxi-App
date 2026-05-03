package de.taxiheringsdorf.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.view.View;
import android.view.inputmethod.EditorInfo;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.ImageButton;
import android.widget.TextView;
import android.widget.Toast;
import androidx.appcompat.app.AppCompatActivity;
import com.google.android.material.button.MaterialButton;

// v6.62.220: Stecknadel-Picker fuer Adresseingabe ohne Google Places.
// Patrick (03.05. 17:49): "kannst du da so einen Stecknadel-Picker einbauen,
// dass man vielleicht auch ueber die Stecknadel auf der Karte die Adressen
// suchen kann?". Aufruf: startActivityForResult mit MapPickerActivity, optional
// EXTRA_INITIAL_QUERY fuer Vorbefuellung. Result: Intent mit EXTRA_RESULT_ADDR/
// LAT/LON.
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

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_map_picker);

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
            buildMapHtml(initialQuery),
            "text/html", "UTF-8", null);

        etSearch.setOnEditorActionListener((v, actionId, event) -> {
            if (actionId == EditorInfo.IME_ACTION_SEARCH) {
                String q = etSearch.getText().toString().trim();
                if (!q.isEmpty()) {
                    wv.evaluateJavascript("window._searchAddress(" + jsString(q) + ")", null);
                }
                return true;
            }
            return false;
        });
        if (initialQuery != null && !initialQuery.isEmpty()) {
            etSearch.setText(initialQuery);
        }

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

    private static String jsString(String s) {
        if (s == null) return "''";
        return "'" + s.replace("\\", "\\\\").replace("'", "\\'") + "'";
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
        // Zentriert auf Heringsdorf-Region (53.95, 14.10).
        // Klick auf Karte → Marker setzen → Reverse-Geocode via Nominatim.
        // Such-Eingabefeld oben (Native EditText) ruft window._searchAddress().
        // Auf Erfolg: window.MapBridge.onPick(lat, lon, addr).
        return "<!DOCTYPE html><html><head><meta charset='utf-8'>"
            + "<meta name='viewport' content='width=device-width,initial-scale=1,maximum-scale=1'>"
            + "<link rel='stylesheet' href='https://unpkg.com/leaflet@1.9/dist/leaflet.css'>"
            + "<style>html,body,#map{margin:0;padding:0;height:100%;width:100%;background:#0f172a}"
            + ".lf{position:absolute;left:8px;bottom:8px;background:rgba(15,23,42,0.85);color:#fff;padding:6px 8px;border-radius:6px;font:12px sans-serif;z-index:500}"
            + "</style></head><body>"
            + "<div id='map'></div>"
            + "<div class='lf'>OpenStreetMap</div>"
            + "<script src='https://unpkg.com/leaflet@1.9/dist/leaflet.js'></script>"
            + "<script>"
            + "var map=L.map('map',{zoomControl:true,attributionControl:false}).setView([53.95,14.10],12);"
            + "L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19}).addTo(map);"
            + "var marker=null;"
            + "function setMarker(lat,lon,addr){"
            + " if(marker){map.removeLayer(marker);}"
            + " marker=L.marker([lat,lon]).addTo(map);"
            + " map.setView([lat,lon],Math.max(map.getZoom(),15));"
            + " if(addr){marker.bindPopup(addr).openPopup();}"
            + " if(window.MapBridge&&window.MapBridge.onPick){window.MapBridge.onPick(lat,lon,addr||'');}"
            + "}"
            + "function reverseGeocode(lat,lon,cb){"
            + " var url='https://nominatim.openstreetmap.org/reverse?format=json&zoom=18&addressdetails=1&lat='+lat+'&lon='+lon;"
            + " fetch(url,{headers:{'User-Agent':'TaxiHeringsdorf/6.62.220'}})"
            + "  .then(function(r){return r.json();})"
            + "  .then(function(d){"
            + "    var a=d.address||{};"
            + "    var name=d.name||a.amenity||a.shop||a.tourism||a.leisure||'';"
            + "    var road=a.road||'';"
            + "    var nr=a.house_number||'';"
            + "    var pc=a.postcode||'';"
            + "    var city=a.city||a.town||a.village||a.municipality||'';"
            + "    var parts=[];"
            + "    if(name)parts.push(name);"
            + "    if(road){var s=road;if(nr)s+=' '+nr;parts.push(s);}"
            + "    if(pc||city){var s='';if(pc)s+=pc;if(city)s+=(s?' ':'')+city;parts.push(s);}"
            + "    var addr=parts.length?parts.join(', '):d.display_name||'';"
            + "    cb(addr);"
            + "  })"
            + "  .catch(function(){cb('');});"
            + "}"
            + "window._searchAddress=function(q){"
            + " var url='https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=de&q='+encodeURIComponent(q);"
            + " fetch(url,{headers:{'User-Agent':'TaxiHeringsdorf/6.62.220'}})"
            + "  .then(function(r){return r.json();})"
            + "  .then(function(arr){"
            + "    if(!arr||!arr.length){alert('Adresse nicht gefunden: '+q);return;}"
            + "    var hit=arr[0];"
            + "    var lat=parseFloat(hit.lat);var lon=parseFloat(hit.lon);"
            + "    setMarker(lat,lon,hit.display_name);"
            + "  });"
            + "};"
            + "map.on('click',function(e){"
            + " var lat=e.latlng.lat;var lon=e.latlng.lng;"
            + " if(marker){map.removeLayer(marker);}"
            + " marker=L.marker([lat,lon]).addTo(map);"
            + " marker.bindPopup('Lade Adresse...').openPopup();"
            + " reverseGeocode(lat,lon,function(addr){"
            + "  marker.bindPopup(addr||'(keine Adresse gefunden)').openPopup();"
            + "  if(window.MapBridge&&window.MapBridge.onPick){window.MapBridge.onPick(lat,lon,addr||'');}"
            + " });"
            + "});"
            + (initialQuery != null && !initialQuery.isEmpty()
                ? "setTimeout(function(){window._searchAddress(" + jsString(initialQuery) + ");},400);"
                : "")
            + "</script></body></html>";
    }
}
