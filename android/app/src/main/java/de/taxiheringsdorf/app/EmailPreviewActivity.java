package de.taxiheringsdorf.app;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.text.TextUtils;
import android.util.Log;
import android.widget.*;
import androidx.appcompat.app.AppCompatActivity;
import com.google.firebase.database.*;
import org.json.JSONObject;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

// v6.63.090 (Patrick 02.06. 18:32 "wäre nicht schlecht wenn ich nochmal Korrektur-Mail bekomme
//   bevor versendet wird. Dass man das aufmachen kann + alles nochmal durchlesen + irgendwo
//   einstellen mit Stripe-Code verschicken oder ohne"):
//
// EmailPreviewActivity öffnet sich vor dem Versand einer Auftragsbestätigung.
// Patrick liest Empfänger/Betreff/Body, toggelt "Mit Stripe-Vorkasse-Link" + "Tracking-Link",
// kann beliebig editieren — dann erst Klick auf "EMAIL SENDEN".
//
// Wird gestartet von AdminDashboardActivity (z.B. Anfrage-Übernahme-Dialog) mit EXTRA_RIDE_ID.
// Initial werden Body+Subject aus den Ride-/Customer-Daten generiert. Bei Senden POST an
// Cloud-Function sendRideConfirmationEmail mit dem freigegebenen Body.
public class EmailPreviewActivity extends AppCompatActivity {

    private static final String TAG = "EmailPreview";
    public static final String EXTRA_RIDE_ID = "rideId";
    private static final String DB_URL = "https://taxi-heringsdorf-default-rtdb.europe-west1.firebasedatabase.app";
    private static final String ENDPOINT_URL = "https://europe-west1-taxi-heringsdorf.cloudfunctions.net/sendRideConfirmationEmail";

    private EditText etTo, etSubject, etBody;
    private CheckBox cbStripe, cbTracking;
    private Button btnSend, btnCancel;
    private TextView tvStatus;
    private String rideId;
    private double ridePrice = 0;

    @Override
    protected void onCreate(Bundle s) {
        super.onCreate(s);
        setContentView(R.layout.activity_email_preview);
        etTo = findViewById(R.id.etEmailTo);
        etSubject = findViewById(R.id.etEmailSubject);
        etBody = findViewById(R.id.etEmailBody);
        cbStripe = findViewById(R.id.cbIncludeStripe);
        cbTracking = findViewById(R.id.cbIncludeTracking);
        btnSend = findViewById(R.id.btnEmailSend);
        btnCancel = findViewById(R.id.btnEmailCancel);
        tvStatus = findViewById(R.id.tvEmailStatus);

        rideId = getIntent().getStringExtra(EXTRA_RIDE_ID);
        if (rideId == null) {
            Toast.makeText(this, "Fehler: keine Ride-ID", Toast.LENGTH_LONG).show();
            finish();
            return;
        }

        btnCancel.setOnClickListener(v -> finish());
        btnSend.setOnClickListener(v -> sendEmail());

        loadRideData();
    }

    private void loadRideData() {
        tvStatus.setText("Lade Fahrt-Daten...");
        FirebaseDatabase.getInstance(DB_URL).getReference("rides/" + rideId)
            .addListenerForSingleValueEvent(new ValueEventListener() {
                @Override public void onDataChange(DataSnapshot snap) {
                    if (!snap.exists()) {
                        tvStatus.setText("⚠️ Ride nicht gefunden");
                        return;
                    }
                    String email = strVal(snap.child("customerEmail").getValue());
                    String name = strVal(snap.child("customerName").getValue());
                    String pickup = strVal(snap.child("pickup").getValue());
                    String dest = strVal(snap.child("destination").getValue());
                    Long pickupTs = longVal(snap.child("pickupTimestamp").getValue());
                    Integer pax = intVal(snap.child("passengers").getValue());
                    String price = strVal(snap.child("price").getValue());
                    String vehicleName = strVal(snap.child("vehicle").getValue());
                    String vehiclePlate = strVal(snap.child("vehiclePlate").getValue());
                    ridePrice = parsePrice(price);

                    etTo.setText(email);

                    // v6.63.090: Datum IMMER aus pickupTimestamp formatieren — NIE pickupTime allein
                    // (verhindert Olaf-Bug 02.06. statt 27.06.).
                    String dateTimeStr = "—";
                    if (pickupTs != null && pickupTs > 0) {
                        SimpleDateFormat fmt = new SimpleDateFormat("EEEE, dd.MM.yyyy 'um' HH:mm 'Uhr'", Locale.GERMANY);
                        fmt.setTimeZone(java.util.TimeZone.getTimeZone("Europe/Berlin"));
                        dateTimeStr = fmt.format(new Date(pickupTs));
                    }

                    String subject = "Funk Taxi Heringsdorf — Auftragsbestätigung " + (pickupTs != null && pickupTs > 0
                            ? new SimpleDateFormat("dd.MM.yyyy HH:mm", Locale.GERMANY).format(new Date(pickupTs))
                            : "");
                    etSubject.setText(subject);

                    StringBuilder body = new StringBuilder();
                    body.append("Sehr geehrte Damen und Herren");
                    if (!TextUtils.isEmpty(name)) {
                        String[] parts = name.split("\\s+");
                        if (parts.length > 0) body.append(" ").append(parts[parts.length - 1]);
                    }
                    body.append(",\n\n");
                    body.append("vielen Dank für Ihre Buchung bei Funk Taxi Heringsdorf. Hiermit bestätigen wir Ihre Fahrt:\n\n");
                    body.append("Datum / Uhrzeit:  ").append(dateTimeStr).append("\n");
                    if (!TextUtils.isEmpty(pickup)) body.append("Abholort:         ").append(pickup).append("\n");
                    if (!TextUtils.isEmpty(dest))   body.append("Zielort:          ").append(dest).append("\n");
                    if (pax != null && pax > 0)     body.append("Personen:         ").append(pax).append("\n");
                    if (!TextUtils.isEmpty(vehicleName)) {
                        body.append("Fahrzeug:         ").append(vehicleName);
                        if (!TextUtils.isEmpty(vehiclePlate)) body.append(" (").append(vehiclePlate).append(")");
                        body.append("\n");
                    }
                    if (!TextUtils.isEmpty(price)) body.append("Fahrpreis:        ").append(price).append(" €\n");
                    body.append("\nBei Änderungswünschen oder Fragen melden Sie sich bitte unverzüglich.\n\n");
                    body.append("Mit freundlichen Grüßen\n");
                    body.append("Patrick Wydra\n");
                    body.append("Funk Taxi Heringsdorf\n");
                    body.append("Telefon: 038378 / 22022\n");
                    body.append("E-Mail: Taxiwydra@googlemail.com");

                    etBody.setText(body.toString());
                    tvStatus.setText("✅ Daten geladen. Lies durch, ergänze ggf., dann SENDEN.");
                }
                @Override public void onCancelled(DatabaseError err) {
                    tvStatus.setText("⚠️ DB-Fehler: " + err.getMessage());
                }
            });
    }

    private void sendEmail() {
        final String to = etTo.getText().toString().trim();
        final String subject = etSubject.getText().toString().trim();
        final String bodyPlain = etBody.getText().toString().trim();
        if (TextUtils.isEmpty(to) || !to.contains("@")) {
            Toast.makeText(this, "Empfänger-Email fehlt oder ungültig", Toast.LENGTH_LONG).show();
            return;
        }
        if (TextUtils.isEmpty(subject) || TextUtils.isEmpty(bodyPlain)) {
            Toast.makeText(this, "Betreff und Text dürfen nicht leer sein", Toast.LENGTH_LONG).show();
            return;
        }
        final boolean withStripe = cbStripe.isChecked();
        final boolean withTracking = cbTracking.isChecked();
        if (withStripe && ridePrice < 0.5) {
            Toast.makeText(this, "Stripe-Link nicht möglich (Preis fehlt oder < 0,50 €)", Toast.LENGTH_LONG).show();
            return;
        }
        btnSend.setEnabled(false);
        btnSend.setText("Sende…");
        tvStatus.setText("📤 Übertrage an Server…");

        // Plain-Text in einfaches HTML wandeln
        final String htmlBody = "<html><body style=\"font-family:Arial,sans-serif;color:#333;max-width:680px;margin:0 auto;line-height:1.5;\">"
                + "<pre style=\"font-family:Arial,sans-serif;white-space:pre-wrap;font-size:14px;\">"
                + bodyPlain.replace("<", "&lt;").replace(">", "&gt;")
                + "</pre></body></html>";

        new Thread(() -> {
            try {
                JSONObject payload = new JSONObject();
                payload.put("rideId", rideId);
                payload.put("toEmail", to);
                payload.put("subject", subject);
                payload.put("htmlBody", htmlBody);
                payload.put("textBody", bodyPlain);
                payload.put("includeStripeLink", withStripe);
                payload.put("includeTrackingLink", withTracking);

                URL url = new URL(ENDPOINT_URL);
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod("POST");
                conn.setRequestProperty("Content-Type", "application/json");
                conn.setConnectTimeout(15000);
                conn.setReadTimeout(45000);
                conn.setDoOutput(true);
                try (OutputStream os = conn.getOutputStream()) {
                    os.write(payload.toString().getBytes("UTF-8"));
                }
                int code = conn.getResponseCode();
                java.io.BufferedReader br = new java.io.BufferedReader(new java.io.InputStreamReader(
                        code >= 200 && code < 300 ? conn.getInputStream() : conn.getErrorStream(), "UTF-8"));
                StringBuilder sb = new StringBuilder();
                String line;
                while ((line = br.readLine()) != null) sb.append(line);
                br.close();
                conn.disconnect();

                final boolean ok = code >= 200 && code < 300;
                final String resp = sb.toString();
                runOnUiThread(() -> {
                    if (ok) {
                        Toast.makeText(this, "✅ Email versendet", Toast.LENGTH_LONG).show();
                        tvStatus.setText("✅ Versendet — schließe in 2 Sek…");
                        setResult(Activity.RESULT_OK);
                        new android.os.Handler().postDelayed(this::finish, 1800);
                    } else {
                        Toast.makeText(this, "Fehler: " + resp, Toast.LENGTH_LONG).show();
                        tvStatus.setText("⚠️ Fehler HTTP " + code + ": " + resp);
                        btnSend.setEnabled(true);
                        btnSend.setText("📧 EMAIL JETZT SENDEN");
                    }
                });
            } catch (Throwable t) {
                Log.e(TAG, "send fail", t);
                runOnUiThread(() -> {
                    Toast.makeText(this, "Fehler: " + t.getMessage(), Toast.LENGTH_LONG).show();
                    tvStatus.setText("⚠️ Verbindungs-Fehler: " + t.getMessage());
                    btnSend.setEnabled(true);
                    btnSend.setText("📧 EMAIL JETZT SENDEN");
                });
            }
        }).start();
    }

    private static String strVal(Object v) { return v == null ? "" : String.valueOf(v); }
    private static Long longVal(Object v) {
        if (v == null) return null;
        try { return v instanceof Number ? ((Number) v).longValue() : Long.parseLong(String.valueOf(v)); } catch (Throwable t) { return null; }
    }
    private static Integer intVal(Object v) {
        if (v == null) return null;
        try { return v instanceof Number ? ((Number) v).intValue() : Integer.parseInt(String.valueOf(v)); } catch (Throwable t) { return null; }
    }
    private static double parsePrice(String s) {
        if (TextUtils.isEmpty(s)) return 0;
        try { return Double.parseDouble(s.replace(",", ".").replaceAll("[^0-9.]", "")); } catch (Throwable t) { return 0; }
    }
}
