package de.taxiheringsdorf.app;

import android.app.Activity;
import android.util.Log;
import android.view.View;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import com.google.android.material.button.MaterialButton;
import com.google.firebase.database.DataSnapshot;
import com.google.firebase.database.DatabaseError;
import com.google.firebase.database.FirebaseDatabase;
import com.google.firebase.database.ValueEventListener;

import java.text.SimpleDateFormat;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.TimeZone;

/**
 * v6.66.241 (Patrick 04.10. 18:29 Bridge): Baustein 3 des Call-zu-Fahrt-Autoflow.
 *
 * Beobachtet /dispoVorschlaege für Einträge mit type='call-vorschlag' + status='open',
 * zeigt die neueste Vorschau in einer Card mit den Buttons [ANLEGEN]/[BEARBEITEN]/[WEG].
 *
 *  - ANLEGEN  → schreibt /rides/{pushId} mit den extrahierten Werten, status=vorbestellt,
 *               Cloud-auto-assign übernimmt. Markiert Vorschlag als status=applied.
 *  - BEARBEITEN → prefilled Edit-Dialog öffnen (TODO morgen, aktuell gleiche Semantik wie ANLEGEN).
 *  - WEG      → status=dismissed, Card verschwindet.
 */
public class CallVorschlagHandler {
    private static final String TAG = "CallVorschlag";
    private static final String DB_URL = "https://taxi-heringsdorf-default-rtdb.europe-west1.firebasedatabase.app";

    private final Activity activity;
    private final LinearLayout card;
    private final TextView title;
    private final TextView body;
    private final MaterialButton btnAnlegen;
    private final MaterialButton btnEdit;
    private final MaterialButton btnDismiss;

    private String currentVorschlagId = null;
    private Map<String, Object> currentExtracted = null;
    private Map<String, Object> currentVorschlag = null;

    public CallVorschlagHandler(Activity activity) {
        this.activity = activity;
        this.card = activity.findViewById(R.id.admin_call_vorschlag_card);
        this.title = activity.findViewById(R.id.admin_call_vorschlag_title);
        this.body = activity.findViewById(R.id.admin_call_vorschlag_body);
        this.btnAnlegen = activity.findViewById(R.id.admin_call_vorschlag_anlegen);
        this.btnEdit = activity.findViewById(R.id.admin_call_vorschlag_edit);
        this.btnDismiss = activity.findViewById(R.id.admin_call_vorschlag_dismiss);

        if (card != null) {
            btnAnlegen.setOnClickListener(v -> handleAnlegen());
            btnEdit.setOnClickListener(v -> handleEdit());
            btnDismiss.setOnClickListener(v -> handleDismiss());
            startListener();
        }
    }

    private void startListener() {
        FirebaseDatabase.getInstance(DB_URL).getReference("dispoVorschlaege")
            .addValueEventListener(new ValueEventListener() {
                @Override public void onDataChange(DataSnapshot s) { renderLatest(s); }
                @Override public void onCancelled(DatabaseError e) { Log.w(TAG, "listener: " + e.getMessage()); }
            });
    }

    @SuppressWarnings("unchecked")
    private void renderLatest(DataSnapshot s) {
        Map<String, Object> newest = null;
        String newestId = null;
        long newestAt = 0;
        for (DataSnapshot c : s.getChildren()) {
            Object v = c.getValue();
            if (!(v instanceof Map)) continue;
            Map<String, Object> m = (Map<String, Object>) v;
            if (!"call-vorschlag".equals(m.get("type"))) continue;
            if (!"open".equals(m.get("status"))) continue;
            long ts = 0;
            Object tsObj = m.get("createdAt");
            if (tsObj instanceof Long) ts = (Long) tsObj;
            else if (tsObj instanceof Double) ts = ((Double) tsObj).longValue();
            if (ts > newestAt) { newestAt = ts; newest = m; newestId = c.getKey(); }
        }
        if (newest == null) {
            card.setVisibility(View.GONE);
            currentVorschlagId = null;
            currentExtracted = null;
            currentVorschlag = null;
            return;
        }
        currentVorschlag = newest;
        currentVorschlagId = newestId;
        currentExtracted = (Map<String, Object>) newest.get("extracted");

        StringBuilder sb = new StringBuilder();
        String phone = (String) newest.get("callerPhone");
        String crmName = (String) newest.get("crmCustomerName");
        String name = currentExtracted != null ? (String) currentExtracted.get("name") : null;
        String displayName = crmName != null ? crmName : (name != null ? name : (phone != null ? phone : "Anrufer"));
        sb.append("👤 ").append(displayName);
        if (phone != null && !phone.isEmpty() && !phone.equals(displayName)) sb.append(" · ").append(phone);
        sb.append("\n");
        if (currentExtracted != null) {
            Object pickupTs = currentExtracted.get("pickupTimestamp");
            String pickupTimeReadable = (String) currentExtracted.get("pickupTimeReadable");
            String pickup = (String) currentExtracted.get("pickup");
            String dest = (String) currentExtracted.get("destination");
            Object pax = currentExtracted.get("passengers");
            Object preis = currentExtracted.get("festpreisEUR");
            if (pickupTs != null) {
                long ts = (pickupTs instanceof Long) ? (Long) pickupTs : ((Double) pickupTs).longValue();
                SimpleDateFormat sdf = new SimpleDateFormat("EEE d.MM HH:mm", Locale.GERMAN);
                sdf.setTimeZone(TimeZone.getTimeZone("Europe/Berlin"));
                sb.append("🕐 ").append(sdf.format(new java.util.Date(ts)));
                if (pickupTimeReadable != null) sb.append(" (").append(pickupTimeReadable).append(")");
                sb.append("\n");
            } else if (pickupTimeReadable != null) {
                sb.append("🕐 ").append(pickupTimeReadable).append("\n");
            }
            if (pickup != null) sb.append("📍 ").append(pickup).append("\n");
            if (dest != null) sb.append("🎯 ").append(dest).append("\n");
            if (pax != null) sb.append("👥 ").append(pax);
            if (preis != null) sb.append(" · 💰 ").append(preis).append(" €");
            sb.append("\n");
            Object conf = currentExtracted.get("confidence");
            if (conf != null) sb.append("🧠 Confidence: ").append(conf);
        } else {
            String transcript = (String) newest.get("transcript");
            if (transcript != null) sb.append(transcript.length() > 200 ? transcript.substring(0, 200) + "..." : transcript);
        }
        title.setText("📞 Call-Vorschlag" + (phone != null ? " · " + phone : ""));
        body.setText(sb.toString().trim());
        card.setVisibility(View.VISIBLE);
    }

    private void handleAnlegen() {
        if (currentVorschlagId == null || currentExtracted == null) {
            Toast.makeText(activity, "Keine Daten", Toast.LENGTH_SHORT).show();
            return;
        }
        createRideThen(true, newRideId -> {
            Toast.makeText(activity, "✓ Fahrt angelegt", Toast.LENGTH_SHORT).show();
        });
    }

    private void handleEdit() {
        if (currentVorschlagId == null || currentExtracted == null) {
            Toast.makeText(activity, "Keine Daten", Toast.LENGTH_SHORT).show();
            return;
        }
        // 🆕 v6.66.246 (Patrick 05.10. 08:44 Bridge: "erstmal muss der Edit-Dialog sich oeffnen,
        //   damit ich DANACH die Fahrt anlegen kann"): Prefilled-Edit-Dialog OHNE Vorab-Anlage.
        //   Patrick kann korrigieren + Speichern (legt Fahrt an) oder Abbrechen (nichts).
        showPrefilledEditDialog();
    }

    @SuppressWarnings("unchecked")
    private void showPrefilledEditDialog() {
        android.content.Context ctx = activity;
        android.widget.LinearLayout root = new android.widget.LinearLayout(ctx);
        root.setOrientation(android.widget.LinearLayout.VERTICAL);
        int pad = (int) (ctx.getResources().getDisplayMetrics().density * 16);
        root.setPadding(pad, pad, pad, pad);

        // Felder bauen
        String phone = (String) currentVorschlag.get("callerPhone");
        String crmName = (String) currentVorschlag.get("crmCustomerName");
        String extractedName = (String) currentExtracted.get("name");
        String displayName = crmName != null ? crmName : (extractedName != null ? extractedName : "");

        android.widget.EditText etName = addEditText(root, "👤 Name", displayName);
        android.widget.EditText etPhone = addEditText(root, "📱 Telefon", phone != null ? phone : "");
        android.widget.EditText etPickup = addEditText(root, "📍 Abholort", (String) currentExtracted.get("pickup"));
        android.widget.EditText etDest = addEditText(root, "🎯 Zielort", (String) currentExtracted.get("destination"));

        // Pickup-Timestamp als Date-Zeit-String
        Object pickupTs = currentExtracted.get("pickupTimestamp");
        if (pickupTs instanceof Double) pickupTs = ((Double) pickupTs).longValue();
        if (pickupTs == null) pickupTs = System.currentTimeMillis() + 10 * 60 * 1000L;
        java.text.SimpleDateFormat sdf = new java.text.SimpleDateFormat("dd.MM.yyyy HH:mm", java.util.Locale.GERMAN);
        sdf.setTimeZone(java.util.TimeZone.getTimeZone("Europe/Berlin"));
        android.widget.EditText etTime = addEditText(root, "🕐 Pickup-Zeit (TT.MM.JJJJ HH:MM)", sdf.format(new java.util.Date((Long) pickupTs)));

        Object pax = currentExtracted.get("passengers");
        android.widget.EditText etPax = addEditText(root, "👥 Personen", pax != null ? String.valueOf(pax) : "1");
        Object preis = currentExtracted.get("festpreisEUR");
        android.widget.EditText etPreis = addEditText(root, "💰 Preis € (leer = Taxameter)", preis != null ? String.valueOf(preis) : "");
        android.widget.EditText etNotes = addEditText(root, "📝 Notiz", (String) currentExtracted.get("notes"));

        android.widget.ScrollView sv = new android.widget.ScrollView(ctx);
        sv.addView(root);

        new androidx.appcompat.app.AlertDialog.Builder(ctx)
            .setTitle("📞 Call-Vorschlag bearbeiten")
            .setView(sv)
            .setPositiveButton("✓ Fahrt anlegen", (d, w) -> {
                Map<String, Object> ride = new HashMap<>();
                String nameVal = etName.getText().toString().trim();
                String phoneVal = etPhone.getText().toString().trim();
                String pickupVal = etPickup.getText().toString().trim();
                String destVal = etDest.getText().toString().trim();
                String timeVal = etTime.getText().toString().trim();
                String paxVal = etPax.getText().toString().trim();
                String preisVal = etPreis.getText().toString().trim();
                String notesVal = etNotes.getText().toString().trim();

                long ts;
                try {
                    ts = sdf.parse(timeVal).getTime();
                } catch (Throwable t) {
                    Toast.makeText(activity, "⚠ Zeit-Format: TT.MM.JJJJ HH:MM", Toast.LENGTH_LONG).show();
                    return;
                }

                ride.put("pickupTimestamp", ts);
                ride.put("pickup", pickupVal);
                ride.put("destination", destVal);
                int paxInt = 1;
                try { paxInt = Integer.parseInt(paxVal); } catch (Throwable _ignore) {}
                ride.put("passengers", paxInt);
                if (!phoneVal.isEmpty()) {
                    ride.put("customerPhone", phoneVal);
                    ride.put("customerMobile", phoneVal);
                }
                ride.put("customerName", nameVal.isEmpty() ? "Call-Anrufer" : nameVal);
                String crmId = (String) currentVorschlag.get("crmCustomerId");
                if (crmId != null) ride.put("customerId", crmId);
                if (!preisVal.isEmpty()) {
                    ride.put("price", preisVal.replace(',', '.'));
                    ride.put("fixedPrice", true);
                }
                long now = System.currentTimeMillis();
                boolean sofort = ts - now < 5 * 60 * 1000L;
                ride.put("status", sofort ? "new" : "vorbestellt");
                ride.put("createdAt", now);
                ride.put("source", "call-vorschlag-v6.66.246");
                ride.put("vorschlagId", currentVorschlagId);
                if (!notesVal.isEmpty()) ride.put("notes", notesVal);

                FirebaseDatabase.getInstance(DB_URL).getReference("rides")
                    .push().setValue(ride, (err, ref) -> {
                        if (err != null) {
                            Toast.makeText(activity, "Fehler: " + err.getMessage(), Toast.LENGTH_LONG).show();
                            return;
                        }
                        Toast.makeText(activity, "✓ Fahrt angelegt", Toast.LENGTH_SHORT).show();
                        markVorschlagStatus("applied");
                    });
            })
            .setNegativeButton("Abbrechen", null)
            .show();
    }

    private android.widget.EditText addEditText(android.widget.LinearLayout root, String hint, String value) {
        android.widget.TextView lbl = new android.widget.TextView(root.getContext());
        lbl.setText(hint);
        lbl.setTextColor(0xFFcbd5e1);
        lbl.setTextSize(13);
        int topMargin = (int)(root.getContext().getResources().getDisplayMetrics().density * 8);
        android.widget.LinearLayout.LayoutParams lp = new android.widget.LinearLayout.LayoutParams(
            android.widget.LinearLayout.LayoutParams.MATCH_PARENT, android.widget.LinearLayout.LayoutParams.WRAP_CONTENT);
        lp.topMargin = topMargin;
        lbl.setLayoutParams(lp);
        root.addView(lbl);
        android.widget.EditText et = new android.widget.EditText(root.getContext());
        et.setText(value != null ? value : "");
        et.setSingleLine(true);
        root.addView(et);
        return et;
    }

    @SuppressWarnings("unchecked")
    private void createRideThen(boolean markApplied, java.util.function.Consumer<String> onDone) {
        if (currentExtracted == null) return;
        Map<String, Object> ride = buildRideFromExtracted();
        if (ride == null) return;
        com.google.firebase.database.DatabaseReference ref = FirebaseDatabase.getInstance(DB_URL).getReference("rides").push();
        final String newId = ref.getKey();
        ref.setValue(ride, (err, r) -> {
            if (err != null) {
                Toast.makeText(activity, "Fehler: " + err.getMessage(), Toast.LENGTH_LONG).show();
                return;
            }
            if (markApplied) markVorschlagStatus("applied");
            if (onDone != null && newId != null) onDone.accept(newId);
        });
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> buildRideFromExtracted() {
        Map<String, Object> ride = new HashMap<>();
        Object pickupTs = currentExtracted.get("pickupTimestamp");
        if (pickupTs instanceof Double) pickupTs = ((Double) pickupTs).longValue();
        if (pickupTs == null) pickupTs = System.currentTimeMillis() + 10 * 60 * 1000L;
        ride.put("pickupTimestamp", pickupTs);
        ride.put("pickup", currentExtracted.get("pickup"));
        ride.put("destination", currentExtracted.get("destination"));
        Object pax = currentExtracted.get("passengers");
        ride.put("passengers", pax != null ? pax : 1);
        String phone = (String) currentVorschlag.get("callerPhone");
        if (phone != null) {
            ride.put("customerPhone", phone);
            ride.put("customerMobile", phone);
        }
        String crmName = (String) currentVorschlag.get("crmCustomerName");
        String name = (String) currentExtracted.get("name");
        ride.put("customerName", crmName != null ? crmName : (name != null ? name : "Call-Anrufer"));
        String crmId = (String) currentVorschlag.get("crmCustomerId");
        if (crmId != null) ride.put("customerId", crmId);
        Object preis = currentExtracted.get("festpreisEUR");
        if (preis != null) {
            ride.put("price", String.valueOf(preis));
            ride.put("fixedPrice", true);
        }
        long now = System.currentTimeMillis();
        long tsLong = pickupTs instanceof Long ? (Long) pickupTs : ((Double) pickupTs).longValue();
        boolean sofort = tsLong - now < 5 * 60 * 1000L;
        ride.put("status", sofort ? "new" : "vorbestellt");
        ride.put("createdAt", now);
        ride.put("source", "call-vorschlag-v6.66.245");
        ride.put("vorschlagId", currentVorschlagId);
        String notes = (String) currentExtracted.get("notes");
        if (notes != null) ride.put("notes", notes);
        return ride;
    }

    private void handleDismiss() {
        if (currentVorschlagId == null) return;
        markVorschlagStatus("dismissed");
        Toast.makeText(activity, "Vorschlag verworfen", Toast.LENGTH_SHORT).show();
    }

    private void markVorschlagStatus(String status) {
        if (currentVorschlagId == null) return;
        FirebaseDatabase.getInstance(DB_URL).getReference("dispoVorschlaege/" + currentVorschlagId + "/status").setValue(status);
    }
}
