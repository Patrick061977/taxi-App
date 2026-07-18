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

// v6.63.090 (Patrick 02.06. 18:32): Vorschau + editierbarer Email-Body vor Versand.
// v6.63.598 (Patrick 04.07.): EXTRA_MODE="invoice" → Rechnung-an-Auftraggeber-Pfad:
//   - Kein Stripe/Tracking-Toggle (versteckt)
//   - Body aus Rechnungs- + Fahrtdaten
//   - POST an sendInvoiceEmail statt sendRideConfirmationEmail
public class EmailPreviewActivity extends AppCompatActivity {

    private static final String TAG = "EmailPreview";
    public static final String EXTRA_RIDE_ID = "rideId";
    public static final String EXTRA_MODE = "mode";
    public static final String MODE_INVOICE = "invoice";
    public static final String EXTRA_INVOICE_KEY = "invoiceKey";
    private static final String DB_URL = "https://taxi-heringsdorf-default-rtdb.europe-west1.firebasedatabase.app";
    private static final String ENDPOINT_CONFIRM = "https://europe-west1-taxi-heringsdorf.cloudfunctions.net/sendRideConfirmationEmail";
    private static final String ENDPOINT_INVOICE = "https://europe-west1-taxi-heringsdorf.cloudfunctions.net/sendInvoiceEmail";

    private EditText etTo, etSubject, etBody;
    private CheckBox cbStripe, cbTracking;
    private Button btnSend, btnCancel;
    private TextView tvStatus;
    private String rideId;
    private String invoiceKey;   // Firebase-Key in /invoices (Fallback wenn kein rideId)
    private String prefillPdfUrl; // pdfUrl direkt aus InvoicesActivity übergeben
    private double ridePrice = 0;
    private boolean isInvoiceMode;
    private String invoiceNumber;
    private String invoicePdfUrl;

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
        invoiceKey = getIntent().getStringExtra(EXTRA_INVOICE_KEY);
        prefillPdfUrl = getIntent().getStringExtra("prefillPdfUrl");
        if (prefillPdfUrl == null) prefillPdfUrl = "";
        isInvoiceMode = MODE_INVOICE.equals(getIntent().getStringExtra(EXTRA_MODE));

        if (rideId == null && invoiceKey == null) {
            Toast.makeText(this, "Fehler: keine Ride-ID oder Rechnungsschlüssel", Toast.LENGTH_LONG).show();
            finish();
            return;
        }

        if (isInvoiceMode) {
            cbStripe.setVisibility(android.view.View.GONE);
            cbTracking.setVisibility(android.view.View.GONE);
            if (getSupportActionBar() != null) getSupportActionBar().setTitle("Rechnung senden");
        }

        btnCancel.setOnClickListener(v -> finish());
        btnSend.setOnClickListener(v -> sendEmail());
        // v6.63.732 (Patrick 18.07. 12:55 Bridge): PDF-Vorschau ohne Download.
        //   Chrome Custom Tab oeffnet die pdfUrl direkt inline (kein separater PDF-Viewer noetig).
        btnSend.setOnLongClickListener(v -> { openPdfPreview(); return true; });
        // Zusaetzlich einen dedizierten Button in die Status-TextView anhaengen via Aktion.
        tvStatus.setOnClickListener(v -> openPdfPreview());

        loadRideData();
    }

    private void openPdfPreview() {
        if (invoicePdfUrl == null || invoicePdfUrl.isEmpty()) {
            Toast.makeText(this, "PDF noch nicht bereit — Cloud-Function generiert gerade...", Toast.LENGTH_LONG).show();
            return;
        }
        // v6.63.733 (Patrick 18.07. 13:48 Bridge): Android laedt PDF-URLs automatisch runter.
        //   Google Docs Viewer wrappt die URL und zeigt PDF inline im Chrome Tab statt
        //   Download-Aufforderung.
        String _viewerUrl;
        try {
            _viewerUrl = "https://docs.google.com/viewer?url="
                + java.net.URLEncoder.encode(invoicePdfUrl, "UTF-8")
                + "&embedded=true";
        } catch (Exception e) { _viewerUrl = invoicePdfUrl; }
        try {
            new androidx.browser.customtabs.CustomTabsIntent.Builder()
                .setShowTitle(true)
                .build()
                .launchUrl(this, android.net.Uri.parse(_viewerUrl));
        } catch (android.content.ActivityNotFoundException e) {
            startActivity(new Intent(Intent.ACTION_VIEW, android.net.Uri.parse(_viewerUrl)));
        }
    }

    private void loadRideData() {
        tvStatus.setText("Lade Daten...");
        if (rideId != null) {
            loadFromRide();
        } else {
            loadFromInvoice(invoiceKey);
        }
    }

    // v6.63.635: Direkt aus /invoices/{key} laden wenn kein rideId vorhanden
    private void loadFromInvoice(String key) {
        FirebaseDatabase.getInstance(DB_URL).getReference("invoices/" + key)
            .addListenerForSingleValueEvent(new ValueEventListener() {
                @Override public void onDataChange(DataSnapshot snap) {
                    if (!snap.exists()) { tvStatus.setText("⚠️ Rechnung nicht gefunden"); return; }
                    invoiceNumber = strVal(snap.child("invoiceNumber").getValue());
                    if (invoiceNumber.isEmpty()) invoiceNumber = key;
                    invoicePdfUrl = strVal(snap.child("pdfUrl").getValue());
                    if (invoicePdfUrl.isEmpty() && !prefillPdfUrl.isEmpty()) invoicePdfUrl = prefillPdfUrl;
                    String email = strVal(snap.child("customerEmail").getValue());
                    if (email.isEmpty()) {
                        String prefillE = getIntent().getStringExtra("prefillEmail");
                        if (prefillE != null && !prefillE.isEmpty()) email = prefillE;
                    }
                    String name = strVal(snap.child("customerName").getValue());
                    if (name.isEmpty()) name = strVal(snap.child("guestName").getValue());
                    String guestName = strVal(snap.child("guestName").getValue());
                    String pickup = strVal(snap.child("pickup").getValue());
                    String dest = strVal(snap.child("destination").getValue());
                    String price = String.format(Locale.GERMANY, "%.2f", dblVal(snap.child("totalGross").getValue()));
                    String dateStr = strVal(snap.child("invoiceDate").getValue());
                    String dateTimeStr = dateStr.isEmpty() ? "—" : dateStr;
                    etTo.setText(email);
                    buildInvoiceBody(name, guestName, pickup, dest, dateTimeStr, price, invoiceNumber, email, null);
                }
                @Override public void onCancelled(DatabaseError err) {
                    tvStatus.setText("⚠️ DB-Fehler: " + err.getMessage());
                }
            });
    }

    // v6.63.732 (Patrick 18.07. 12:55 Bridge): live-Listener statt SingleValue.
    //   Wenn EmailPreview direkt nach Fahrt-Abschluss auf invoiceNumber wartet, muss
    //   der Listener beim asynchronen Rechnungs-Anlegen (Cloud-Function ~5s) refreshen.
    private ValueEventListener _rideLive;
    private void loadFromRide() {
        _rideLive = new ValueEventListener() {
                @Override public void onDataChange(DataSnapshot snap) {
                    if (!snap.exists()) {
                        if (invoiceKey != null) { loadFromInvoice(invoiceKey); return; }
                        tvStatus.setText("⚠️ Ride nicht gefunden");
                        return;
                    }
                    String email = strVal(snap.child("customerEmail").getValue());
                    String name = strVal(snap.child("customerName").getValue());
                    String guestName = strVal(snap.child("guestName").getValue());
                    String pickup = strVal(snap.child("pickup").getValue());
                    String dest = strVal(snap.child("destination").getValue());
                    Long pickupTs = longVal(snap.child("pickupTimestamp").getValue());
                    Integer pax = intVal(snap.child("passengers").getValue());
                    String price = strVal(snap.child("price").getValue());
                    String vehicleName = strVal(snap.child("vehicle").getValue());
                    String vehiclePlate = strVal(snap.child("vehiclePlate").getValue());
                    invoiceNumber = strVal(snap.child("invoiceNumber").getValue());
                    invoicePdfUrl = strVal(snap.child("invoicePdfUrl").getValue());
                    ridePrice = parsePrice(price);

                    // v6.63.635: prefillPdfUrl als Fallback wenn ride.invoicePdfUrl leer
                    if (invoicePdfUrl.isEmpty() && !prefillPdfUrl.isEmpty()) invoicePdfUrl = prefillPdfUrl;

                    // prefillEmail-Fallback
                    if (email == null || email.isEmpty()) {
                        String prefillE = getIntent().getStringExtra("prefillEmail");
                        if (prefillE != null && !prefillE.isEmpty()) email = prefillE;
                    }
                    etTo.setText(email);

                    String dateTimeStr = "—";
                    if (pickupTs != null && pickupTs > 0) {
                        SimpleDateFormat fmt = new SimpleDateFormat("EEEE, dd.MM.yyyy 'um' HH:mm 'Uhr'", Locale.GERMANY);
                        fmt.setTimeZone(java.util.TimeZone.getTimeZone("Europe/Berlin"));
                        dateTimeStr = fmt.format(new Date(pickupTs));
                    }

                    if (isInvoiceMode) {
                        // v6.63.635: Invoice pdfUrl nachladen wenn aus Ride leer
                        final String _email = email;
                        if (invoicePdfUrl.isEmpty() && !invoiceNumber.isEmpty()) {
                            FirebaseDatabase.getInstance(DB_URL)
                                .getReference("invoices/" + invoiceNumber + "/pdfUrl").get()
                                .addOnSuccessListener(s -> { String u = strVal(s.getValue()); if (!u.isEmpty()) invoicePdfUrl = u; });
                        }
                        buildInvoiceBody(name, guestName, pickup, dest, dateTimeStr, price, invoiceNumber, _email, pickupTs);
                    } else {
                        buildConfirmationBody(name, email, pickup, dest, dateTimeStr, pax, price, vehicleName, vehiclePlate, pickupTs);
                    }
                }
                @Override public void onCancelled(DatabaseError err) {
                    tvStatus.setText("⚠️ DB-Fehler: " + err.getMessage());
                }
            };
        FirebaseDatabase.getInstance(DB_URL).getReference("rides/" + rideId).addValueEventListener(_rideLive);
    }
    @Override protected void onDestroy() {
        super.onDestroy();
        if (_rideLive != null) {
            try { FirebaseDatabase.getInstance(DB_URL).getReference("rides/" + rideId).removeEventListener(_rideLive); } catch (Throwable _ignore) {}
        }
    }

    private void buildConfirmationBody(String name, String email, String pickup, String dest,
            String dateTimeStr, Integer pax, String price, String vehicleName, String vehiclePlate, Long pickupTs) {
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

    private void buildInvoiceBody(String name, String guestName, String pickup, String dest,
            String dateTimeStr, String price, String invNumber, String email, Long pickupTs) {
        String displayName = !TextUtils.isEmpty(name) ? name : "Damen und Herren";
        String lastName = displayName;
        String[] parts = displayName.split("\\s+");
        if (parts.length > 0) lastName = parts[parts.length - 1];

        String subject = "Rechnung " + (TextUtils.isEmpty(invNumber) ? "" : invNumber) + " – Funk Taxi Heringsdorf";
        etSubject.setText(subject);

        StringBuilder body = new StringBuilder();
        body.append("Sehr geehrte Damen und Herren ").append(lastName).append(",\n\n");
        body.append("vielen Dank für Ihre Buchung. Im Anhang erhalten Sie Ihre Rechnung");
        if (!TextUtils.isEmpty(invNumber)) body.append(" Nr. ").append(invNumber);
        body.append(" für die durchgeführte Fahrt.\n\n");
        body.append("━━━ Fahrtendetails ━━━\n");
        body.append("Datum:    ").append(dateTimeStr).append("\n");
        if (!TextUtils.isEmpty(pickup)) body.append("Von:      ").append(pickup).append("\n");
        if (!TextUtils.isEmpty(dest))   body.append("Nach:     ").append(dest).append("\n");
        String fahrgast = !TextUtils.isEmpty(guestName) ? guestName : (!TextUtils.isEmpty(name) ? name : "");
        if (!TextUtils.isEmpty(fahrgast)) body.append("Fahrgast: ").append(fahrgast).append("\n");
        if (!TextUtils.isEmpty(price))  body.append("Betrag:   ").append(price).append(" €\n");
        body.append("━━━━━━━━━━━━━━━━━━━━━\n\n");
        body.append("Bei Fragen stehen wir Ihnen gerne zur Verfügung.\n\n");
        body.append("Mit freundlichen Grüßen\n");
        body.append("Patrick Wydra\n");
        body.append("Funk Taxi Heringsdorf\n");
        body.append("Telefon: 038378 / 22022\n");
        body.append("E-Mail: Taxiwydra@googlemail.com");

        etBody.setText(body.toString());
        // 🆕 v6.63.639: PDF-Status anzeigen damit klar ist ob Anhang dabei ist
        String _pdfInfo = !TextUtils.isEmpty(invoicePdfUrl)
            ? "📎 Rechnung " + (TextUtils.isEmpty(invNumber) ? "" : invNumber) + ".pdf wird angehängt"
            : "⚠️ Kein PDF gefunden — Anhang fehlt. Bitte zuerst Rechnung erstellen.";
        tvStatus.setText("✅ Vorschau bereit — lies durch, passe an, dann SENDEN.\n" + _pdfInfo);
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

        if (!isInvoiceMode) {
            final boolean withStripe = cbStripe.isChecked();
            final boolean withTracking = cbTracking.isChecked();
            if (withStripe && ridePrice < 0.5) {
                Toast.makeText(this, "Stripe-Link nicht möglich (Preis fehlt oder < 0,50 €)", Toast.LENGTH_LONG).show();
                return;
            }
            btnSend.setEnabled(false);
            btnSend.setText("Sende…");
            tvStatus.setText("📤 Übertrage an Server…");
            sendConfirmationEmail(to, subject, bodyPlain, withStripe, withTracking);
        } else {
            if (TextUtils.isEmpty(invoiceNumber)) {
                Toast.makeText(this, "Keine Rechnungsnummer — Rechnung zuerst erstellen", Toast.LENGTH_LONG).show();
                return;
            }
            btnSend.setEnabled(false);
            btnSend.setText("Sende…");
            tvStatus.setText("📤 Übertrage Rechnung an Server…");
            sendInvoiceEmail(to, subject, bodyPlain);
        }
    }

    private void sendConfirmationEmail(String to, String subject, String bodyPlain, boolean withStripe, boolean withTracking) {
        final String htmlBody = toHtml(bodyPlain);
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
                postAndFinish(ENDPOINT_CONFIRM, payload);
            } catch (Throwable t) {
                onSendError(t.getMessage());
            }
        }).start();
    }

    private void sendInvoiceEmail(String to, String subject, String bodyPlain) {
        final String htmlBody = toHtml(bodyPlain);
        new Thread(() -> {
            try {
                JSONObject payload = new JSONObject();
                payload.put("invoiceNumber", invoiceNumber);
                payload.put("toEmail", to);
                payload.put("subject", subject);
                payload.put("htmlBody", htmlBody);
                payload.put("textBody", bodyPlain);
                if (!TextUtils.isEmpty(invoicePdfUrl)) {
                    payload.put("pdfUrl", invoicePdfUrl);
                    payload.put("attachPdf", true);
                }
                postAndFinish(ENDPOINT_INVOICE, payload);
            } catch (Throwable t) {
                onSendError(t.getMessage());
            }
        }).start();
    }

    private void postAndFinish(String endpointUrl, JSONObject payload) throws Exception {
        URL url = new URL(endpointUrl);
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
    }

    private void onSendError(String msg) {
        Log.e(TAG, "send fail: " + msg);
        runOnUiThread(() -> {
            Toast.makeText(this, "Fehler: " + msg, Toast.LENGTH_LONG).show();
            tvStatus.setText("⚠️ Verbindungs-Fehler: " + msg);
            btnSend.setEnabled(true);
            btnSend.setText("📧 EMAIL JETZT SENDEN");
        });
    }

    private static String toHtml(String plain) {
        return "<html><body style=\"font-family:Arial,sans-serif;color:#333;max-width:680px;margin:0 auto;line-height:1.5;\">"
                + "<pre style=\"font-family:Arial,sans-serif;white-space:pre-wrap;font-size:14px;\">"
                + plain.replace("<", "&lt;").replace(">", "&gt;")
                + "</pre></body></html>";
    }

    private static String strVal(Object v) { return v == null ? "" : String.valueOf(v); }
    private static double dblVal(Object v) {
        if (v == null) return 0;
        try { return v instanceof Number ? ((Number) v).doubleValue() : Double.parseDouble(String.valueOf(v)); } catch (Throwable t) { return 0; }
    }
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
