package de.taxiheringsdorf.app;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.DatePickerDialog;
import android.app.TimePickerDialog;
import android.text.InputType;
import android.util.Log;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import com.google.firebase.database.DatabaseReference;
import com.google.firebase.database.FirebaseDatabase;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Collections;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.TimeZone;

/**
 * v6.63.077 (Patrick 01.06. Bridge "auch aus CRM-Suche / Aufnahme / Anrufliste"):
 * Helper-Klasse für das Multi-Day-Copy-Modal. Wird von AdminDashboardActivity
 * (Edit-Dialog + Neue-Buchung) und von CrmSearchActivity (Vorbestellung-Maske)
 * gleichermaßen aufgerufen.
 *
 * Legt N Vorbestellungen mit gemeinsamer seriesId/seriesIndex/seriesTotal/
 * seriesAllDates an + EINE Sammel-SMS in /smsQueue. Cloud onRideCreated
 * skippt die N Einzel-Bestätigungen bei seriesId (siehe PR #2118).
 */
public final class MultiDayCopySheet {

    private static final String TAG = "MultiDayCopySheet";

    private MultiDayCopySheet() {}

    public static void show(
        final Activity ctx,
        final String dbInstanceUrl,
        final String customerName,
        final String customerPhone,
        final String customerId,
        final String pickup,
        final String destination,
        final Double pickupLat,
        final Double pickupLon,
        final Double destLat,
        final Double destLon,
        final int passengers,
        final Long defaultPickupTimestamp
    ) {
        final List<String> selectedDates = new ArrayList<>();
        final int pad = (int)(ctx.getResources().getDisplayMetrics().density * 16);
        final SimpleDateFormat dateFmt = new SimpleDateFormat("yyyy-MM-dd", Locale.GERMANY);
        final SimpleDateFormat displayFmt = new SimpleDateFormat("EEE dd.MM.yyyy", Locale.GERMANY);
        dateFmt.setTimeZone(TimeZone.getTimeZone("Europe/Berlin"));
        displayFmt.setTimeZone(TimeZone.getTimeZone("Europe/Berlin"));

        LinearLayout root = new LinearLayout(ctx);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(pad, pad, pad, pad);

        TextView tvHeader = new TextView(ctx);
        tvHeader.setText("📋 " + (customerName != null ? customerName : "?") + "\n📍 "
            + (pickup != null ? pickup : "?") + "\n🎯 " + (destination != null ? destination : "?"));
        tvHeader.setTextSize(13);
        tvHeader.setPadding(0, 0, 0, pad);
        root.addView(tvHeader);

        TextView tvTimeLabel = new TextView(ctx);
        tvTimeLabel.setText("Uhrzeit für alle Kopien:");
        tvTimeLabel.setTextSize(12);
        root.addView(tvTimeLabel);

        final EditText etTime = new EditText(ctx);
        etTime.setInputType(InputType.TYPE_NULL);
        etTime.setFocusable(false);
        etTime.setKeyListener(null);
        String origTime = "08:00";
        if (defaultPickupTimestamp != null && defaultPickupTimestamp > 0) {
            SimpleDateFormat tf = new SimpleDateFormat("HH:mm", Locale.GERMANY);
            tf.setTimeZone(TimeZone.getTimeZone("Europe/Berlin"));
            origTime = tf.format(new Date(defaultPickupTimestamp));
        }
        etTime.setText(origTime);
        etTime.setOnClickListener(_v -> {
            String[] parts = etTime.getText().toString().split(":");
            int h = (parts.length >= 2) ? Integer.parseInt(parts[0]) : 8;
            int m = (parts.length >= 2) ? Integer.parseInt(parts[1]) : 0;
            new TimePickerDialog(ctx,
                (tp, h2, m2) -> etTime.setText(String.format(Locale.GERMANY, "%02d:%02d", h2, m2)),
                h, m, true).show();
        });
        root.addView(etTime);

        TextView tvDateLabel = new TextView(ctx);
        tvDateLabel.setText("\nTage hinzufügen:");
        tvDateLabel.setTextSize(12);
        root.addView(tvDateLabel);

        LinearLayout dateRow = new LinearLayout(ctx);
        dateRow.setOrientation(LinearLayout.HORIZONTAL);
        final EditText etDate = new EditText(ctx);
        etDate.setInputType(InputType.TYPE_NULL);
        etDate.setFocusable(false);
        etDate.setKeyListener(null);
        Calendar tomorrow = Calendar.getInstance();
        tomorrow.add(Calendar.DAY_OF_MONTH, 1);
        etDate.setText(dateFmt.format(tomorrow.getTime()));
        LinearLayout.LayoutParams dateFlex = new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
        etDate.setLayoutParams(dateFlex);
        etDate.setOnClickListener(_v -> {
            String[] parts = etDate.getText().toString().split("-");
            Calendar c = Calendar.getInstance();
            if (parts.length == 3) {
                try { c.set(Integer.parseInt(parts[0]), Integer.parseInt(parts[1]) - 1, Integer.parseInt(parts[2])); }
                catch (Throwable _t) {}
            }
            new DatePickerDialog(ctx,
                (dp, y, mo, dy) -> etDate.setText(String.format(Locale.GERMANY, "%04d-%02d-%02d", y, mo + 1, dy)),
                c.get(Calendar.YEAR), c.get(Calendar.MONTH), c.get(Calendar.DAY_OF_MONTH)).show();
        });
        dateRow.addView(etDate);

        final TextView tvDatesList = new TextView(ctx);
        tvDatesList.setText("(keine Tage)");
        tvDatesList.setTextSize(12);
        tvDatesList.setPadding(0, pad, 0, pad);
        final TextView tvDatesCount = new TextView(ctx);
        tvDatesCount.setText("0 Tage ausgewählt");
        tvDatesCount.setTextSize(12);

        final Runnable[] renderHolder = new Runnable[1];
        renderHolder[0] = () -> {
            Collections.sort(selectedDates);
            tvDatesCount.setText(selectedDates.size() + " Tag" + (selectedDates.size() == 1 ? "" : "e") + " ausgewählt");
            if (selectedDates.isEmpty()) {
                tvDatesList.setText("(keine Tage)");
            } else {
                StringBuilder sb = new StringBuilder();
                for (String ds : selectedDates) {
                    try {
                        Date d = dateFmt.parse(ds);
                        sb.append("• ").append(displayFmt.format(d)).append("\n");
                    } catch (Throwable _t) {
                        sb.append("• ").append(ds).append("\n");
                    }
                }
                tvDatesList.setText(sb.toString().trim());
            }
        };

        com.google.android.material.button.MaterialButton btnAdd = new com.google.android.material.button.MaterialButton(ctx);
        btnAdd.setText("+ Tag");
        btnAdd.setTextSize(12);
        btnAdd.setOnClickListener(_v -> {
            String ds = etDate.getText().toString();
            if (!selectedDates.contains(ds)) {
                selectedDates.add(ds);
                renderHolder[0].run();
            }
            try {
                Date d = dateFmt.parse(ds);
                Calendar c = Calendar.getInstance();
                c.setTime(d);
                c.add(Calendar.DAY_OF_MONTH, 1);
                etDate.setText(dateFmt.format(c.getTime()));
            } catch (Throwable _t) {}
        });
        dateRow.addView(btnAdd);
        root.addView(dateRow);

        LinearLayout.LayoutParams qp = new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
        LinearLayout quickRow = new LinearLayout(ctx);
        quickRow.setOrientation(LinearLayout.HORIZONTAL);

        com.google.android.material.button.MaterialButton btn7 = new com.google.android.material.button.MaterialButton(ctx);
        btn7.setText("+7 Tage");
        btn7.setTextSize(11);
        btn7.setLayoutParams(qp);
        btn7.setOnClickListener(_v -> addRangeOfDays(etDate, selectedDates, 7, false, dateFmt, renderHolder[0]));
        quickRow.addView(btn7);

        com.google.android.material.button.MaterialButton btnMoFr = new com.google.android.material.button.MaterialButton(ctx);
        btnMoFr.setText("+Mo-Fr");
        btnMoFr.setTextSize(11);
        btnMoFr.setLayoutParams(qp);
        btnMoFr.setOnClickListener(_v -> addRangeOfDays(etDate, selectedDates, 14, true, dateFmt, renderHolder[0]));
        quickRow.addView(btnMoFr);

        com.google.android.material.button.MaterialButton btnClear = new com.google.android.material.button.MaterialButton(ctx);
        btnClear.setText("Alle ✕");
        btnClear.setTextSize(11);
        btnClear.setLayoutParams(qp);
        btnClear.setOnClickListener(_v -> {
            selectedDates.clear();
            renderHolder[0].run();
        });
        quickRow.addView(btnClear);
        root.addView(quickRow);
        root.addView(tvDatesCount);
        root.addView(tvDatesList);

        ScrollView scroll = new ScrollView(ctx);
        scroll.addView(root);

        AlertDialog dlg = new AlertDialog.Builder(ctx)
            .setTitle("📋 Auf mehrere Tage kopieren")
            .setView(scroll)
            .setPositiveButton("✅ Jetzt kopieren", null)
            .setNegativeButton("Abbrechen", null)
            .create();
        dlg.show();
        dlg.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(_v -> {
            if (selectedDates.isEmpty()) {
                Toast.makeText(ctx, "Bitte mindestens einen Tag wählen", Toast.LENGTH_SHORT).show();
                return;
            }
            String timeStr = etTime.getText().toString();
            if (!timeStr.matches("\\d{2}:\\d{2}")) {
                Toast.makeText(ctx, "Bitte Uhrzeit eingeben (HH:MM)", Toast.LENGTH_SHORT).show();
                return;
            }
            dlg.dismiss();
            executeMultiDayCopy(ctx, dbInstanceUrl,
                customerName, customerPhone, customerId,
                pickup, destination,
                pickupLat, pickupLon, destLat, destLon,
                passengers,
                new ArrayList<>(selectedDates), timeStr);
        });
        renderHolder[0].run();
    }

    private static void addRangeOfDays(EditText etDate, List<String> selectedDates,
                                       int days, boolean weekdaysOnly,
                                       SimpleDateFormat dateFmt, Runnable render) {
        try {
            Date d = dateFmt.parse(etDate.getText().toString());
            Calendar c = Calendar.getInstance();
            c.setTime(d);
            for (int i = 0; i < days; i++) {
                if (weekdaysOnly) {
                    int dow = c.get(Calendar.DAY_OF_WEEK);
                    if (dow == Calendar.SATURDAY || dow == Calendar.SUNDAY) {
                        c.add(Calendar.DAY_OF_MONTH, 1);
                        continue;
                    }
                }
                String ds = dateFmt.format(c.getTime());
                if (!selectedDates.contains(ds)) selectedDates.add(ds);
                c.add(Calendar.DAY_OF_MONTH, 1);
            }
            render.run();
        } catch (Throwable _t) {
            Log.w(TAG, "addRangeOfDays: " + _t.getMessage());
        }
    }

    private static void executeMultiDayCopy(
        final Activity ctx,
        final String dbInstanceUrl,
        final String customerName,
        final String customerPhone,
        final String customerId,
        final String pickup,
        final String destination,
        final Double pickupLat,
        final Double pickupLon,
        final Double destLat,
        final Double destLon,
        final int passengers,
        final List<String> dates,
        final String timeStr
    ) {
        if (dates == null || dates.isEmpty()) return;
        Collections.sort(dates);
        SimpleDateFormat dateTimeFmt = new SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.GERMANY);
        dateTimeFmt.setTimeZone(TimeZone.getTimeZone("Europe/Berlin"));
        SimpleDateFormat prettyFmt = new SimpleDateFormat("dd.MM.yyyy", Locale.GERMANY);
        prettyFmt.setTimeZone(TimeZone.getTimeZone("Europe/Berlin"));

        final long now = System.currentTimeMillis();
        final int total = dates.size();
        FirebaseDatabase db = FirebaseDatabase.getInstance(dbInstanceUrl);
        final String seriesId = db.getReference("rides").push().getKey();

        List<String> allDatesPretty = new ArrayList<>();
        List<String> allDatesIso = new ArrayList<>();
        for (String ds : dates) {
            try {
                Date d = dateTimeFmt.parse(ds + " " + timeStr);
                allDatesPretty.add(prettyFmt.format(d) + " " + timeStr);
                allDatesIso.add(ds + " " + timeStr);
            } catch (Throwable _t) {}
        }

        Map<String, Object> updates = new HashMap<>();
        int idx = 0;
        for (String ds : dates) {
            idx++;
            Long pickupTs;
            try {
                pickupTs = dateTimeFmt.parse(ds + " " + timeStr).getTime();
            } catch (Throwable _t) { continue; }

            Map<String, Object> newRide = new HashMap<>();
            if (customerName != null) newRide.put("customerName", customerName);
            if (customerPhone != null) {
                newRide.put("customerPhone", customerPhone);
                newRide.put("customerMobile", customerPhone);
            }
            if (customerId != null && !customerId.isEmpty()) newRide.put("customerId", customerId);
            if (pickup != null) newRide.put("pickup", pickup);
            if (destination != null) newRide.put("destination", destination);
            if (pickupLat != null && !Double.isNaN(pickupLat)) newRide.put("pickupLat", pickupLat);
            if (pickupLon != null && !Double.isNaN(pickupLon)) newRide.put("pickupLon", pickupLon);
            if (destLat != null && !Double.isNaN(destLat)) newRide.put("destinationLat", destLat);
            if (destLon != null && !Double.isNaN(destLon)) newRide.put("destinationLon", destLon);
            newRide.put("passengers", passengers);
            newRide.put("status", "vorbestellt");
            newRide.put("pickupTimestamp", pickupTs);
            newRide.put("pickupTime", timeStr);
            newRide.put("createdAt", now);
            newRide.put("updatedAt", now);
            newRide.put("source", "native_series_multi_copy");
            newRide.put("seriesId", seriesId);
            newRide.put("seriesIndex", idx);
            newRide.put("seriesTotal", total);
            newRide.put("seriesAllDates", allDatesIso);

            String rideKey = (idx == 1) ? seriesId : db.getReference("rides").push().getKey();
            updates.put("/rides/" + rideKey, newRide);
        }

        if (customerPhone != null && customerPhone.replaceAll("[^0-9]", "").length() >= 8) {
            StringBuilder smsText = new StringBuilder();
            smsText.append("Funktaxi Heringsdorf: Hallo ");
            smsText.append(customerName != null ? customerName : "Kunde");
            smsText.append(", wir bestätigen Ihre ").append(total).append(" Termine:\n");
            for (String pretty : allDatesPretty) smsText.append("• ").append(pretty).append("\n");
            smsText.append("Alle Fahrten ").append(pickup != null ? pickup : "");
            smsText.append(" → ").append(destination != null ? destination : "");
            smsText.append("\nBei Fragen 038378/22022.");

            Map<String, Object> sms = new HashMap<>();
            sms.put("phone", customerPhone);
            sms.put("text", smsText.toString());
            sms.put("seriesId", seriesId);
            sms.put("type", "series_confirmation");
            sms.put("status", "pending");
            sms.put("createdAt", now);
            sms.put("createdBy", "native_series_multi_copy-v6.63.077");
            String smsKey = db.getReference("smsQueue").push().getKey();
            updates.put("/smsQueue/" + smsKey, sms);
        }

        db.getReference().updateChildren(updates).addOnCompleteListener(task -> {
            if (task.isSuccessful()) {
                Toast.makeText(ctx, "✅ " + total + " Termine angelegt + Sammel-SMS", Toast.LENGTH_LONG).show();
            } else {
                Toast.makeText(ctx, "❌ Fehler: " + (task.getException() != null ? task.getException().getMessage() : "?"), Toast.LENGTH_LONG).show();
            }
        });
    }
}
