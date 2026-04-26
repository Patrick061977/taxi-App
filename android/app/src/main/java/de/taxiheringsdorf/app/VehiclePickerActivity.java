package de.taxiheringsdorf.app;

import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.os.Bundle;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;
import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.RecyclerView;
import com.google.firebase.auth.FirebaseAuth;
import com.google.firebase.auth.FirebaseUser;
import com.google.firebase.database.DataSnapshot;
import com.google.firebase.database.DatabaseError;
import com.google.firebase.database.FirebaseDatabase;
import com.google.firebase.database.ValueEventListener;
import java.util.ArrayList;
import java.util.List;

// v6.45.0: Fahrzeug-Auswahl nach Login. Zeigt alle aktiven Fahrzeuge aus /vehicles,
// User wählt → SharedPreferences gesetzt + DriverDashboardActivity öffnen.
public class VehiclePickerActivity extends AppCompatActivity {
    private static final String DB_INSTANCE_URL = "https://taxi-heringsdorf-default-rtdb.europe-west1.firebasedatabase.app";

    private RecyclerView rv;
    private ProgressBar progress;
    private TextView tvLoggedInAs;
    private VehicleAdapter adapter;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        setContentView(R.layout.activity_vehicle_picker);

        rv = findViewById(R.id.rv_vehicles);
        progress = findViewById(R.id.vehicle_progress);
        tvLoggedInAs = findViewById(R.id.tv_logged_in_as);
        rv.setLayoutManager(new LinearLayoutManager(this));
        adapter = new VehicleAdapter();
        rv.setAdapter(adapter);

        FirebaseUser u = FirebaseAuth.getInstance().getCurrentUser();
        if (u != null) {
            String label = u.getEmail() != null ? u.getEmail() : (u.getPhoneNumber() != null ? u.getPhoneNumber() : "Nutzer " + u.getUid());
            tvLoggedInAs.setText("Angemeldet als " + label);
        }

        loadVehicles();
    }

    private void loadVehicles() {
        progress.setVisibility(View.VISIBLE);
        FirebaseDatabase.getInstance(DB_INSTANCE_URL).getReference("vehicles")
            .addListenerForSingleValueEvent(new ValueEventListener() {
                @Override
                public void onDataChange(@NonNull DataSnapshot snapshot) {
                    progress.setVisibility(View.GONE);
                    List<Vehicle> vs = new ArrayList<>();
                    for (DataSnapshot c : snapshot.getChildren()) {
                        Vehicle v = Vehicle.fromSnap(c);
                        if (v == null) continue;
                        if (v.deactivated) continue;
                        vs.add(v);
                    }
                    vs.sort((a, b) -> {
                        int aPrio = a.priority != null ? a.priority : 99;
                        int bPrio = b.priority != null ? b.priority : 99;
                        if (aPrio != bPrio) return Integer.compare(aPrio, bPrio);
                        return (a.name != null ? a.name : "").compareTo(b.name != null ? b.name : "");
                    });
                    adapter.set(vs);
                    if (vs.isEmpty()) {
                        Toast.makeText(VehiclePickerActivity.this, "Keine aktiven Fahrzeuge gefunden", Toast.LENGTH_LONG).show();
                    }
                }
                @Override
                public void onCancelled(@NonNull DatabaseError error) {
                    progress.setVisibility(View.GONE);
                    Toast.makeText(VehiclePickerActivity.this, "Fehler: " + error.getMessage(), Toast.LENGTH_LONG).show();
                }
            });
    }

    private void selectVehicle(Vehicle v) {
        SharedPreferences.Editor e1 = getSharedPreferences("driver", MODE_PRIVATE).edit();
        e1.putString("vehicleId", v.id);
        if (v.name != null) e1.putString("vehicleName", v.name);
        e1.apply();
        SharedPreferences.Editor e2 = getSharedPreferences("fcm", MODE_PRIVATE).edit();
        e2.putString("vehicleId", v.id);
        e2.apply();

        // Cloud-side: setzt fcmToken-Vehicle-Mapping wenn Token schon vorhanden
        String token = getSharedPreferences("fcm", MODE_PRIVATE).getString("current_token", null);
        if (token != null && !token.isEmpty()) {
            FirebaseDatabase.getInstance(DB_INSTANCE_URL)
                .getReference("vehicles/" + v.id + "/fcmToken").setValue(token);
        }

        Toast.makeText(this, "✅ " + (v.name != null ? v.name : v.id) + " gewählt", Toast.LENGTH_SHORT).show();
        startActivity(new Intent(this, DriverDashboardActivity.class));
        finish();
    }

    static class Vehicle {
        String id, name;
        Integer capacity, priority;
        boolean deactivated;
        String shiftStatus;
        Boolean active;

        static Vehicle fromSnap(DataSnapshot s) {
            try {
                Vehicle v = new Vehicle();
                v.id = s.getKey();
                v.name = s.child("name").getValue(String.class);
                Object cap = s.child("capacity").getValue();
                if (cap instanceof Number) v.capacity = ((Number) cap).intValue();
                Object pri = s.child("priority").getValue();
                if (pri instanceof Number) v.priority = ((Number) pri).intValue();
                Boolean d = s.child("deactivated").getValue(Boolean.class);
                Boolean a = s.child("active").getValue(Boolean.class);
                v.deactivated = (d != null && d) || (a != null && !a);
                v.active = a;
                v.shiftStatus = s.child("shift").child("status").getValue(String.class);
                return v;
            } catch (Throwable _t) { return null; }
        }
    }

    class VehicleAdapter extends RecyclerView.Adapter<VehicleAdapter.VH> {
        private List<Vehicle> data = new ArrayList<>();
        void set(List<Vehicle> vs) { data = vs; notifyDataSetChanged(); }
        @NonNull @Override
        public VH onCreateViewHolder(@NonNull ViewGroup p, int t) {
            return new VH(LayoutInflater.from(p.getContext()).inflate(R.layout.item_vehicle_card, p, false));
        }
        @Override public void onBindViewHolder(@NonNull VH h, int pos) { h.bind(data.get(pos)); }
        @Override public int getItemCount() { return data.size(); }
        class VH extends RecyclerView.ViewHolder {
            TextView tvName, tvMeta, tvStatus;
            VH(View v) {
                super(v);
                tvName = v.findViewById(R.id.tv_vehicle_name);
                tvMeta = v.findViewById(R.id.tv_vehicle_meta);
                tvStatus = v.findViewById(R.id.tv_vehicle_status);
            }
            void bind(Vehicle v) {
                tvName.setText(v.name != null ? v.name : v.id);
                String meta = v.id;
                if (v.capacity != null) meta += " · " + v.capacity + " Pax";
                tvMeta.setText(meta);
                String st = v.shiftStatus != null ? v.shiftStatus : "frei";
                tvStatus.setText(st);
                int color;
                switch (st.toLowerCase()) {
                    case "active":     color = Color.parseColor("#10B981"); break;
                    case "paused":     color = Color.parseColor("#F59E0B"); break;
                    case "auto-ended": color = Color.parseColor("#EF4444"); break;
                    default:           color = Color.parseColor("#475569");
                }
                tvStatus.setBackgroundColor(color);
                itemView.setOnClickListener(_v -> selectVehicle(v));
            }
        }
    }
}
