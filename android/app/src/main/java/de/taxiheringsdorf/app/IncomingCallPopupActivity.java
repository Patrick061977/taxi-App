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
    private static final String[][] QUICK_DESTS = {
        {"✈ Flughafen Heringsdorf", "Flughafen Heringsdorf, 17419 Heringsdorf"},
        {"🚂 Bahnhof Heringsdorf", "Bahnhof Heringsdorf, 17424 Heringsdorf"},
        {"🚂 Bahnhof Ahlbeck", "Bahnhof Ahlbeck, 17419 Ahlbeck"},
        {"🚂 Bahnhof Bansin", "Bahnhof Bansin, 17429 Bansin"},
        {"🚂 Bahnhof Zuessow", "Bahnhof Zuessow, 17495 Zuessow"},
        {"🇵🇱 Swinemuende Zentrum", "Świnoujście, Polen"}
    };

    private String phone;
    private String matchedCustomerId;
    private String matchedCustomerName;
    private String matchedCustomerHomeAddress;

    private String chosenPickup;
    private String chosenDest;
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
                | WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
            );
        }

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

        // Ziel-Schnellwahl-Buttons statisch aufbauen (bekannte Top-Ziele)
        for (String[] d : QUICK_DESTS) {
            addPickButton(llDestBtns, d[0], () -> selectDest(d[1], d[0]));
        }
        addPickButton(llDestBtns, "＋ Andere Adresse (tippen)", () -> {
            showTextInput("Ziel-Adresse", (txt) -> selectDest(txt, txt));
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

    private void showTextInput(String hint, java.util.function.Consumer<String> cb) {
        // Simpler AlertDialog mit EditText — Autocomplete kommt in v6.65.1
        final EditText input = new EditText(this);
        input.setHint(hint);
        new androidx.appcompat.app.AlertDialog.Builder(this)
            .setTitle(hint)
            .setView(input)
            .setPositiveButton("OK", (d, w) -> {
                String s = input.getText().toString().trim();
                if (!s.isEmpty()) cb.accept(s);
            })
            .setNegativeButton("Abbrechen", null)
            .show();
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
            () -> selectPickup("GPS-Standort", "GPS-Standort"));
        addPickButton(llPickupBtns, "＋ Andere Adresse (tippen)",
            () -> showTextInput("Abhol-Adresse", (txt) -> selectPickup(txt, txt)));
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
            () -> selectPickup("GPS-Standort", "GPS-Standort"));
        addPickButton(llPickupBtns, "＋ Adresse tippen",
            () -> showTextInput("Abhol-Adresse", (txt) -> selectPickup(txt, txt)));
    }

    private static String normalizePhone(String p) {
        if (p == null) return "";
        return p.replaceAll("[^0-9]", "");
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
        ride.put("destination", chosenDest);
        String zw = etZwischen.getVisibility() == View.VISIBLE ? etZwischen.getText().toString().trim() : "";
        if (!zw.isEmpty()) ride.put("zwischenstopp", zw);
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
