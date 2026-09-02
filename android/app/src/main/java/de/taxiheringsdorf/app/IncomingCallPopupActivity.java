package de.taxiheringsdorf.app;

// v6.65.0 (Patrick 02.09.2026 12:00 Bridge "Schnellbutton fuer Anrufe"):
// Vollbild-Popup wenn Anruf reinkommt (via PhoneStateReceiver bei RINGING).
// Ueber Lockscreen sichtbar. Zeigt Kunde+Schnellwahl+SOFORT so dass Patrick
// waehrend des Telefonats in 3 Taps die Fahrt vergeben kann.
//
// Intent-Extras:
//   extra "phone": eingehende Nummer aus TelephonyManager
//
// SOFORT-Button:
//   Legt Ride an mit pickup+dest+pax, status="new", pickupTimestamp=jetzt.
//   Cloud-Function scheduledAutoAssign uebernimmt Zuweisung nach FCFS.
//   (Kein neuer Regel-Code — nutzt bestehende Dispatch-Logik.)
//
// VORBESTELLEN-Button:
//   Oeffnet CrmSearchActivity mit auto_vorbestellung_* Prefills — dort
//   trägt Patrick Datum/Uhrzeit ein und bestaetigt.

import android.app.KeyguardManager;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;

import com.google.firebase.database.DataSnapshot;
import com.google.firebase.database.DatabaseError;
import com.google.firebase.database.DatabaseReference;
import com.google.firebase.database.FirebaseDatabase;
import com.google.firebase.database.ValueEventListener;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

public class IncomingCallPopupActivity extends AppCompatActivity {

    private static final String TAG = "IncomingCallPopup";
    private static final String DB_INSTANCE_URL =
        "https://taxi-heringsdorf-default-rtdb.europe-west1.firebasedatabase.app";

    // Feste Schnellwahl-Ziele (haeufige Fahrtenziele — 90% aller Sofort-Fahrten)
    // v6.65.5: mit hardcoded Coords damit Ride sofort geokodiert ist (kein Nominatim-Roundtrip).
    // Format: {label, address, lat, lon}
    private static final String[][] QUICK_DESTS = {
        {"✈ Flughafen Heringsdorf", "Flughafen Heringsdorf, 17419 Heringsdorf", "53.8788", "14.1524"},
        {"🚂 Bahnhof Heringsdorf", "Bahnhof Heringsdorf, 17424 Heringsdorf", "53.9520", "14.1687"},
        {"🚂 Bahnhof Ahlbeck", "Bahnhof Ahlbeck, 17419 Ahlbeck", "53.9364", "14.2153"},
        {"🚂 Bahnhof Bansin", "Bahnhof Bansin, 17429 Bansin", "53.9713", "14.1263"},
        {"🚂 Bahnhof Zuessow", "Bahnhof Zuessow, 17495 Zuessow", "53.9186", "13.6636"},
        {"🇵🇱 Swinemuende Zentrum", "Świnoujście, Polen", "53.9106", "14.2483"}
    };

    private String phone;
    private String matchedCustomerId;
    private String matchedCustomerName;
    private String matchedCustomerHomeAddress;

    private String chosenPickup;
    private Double chosenPickupLat, chosenPickupLon;
    private String chosenDest;
    private Double chosenDestLat, chosenDestLon;
    private String chosenZwischen;
    private Double chosenZwischenLat, chosenZwischenLon;
    private int pax = 1;
    private long popupOpenedAt;

    // UI refs
    private TextView tvPhone, tvCustName, tvCustMeta, tvCue, tvPickupChosen, tvDestChosen, tvTime, tvPax;
    private EditText etName, etZwischen, etNotes;
    private LinearLayout llPickupBtns, llDestBtns;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        popupOpenedAt = System.currentTimeMillis();

        // Ueber Lockscreen + Bildschirm wecken (wie RideAlertActivity)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
            KeyguardManager km = (KeyguardManager) getSystemService(Context.KEYGUARD_SERVICE);
            if (km != null) km.requestDismissKeyguard(this, null);
        } else {
            getWindow().addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
            );
        }
        // v6.65.3 (Patrick 02.09. "Bildschirm darf sich nicht von alleine schliessen"):
        //   KEEP_SCREEN_ON IMMER, unabhaengig von SDK. Verhindert dass der Popup
        //   waehrend Patrick die Adresse tippt vom Screen-Timeout ausgeblendet wird.
        //   Plus KEEP_ON_WHILE_LOCKED damit auch bei Lockscreen der Screen anbleibt.
        getWindow().addFlags(
            WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
        );

        setContentView(R.layout.activity_incoming_call_popup);

        tvPhone = findViewById(R.id.popup_phone);
        tvCustName = findViewById(R.id.popup_customer_name);
        tvCustMeta = findViewById(R.id.popup_customer_meta);
        tvCue = findViewById(R.id.popup_cue);
        tvPickupChosen = findViewById(R.id.popup_pickup_chosen);
        tvDestChosen = findViewById(R.id.popup_dest_chosen);
        tvTime = findViewById(R.id.popup_time);
        tvPax = findViewById(R.id.popup_pax_value);
        etName = findViewById(R.id.popup_name_input);
        etZwischen = findViewById(R.id.popup_zwischen_input);
        etNotes = findViewById(R.id.popup_notes);
        llPickupBtns = findViewById(R.id.popup_pickup_buttons);
        llDestBtns = findViewById(R.id.popup_dest_buttons);

        phone = getIntent() != null ? getIntent().getStringExtra("phone") : null;
        if (phone == null) phone = "unbekannt";
        tvPhone.setText(phone);
        tvTime.setText(new SimpleDateFormat("HH:mm", Locale.GERMANY).format(new Date()));

        // Personen-Zaehler
        findViewById(R.id.popup_pax_plus).setOnClickListener(v -> {
            if (pax < 8) { pax++; tvPax.setText(String.valueOf(pax)); }
        });
        findViewById(R.id.popup_pax_minus).setOnClickListener(v -> {
            if (pax > 1) { pax--; tvPax.setText(String.valueOf(pax)); }
        });

        // Zwischenstopp-Toggle
        Button btnZw = findViewById(R.id.popup_zwischen_toggle);
        btnZw.setOnClickListener(v -> {
            boolean vis = etZwischen.getVisibility() == View.VISIBLE;
            etZwischen.setVisibility(vis ? View.GONE : View.VISIBLE);
            btnZw.setText(vis ? "＋ Zwischenstopp hinzufuegen" : "－ Zwischenstopp entfernen");
        });
        // Zwischenstopp Autocomplete-Trigger bei Klick
        etZwischen.setOnClickListener(v -> showAddressPicker("Zwischenstopp suchen", (label, lat, lon) -> {
            etZwischen.setText(label);
            chosenZwischen = label;
            chosenZwischenLat = lat;
            chosenZwischenLon = lon;
        }));

        // v6.65.5: Swap Pickup <-> Ziel
        Button btnSwap = findViewById(R.id.popup_swap);
        btnSwap.setOnClickListener(v -> {
            String tPick = chosenPickup; Double tLat = chosenPickupLat, tLon = chosenPickupLon;
            chosenPickup = chosenDest; chosenPickupLat = chosenDestLat; chosenPickupLon = chosenDestLon;
            chosenDest = tPick; chosenDestLat = tLat; chosenDestLon = tLon;
            if (chosenPickup != null) selectPickup(chosenPickup, chosenPickup); else tvPickupChosen.setVisibility(View.GONE);
            if (chosenDest != null) selectDest(chosenDest, chosenDest); else tvDestChosen.setVisibility(View.GONE);
            Toast.makeText(this, "⇅ Getauscht", Toast.LENGTH_SHORT).show();
        });

        // Ziel-Schnellwahl-Buttons statisch aufbauen (bekannte Top-Ziele mit hardcoded Coords)
        for (String[] d : QUICK_DESTS) {
            final String label = d[0], addr = d[1];
            final double lat = Double.parseDouble(d[2]), lon = Double.parseDouble(d[3]);
            addPickButton(llDestBtns, label, () -> {
                chosenDestLat = lat; chosenDestLon = lon;
                selectDest(addr, label);
            });
        }
        addPickButton(llDestBtns, "＋ Andere Adresse (Autocomplete)", () -> {
            showAddressPicker("Ziel-Adresse suchen", (label, lat, lon) -> {
                chosenDestLat = lat; chosenDestLon = lon;
                selectDest(label, label);
            });
        });

        // Buttons
        findViewById(R.id.popup_btn_sofort).setOnClickListener(v -> onSofort());
        findViewById(R.id.popup_btn_vorbestellen).setOnClickListener(v -> onVorbestellen());
        findViewById(R.id.popup_btn_cancel).setOnClickListener(v -> finish());

        // CRM-Lookup starten
        lookupCustomerByPhone(phone);
    }

    private void addPickButton(LinearLayout parent, String label, Runnable onClick) {
        Button b = new Button(this);
        b.setText(label);
        b.setAllCaps(false);
        b.setTextColor(0xFFe2e8f0);
        b.setBackgroundColor(0xFF334155);
        b.setPadding(24, 16, 24, 16);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.setMargins(0, 4, 0, 4);
        b.setLayoutParams(lp);
        b.setOnClickListener(v -> onClick.run());
        parent.addView(b);
    }

    private void selectPickup(String address, String label) {
        chosenPickup = address;
        tvPickupChosen.setText("✓ Abholung: " + label);
        tvPickupChosen.setVisibility(View.VISIBLE);
    }

    private void selectDest(String address, String label) {
        chosenDest = address;
        tvDestChosen.setText("✓ Ziel: " + label);
        tvDestChosen.setVisibility(View.VISIBLE);
    }

    // v6.65.5 (Patrick 02.09. 14:58 Bridge "Adresse muss geokodiert werden"):
    //   Nominatim-Autocomplete-Dialog. Debounced Fetch, viewbox Usedom, Ergebnisse als
    //   Buttons. onPick liefert Label + lat/lon fuer Ride-Anlage.
    private interface AddressPickCallback {
        void onPick(String label, double lat, double lon);
    }
    private void showAddressPicker(String title, AddressPickCallback cb) {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(24, 24, 24, 24);

        EditText input = new EditText(this);
        input.setHint("Adresse tippen (mind. 3 Buchstaben)");
        root.addView(input);

        LinearLayout results = new LinearLayout(this);
        results.setOrientation(LinearLayout.VERTICAL);
        results.setPadding(0, 12, 0, 0);
        root.addView(results);

        androidx.appcompat.app.AlertDialog dlg = new androidx.appcompat.app.AlertDialog.Builder(this)
            .setTitle(title)
            .setView(root)
            .setNegativeButton("Abbrechen", null)
            .create();

        final android.os.Handler handler = new android.os.Handler(android.os.Looper.getMainLooper());
        final Runnable[] pending = { null };
        input.addTextChangedListener(new android.text.TextWatcher() {
            @Override public void beforeTextChanged(CharSequence s, int a, int b, int c) {}
            @Override public void onTextChanged(CharSequence s, int a, int b, int c) {}
            @Override public void afterTextChanged(android.text.Editable s) {
                if (pending[0] != null) handler.removeCallbacks(pending[0]);
                final String q = s.toString().trim();
                if (q.length() < 3) { results.removeAllViews(); return; }
                pending[0] = () -> {
                    new Thread(() -> {
                        try {
                            String enc = java.net.URLEncoder.encode(q, "UTF-8");
                            String url = "https://nominatim.openstreetmap.org/search?format=json&limit=6&addressdetails=1"
                                + "&viewbox=13.5%2C54.5%2C14.7%2C53.8&bounded=0&countrycodes=de%2Cpl&q=" + enc;
                            java.net.HttpURLConnection c = (java.net.HttpURLConnection) new java.net.URL(url).openConnection();
                            c.setRequestProperty("User-Agent", "TaxiHeringsdorf-App/6.65");
                            c.setConnectTimeout(4000); c.setReadTimeout(4000);
                            java.io.InputStream is = c.getInputStream();
                            java.io.ByteArrayOutputStream bos = new java.io.ByteArrayOutputStream();
                            byte[] buf = new byte[4096]; int n;
                            while ((n = is.read(buf)) != -1) bos.write(buf, 0, n);
                            org.json.JSONArray arr = new org.json.JSONArray(bos.toString("UTF-8"));
                            runOnUiThread(() -> {
                                results.removeAllViews();
                                if (arr.length() == 0) {
                                    TextView none = new TextView(IncomingCallPopupActivity.this);
                                    none.setText("Keine Vorschlaege — Netz oder Nominatim rate-limit");
                                    none.setTextColor(0xFF94a3b8);
                                    results.addView(none);
                                    return;
                                }
                                for (int i = 0; i < arr.length(); i++) {
                                    try {
                                        org.json.JSONObject o = arr.getJSONObject(i);
                                        // v6.65.6 (Patrick 02.09. 15:18 Bridge): "Maxim-Gorki-Straße 22" statt
                                        //   "22, Maxim-Gorki-Straße". Nominatim liefert strukturiertes addressdetails
                                        //   Objekt -- selber zusammenbauen: road + house_number + PLZ + city.
                                        org.json.JSONObject addr = o.optJSONObject("address");
                                        String label;
                                        if (addr != null) {
                                            String road = addr.optString("road", addr.optString("pedestrian", addr.optString("footway", "")));
                                            String hnr = addr.optString("house_number", "");
                                            String plz = addr.optString("postcode", "");
                                            // v6.65.6b (Patrick 02.09. 15:19): "nicht Kaiserbäder" — Nominatim liefert
                                            //   fuer die drei Kaiserbaeder (Ahlbeck/Heringsdorf/Bansin) manchmal city="Kaiserbaeder"
                                            //   und suburb=konkreter Ortsname. Suburb bevorzugen wenn vorhanden — Patrick will
                                            //   den konkreten Ort sehen (Ahlbeck), nicht die Sammelbezeichnung.
                                            String city = addr.optString("suburb",
                                                addr.optString("village",
                                                addr.optString("town",
                                                addr.optString("city",
                                                addr.optString("municipality", "")))));
                                            StringBuilder sb = new StringBuilder();
                                            if (!road.isEmpty()) { sb.append(road); if (!hnr.isEmpty()) sb.append(" ").append(hnr); }
                                            else sb.append(o.optString("name", ""));
                                            if (sb.length() > 0 && (!plz.isEmpty() || !city.isEmpty())) sb.append(", ");
                                            if (!plz.isEmpty()) sb.append(plz).append(" ");
                                            if (!city.isEmpty()) sb.append(city);
                                            label = sb.toString().trim();
                                            if (label.isEmpty()) label = o.optString("display_name", "");
                                        } else {
                                            String display = o.optString("display_name", "");
                                            String[] parts = display.split(", ");
                                            label = parts.length > 0 ? parts[0] : display;
                                            if (parts.length > 1) label += ", " + parts[1];
                                            if (parts.length > 2) label += ", " + parts[2];
                                        }
                                        double lat = Double.parseDouble(o.optString("lat", "0"));
                                        double lon = Double.parseDouble(o.optString("lon", "0"));
                                        final String flabel = label;
                                        Button btn = new Button(IncomingCallPopupActivity.this);
                                        btn.setText("📍 " + flabel);
                                        btn.setAllCaps(false);
                                        btn.setGravity(android.view.Gravity.START | android.view.Gravity.CENTER_VERTICAL);
                                        btn.setTextSize(12);
                                        btn.setTextColor(0xFFe2e8f0);
                                        btn.setBackgroundColor(0xFF1e40af);
                                        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                                            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
                                        lp.setMargins(0, 4, 0, 4);
                                        btn.setLayoutParams(lp);
                                        btn.setOnClickListener(v -> {
                                            cb.onPick(flabel, lat, lon);
                                            dlg.dismiss();
                                        });
                                        results.addView(btn);
                                    } catch (Exception _e) { /* skip */ }
                                }
                            });
                        } catch (Exception _err) {
                            runOnUiThread(() -> {
                                results.removeAllViews();
                                TextView e = new TextView(IncomingCallPopupActivity.this);
                                e.setText("Netzfehler: " + _err.getMessage());
                                e.setTextColor(0xFFef4444);
                                results.addView(e);
                            });
                        }
                    }).start();
                };
                handler.postDelayed(pending[0], 600);
            }
        });
        dlg.show();
    }

    // Convenience wrapper — behält bestehende showTextInput-Signatur, aber unterlegt jetzt mit Autocomplete + Geo
    private void showTextInput(String hint, java.util.function.Consumer<String> cb) {
        showAddressPicker(hint, (label, lat, lon) -> {
            // Coord-Zuordnung passiert via selectPickup/selectDest (siehe Aufrufer)
            cb.accept(label);
        });
    }

    private void lookupCustomerByPhone(String rawPhone) {
        final String pNorm = normalizePhone(rawPhone);
        if (pNorm.isEmpty()) { showUnknown(); return; }
        FirebaseDatabase.getInstance(DB_INSTANCE_URL).getReference("customers")
            .addListenerForSingleValueEvent(new ValueEventListener() {
                @Override public void onDataChange(DataSnapshot snap) {
                    for (DataSnapshot cs : snap.getChildren()) {
                        Object[] fields = new Object[]{
                            cs.child("phone").getValue(String.class),
                            cs.child("mobilePhone").getValue(String.class),
                            cs.child("phone2").getValue(String.class)
                        };
                        for (Object f : fields) {
                            if (f == null) continue;
                            if (normalizePhone(String.valueOf(f)).equals(pNorm)) {
                                matchedCustomerId = cs.getKey();
                                matchedCustomerName = cs.child("name").getValue(String.class);
                                matchedCustomerHomeAddress = cs.child("address").getValue(String.class);
                                showMatched();
                                return;
                            }
                        }
                        DataSnapshot ap = cs.child("additionalPhones");
                        if (ap.exists()) {
                            for (DataSnapshot a : ap.getChildren()) {
                                String v = a.getValue(String.class);
                                if (v != null && normalizePhone(v).equals(pNorm)) {
                                    matchedCustomerId = cs.getKey();
                                    matchedCustomerName = cs.child("name").getValue(String.class);
                                    matchedCustomerHomeAddress = cs.child("address").getValue(String.class);
                                    showMatched();
                                    return;
                                }
                            }
                        }
                    }
                    showUnknown();
                }
                @Override public void onCancelled(DatabaseError e) {
                    Log.w(TAG, "CRM-Lookup Fehler: " + e.getMessage());
                    showUnknown();
                }
            });
    }

    private void showMatched() {
        tvCustName.setText(matchedCustomerName != null ? matchedCustomerName : "?");
        tvCustName.setVisibility(View.VISIBLE);
        tvCustMeta.setText("Stammkunde im CRM");
        tvCustMeta.setVisibility(View.VISIBLE);
        etName.setVisibility(View.GONE);
        // Cue-Card ohne Name-Frage
        tvCue.setText("📝 Wohin? · Wo abholen? · Zwischenstopp? · Personen? · Sonderwuensche?");
        // Pickup-Buttons: CRM-Hauptadresse + GPS + andere
        llPickupBtns.removeAllViews();
        if (matchedCustomerHomeAddress != null && !matchedCustomerHomeAddress.isEmpty()) {
            addPickButton(llPickupBtns, "🏠 " + matchedCustomerHomeAddress,
                () -> selectPickup(matchedCustomerHomeAddress, "Zuhause"));
        }
        addPickButton(llPickupBtns, "📍 Aktueller GPS-Standort (Fahrer)",
            () -> { chosenPickupLat = null; chosenPickupLon = null; selectPickup("GPS-Standort", "GPS-Standort"); });
        addPickButton(llPickupBtns, "＋ Andere Adresse (Autocomplete)",
            () -> showAddressPicker("Abhol-Adresse suchen", (label, lat, lon) -> {
                chosenPickupLat = lat; chosenPickupLon = lon;
                selectPickup(label, label);
            }));
    }

    private void showUnknown() {
        tvCustName.setVisibility(View.GONE);
        tvCustMeta.setText("Unbekannter Anrufer — bitte Name aufnehmen");
        tvCustMeta.setVisibility(View.VISIBLE);
        etName.setVisibility(View.VISIBLE);
        tvCue.setText("📝 Name? · Wohin? · Wo abholen? · Zwischenstopp? · Personen? · Sonderwuensche?");
        // Pickup: nur GPS + andere (kein CRM-Home)
        llPickupBtns.removeAllViews();
        addPickButton(llPickupBtns, "📍 Aktueller GPS-Standort (Fahrer)",
            () -> { chosenPickupLat = null; chosenPickupLon = null; selectPickup("GPS-Standort", "GPS-Standort"); });
        addPickButton(llPickupBtns, "＋ Adresse suchen (Autocomplete)",
            () -> showAddressPicker("Abhol-Adresse suchen", (label, lat, lon) -> {
                chosenPickupLat = lat; chosenPickupLon = lon;
                selectPickup(label, label);
            }));
    }

    // v6.65.4 (Patrick 02.09.): Match ueber die letzten 7 Ziffern — gleich wie CallLogActivity
    //   (Zeile 890). Damit matchen: "+493837822022" ↔ "0038-3782-2022" ↔ "004-938-37822022"
    //   ↔ "22022" (Kurzwahl) — alle enden auf ...7822022 bzw. ..22022. Verhindert die "004"-
    //   Tippfehler-Falle und CRM-Kurzwahl-Nichterkennung.
    private static String normalizePhone(String p) {
        if (p == null) return "";
        String d = p.replaceAll("[^0-9]", "");
        if (d.length() >= 7) return d.substring(d.length() - 7);
        return d;
    }

    private void onSofort() {
        if (chosenPickup == null || chosenPickup.isEmpty()) {
            Toast.makeText(this, "Bitte Abholort waehlen", Toast.LENGTH_SHORT).show(); return;
        }
        if (chosenDest == null || chosenDest.isEmpty()) {
            Toast.makeText(this, "Bitte Ziel waehlen", Toast.LENGTH_SHORT).show(); return;
        }
        String custName = matchedCustomerName;
        if (custName == null || custName.isEmpty()) {
            custName = etName.getText().toString().trim();
            if (custName.isEmpty()) custName = "Anrufer " + phone;
        }
        final String _custName = custName;
        Map<String, Object> ride = new HashMap<>();
        ride.put("pickup", chosenPickup);
        if (chosenPickupLat != null && chosenPickupLon != null) {
            ride.put("pickupLat", chosenPickupLat);
            ride.put("pickupLon", chosenPickupLon);
        }
        ride.put("destination", chosenDest);
        if (chosenDestLat != null && chosenDestLon != null) {
            ride.put("destinationLat", chosenDestLat);
            ride.put("destinationLon", chosenDestLon);
        }
        String zw = etZwischen.getVisibility() == View.VISIBLE ? etZwischen.getText().toString().trim() : "";
        if (!zw.isEmpty()) ride.put("zwischenstopp", zw);
        if (chosenZwischenLat != null && chosenZwischenLon != null) {
            ride.put("zwischenstoppLat", chosenZwischenLat);
            ride.put("zwischenstoppLon", chosenZwischenLon);
        }
        ride.put("passengers", pax);
        ride.put("customerName", _custName);
        ride.put("customerPhone", phone);
        if (matchedCustomerId != null) ride.put("customerId", matchedCustomerId);
        String notes = etNotes.getText().toString().trim();
        if (!notes.isEmpty()) ride.put("notes", notes);
        ride.put("status", "new");
        ride.put("pickupTimestamp", System.currentTimeMillis());
        ride.put("createdAt", System.currentTimeMillis());
        ride.put("createdVia", "native-incoming-call-popup-v6.65.0");
        ride.put("updatedAt", System.currentTimeMillis());
        // Auto-Assign uebernimmt scheduledAutoAssign Cloud-Function (FCFS + Schichtplan)

        DatabaseReference ref = FirebaseDatabase.getInstance(DB_INSTANCE_URL).getReference("rides").push();
        ref.setValue(ride).addOnSuccessListener(_ok -> {
            Toast.makeText(this, "🚀 Fahrt an Dispatcher — Auto-Assign laeuft", Toast.LENGTH_LONG).show();
            finish();
        }).addOnFailureListener(err -> {
            Toast.makeText(this, "❌ Fehler: " + err.getMessage(), Toast.LENGTH_LONG).show();
        });
    }

    @Override
    public void onBackPressed() {
        // v6.65.3 (Patrick 02.09.): BACK abfangen mit Bestaetigungs-Dialog damit
        //   der Popup nicht versehentlich beim Weg-Tippen geschlossen wird.
        new androidx.appcompat.app.AlertDialog.Builder(this)
            .setTitle("Popup schliessen?")
            .setMessage("Deine Eingaben gehen verloren. Wirklich schliessen?")
            .setPositiveButton("Ja, schliessen", (d, w) -> super.onBackPressed())
            .setNegativeButton("Nein, weiter", null)
            .show();
    }

    private void onVorbestellen() {
        // Ins bestehende Vorbestell-Formular springen mit den bereits gesammelten Daten
        Intent i = new Intent(this, CrmSearchActivity.class);
        if (matchedCustomerId != null) i.putExtra("auto_vorbestellung_customer_id", matchedCustomerId);
        i.putExtra("auto_vorbestellung_phone", phone);
        if (matchedCustomerName != null) i.putExtra("auto_vorbestellung_name", matchedCustomerName);
        // Prefill-Extras — CrmSearchActivity muesste diese noch auslesen (v6.65.1 falls fehlt)
        if (chosenPickup != null) i.putExtra("prefill_pickup", chosenPickup);
        if (chosenDest != null) i.putExtra("prefill_destination", chosenDest);
        i.putExtra("prefill_pax", pax);
        startActivity(i);
        finish();
    }
}
