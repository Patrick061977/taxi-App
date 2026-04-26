package de.taxiheringsdorf.app;

import android.Manifest;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.os.Bundle;
import android.provider.CallLog;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;
import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.RecyclerView;
import com.google.firebase.database.DatabaseReference;
import com.google.firebase.database.FirebaseDatabase;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

// v6.46.0: Anrufliste → neue Buchung
// User wählt Anruf aus letzten 30 → Dialog: EINSTEIGER mit Nummer ODER Vorbestellung anlegen.
public class CallLogActivity extends AppCompatActivity {
    private static final int REQ_PERM = 9001;
    private static final String DB_INSTANCE_URL = "https://taxi-heringsdorf-default-rtdb.europe-west1.firebasedatabase.app";

    private RecyclerView rv;
    private ProgressBar progress;
    private TextView permHint;
    private CallAdapter adapter;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        setContentView(R.layout.activity_call_log);

        rv = findViewById(R.id.rv_calls);
        progress = findViewById(R.id.calls_progress);
        permHint = findViewById(R.id.permission_hint);
        rv.setLayoutManager(new LinearLayoutManager(this));
        adapter = new CallAdapter();
        rv.setAdapter(adapter);

        if (ContextCompat.checkSelfPermission(this, Manifest.permission.READ_CALL_LOG) != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this, new String[]{Manifest.permission.READ_CALL_LOG, Manifest.permission.READ_CONTACTS}, REQ_PERM);
        } else {
            loadCalls();
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions, @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_PERM) {
            if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                permHint.setVisibility(View.GONE);
                loadCalls();
            } else {
                permHint.setVisibility(View.VISIBLE);
            }
        }
    }

    private void loadCalls() {
        progress.setVisibility(View.VISIBLE);
        new Thread(() -> {
            List<CallEntry> result = new ArrayList<>();
            try {
                String[] proj = {
                    CallLog.Calls.NUMBER,
                    CallLog.Calls.CACHED_NAME,
                    CallLog.Calls.DATE,
                    CallLog.Calls.TYPE,
                    CallLog.Calls.DURATION
                };
                Cursor c = getContentResolver().query(
                    CallLog.Calls.CONTENT_URI,
                    proj,
                    null, null,
                    CallLog.Calls.DATE + " DESC LIMIT 50"
                );
                if (c != null) {
                    while (c.moveToNext()) {
                        CallEntry e = new CallEntry();
                        e.number = c.getString(0);
                        e.name = c.getString(1);
                        e.date = c.getLong(2);
                        e.type = c.getInt(3);
                        e.durationSec = c.getLong(4);
                        if (e.number != null && !e.number.isEmpty()) result.add(e);
                    }
                    c.close();
                }
            } catch (Throwable t) {
                runOnUiThread(() -> Toast.makeText(this, "Anrufliste-Fehler: " + t.getMessage(), Toast.LENGTH_LONG).show());
            }
            runOnUiThread(() -> {
                progress.setVisibility(View.GONE);
                adapter.set(result);
                if (result.isEmpty()) Toast.makeText(this, "Keine Anrufe gefunden", Toast.LENGTH_SHORT).show();
            });
        }).start();
    }

    private void showActionDialog(CallEntry e) {
        String label = (e.name != null && !e.name.isEmpty() ? e.name + " — " : "") + e.number;
        new AlertDialog.Builder(this)
            .setTitle("📞 " + label)
            .setItems(new String[]{
                "🚖 EINSTEIGER mit dieser Nummer",
                "📅 Vorbestellung erstellen",
                "Abbrechen"
            }, (d, which) -> {
                switch (which) {
                    case 0: createEinsteigerWithPhone(e); break;
                    case 1: showPrebookingDialog(e); break;
                }
            })
            .show();
    }

    private void createEinsteigerWithPhone(CallEntry e) {
        String vehicleId = getSharedPreferences("driver", MODE_PRIVATE).getString("vehicleId", null);
        if (vehicleId == null) {
            Toast.makeText(this, "Kein Fahrzeug ausgewählt", Toast.LENGTH_SHORT).show();
            return;
        }
        DatabaseReference ref = FirebaseDatabase.getInstance(DB_INSTANCE_URL).getReference("rides").push();
        long now = System.currentTimeMillis();
        Map<String, Object> r = new HashMap<>();
        r.put("customerName", e.name != null && !e.name.isEmpty() ? e.name : "Einsteiger");
        r.put("customerPhone", e.number);
        r.put("customerMobile", e.number);
        r.put("vehicleId", vehicleId);
        r.put("status", "picked_up");
        r.put("pickup", "Standort Fahrer");
        r.put("destination", "");
        r.put("pickupTimestamp", now);
        r.put("createdAt", now);
        r.put("updatedAt", now);
        r.put("acceptedAt", now);
        r.put("acceptedVia", "native_dashboard_einsteiger_calllog");
        r.put("source", "native_einsteiger_call");
        r.put("isInsteiger", true);
        r.put("passengers", 1);
        ref.setValue(r).addOnSuccessListener(_v -> {
            Toast.makeText(this, "✅ EINSTEIGER angelegt mit " + e.number, Toast.LENGTH_SHORT).show();
            startActivity(new Intent(this, DriverDashboardActivity.class));
            finish();
        }).addOnFailureListener(ex -> Toast.makeText(this, "Fehler: " + ex.getMessage(), Toast.LENGTH_LONG).show());
    }

    private void showPrebookingDialog(CallEntry e) {
        // Vereinfachter Vorbestellungs-Dialog: Name (vorausgefüllt), Pickup, Ziel, Zeit (Std + Min), Datum optional
        Toast.makeText(this, "Vorbestellungs-Dialog kommt in v6.46.1 — bis dahin Web-App nutzen", Toast.LENGTH_LONG).show();
        // TODO v6.46.1: AlertDialog mit Pickup/Dest/Datum/Zeit + EditTexts
    }

    static class CallEntry {
        String number, name;
        long date;
        long durationSec;
        int type; // 1=incoming, 2=outgoing, 3=missed, 4=voicemail, 5=rejected, 6=blocked
    }

    class CallAdapter extends RecyclerView.Adapter<CallAdapter.VH> {
        private List<CallEntry> data = new ArrayList<>();
        void set(List<CallEntry> e) { data = e; notifyDataSetChanged(); }
        @NonNull @Override
        public VH onCreateViewHolder(@NonNull ViewGroup p, int t) {
            return new VH(LayoutInflater.from(p.getContext()).inflate(R.layout.item_call_card, p, false));
        }
        @Override public void onBindViewHolder(@NonNull VH h, int pos) { h.bind(data.get(pos)); }
        @Override public int getItemCount() { return data.size(); }
        class VH extends RecyclerView.ViewHolder {
            TextView tvIcon, tvName, tvNumber, tvTime;
            VH(View v) {
                super(v);
                tvIcon = v.findViewById(R.id.tv_call_icon);
                tvName = v.findViewById(R.id.tv_call_name);
                tvNumber = v.findViewById(R.id.tv_call_number);
                tvTime = v.findViewById(R.id.tv_call_time);
            }
            void bind(CallEntry e) {
                String emoji;
                switch (e.type) {
                    case 1: emoji = "📥"; break; // incoming
                    case 2: emoji = "📤"; break; // outgoing
                    case 3: emoji = "❌"; break; // missed
                    default: emoji = "📞";
                }
                tvIcon.setText(emoji);
                tvName.setText(e.name != null && !e.name.isEmpty() ? e.name : "(Unbekannt)");
                tvNumber.setText(e.number);
                long ageSec = (System.currentTimeMillis() - e.date) / 1000;
                String age;
                if (ageSec < 60) age = ageSec + "s";
                else if (ageSec < 3600) age = (ageSec / 60) + " Min";
                else if (ageSec < 86400) age = (ageSec / 3600) + " Std";
                else age = (ageSec / 86400) + " Tagen";
                tvTime.setText("vor " + age + (e.durationSec > 0 ? " · Dauer " + e.durationSec + "s" : ""));
                itemView.setOnClickListener(_v -> showActionDialog(e));
            }
        }
    }
}
