package de.taxiheringsdorf.app;

import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Bundle;
import android.text.Editable;
import android.text.InputType;
import android.text.TextWatcher;
import android.util.Log;
import android.widget.*;
import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;
import com.google.android.material.button.MaterialButton;
import com.google.firebase.database.*;
import java.text.SimpleDateFormat;
import java.util.*;

// 🆕 v6.63.599 (Patrick 04.07.): Rechnungen-Übersicht + Bearbeiten + Senden
// v6.63.600: Ladelogik auf 3 parallele Queries (invoiceDate + createdAt + $key-Range)
//   damit sowohl auto-erstellte als auch manuell erstellte Rechnungen erscheinen.
public class InvoicesActivity extends AppCompatActivity {

    private static final String DB_URL = "https://taxi-heringsdorf-default-rtdb.europe-west1.firebasedatabase.app";

    private LinearLayout llList;
    private TextView tvStatus;
    private MaterialButton btnRefresh;
    private EditText etSearch;
    private final List<InvItem> allItems = new ArrayList<>();
    // v6.63.735 (Patrick 18.07. Bridge): Status-Filter-Chips + KPI-Dashboard.
    private String _activeFilter = "all"; // all | open | overdue | paid
    private LinearLayout _chipRow;
    private LinearLayout _kpiRow;
    private TextView _chipAll, _chipOpen, _chipOverdue, _chipPaid;
    private TextView _kpiOpen, _kpiOverdue, _kpiMonth;

    private static class InvItem {
        String key, invNr, rideId, custName, custEmail, custId, date, pdfUrl, payStatus;
        // v6.63.754 (Patrick 20.07. Bridge): Zahlungsart in Rechnung editierbar
        String paymentMethod;
        double gross;
        long sortTs;
    }

    @Override
    protected void onCreate(Bundle s) {
        super.onCreate(s);
        setContentView(R.layout.activity_invoices);
        llList = findViewById(R.id.llInvoicesList);
        tvStatus = findViewById(R.id.tvInvoicesStatus);
        btnRefresh = findViewById(R.id.btnInvoicesRefresh);
        etSearch = findViewById(R.id.etInvoicesSearch);

        btnRefresh.setOnClickListener(v -> loadInvoices());
        etSearch.addTextChangedListener(new TextWatcher() {
            public void beforeTextChanged(CharSequence s,int a,int b,int c){}
            public void onTextChanged(CharSequence s,int a,int b,int c){ renderList(s.toString().toLowerCase(Locale.GERMANY).trim()); }
            public void afterTextChanged(Editable s){}
        });
        loadInvoices();
    }

    private void loadInvoices() {
        tvStatus.setText("Lade Rechnungen...");
        llList.removeAllViews();
        allItems.clear();
        btnRefresh.setEnabled(false);
        final DatabaseReference ref = FirebaseDatabase.getInstance(DB_URL).getReference("invoices");
        final int[] done = {0};
        final Set<String> seen = new HashSet<>();

        Runnable checkDone = () -> {
            done[0]++;
            if (done[0] < 2) return;
            // Alle geladen — sortieren + rendern
            allItems.sort((a, b) -> Long.compare(b.sortTs, a.sortTs));
            String filter = etSearch != null ? etSearch.getText().toString().toLowerCase(Locale.GERMANY).trim() : "";
            tvStatus.setText(allItems.size() + " Rechnungen geladen");
            btnRefresh.setEnabled(true);
            renderList(filter);
        };

        // v6.63.609: .get() statt addListenerForSingleValueEvent — erzwingt Server-Lese,
        //   verhindert veraltete In-Memory-Cache-Werte (z.B. 7€ statt 10€ nach REST-Patch).
        // Query 1: nach invoiceDate (auto-erstellte Rechnungen, ISO-String sortierbar)
        ref.orderByChild("invoiceDate").startAt("2026-01-01").limitToLast(80).get()
            .addOnSuccessListener(snap -> {
                for (DataSnapshot c : snap.getChildren()) {
                    if (!seen.contains(c.getKey())) {
                        seen.add(c.getKey());
                        InvItem item = parse(c);
                        if (item != null) allItems.add(item);
                    }
                }
                runOnUiThread(checkDone);
            })
            .addOnFailureListener(e -> { Log.w("InvoicesActivity", "Query1 failed: " + e.getMessage()); runOnUiThread(checkDone); });

        // Query 2: nach createdAt (manuell erstellte Rechnungen, Unix-Timestamp)
        ref.orderByChild("createdAt").startAt(1.0).limitToLast(50).get()
            .addOnSuccessListener(snap -> {
                for (DataSnapshot c : snap.getChildren()) {
                    if (!seen.contains(c.getKey())) {
                        seen.add(c.getKey());
                        InvItem item = parse(c);
                        if (item != null) allItems.add(item);
                    }
                }
                runOnUiThread(checkDone);
            })
            .addOnFailureListener(e -> { Log.w("InvoicesActivity", "Query2 failed: " + e.getMessage()); runOnUiThread(checkDone); });
    }

    private InvItem parse(DataSnapshot c) {
        InvItem item = new InvItem();
        item.key      = c.getKey();
        item.invNr    = strVal(c.child("invoiceNumber").getValue());
        if (item.invNr.isEmpty()) item.invNr = item.key;
        item.rideId   = strVal(c.child("rideId").getValue());
        item.custName = strVal(c.child("customerName").getValue());
        if (item.custName.isEmpty()) item.custName = strVal(c.child("guestName").getValue());
        item.custEmail = strVal(c.child("customerEmail").getValue());
        item.date     = strVal(c.child("invoiceDate").getValue());
        item.pdfUrl   = strVal(c.child("pdfUrl").getValue());
        item.payStatus = strVal(c.child("paymentStatus").getValue());
        item.gross    = dblVal(c.child("totalGross").getValue());
        item.custId   = strVal(c.child("customerId").getValue());
        item.paymentMethod = strVal(c.child("paymentMethod").getValue());
        // Sortier-Timestamp: createdAt > invoiceDate-parsed > autoCreatedAt
        long createdAt = longVal(c.child("createdAt").getValue());
        long autoCreated = longVal(c.child("autoCreatedAt").getValue());
        item.sortTs = createdAt > 0 ? createdAt : (autoCreated > 0 ? autoCreated : parseDateMs(item.date));
        return item;
    }

    private void renderList(String filter) {
        llList.removeAllViews();
        float dp = getResources().getDisplayMetrics().density;
        int pad = (int)(dp * 12);
        int count = 0;
        for (InvItem item : allItems) {
            if (!filter.isEmpty()) {
                String hay = (item.invNr + " " + item.custName + " " + item.date + " " + item.pdfUrl).toLowerCase(Locale.GERMANY);
                if (!hay.contains(filter)) continue;
            }
            addCard(item, pad, dp);
            count++;
        }
        if (count == 0) {
            TextView tv = new TextView(this);
            tv.setText(filter.isEmpty() ? "Keine Rechnungen gefunden." : "Keine Treffer für \"" + filter + "\"");
            tv.setTextColor(Color.parseColor("#94A3B8"));
            tv.setPadding(pad, pad, pad, pad);
            llList.addView(tv);
        }
    }

    // v6.63.608: Kompakte Listenzeile — Tap öffnet Vorschau-Dialog mit Aktionen
    private void addCard(InvItem item, int pad, float dp) {
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.HORIZONTAL);
        card.setBackgroundColor(Color.parseColor("#1E293B"));
        card.setPadding(pad, (int)(dp*10), pad, (int)(dp*10));
        LinearLayout.LayoutParams cp = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        cp.setMargins(0, 0, 0, (int)(dp * 4));
        card.setLayoutParams(cp);
        card.setClickable(true); card.setFocusable(true);
        card.setOnClickListener(v -> showPreviewDialog(item));

        // Links: Nr. + Kundenname
        LinearLayout leftCol = new LinearLayout(this);
        leftCol.setOrientation(LinearLayout.VERTICAL);
        leftCol.setLayoutParams(new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1));
        TextView tvNr = new TextView(this);
        tvNr.setText("Nr. " + item.invNr);
        tvNr.setTextColor(Color.parseColor("#F8FAFC"));
        tvNr.setTextSize(14); tvNr.setTypeface(null, Typeface.BOLD);
        leftCol.addView(tvNr);
        if (!item.custName.isEmpty()) {
            TextView tvName = new TextView(this);
            tvName.setText(item.custName);
            tvName.setTextColor(Color.parseColor("#94A3B8")); tvName.setTextSize(12);
            leftCol.addView(tvName);
        }
        card.addView(leftCol);

        // Rechts: Betrag + Status + Datum
        LinearLayout rightCol = new LinearLayout(this);
        rightCol.setOrientation(LinearLayout.VERTICAL);
        rightCol.setGravity(android.view.Gravity.END);
        boolean isPaid = "paid".equals(item.payStatus);
        TextView tvAmt = new TextView(this);
        tvAmt.setText(String.format(Locale.GERMANY, "%.2f €", item.gross));
        tvAmt.setTextColor(isPaid ? Color.parseColor("#10B981") : Color.parseColor("#F8FAFC"));
        tvAmt.setTextSize(15); tvAmt.setTypeface(null, Typeface.BOLD);
        tvAmt.setGravity(android.view.Gravity.END);
        rightCol.addView(tvAmt);
        TextView tvStatus = new TextView(this);
        tvStatus.setText(isPaid ? "✅" : ("offen".equalsIgnoreCase(item.payStatus) ? "⏳" : item.date.isEmpty() ? "" : formatDate(item.date)));
        tvStatus.setTextColor(isPaid ? Color.parseColor("#10B981") : Color.parseColor("#F59E0B"));
        tvStatus.setTextSize(11); tvStatus.setGravity(android.view.Gravity.END);
        rightCol.addView(tvStatus);
        card.addView(rightCol);

        llList.addView(card);
    }

    // v6.63.608: Vorschau-Dialog mit vollständigen Details + Aktions-Buttons
    private void showPreviewDialog(InvItem item) {
        float dp = getResources().getDisplayMetrics().density;
        int p = (int)(dp * 16);
        LinearLayout form = new LinearLayout(this);
        form.setOrientation(LinearLayout.VERTICAL); form.setPadding(p, p/2, p, p/2);

        // Header
        TextView tvHdr = new TextView(this);
        tvHdr.setText("Rechnung " + item.invNr);
        tvHdr.setTextSize(16); tvHdr.setTypeface(null, Typeface.BOLD);
        form.addView(tvHdr);

        // Details
        String[] labels = { "Kunde:", "Datum:", "Betrag:", "Status:" };
        boolean isPaid = "paid".equals(item.payStatus);
        String[] values = {
            item.custName.isEmpty() ? "—" : item.custName,
            item.date.isEmpty() ? "—" : formatDate(item.date),
            String.format(Locale.GERMANY, "%.2f €", item.gross),
            isPaid ? "✅ bezahlt" : "⏳ offen"
        };
        for (int i = 0; i < labels.length; i++) {
            LinearLayout row = new LinearLayout(this);
            row.setOrientation(LinearLayout.HORIZONTAL);
            LinearLayout.LayoutParams rp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
            rp.setMargins(0, (int)(dp*6), 0, 0); row.setLayoutParams(rp);
            TextView lbl = new TextView(this);
            lbl.setText(labels[i]);
            lbl.setTextSize(13); lbl.setTextColor(Color.parseColor("#94A3B8"));
            lbl.setLayoutParams(new LinearLayout.LayoutParams((int)(dp*70), LinearLayout.LayoutParams.WRAP_CONTENT));
            row.addView(lbl);
            TextView val = new TextView(this);
            val.setText(values[i]);
            val.setTextSize(13); val.setTextColor(Color.parseColor("#F8FAFC"));
            if (i == 2) { val.setTypeface(null, Typeface.BOLD); val.setTextColor(Color.parseColor("#10B981")); }
            row.addView(val);
            form.addView(row);
        }

        // Aktions-Buttons
        LinearLayout btnRow = new LinearLayout(this);
        btnRow.setOrientation(LinearLayout.HORIZONTAL);
        LinearLayout.LayoutParams brp = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        brp.setMargins(0, (int)(dp*16), 0, 0); btnRow.setLayoutParams(brp);

        final AlertDialog[] dlgRef = {null};

        MaterialButton btnEdit = new MaterialButton(this);
        btnEdit.setText("✏️ Bearbeiten");
        btnEdit.setTextSize(12); btnEdit.setTextColor(Color.WHITE);
        btnEdit.setLayoutParams(new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1));
        btnEdit.setBackgroundColor(Color.parseColor("#475569"));
        btnEdit.setOnClickListener(v -> { if (dlgRef[0] != null) dlgRef[0].dismiss(); showEditDialog(item); });
        btnRow.addView(btnEdit);

        // v6.63.635: E-Mail-Button immer anzeigen (auch ohne rideId via invoiceKey-Fallback)
        {
            MaterialButton btnSend = new MaterialButton(this);
            btnSend.setText("📧 E-Mail");
            btnSend.setTextSize(12); btnSend.setTextColor(Color.WHITE);
            LinearLayout.LayoutParams sp = new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1);
            sp.setMargins((int)(dp*6), 0, 0, 0); btnSend.setLayoutParams(sp);
            btnSend.setBackgroundColor(Color.parseColor("#059669"));
            // v6.63.609: CRM-Email via customerId nachschlagen wenn custEmail leer
            btnSend.setOnClickListener(v -> {
                if (dlgRef[0] != null) dlgRef[0].dismiss();
                String knownEmail = item.custEmail != null && !item.custEmail.isEmpty() ? item.custEmail : "";
                if (knownEmail.isEmpty() && !item.custId.isEmpty()) {
                    FirebaseDatabase.getInstance(DB_URL).getReference("customers/" + item.custId + "/email").get()
                        .addOnSuccessListener(snap -> {
                            String crmEmail = strVal(snap.getValue());
                            launchEmailPreview(item, crmEmail);
                        })
                        .addOnFailureListener(e -> launchEmailPreview(item, ""));
                } else {
                    launchEmailPreview(item, knownEmail);
                }
            });
            btnRow.addView(btnSend);
        }

        if (!item.pdfUrl.isEmpty()) {
            MaterialButton btnPdf = new MaterialButton(this);
            btnPdf.setText("📄 PDF öffnen");
            btnPdf.setTextSize(12); btnPdf.setTextColor(Color.WHITE);
            LinearLayout.LayoutParams pp = new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1);
            pp.setMargins((int)(dp*6), 0, 0, 0); btnPdf.setLayoutParams(pp);
            btnPdf.setBackgroundColor(Color.parseColor("#1D4ED8"));
            btnPdf.setOnClickListener(v -> {
                if (dlgRef[0] != null) dlgRef[0].dismiss();
                try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(item.pdfUrl))); }
                catch (Throwable t) { Toast.makeText(this, "Kein PDF-App installiert", Toast.LENGTH_SHORT).show(); }
            });
            btnRow.addView(btnPdf);
        }
        form.addView(btnRow);

        // v6.63.756 (Patrick 20.07. Bridge: "wo kann man Rechnung neu generieren"):
        //   Expliziter Regen-Button in eigener Zeile — triggert needsPdfRegeneration=true.
        //   Bisher lief Regen nur ueber Bearbeiten -> Speichern. Fuer Faelle wo Rechnung
        //   nicht bearbeitet werden soll (nur Neu-Rendering z.B. nach CRM-Aenderung),
        //   ist ein eigener Button klarer.
        LinearLayout btnRow2 = new LinearLayout(this);
        btnRow2.setOrientation(LinearLayout.HORIZONTAL);
        LinearLayout.LayoutParams brp2 = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        brp2.setMargins(0, (int)(dp*8), 0, 0); btnRow2.setLayoutParams(brp2);
        MaterialButton btnRegen = new MaterialButton(this);
        btnRegen.setText("🔄 PDF neu generieren");
        btnRegen.setTextSize(12); btnRegen.setTextColor(Color.WHITE);
        btnRegen.setBackgroundColor(Color.parseColor("#7C3AED"));
        btnRegen.setLayoutParams(new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));
        btnRegen.setOnClickListener(v -> {
            // paymentTerms=null damit CRM-paymentMethod-Aenderung durchschlaegt
            java.util.Map<String,Object> _regen = new java.util.HashMap<>();
            _regen.put("needsPdfRegeneration", true);
            _regen.put("paymentTerms", null);
            _regen.put("updatedAt", System.currentTimeMillis());
            FirebaseDatabase.getInstance(DB_URL).getReference("invoices/" + item.key)
                .updateChildren(_regen)
                .addOnSuccessListener(_ok -> Toast.makeText(this, "🔄 PDF wird in ~1 Min neu gebaut", Toast.LENGTH_LONG).show())
                .addOnFailureListener(_err -> Toast.makeText(this, "⚠️ Fehler: " + _err.getMessage(), Toast.LENGTH_LONG).show());
        });
        btnRow2.addView(btnRegen);
        form.addView(btnRow2);

        // v6.63.757 (Patrick 20.07. Bridge "Aus ride neu befüllen"): Force-Refill.
        //   Kunde-Name/Personenzahl in der Ride wurden nachtraeglich korrigiert,
        //   sollen jetzt in die bestehende Rechnung uebernommen werden.
        //   Native laedt Ride+Customer, ueberschreibt Rechnungs-Felder mit den
        //   aktuellen Werten und triggert Regen. Der Cloud-Regen macht den
        //   Rest (PDF neu bauen mit den frischen Feldern).
        if (item.rideId != null && !item.rideId.isEmpty()) {
            LinearLayout btnRow3 = new LinearLayout(this);
            btnRow3.setOrientation(LinearLayout.HORIZONTAL);
            LinearLayout.LayoutParams brp3 = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
            brp3.setMargins(0, (int)(dp*8), 0, 0); btnRow3.setLayoutParams(brp3);
            MaterialButton btnRefill = new MaterialButton(this);
            btnRefill.setText("⚡ Aus Ride + CRM neu befüllen");
            btnRefill.setTextSize(12); btnRefill.setTextColor(Color.WHITE);
            btnRefill.setBackgroundColor(Color.parseColor("#0891B2"));
            btnRefill.setLayoutParams(new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));
            btnRefill.setOnClickListener(v -> {
                // Ride laden
                FirebaseDatabase.getInstance(DB_URL).getReference("rides/" + item.rideId).get()
                    .addOnSuccessListener(rs -> {
                        if (!rs.exists()) {
                            Toast.makeText(this, "⚠️ Ride nicht gefunden", Toast.LENGTH_LONG).show();
                            return;
                        }
                        String _rideCustName = strVal(rs.child("customerName").getValue());
                        String _rideGuestName = strVal(rs.child("guestName").getValue());
                        Object _paxRaw = rs.child("passengers").getValue();
                        int _pax = _paxRaw instanceof Number ? ((Number)_paxRaw).intValue() : 1;
                        String _rideCustId = strVal(rs.child("customerId").getValue());
                        String _pickupIso = strVal(rs.child("pickupTime").getValue());
                        String _pickup = strVal(rs.child("pickup").getValue());
                        String _dest = strVal(rs.child("destination").getValue());

                        // v6.63.792 (Patrick 23.07. Bridge Südhöhl-Fall): _applyFn nimmt jetzt
                        //   das AUS CRM ERMITTELTE Name/Email als Prio. Vorher wurde immer
                        //   Ride.customerName='Gast' übernommen und CRM-Wert überschrieben.
                        //   Neu: wenn CRM einen Namen liefert (billingAddresses.empfaengerName
                        //   ODER customer.name ODER lastName), gewinnt der.
                        final String[] _crmNameHolder = new String[]{""};
                        final String[] _crmEmailHolder = new String[]{""};
                        Runnable _applyFn = () -> {
                            java.util.Map<String,Object> _upd = new java.util.HashMap<>();
                            // v6.63.792: CRM-Name gewinnt, Ride-Name (oft 'Gast') nur Fallback
                            String _finalName = !_crmNameHolder[0].isEmpty() ? _crmNameHolder[0] : _rideCustName;
                            if (!_finalName.isEmpty()) _upd.put("customerName", _finalName);
                            // v6.63.792: E-Mail aus CRM (falls da) — sonst nicht anfassen
                            if (!_crmEmailHolder[0].isEmpty()) _upd.put("customerEmail", _crmEmailHolder[0]);
                            _upd.put("guestName", _rideGuestName.isEmpty() ? null : _rideGuestName);
                            String _desc = "1 Fahrt von " + _pickup + " nach " + _dest
                                + (_pax > 1 ? " (" + _pax + " Personen)" : "");
                            _upd.put("positions/0/description", _desc);
                            _upd.put("positions/0/passengers", _pax);
                            _upd.put("needsPdfRegeneration", true);
                            _upd.put("paymentTerms", null);
                            _upd.put("_refilledFromRide", System.currentTimeMillis());
                            _upd.put("updatedAt", System.currentTimeMillis());
                            FirebaseDatabase.getInstance(DB_URL).getReference("invoices/" + item.key)
                                .updateChildren(_upd)
                                .addOnSuccessListener(_ok -> Toast.makeText(this, "⚡ Rechnung neu befüllt — PDF in ~1 Min bereit", Toast.LENGTH_LONG).show())
                                .addOnFailureListener(_err -> Toast.makeText(this, "⚠️ " + _err.getMessage(), Toast.LENGTH_LONG).show());
                        };
                        if (!_rideCustId.isEmpty()) {
                            FirebaseDatabase.getInstance(DB_URL).getReference("customers/" + _rideCustId).get()
                                .addOnSuccessListener(cs -> {
                                    // v6.63.762 (Patrick 21.07. Bridge Anna-Sill-Fall): billingAddresses[]
                                    //   strukturiert lesen — Zusatz + Straße + PLZ/Ort sauber
                                    //   zusammenbauen. Alter Code las nur flat customer.address
                                    //   und verlor dabei adresszusatz (Brinkmannhaus).
                                    java.util.Map<String,Object> _addr = new java.util.HashMap<>();
                                    String _crmAddr = "";
                                    String _crmName = "";
                                    // Prio 1: billingAddresses[isDefault=true] oder [0] mit strukturierten Feldern
                                    com.google.firebase.database.DataSnapshot _bas = cs.child("billingAddresses");
                                    if (_bas.exists()) {
                                        com.google.firebase.database.DataSnapshot _ba = null;
                                        for (com.google.firebase.database.DataSnapshot _b : _bas.getChildren()) {
                                            Object _def = _b.child("isDefault").getValue();
                                            if (_def instanceof Boolean && (Boolean) _def) { _ba = _b; break; }
                                        }
                                        if (_ba == null) {
                                            java.util.Iterator<com.google.firebase.database.DataSnapshot> _it = _bas.getChildren().iterator();
                                            if (_it.hasNext()) _ba = _it.next();
                                        }
                                        if (_ba != null) {
                                            _crmName = strVal(_ba.child("empfaengerName").getValue());
                                            if (_crmName.isEmpty()) _crmName = strVal(_ba.child("label").getValue());
                                            String _adrZ = strVal(_ba.child("adresszusatz").getValue());
                                            String _str = strVal(_ba.child("strasse").getValue());
                                            String _plz = strVal(_ba.child("plz").getValue());
                                            String _ort = strVal(_ba.child("ort").getValue());
                                            String _land = strVal(_ba.child("land").getValue());
                                            java.util.List<String> _parts = new java.util.ArrayList<>();
                                            if (!_adrZ.isEmpty()) _parts.add(_adrZ);
                                            if (!_str.isEmpty()) _parts.add(_str);
                                            String _plzOrt = (_plz + " " + _ort).trim();
                                            if (!_plzOrt.isEmpty()) _parts.add(_plzOrt);
                                            if (!_land.isEmpty() && !_land.equalsIgnoreCase("deutschland")) _parts.add(_land);
                                            if (!_parts.isEmpty()) {
                                                _crmAddr = android.text.TextUtils.join(", ", _parts);
                                            } else {
                                                // billingAddresses[] hat nur address-Freitext (altes Format)
                                                _crmAddr = strVal(_ba.child("address").getValue());
                                                // wenn adresszusatz separat, davorstellen
                                                if (!_adrZ.isEmpty() && !_crmAddr.isEmpty() && !_crmAddr.contains(_adrZ)) {
                                                    _crmAddr = _adrZ + ", " + _crmAddr;
                                                }
                                            }
                                        }
                                    }
                                    // Prio 2: flat invoiceAddress / billingAddress / address (Legacy-Fallback)
                                    if (_crmAddr.isEmpty()) _crmAddr = strVal(cs.child("invoiceAddress").getValue());
                                    if (_crmAddr.isEmpty()) _crmAddr = strVal(cs.child("billingAddress").getValue());
                                    if (_crmAddr.isEmpty()) _crmAddr = strVal(cs.child("address").getValue());
                                    // 🆕 v6.63.792 (Patrick 23.07. Bridge Südhöhl-Bug): flat customer.name als
                                    //   Fallback wenn kein billingAddresses.empfaengerName. Sonst blieb Ride-'Gast'.
                                    if (_crmName.isEmpty()) _crmName = strVal(cs.child("name").getValue());
                                    if (_crmName.isEmpty()) _crmName = strVal(cs.child("lastName").getValue());
                                    // 🆕 v6.63.794 (Patrick 23.07. Bridge REVERT): Anrede NICHT automatisch
                                    //   voranstellen. Patrick: 'übernimm 1:1 was im CRM steht, halluzinier
                                    //   nichts dazu'. Wenn er 'Frau Süd-Höhe' will → im CRM.name so
                                    //   eintragen. Sonst wird Süd-Höhe genommen wie es ist.
                                    if (!_crmAddr.isEmpty()) _addr.put("customerAddress", _crmAddr);
                                    if (!_crmName.isEmpty()) _addr.put("customerName", _crmName);
                                    String _crmEmail = strVal(cs.child("email").getValue());
                                    if (!_crmEmail.isEmpty()) _addr.put("customerEmail", _crmEmail);
                                    // v6.63.792: Werte für _applyFn zwischenspeichern damit sie NICHT überschrieben werden
                                    _crmNameHolder[0] = _crmName;
                                    _crmEmailHolder[0] = _crmEmail;
                                    if (!_addr.isEmpty()) {
                                        FirebaseDatabase.getInstance(DB_URL).getReference("invoices/" + item.key)
                                            .updateChildren(_addr);
                                    }
                                    _applyFn.run();
                                })
                                .addOnFailureListener(_e -> _applyFn.run());
                        } else {
                            _applyFn.run();
                        }
                    })
                    .addOnFailureListener(_e -> Toast.makeText(this, "⚠️ " + _e.getMessage(), Toast.LENGTH_LONG).show());
            });
            btnRow3.addView(btnRefill);
            form.addView(btnRow3);
        }

        AlertDialog dlg = new AlertDialog.Builder(this)
            .setView(form)
            .setNegativeButton("Schließen", null)
            .create();
        dlgRef[0] = dlg;
        dlg.show();
    }

    private void launchEmailPreview(InvItem item, String prefillEmail) {
        Intent intent = new Intent(this, EmailPreviewActivity.class);
        // v6.63.635: rideId nur wenn vorhanden — sonst invoiceKey als Fallback
        if (!item.rideId.isEmpty()) intent.putExtra(EmailPreviewActivity.EXTRA_RIDE_ID, item.rideId);
        intent.putExtra(EmailPreviewActivity.EXTRA_INVOICE_KEY, item.key);
        intent.putExtra("prefillPdfUrl", item.pdfUrl);
        intent.putExtra(EmailPreviewActivity.EXTRA_MODE, EmailPreviewActivity.MODE_INVOICE);
        if (!prefillEmail.isEmpty()) intent.putExtra("prefillEmail", prefillEmail);
        startActivity(intent);
    }

    private void showEditDialog(InvItem item) {
        float dp = getResources().getDisplayMetrics().density;
        int p = (int)(dp * 16);
        LinearLayout form = new LinearLayout(this);
        form.setOrientation(LinearLayout.VERTICAL); form.setPadding(p, p/2, p, p/2);

        TextView tvInfo = new TextView(this);
        tvInfo.setText("Rechnung " + item.invNr + " — " + item.custName);
        tvInfo.setTextSize(14); tvInfo.setTypeface(null, Typeface.BOLD);
        form.addView(tvInfo);

        TextView tvLabel = new TextView(this);
        tvLabel.setText("Betrag (€):");
        tvLabel.setTextSize(13);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        lp.setMargins(0,(int)(dp*8),0,0); tvLabel.setLayoutParams(lp);
        form.addView(tvLabel);

        EditText etBetrag = new EditText(this);
        etBetrag.setInputType(InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_FLAG_DECIMAL);
        etBetrag.setText(String.format(Locale.GERMANY, "%.2f", item.gross));
        etBetrag.setSelectAllOnFocus(true);
        form.addView(etBetrag);

        // v6.63.754 (Patrick 20.07. Bridge): Zahlungsart-Spinner —
        //   Rechnungs-Editor konnte bisher nur den Betrag aendern. Text auf der
        //   PDF ("Zahlbar innerhalb 14 Tage" vs "Betrag in Bar erhalten") wird
        //   aus invoice.paymentMethod abgeleitet (functions/invoice-html.js Z.44+).
        //   Ohne dieses Feld musste Patrick den paymentMethod im Web-Editor aendern.
        TextView lblPay = new TextView(this);
        lblPay.setText("Zahlungsart:");
        lblPay.setTextSize(13);
        LinearLayout.LayoutParams lpPay = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        lpPay.setMargins(0,(int)(dp*12),0,0); lblPay.setLayoutParams(lpPay);
        form.addView(lblPay);
        final String[] _pmKeys = { "bar", "rechnung", "vorkasse", "stripe", "karte", "transportschein" };
        final String[] _pmLabels = { "💶 Bar", "🧾 Auf Rechnung (14 Tage)", "💰 Vorkasse (sofort)", "💳 Stripe (online)", "💳 Karte", "🏥 Transportschein" };
        Spinner spPay = new Spinner(this);
        ArrayAdapter<String> _adapter = new ArrayAdapter<>(this, android.R.layout.simple_spinner_dropdown_item, _pmLabels);
        spPay.setAdapter(_adapter);
        int _preSel = 0;
        String _curPm = item.paymentMethod != null ? item.paymentMethod.toLowerCase() : "";
        for (int i = 0; i < _pmKeys.length; i++) { if (_pmKeys[i].equals(_curPm)) { _preSel = i; break; } }
        spPay.setSelection(_preSel);
        form.addView(spPay);

        new AlertDialog.Builder(this)
            .setTitle("✏️ Rechnung bearbeiten")
            .setView(form)
            .setPositiveButton("Speichern", (d, which) -> {
                String raw = etBetrag.getText().toString().replace(",", ".").trim();
                try {
                    double newGross = Double.parseDouble(raw);
                    if (newGross <= 0) { Toast.makeText(this, "Betrag muss > 0 sein", Toast.LENGTH_SHORT).show(); return; }
                    item.gross = newGross;
                    // Alle Summenfelder konsistent aktualisieren (positions + totals)
                    double vatRate = 7.0;
                    double newNet = newGross / (1.0 + vatRate / 100.0);
                    double newVat = newNet * (vatRate / 100.0);
                    java.util.Map<String, Object> upd = new java.util.HashMap<>();
                    upd.put("totalGross", newGross);
                    upd.put("totalNet", Math.round(newNet * 100.0) / 100.0);
                    upd.put("totalVat", Math.round(newVat * 100.0) / 100.0);
                    upd.put("updatedAt", System.currentTimeMillis());
                    upd.put("positions/0/amount", newGross);
                    upd.put("needsPdfRegeneration", true);
                    // v6.63.754: paymentMethod aus Spinner uebernehmen (auch wenn unveraendert
                    //   — spart einen Zusatzflag). Cloud-Function nutzt paymentMethod fuer
                    //   Zahlungsbedingung-Text + EPC-QR-Skip bei Bar.
                    String _newPm = _pmKeys[spPay.getSelectedItemPosition()];
                    upd.put("paymentMethod", _newPm);
                    item.paymentMethod = _newPm;
                    // v6.63.755 (Patrick 20.07. Bridge Villen-im-Park-Bug): paymentTerms MUSS
                    //   genullt werden wenn paymentMethod geaendert wird — sonst blockiert der
                    //   alte Fixtext ("Zahlbar 14 Tage") das paymentMethod-Mapping im PDF.
                    //   invoice-html.js Z.252: paymentTermsText = inv.paymentTerms || paymentLabel(pm)
                    upd.put("paymentTerms", null);
                    // Bei Bar → Rechnung als bezahlt markieren (Standard-Erwartung)
                    if ("bar".equals(_newPm)) {
                        upd.put("paymentStatus", "bezahlt");
                        upd.put("paidAt", System.currentTimeMillis());
                        item.payStatus = "bezahlt";
                    }
                    // v6.63.609: mit Erfolgs-/Fehler-Feedback (vorher silent-fail möglich)
                    final double _savedGross = newGross;
                    FirebaseDatabase.getInstance(DB_URL).getReference("invoices/" + item.key)
                        .updateChildren(upd)
                        .addOnSuccessListener(_ok -> {
                            Toast.makeText(this, "✅ " + String.format(Locale.GERMANY, "%.2f €", _savedGross) + " gespeichert ✓ Firebase", Toast.LENGTH_SHORT).show();
                        })
                        .addOnFailureListener(_err -> {
                            Toast.makeText(this, "⚠️ Speichern fehlgeschlagen: " + _err.getMessage(), Toast.LENGTH_LONG).show();
                            // Lokale Änderung rückgängig damit Liste nicht lügt
                            item.gross = 0; // wird neu geladen beim nächsten Refresh
                        });
                    renderList(etSearch.getText().toString().toLowerCase(Locale.GERMANY).trim());
                } catch (NumberFormatException e) {
                    Toast.makeText(this, "Ungültiger Betrag", Toast.LENGTH_SHORT).show();
                }
            })
            .setNegativeButton("Abbrechen", null)
            .show();
    }

    private static String formatDate(String d) {
        if (d == null || d.isEmpty()) return "—";
        try {
            return new SimpleDateFormat("dd.MM.yyyy", Locale.GERMANY)
                .format(new SimpleDateFormat("yyyy-MM-dd", Locale.GERMANY).parse(d));
        } catch (Throwable t) { return d; }
    }
    private static long parseDateMs(String d) {
        if (d == null || d.isEmpty()) return 0;
        try { return new SimpleDateFormat("yyyy-MM-dd", Locale.GERMANY).parse(d).getTime(); }
        catch (Throwable t) { return 0; }
    }
    private static String strVal(Object v) { return v == null ? "" : String.valueOf(v); }
    private static double dblVal(Object v) {
        if (v == null) return 0;
        try { return v instanceof Number ? ((Number)v).doubleValue() : Double.parseDouble(String.valueOf(v)); }
        catch (Throwable t) { return 0; }
    }
    private static long longVal(Object v) {
        if (v == null) return 0;
        try { return v instanceof Number ? ((Number)v).longValue() : Long.parseLong(String.valueOf(v)); }
        catch (Throwable t) { return 0; }
    }
}
