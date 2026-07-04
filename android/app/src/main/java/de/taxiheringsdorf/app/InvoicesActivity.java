package de.taxiheringsdorf.app;

import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Bundle;
import android.text.Editable;
import android.text.InputType;
import android.text.TextWatcher;
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

    private static class InvItem {
        String key, invNr, rideId, custName, custEmail, date, pdfUrl, payStatus;
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

        // Query 1: nach invoiceDate (auto-erstellte Rechnungen, ISO-String sortierbar)
        ref.orderByChild("invoiceDate").startAt("2026-01-01").limitToLast(80)
            .addListenerForSingleValueEvent(new ValueEventListener() {
                @Override public void onDataChange(DataSnapshot snap) {
                    for (DataSnapshot c : snap.getChildren()) {
                        if (!seen.contains(c.getKey())) {
                            seen.add(c.getKey());
                            InvItem item = parse(c);
                            if (item != null) allItems.add(item);
                        }
                    }
                    runOnUiThread(checkDone);
                }
                @Override public void onCancelled(DatabaseError e) { runOnUiThread(checkDone); }
            });

        // Query 2: nach createdAt (manuell erstellte Rechnungen, Unix-Timestamp)
        ref.orderByChild("createdAt").startAt(1.0).limitToLast(50)
            .addListenerForSingleValueEvent(new ValueEventListener() {
                @Override public void onDataChange(DataSnapshot snap) {
                    for (DataSnapshot c : snap.getChildren()) {
                        if (!seen.contains(c.getKey())) {
                            seen.add(c.getKey());
                            InvItem item = parse(c);
                            if (item != null) allItems.add(item);
                        }
                    }
                    runOnUiThread(checkDone);
                }
                @Override public void onCancelled(DatabaseError e) { runOnUiThread(checkDone); }
            });
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

    private void addCard(InvItem item, int pad, float dp) {
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setBackgroundColor(Color.parseColor("#1E293B"));
        card.setPadding(pad, pad, pad, pad);
        LinearLayout.LayoutParams cp = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        cp.setMargins(0, 0, 0, (int)(dp * 10));
        card.setLayoutParams(cp);

        // Kopfzeile
        LinearLayout header = new LinearLayout(this);
        header.setOrientation(LinearLayout.HORIZONTAL);
        header.setLayoutParams(new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));
        TextView tvNr = new TextView(this);
        tvNr.setLayoutParams(new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1));
        tvNr.setText("Nr. " + item.invNr);
        tvNr.setTextColor(Color.parseColor("#F8FAFC"));
        tvNr.setTextSize(15); tvNr.setTypeface(null, Typeface.BOLD);
        header.addView(tvNr);
        TextView tvDate = new TextView(this);
        tvDate.setText(formatDate(item.date));
        tvDate.setTextColor(Color.parseColor("#94A3B8")); tvDate.setTextSize(13);
        header.addView(tvDate);
        card.addView(header);

        if (!item.custName.isEmpty()) {
            TextView tvName = new TextView(this);
            tvName.setText(item.custName);
            tvName.setTextColor(Color.parseColor("#CBD5E1")); tvName.setTextSize(14);
            LinearLayout.LayoutParams np = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
            np.setMargins(0,(int)(dp*4),0,0); tvName.setLayoutParams(np);
            card.addView(tvName);
        }

        // Betrag + Status
        LinearLayout amtRow = new LinearLayout(this);
        amtRow.setOrientation(LinearLayout.HORIZONTAL);
        LinearLayout.LayoutParams ap = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        ap.setMargins(0,(int)(dp*4),0,0); amtRow.setLayoutParams(ap);
        TextView tvAmt = new TextView(this);
        tvAmt.setLayoutParams(new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1));
        tvAmt.setText(String.format(Locale.GERMANY, "%.2f €", item.gross));
        tvAmt.setTextColor(Color.parseColor("#10B981")); tvAmt.setTextSize(16);
        tvAmt.setTypeface(null, Typeface.BOLD);
        amtRow.addView(tvAmt);
        boolean isPaid = "paid".equals(item.payStatus);
        TextView tvPay = new TextView(this);
        tvPay.setText(isPaid ? "✅ bezahlt" : "⏳ offen");
        tvPay.setTextColor(isPaid ? Color.parseColor("#10B981") : Color.parseColor("#F59E0B"));
        tvPay.setTextSize(13); amtRow.addView(tvPay);
        card.addView(amtRow);

        // Buttons: Bearbeiten | Senden | PDF
        LinearLayout btnRow = new LinearLayout(this);
        btnRow.setOrientation(LinearLayout.HORIZONTAL);
        LinearLayout.LayoutParams brp = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        brp.setMargins(0,(int)(dp*8),0,0); btnRow.setLayoutParams(brp);

        // Bearbeiten
        MaterialButton btnEdit = new MaterialButton(this);
        btnEdit.setText("✏️");
        btnEdit.setTextSize(16); btnEdit.setTextColor(Color.WHITE);
        LinearLayout.LayoutParams ep = new LinearLayout.LayoutParams(
            (int)(dp*48), LinearLayout.LayoutParams.WRAP_CONTENT);
        ep.setMargins(0,0,(int)(dp*6),0); btnEdit.setLayoutParams(ep);
        btnEdit.setBackgroundColor(Color.parseColor("#475569"));
        btnEdit.setOnClickListener(v -> showEditDialog(item));
        btnRow.addView(btnEdit);

        // Senden
        MaterialButton btnSend = new MaterialButton(this);
        btnSend.setText("📧 Senden");
        btnSend.setTextSize(13); btnSend.setTextColor(Color.WHITE);
        LinearLayout.LayoutParams sp = new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1);
        sp.setMargins(0,0,(int)(dp*6),0); btnSend.setLayoutParams(sp);
        if (!item.rideId.isEmpty()) {
            btnSend.setBackgroundColor(Color.parseColor("#059669"));
            btnSend.setOnClickListener(v -> {
                Intent intent = new Intent(this, EmailPreviewActivity.class);
                intent.putExtra(EmailPreviewActivity.EXTRA_RIDE_ID, item.rideId);
                intent.putExtra(EmailPreviewActivity.EXTRA_MODE, EmailPreviewActivity.MODE_INVOICE);
                startActivity(intent);
            });
        } else {
            btnSend.setBackgroundColor(Color.parseColor("#475569")); btnSend.setEnabled(false);
        }
        btnRow.addView(btnSend);

        // PDF
        MaterialButton btnPdf = new MaterialButton(this);
        btnPdf.setTextSize(13); btnPdf.setTextColor(Color.WHITE);
        btnPdf.setLayoutParams(new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1));
        if (!item.pdfUrl.isEmpty()) {
            btnPdf.setText("📄 PDF");
            btnPdf.setBackgroundColor(Color.parseColor("#1D4ED8"));
            btnPdf.setOnClickListener(v -> {
                try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(item.pdfUrl))); }
                catch (Throwable t) { Toast.makeText(this, "Kein Browser: "+t.getMessage(), Toast.LENGTH_SHORT).show(); }
            });
        } else {
            btnPdf.setText("📄 —"); btnPdf.setBackgroundColor(Color.parseColor("#334155")); btnPdf.setEnabled(false);
        }
        btnRow.addView(btnPdf);
        card.addView(btnRow);
        llList.addView(card);
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

        new AlertDialog.Builder(this)
            .setTitle("✏️ Rechnung bearbeiten")
            .setView(form)
            .setPositiveButton("Speichern", (d, which) -> {
                String raw = etBetrag.getText().toString().replace(",", ".").trim();
                try {
                    double newGross = Double.parseDouble(raw);
                    if (newGross <= 0) { Toast.makeText(this, "Betrag muss > 0 sein", Toast.LENGTH_SHORT).show(); return; }
                    item.gross = newGross;
                    // Firebase updaten
                    FirebaseDatabase.getInstance(DB_URL).getReference("invoices/" + item.key)
                        .updateChildren(Collections.singletonMap("totalGross", newGross));
                    Toast.makeText(this, "✅ Betrag aktualisiert: " + String.format(Locale.GERMANY, "%.2f €", newGross), Toast.LENGTH_SHORT).show();
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
