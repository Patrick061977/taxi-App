// v6.63.915 (Patrick 19.08.2026 13:05): SMS-Übersicht heute mit Retry-Button.
// Zeigt alle smsQueue-Einträge des heutigen Tages mit Status-Badge (sent/pending/
// failed) und einem "Neu senden"-Button für Einträge die nicht durchgekommen sind.
// Setzt beim Retry status=pending_gateway_offline zurück + attempts=0, dann
// picks scheduledSmsRetry-Cron es alle 2 Min neu auf sobald das SMS-Gateway
// (Patricks eingeloggtes Handy) wieder online ist.
package de.taxiheringsdorf.app;

import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.RecyclerView;

import com.google.android.material.button.MaterialButton;
import com.google.firebase.database.DataSnapshot;
import com.google.firebase.database.DatabaseError;
import com.google.firebase.database.DatabaseReference;
import com.google.firebase.database.FirebaseDatabase;
import com.google.firebase.database.ValueEventListener;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;

public class SmsQueueActivity extends AppCompatActivity {
    private DatabaseReference db;
    private RecyclerView rv;
    private LinearLayout empty;
    private TextView tvGatewayStatus;
    private SmsAdapter adapter;
    private ValueEventListener smsListener;
    private ValueEventListener vehiclesListener;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_sms_queue);
        db = FirebaseDatabase.getInstance("https://taxi-heringsdorf-default-rtdb.europe-west1.firebasedatabase.app").getReference();
        rv = findViewById(R.id.rv_sms);
        empty = findViewById(R.id.empty_state);
        tvGatewayStatus = findViewById(R.id.tv_gateway_status);
        findViewById(R.id.btn_back).setOnClickListener(v -> finish());
        rv.setLayoutManager(new LinearLayoutManager(this));
        adapter = new SmsAdapter();
        rv.setAdapter(adapter);
        attachListeners();
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        if (smsListener != null) db.child("smsQueue").removeEventListener(smsListener);
        if (vehiclesListener != null) db.child("vehicles").removeEventListener(vehiclesListener);
    }

    private void attachListeners() {
        // 1) smsQueue: alle Einträge, im Adapter nach "heute" filtern
        smsListener = new ValueEventListener() {
            @Override public void onDataChange(@NonNull DataSnapshot snap) {
                Calendar cal = Calendar.getInstance(TimeZone.getTimeZone("Europe/Berlin"));
                cal.set(Calendar.HOUR_OF_DAY, 0);
                cal.set(Calendar.MINUTE, 0);
                cal.set(Calendar.SECOND, 0);
                cal.set(Calendar.MILLISECOND, 0);
                long todayStart = cal.getTimeInMillis();
                List<SmsEntry> list = new ArrayList<>();
                for (DataSnapshot c : snap.getChildren()) {
                    SmsEntry e = SmsEntry.fromSnap(c);
                    if (e == null) continue;
                    if (e.createdAt < todayStart) continue;
                    list.add(e);
                }
                Collections.sort(list, (a, b) -> Long.compare(b.createdAt, a.createdAt));
                adapter.set(list);
                empty.setVisibility(list.isEmpty() ? View.VISIBLE : View.GONE);
            }
            @Override public void onCancelled(@NonNull DatabaseError err) { }
        };
        db.child("smsQueue").addValueEventListener(smsListener);

        // 2) vehicles: Gateway-Status im Header anzeigen (welches Vehicle sendet gerade?)
        vehiclesListener = new ValueEventListener() {
            @Override public void onDataChange(@NonNull DataSnapshot snap) {
                db.child("settings/sms/gatewayUserId").get().addOnSuccessListener(gwSnap -> {
                    String gwUid = gwSnap.getValue(String.class);
                    if (gwUid == null) {
                        tvGatewayStatus.setText("Gateway: KEIN USER");
                        tvGatewayStatus.setBackgroundColor(Color.parseColor("#DC2626"));
                        return;
                    }
                    for (DataSnapshot v : snap.getChildren()) {
                        DataSnapshot sh = v.child("shift");
                        String status = sh.child("status").getValue(String.class);
                        String uid = sh.child("userId").getValue(String.class);
                        String name = v.child("name").getValue(String.class);
                        String token = v.child("fcmToken").child("token").getValue(String.class);
                        if (gwUid.equals(uid) && "active".equals(status) && token != null && !token.isEmpty()) {
                            tvGatewayStatus.setText("Gateway ✅ " + (name != null ? name : v.getKey()));
                            tvGatewayStatus.setBackgroundColor(Color.parseColor("#059669"));
                            return;
                        }
                    }
                    tvGatewayStatus.setText("Gateway ⚠️ nicht online");
                    tvGatewayStatus.setBackgroundColor(Color.parseColor("#F59E0B"));
                });
            }
            @Override public void onCancelled(@NonNull DatabaseError err) { }
        };
        db.child("vehicles").addValueEventListener(vehiclesListener);
    }

    private void retry(SmsEntry e) {
        java.util.Map<String, Object> upd = new java.util.HashMap<>();
        upd.put("status", "pending_gateway_offline");
        upd.put("attempts", 0);
        upd.put("firstAttemptAt", System.currentTimeMillis());
        upd.put("lastAttemptAt", null);
        upd.put("lastAttemptError", null);
        upd.put("bridgeWarnedAt", null);
        upd.put("retriedManuallyAt", System.currentTimeMillis());
        db.child("smsQueue/" + e.id).updateChildren(upd).addOnSuccessListener(v ->
                Toast.makeText(SmsQueueActivity.this, "🔄 Retry ausgelöst — Cron greift binnen 2 Min", Toast.LENGTH_SHORT).show()
        ).addOnFailureListener(err ->
                Toast.makeText(SmsQueueActivity.this, "Fehler: " + err.getMessage(), Toast.LENGTH_LONG).show()
        );
    }

    static class SmsEntry {
        String id, phone, text, status, error;
        long createdAt, sentAt;
        Integer attempts;

        static SmsEntry fromSnap(DataSnapshot c) {
            try {
                SmsEntry e = new SmsEntry();
                e.id = c.getKey();
                e.phone = c.child("phone").getValue(String.class);
                e.text = c.child("text").getValue(String.class);
                e.status = c.child("status").getValue(String.class);
                e.error = c.child("error").getValue(String.class);
                if (e.error == null) e.error = c.child("lastAttemptError").getValue(String.class);
                Object caObj = c.child("createdAt").getValue();
                if (caObj instanceof Long) e.createdAt = (Long) caObj;
                else if (caObj instanceof Number) e.createdAt = ((Number) caObj).longValue();
                Object saObj = c.child("sentAt").getValue();
                if (saObj instanceof Long) e.sentAt = (Long) saObj;
                else if (saObj instanceof Number) e.sentAt = ((Number) saObj).longValue();
                Object atObj = c.child("attempts").getValue();
                if (atObj instanceof Number) e.attempts = ((Number) atObj).intValue();
                return e;
            } catch (Exception ex) {
                return null;
            }
        }
    }

    class SmsAdapter extends RecyclerView.Adapter<SmsAdapter.VH> {
        List<SmsEntry> data = new ArrayList<>();
        SimpleDateFormat fmt = new SimpleDateFormat("HH:mm", Locale.GERMANY);
        SimpleDateFormat fmtFull = new SimpleDateFormat("HH:mm:ss", Locale.GERMANY);

        SmsAdapter() {
            fmt.setTimeZone(TimeZone.getTimeZone("Europe/Berlin"));
            fmtFull.setTimeZone(TimeZone.getTimeZone("Europe/Berlin"));
        }

        void set(List<SmsEntry> list) { data = list; notifyDataSetChanged(); }

        @NonNull @Override
        public VH onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
            View v = LayoutInflater.from(parent.getContext()).inflate(R.layout.item_sms_row, parent, false);
            return new VH(v);
        }

        @Override public void onBindViewHolder(@NonNull VH h, int pos) { h.bind(data.get(pos)); }
        @Override public int getItemCount() { return data.size(); }

        class VH extends RecyclerView.ViewHolder {
            TextView tvBadge, tvTime, tvPhone, tvPreview, tvMeta;
            MaterialButton btnRetry;

            VH(View v) {
                super(v);
                tvBadge = v.findViewById(R.id.tv_status_badge);
                tvTime = v.findViewById(R.id.tv_time);
                tvPhone = v.findViewById(R.id.tv_phone);
                tvPreview = v.findViewById(R.id.tv_text_preview);
                tvMeta = v.findViewById(R.id.tv_meta);
                btnRetry = v.findViewById(R.id.btn_retry);
            }

            void bind(SmsEntry e) {
                tvTime.setText(e.createdAt > 0 ? fmt.format(new java.util.Date(e.createdAt)) : "--:--");
                tvPhone.setText(e.phone != null ? e.phone : "?");
                tvPreview.setText(e.text != null ? e.text : "");
                String st = e.status != null ? e.status : "?";
                boolean canRetry = false;
                int color;
                String label;
                switch (st) {
                    case "sent":
                        label = "🟢 SENT";
                        color = Color.parseColor("#059669");
                        break;
                    case "fcm_sent":
                        label = "🟡 GESENDET (Handy quittiert noch)";
                        color = Color.parseColor("#F59E0B");
                        break;
                    case "pending":
                    case "pending_gateway_offline":
                        label = "🟡 PENDING";
                        color = Color.parseColor("#F59E0B");
                        canRetry = true;
                        break;
                    case "failed":
                        label = "🔴 FAILED";
                        color = Color.parseColor("#DC2626");
                        canRetry = true;
                        break;
                    default:
                        label = "⚪ " + st;
                        color = Color.parseColor("#475569");
                        canRetry = true;
                }
                tvBadge.setText(label);
                tvBadge.setBackgroundColor(color);

                StringBuilder meta = new StringBuilder();
                if (e.attempts != null && e.attempts > 0) meta.append(e.attempts).append(" Versuche · ");
                if (e.sentAt > 0) meta.append("gesendet ").append(fmtFull.format(new java.util.Date(e.sentAt))).append(" · ");
                if (e.error != null && !e.error.isEmpty()) meta.append(e.error);
                if (meta.length() > 3 && meta.charAt(meta.length() - 3) == '·') meta.setLength(meta.length() - 3);
                tvMeta.setText(meta.toString());
                tvMeta.setVisibility(meta.length() > 0 ? View.VISIBLE : View.GONE);

                btnRetry.setVisibility(canRetry ? View.VISIBLE : View.GONE);
                btnRetry.setOnClickListener(v -> retry(e));
            }
        }
    }
}
