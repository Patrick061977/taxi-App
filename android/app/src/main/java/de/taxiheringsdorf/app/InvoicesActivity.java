package de.taxiheringsdorf.app;

import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;
import androidx.appcompat.app.AppCompatActivity;
import com.google.android.material.button.MaterialButton;
import com.google.firebase.database.*;
import java.text.SimpleDateFormat;
import java.util.*;

// 🆕 v6.63.598 (Patrick 04.07.): Rechnungen-Übersicht
// Lädt alle Rechnungen aus /invoices/ (neueste zuerst), zeigt Status + Senden-Button.
public class InvoicesActivity extends AppCompatActivity {

    private static final String DB_URL = "https://taxi-heringsdorf-default-rtdb.europe-west1.firebasedatabase.app";

    private LinearLayout llList;
    private TextView tvStatus;
    private MaterialButton btnRefresh;

    @Override
    protected void onCreate(Bundle s) {
        super.onCreate(s);
        setContentView(R.layout.activity_invoices);

        llList = findViewById(R.id.llInvoicesList);
        tvStatus = findViewById(R.id.tvInvoicesStatus);
        btnRefresh = findViewById(R.id.btnInvoicesRefresh);

        btnRefresh.setOnClickListener(v -> loadInvoices());
        loadInvoices();
    }

    private void loadInvoices() {
        tvStatus.setText("⏳ Lade Rechnungen...");
        llList.removeAllViews();
        btnRefresh.setEnabled(false);

        FirebaseDatabase.getInstance(DB_URL)
            .getReference("invoices")
            .orderByChild("invoiceDate")
            .limitToLast(60)
            .addListenerForSingleValueEvent(new ValueEventListener() {
                @Override public void onDataChange(DataSnapshot snap) {
                    List<DataSnapshot> list = new ArrayList<>();
                    for (DataSnapshot c : snap.getChildren()) list.add(c);
                    Collections.reverse(list); // neueste zuerst

                    runOnUiThread(() -> {
                        btnRefresh.setEnabled(true);
                        if (list.isEmpty()) {
                            tvStatus.setText("Keine Rechnungen gefunden.");
                            return;
                        }
                        tvStatus.setText(list.size() + " Rechnungen (letzte 60)");
                        llList.removeAllViews();
                        for (DataSnapshot inv : list) addInvoiceCard(inv);
                    });
                }
                @Override public void onCancelled(DatabaseError e) {
                    runOnUiThread(() -> {
                        btnRefresh.setEnabled(true);
                        tvStatus.setText("⚠️ Fehler: " + e.getMessage());
                    });
                }
            });
    }

    private void addInvoiceCard(DataSnapshot inv) {
        String invNr    = strVal(inv.child("invoiceNumber").getValue());
        String rideId   = strVal(inv.child("rideId").getValue());
        String custName = strVal(inv.child("customerName").getValue());
        String custEmail = strVal(inv.child("customerEmail").getValue());
        String dateStr  = strVal(inv.child("invoiceDate").getValue());
        String pdfUrl   = strVal(inv.child("pdfUrl").getValue());
        String payStatus = strVal(inv.child("paymentStatus").getValue());
        double gross    = dblVal(inv.child("totalGross").getValue());

        float dp = getResources().getDisplayMetrics().density;
        int pad = (int)(dp * 12);

        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setBackgroundColor(Color.parseColor("#1E293B"));
        card.setPadding(pad, pad, pad, pad);
        LinearLayout.LayoutParams cp = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        cp.setMargins(0, 0, 0, (int)(dp * 10));
        card.setLayoutParams(cp);

        // Kopfzeile: Nummer + Datum
        LinearLayout header = new LinearLayout(this);
        header.setOrientation(LinearLayout.HORIZONTAL);
        header.setLayoutParams(new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));

        TextView tvNr = new TextView(this);
        tvNr.setLayoutParams(new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1));
        tvNr.setText("Nr. " + (invNr.isEmpty() ? "?" : invNr));
        tvNr.setTextColor(Color.parseColor("#F8FAFC"));
        tvNr.setTextSize(15);
        tvNr.setTypeface(null, Typeface.BOLD);
        header.addView(tvNr);

        TextView tvDate = new TextView(this);
        tvDate.setText(formatDate(dateStr));
        tvDate.setTextColor(Color.parseColor("#94A3B8"));
        tvDate.setTextSize(13);
        header.addView(tvDate);
        card.addView(header);

        // Kundenname
        if (!custName.isEmpty()) {
            TextView tvName = new TextView(this);
            tvName.setText(custName);
            tvName.setTextColor(Color.parseColor("#CBD5E1"));
            tvName.setTextSize(14);
            LinearLayout.LayoutParams np = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
            np.setMargins(0, (int)(dp*4), 0, 0);
            tvName.setLayoutParams(np);
            card.addView(tvName);
        }

        // Betrag + Status
        LinearLayout amtRow = new LinearLayout(this);
        amtRow.setOrientation(LinearLayout.HORIZONTAL);
        LinearLayout.LayoutParams ap = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        ap.setMargins(0, (int)(dp*4), 0, 0);
        amtRow.setLayoutParams(ap);

        TextView tvAmt = new TextView(this);
        tvAmt.setLayoutParams(new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1));
        tvAmt.setText(String.format(Locale.GERMANY, "%.2f €", gross));
        tvAmt.setTextColor(Color.parseColor("#10B981"));
        tvAmt.setTextSize(16);
        tvAmt.setTypeface(null, Typeface.BOLD);
        amtRow.addView(tvAmt);

        boolean isPaid = "paid".equals(payStatus);
        TextView tvPay = new TextView(this);
        tvPay.setText(isPaid ? "✅ bezahlt" : "⏳ offen");
        tvPay.setTextColor(isPaid ? Color.parseColor("#10B981") : Color.parseColor("#F59E0B"));
        tvPay.setTextSize(13);
        amtRow.addView(tvPay);
        card.addView(amtRow);

        // Buttons
        LinearLayout btnRow = new LinearLayout(this);
        btnRow.setOrientation(LinearLayout.HORIZONTAL);
        LinearLayout.LayoutParams brp = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        brp.setMargins(0, (int)(dp*8), 0, 0);
        btnRow.setLayoutParams(brp);

        // Senden-Button
        MaterialButton btnSend = new MaterialButton(this);
        btnSend.setText("📧 Senden");
        btnSend.setTextSize(13);
        btnSend.setTextColor(Color.WHITE);
        LinearLayout.LayoutParams sp = new LinearLayout.LayoutParams(
            0, LinearLayout.LayoutParams.WRAP_CONTENT, 1);
        sp.setMargins(0, 0, (int)(dp*6), 0);
        btnSend.setLayoutParams(sp);

        if (!rideId.isEmpty()) {
            btnSend.setBackgroundColor(Color.parseColor("#059669"));
            final String _rideId = rideId;
            btnSend.setOnClickListener(v -> {
                Intent intent = new Intent(this, EmailPreviewActivity.class);
                intent.putExtra(EmailPreviewActivity.EXTRA_RIDE_ID, _rideId);
                intent.putExtra(EmailPreviewActivity.EXTRA_MODE, EmailPreviewActivity.MODE_INVOICE);
                startActivity(intent);
            });
        } else {
            btnSend.setBackgroundColor(Color.parseColor("#475569"));
            btnSend.setEnabled(false);
            btnSend.setText("📧 (keine RideID)");
        }
        btnRow.addView(btnSend);

        // PDF-Button
        MaterialButton btnPdf = new MaterialButton(this);
        LinearLayout.LayoutParams pp = new LinearLayout.LayoutParams(
            0, LinearLayout.LayoutParams.WRAP_CONTENT, 1);
        btnPdf.setLayoutParams(pp);
        btnPdf.setTextSize(13);
        btnPdf.setTextColor(Color.WHITE);

        if (!pdfUrl.isEmpty()) {
            btnPdf.setText("📄 PDF öffnen");
            btnPdf.setBackgroundColor(Color.parseColor("#1D4ED8"));
            final String _pdfUrl = pdfUrl;
            btnPdf.setOnClickListener(v -> {
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(_pdfUrl)));
                } catch (Throwable t) {
                    Toast.makeText(this, "Kein PDF-Reader: " + t.getMessage(), Toast.LENGTH_SHORT).show();
                }
            });
        } else {
            btnPdf.setText("📄 kein PDF");
            btnPdf.setBackgroundColor(Color.parseColor("#475569"));
            btnPdf.setEnabled(false);
        }
        btnRow.addView(btnPdf);
        card.addView(btnRow);

        llList.addView(card);
    }

    private static String formatDate(String isoDate) {
        if (isoDate == null || isoDate.isEmpty()) return "—";
        try {
            SimpleDateFormat in = new SimpleDateFormat("yyyy-MM-dd", Locale.GERMANY);
            SimpleDateFormat out = new SimpleDateFormat("dd.MM.yyyy", Locale.GERMANY);
            return out.format(in.parse(isoDate));
        } catch (Throwable t) { return isoDate; }
    }
    private static String strVal(Object v) { return v == null ? "" : String.valueOf(v); }
    private static double dblVal(Object v) {
        if (v == null) return 0;
        try { return v instanceof Number ? ((Number)v).doubleValue() : Double.parseDouble(String.valueOf(v)); }
        catch (Throwable t) { return 0; }
    }
}
