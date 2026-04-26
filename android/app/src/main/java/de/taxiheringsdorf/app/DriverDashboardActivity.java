package de.taxiheringsdorf.app;

import android.app.AlertDialog;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.InputType;
import android.util.Log;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.PopupMenu;
import android.widget.TextView;
import android.widget.Toast;
import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.RecyclerView;
import com.google.android.material.button.MaterialButton;
import com.google.firebase.auth.FirebaseAuth;
import com.google.firebase.auth.FirebaseUser;
import com.google.firebase.database.DataSnapshot;
import com.google.firebase.database.DatabaseError;
import com.google.firebase.database.DatabaseReference;
import com.google.firebase.database.FirebaseDatabase;
import com.google.firebase.database.Query;
import com.google.firebase.database.ValueEventListener;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

// v6.43.0: Phase 3a — Driver Dashboard mit allen wichtigen Aktionen.
// Status-Workflow (accepted → on_way → arrived → picked_up → completed),
// Navigation (Google Maps), Anruf, SMS-Tracking, Stornieren, EINSTEIGER (walk-in),
// Online-Toggle, Schicht-Timer, Tagesverdienst.
public class DriverDashboardActivity extends AppCompatActivity {

    private static final String TAG = "DriverDashboard";
    private static final String DB_INSTANCE_URL = "https://taxi-heringsdorf-default-rtdb.europe-west1.firebasedatabase.app";
    private static final String TRACKING_BASE = "https://umwelt-taxi-insel-usedom.de/Taxi-App/track.html?ride=";

    private TextView tvVehicleInfo, tvShiftStatus, tvShiftDetail, tvShiftTimer, tvTodayEarnings;
    private MaterialButton btnMenu, btnEinsteiger, btnCallLog;
    // v6.50.0: Update-Banner
    private LinearLayout updateBanner;
    private TextView updateBannerText;
    private MaterialButton updateBannerBtn;
    private LinearLayout shiftStatsRow;
    private RecyclerView rvRides;
    private LinearLayout emptyState;
    private RideAdapter rideAdapter;

    private FirebaseDatabase db;
    private String currentVehicleId;
    private DatabaseReference vehicleRef;
    private Query ridesQuery;
    private Query todayCompletedQuery;
    private Query openRidesQuery;
    private ValueEventListener shiftListener;
    private ValueEventListener ridesListener;
    private ValueEventListener todayCompletedListener;
    private ValueEventListener openRidesListener;
    // v6.43.1: Cache der zugewiesenen + offenen Fahrten getrennt → mergen vor Anzeige
    private List<Ride> myAssignedRides = new ArrayList<>();
    private List<Ride> openUnassignedRides = new ArrayList<>();

    private boolean shiftActive = false;
    private boolean onlineState = true;
    private Long shiftStartTime = null;
    private double todayEarnings = 0.0;
    private final Handler timerHandler = new Handler(Looper.getMainLooper());
    private final Runnable timerTick = new Runnable() {
        @Override
        public void run() {
            updateShiftTimer();
            timerHandler.postDelayed(this, 1000);
        }
    };
    // v6.50.1: Vehicle-Lock — Heartbeat alle 60s in /vehicles/{vid}/activeDevice/lastHeartbeat
    // damit andere Handys sehen dass dieses Fahrzeug aktiv ist. Ohne Heartbeat ist der
    // Lock nach 5 Min veraltet (siehe VehiclePickerActivity.STALE_LOCK_MS).
    private static final long LOCK_HEARTBEAT_MS = 60 * 1000L;
    private final Handler lockHandler = new Handler(Looper.getMainLooper());
    private boolean lockStolenDialogShown = false;
    private final Runnable lockHeartbeatTick = new Runnable() {
        @Override
        public void run() {
            sendLockHeartbeat();
            lockHandler.postDelayed(this, LOCK_HEARTBEAT_MS);
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        setContentView(R.layout.activity_driver_dashboard);

        // v6.42.3: Optionaler Intent-Extra für ADB-Setup ohne WebView-Login
        String intentVehicleId = getIntent() != null ? getIntent().getStringExtra("setVehicleId") : null;
        if (intentVehicleId != null && !intentVehicleId.isEmpty()) {
            getSharedPreferences("driver", MODE_PRIVATE).edit().putString("vehicleId", intentVehicleId).apply();
            getSharedPreferences("fcm", MODE_PRIVATE).edit().putString("vehicleId", intentVehicleId).apply();
            Log.i(TAG, "vehicleId via Intent-Extra gesetzt: " + intentVehicleId);
        }

        tvVehicleInfo = findViewById(R.id.tv_vehicle_info);
        tvShiftStatus = findViewById(R.id.tv_shift_status);
        tvShiftDetail = findViewById(R.id.tv_shift_detail);
        tvShiftTimer = findViewById(R.id.tv_shift_timer);
        tvTodayEarnings = findViewById(R.id.tv_today_earnings);
        btnMenu = findViewById(R.id.btn_menu);
        btnEinsteiger = findViewById(R.id.btn_einsteiger);
        btnCallLog = findViewById(R.id.btn_call_log);
        shiftStatsRow = findViewById(R.id.shift_stats_row);
        rvRides = findViewById(R.id.rv_rides);
        emptyState = findViewById(R.id.empty_state);
        updateBanner = findViewById(R.id.update_banner);
        updateBannerText = findViewById(R.id.update_banner_text);
        updateBannerBtn = findViewById(R.id.update_banner_btn);

        rvRides.setLayoutManager(new LinearLayoutManager(this));
        rideAdapter = new RideAdapter();
        rvRides.setAdapter(rideAdapter);

        SharedPreferences prefs = getSharedPreferences("driver", MODE_PRIVATE);
        currentVehicleId = prefs.getString("vehicleId", null);
        if (currentVehicleId == null) {
            SharedPreferences fcmPrefs = getSharedPreferences("fcm", MODE_PRIVATE);
            currentVehicleId = fcmPrefs.getString("vehicleId", null);
        }

        if (currentVehicleId == null) {
            // v6.45.0: Kein Fahrzeug → zu LoginActivity weiterleiten
            startActivity(new Intent(this, LoginActivity.class));
            finish();
            return;
        }
        String vehicleName = prefs.getString("vehicleName", null);
        // v6.51.1: Version direkt unter dem Fahrzeug anzeigen — Patrick wollte sehen
        // welche Version drauf ist ohne in Android-Settings graben zu müssen.
        String appVer = "?";
        try { appVer = getPackageManager().getPackageInfo(getPackageName(), 0).versionName; }
        catch (Throwable _t) {}
        String vText = (vehicleName != null ? vehicleName + " (" + currentVehicleId + ")" : "Fahrzeug: " + currentVehicleId)
            + " · v" + appVer;
        tvVehicleInfo.setText(vText);
        connectFirebase();

        btnMenu.setOnClickListener(v -> showHamburgerMenu(v));
        btnEinsteiger.setOnClickListener(v -> showEinsteigerDialog());
        btnCallLog.setOnClickListener(v -> startActivity(new Intent(this, CallLogActivity.class)));

        // v6.50.0: Update-Check beim Start
        // v6.52.1: nutzt jetzt geteilte UpdateChecker-Klasse (gleiche Logik im LoginActivity)
        UpdateChecker.checkAsync(this, updateBanner, updateBannerText, updateBannerBtn);

        // v6.50.1: Lock direkt setzen (falls Activity ohne VehiclePicker geöffnet wird —
        // z.B. nach App-Restart) und Heartbeat-Loop starten
        sendLockHeartbeat();
        lockHandler.postDelayed(lockHeartbeatTick, LOCK_HEARTBEAT_MS);
    }

    private void connectFirebase() {
        try {
            db = FirebaseDatabase.getInstance(DB_INSTANCE_URL);
            vehicleRef = db.getReference("vehicles/" + currentVehicleId);
            shiftListener = new ValueEventListener() {
                @Override public void onDataChange(@NonNull DataSnapshot s) { onVehicleUpdate(s); }
                @Override public void onCancelled(@NonNull DatabaseError error) { Log.e(TAG, "Vehicle: " + error.getMessage()); }
            };
            vehicleRef.addValueEventListener(shiftListener);

            ridesQuery = db.getReference("rides").orderByChild("vehicleId").equalTo(currentVehicleId);
            ridesListener = new ValueEventListener() {
                @Override public void onDataChange(@NonNull DataSnapshot s) { onRidesUpdate(s); }
                @Override public void onCancelled(@NonNull DatabaseError error) { Log.e(TAG, "Rides: " + error.getMessage()); }
            };
            ridesQuery.addValueEventListener(ridesListener);

            // Today-completed-Listener für Tagesverdienst
            todayCompletedQuery = db.getReference("rides").orderByChild("vehicleId").equalTo(currentVehicleId);
            todayCompletedListener = new ValueEventListener() {
                @Override public void onDataChange(@NonNull DataSnapshot s) { calcTodayEarnings(s); }
                @Override public void onCancelled(@NonNull DatabaseError error) { Log.e(TAG, "Earnings: " + error.getMessage()); }
            };
            // gleicher Query — nutzt Cache
            todayCompletedQuery.addValueEventListener(todayCompletedListener);

            // v6.47.1: Server-side Filter — nur status='warteschlange' (war vorher .getReference('rides')
            // mit Client-side-Filter, das hat ALLE rides bei jedem Update gestreamt = ~5MB pro Update,
            // bei 5 Fahrer-Handys × 100 Updates/Tag = 75GB/Monat = ~75€ unnötige Bandwidth.
            // Jetzt: nur die warteschlange-Einträge — meistens 0-2 Stück.
            openRidesQuery = db.getReference("rides").orderByChild("status").equalTo("warteschlange");
            openRidesListener = new ValueEventListener() {
                @Override public void onDataChange(@NonNull DataSnapshot s) { onOpenRidesUpdate(s); }
                @Override public void onCancelled(@NonNull DatabaseError error) { Log.e(TAG, "OpenRides: " + error.getMessage()); }
            };
            openRidesQuery.addValueEventListener(openRidesListener);
        } catch (Throwable t) {
            Log.e(TAG, "Firebase-Setup Fehler: " + t.getMessage());
            tvVehicleInfo.setText("⚠️ Firebase-Verbindungsfehler: " + t.getMessage());
        }
    }

    private void onVehicleUpdate(DataSnapshot s) {
        // v6.50.1/v6.51.3: Lock-Stolen-Check — Patrick hat berichtet dass er sich gegenseitig
        // ausloggt weil seine 2 Geräte verschiedene Firebase-UIDs haben (Email-Login vs
        // Phone-Login = 2 separate Auth-Identities für dieselbe Person). Bis Account-Linking
        // in v6.52 steht, KEIN auto-Logout mehr — nur ein leichter Toast-Hinweis. Lock-Daten
        // bleiben erhalten + werden im VehiclePicker angezeigt, aber keine Erzwingung.
        DataSnapshot dev = s.child("activeDevice");
        if (dev.exists() && !lockStolenDialogShown) {
            String lockUid = dev.child("uid").getValue(String.class);
            FirebaseUser fu = FirebaseAuth.getInstance().getCurrentUser();
            String myUid = fu != null ? fu.getUid() : "anon-" + Build.MODEL;
            if (lockUid != null && !lockUid.equals(myUid)) {
                String otherLabel = dev.child("label").getValue(String.class);
                lockStolenDialogShown = true;
                runOnUiThread(() -> Toast.makeText(this,
                    "⚠️ Tesla auch aktiv auf " + (otherLabel != null ? otherLabel : "anderem Gerät"),
                    Toast.LENGTH_LONG).show());
                // KEIN return — wir bleiben drauf
            }
        }

        Object shiftObj = s.child("shift").getValue();
        Object onlineObj = s.child("online").getValue();
        String status = "?";
        Long lastHb = null;
        Long startTime = null;
        if (shiftObj instanceof java.util.Map) {
            java.util.Map<?, ?> m = (java.util.Map<?, ?>) shiftObj;
            Object st = m.get("status");
            if (st != null) status = String.valueOf(st);
            Object hb = m.get("lastHeartbeat");
            if (hb instanceof Long) lastHb = (Long) hb;
            else if (hb instanceof Number) lastHb = ((Number) hb).longValue();
            Object stt = m.get("startTime");
            if (stt instanceof Long) startTime = (Long) stt;
            else if (stt instanceof Number) startTime = ((Number) stt).longValue();
        }
        shiftActive = "active".equals(status);
        shiftStartTime = startTime;

        if (onlineObj instanceof Boolean) onlineState = (Boolean) onlineObj;

        // v6.51.2: Schicht-Recovery — wenn Firebase 'aktiv' meldet aber Foreground-Service
        // tot ist (App-Update, Force-Stop, OS-Kill), starte den Service neu damit GPS+Heartbeat
        // und die Status-Notification (Icon oben in Statusleiste) wieder laufen.
        // Patrick hat das nach v6.51.0-Install bemerkt: 'oben in der Startungsleiste ist die App nicht mehr zu sehen'.
        if (shiftActive && !ShiftForegroundService.isRunning() && currentVehicleId != null) {
            try {
                Intent svc = new Intent(this, ShiftForegroundService.class);
                svc.setAction(ShiftForegroundService.ACTION_START);
                svc.putExtra(ShiftForegroundService.EXTRA_VEHICLE_ID, currentVehicleId);
                svc.putExtra(ShiftForegroundService.EXTRA_CONTENT_TEXT, "Schicht aktiv (recovered nach App-Restart)");
                startForegroundService(svc);
                Log.i(TAG, "🔄 Schicht-Recovery: Foreground-Service neu gestartet");
            } catch (Throwable t) {
                Log.w(TAG, "🔄 Schicht-Recovery fehlgeschlagen: " + t.getMessage());
            }
        }

        // v6.47.0: Mini-Status-Badge im Header (statt großer Schicht-Karte)
        if (shiftActive) {
            tvShiftStatus.setText(onlineState ? "🟢 Aktiv" : "⏸ Pause");
            tvShiftStatus.setBackgroundColor(onlineState ? Color.parseColor("#10B981") : Color.parseColor("#F59E0B"));
            String detail = "";
            if (lastHb != null) {
                long ageSec = (System.currentTimeMillis() - lastHb) / 1000;
                detail = "GPS vor " + ageSec + "s";
            }
            tvShiftDetail.setText(detail);
            shiftStatsRow.setVisibility(View.VISIBLE);
            timerHandler.removeCallbacks(timerTick);
            timerHandler.post(timerTick);
        } else {
            tvShiftStatus.setText("auto-ended".equals(status) ? "⚠ Auto-Ende" : "⏸ Aus");
            tvShiftStatus.setBackgroundColor("auto-ended".equals(status) ? Color.parseColor("#EF4444") : Color.parseColor("#475569"));
            tvShiftDetail.setText("");
            shiftStatsRow.setVisibility(View.GONE);
            timerHandler.removeCallbacks(timerTick);
        }
    }

    // v6.47.0: Hamburger-Menu mit allen Schicht-/Account-Aktionen
    private void showHamburgerMenu(View anchor) {
        PopupMenu p = new PopupMenu(this, anchor);
        p.getMenuInflater().inflate(R.menu.dashboard_menu, p.getMenu());

        // v6.51.1: Version-Eintrag (deaktiviert, nur Anzeige)
        try {
            String ver = getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
            p.getMenu().findItem(R.id.menu_version).setTitle("📱 Version v" + ver);
        } catch (Throwable _t) {}

        // Dynamische Texte je nach Status
        p.getMenu().findItem(R.id.menu_shift_toggle).setTitle(shiftActive ? "⏹ Schicht stoppen" : "▶ Schicht starten");
        p.getMenu().findItem(R.id.menu_online_toggle).setTitle(onlineState ? "⏸ Pause / Offline" : "🟢 Online schalten");

        p.setOnMenuItemClickListener(item -> {
            int id = item.getItemId();
            if (id == R.id.menu_shift_toggle)   { toggleShift(); return true; }
            if (id == R.id.menu_online_toggle)  { toggleOnline(); return true; }
            if (id == R.id.menu_stats)          { startActivity(new Intent(this, StatsActivity.class)); return true; }
            if (id == R.id.menu_crm)            { startActivity(new Intent(this, CrmSearchActivity.class)); return true; }
            if (id == R.id.menu_webapp)         { openWebView(); return true; }
            if (id == R.id.menu_change_vehicle) {
                getSharedPreferences("driver", MODE_PRIVATE).edit().remove("vehicleId").remove("vehicleName").apply();
                startActivity(new Intent(this, VehiclePickerActivity.class));
                finish();
                return true;
            }
            if (id == R.id.menu_logout)         { doLogout(); return true; }
            return false;
        });
        p.show();
    }

    // v6.52.1: checkForUpdate / downloadAndInstall sind jetzt in UpdateChecker.java
    // (auch von LoginActivity benutzt damit Patrick auch ohne Login updaten kann).

    private void doLogout() {
        clearVehicleLock();
        try { FirebaseAuth.getInstance().signOut(); } catch (Throwable _t) {}
        getSharedPreferences("driver", MODE_PRIVATE).edit().clear().apply();
        // FCM-Token NICHT löschen — bleibt für Push-Empfang nach Re-Login
        startActivity(new Intent(this, LoginActivity.class));
        finish();
    }

    // v6.50.1: Lock-Heartbeat — schreibt nur lastHeartbeat. uid/label bleiben wie gesetzt
    // beim Picker (oder falls Lock fremd ist → ignoriere via Stolen-Check oben).
    private void sendLockHeartbeat() {
        if (db == null || currentVehicleId == null) {
            try {
                db = FirebaseDatabase.getInstance(DB_INSTANCE_URL);
            } catch (Throwable _t) { return; }
        }
        if (currentVehicleId == null) return;
        FirebaseUser fu = FirebaseAuth.getInstance().getCurrentUser();
        String myUid = fu != null ? fu.getUid() : "anon-" + Build.MODEL;
        String myLabel = VehiclePickerActivity.buildDeviceLabel(fu);
        Map<String, Object> u = new HashMap<>();
        u.put("uid", myUid);
        u.put("label", myLabel);
        u.put("lastHeartbeat", com.google.firebase.database.ServerValue.TIMESTAMP);
        // claimedAt nicht überschreiben — bleibt vom Picker
        db.getReference("vehicles/" + currentVehicleId + "/activeDevice").updateChildren(u);
    }

    // v6.50.1: Lock löschen beim Logout — andere Handys können dann sofort übernehmen
    private void clearVehicleLock() {
        if (db == null || currentVehicleId == null) return;
        FirebaseUser fu = FirebaseAuth.getInstance().getCurrentUser();
        String myUid = fu != null ? fu.getUid() : "anon-" + Build.MODEL;
        // Nur löschen wenn der Lock noch uns gehört — sonst tippte schon jemand übernommen
        db.getReference("vehicles/" + currentVehicleId + "/activeDevice")
            .addListenerForSingleValueEvent(new ValueEventListener() {
                @Override public void onDataChange(@NonNull DataSnapshot s) {
                    String currentUid = s.child("uid").getValue(String.class);
                    if (currentUid == null || currentUid.equals(myUid)) {
                        s.getRef().removeValue();
                    }
                }
                @Override public void onCancelled(@NonNull DatabaseError e) {}
            });
    }

    // v6.50.1: Wenn fremdes Handy übernommen hat → Modal-Dialog, nicht-abbrechbar.
    // Nach OK → zurück zum LoginActivity, Schicht ist beendet auf diesem Gerät.
    private void showLockStolenDialog(String otherLabel) {
        try { lockHandler.removeCallbacks(lockHeartbeatTick); } catch (Throwable _t) {}
        new androidx.appcompat.app.AlertDialog.Builder(this)
            .setTitle("⚠️ Schicht übernommen")
            .setMessage("Das Fahrzeug wird jetzt auf einem anderen Gerät genutzt:\n" +
                (otherLabel != null ? otherLabel : "anderes Handy") +
                "\n\nDieses Handy wird abgemeldet.")
            .setCancelable(false)
            .setPositiveButton("OK", (d, _w) -> {
                // KEIN clearVehicleLock — der neue Besitzer soll seinen Lock behalten
                try { FirebaseAuth.getInstance().signOut(); } catch (Throwable _t) {}
                getSharedPreferences("driver", MODE_PRIVATE).edit().clear().apply();
                startActivity(new Intent(this, LoginActivity.class));
                finish();
            })
            .show();
    }

    private void updateShiftTimer() {
        if (!shiftActive || shiftStartTime == null) return;
        long elapsed = (System.currentTimeMillis() - shiftStartTime) / 1000;
        long h = elapsed / 3600;
        long m = (elapsed % 3600) / 60;
        long sec = elapsed % 60;
        tvShiftTimer.setText(String.format(Locale.GERMANY, "⏱ %02d:%02d:%02d", h, m, sec));
    }

    private void toggleOnline() {
        if (db == null || currentVehicleId == null) return;
        onlineState = !onlineState;
        // UI-Update kommt automatisch via onVehicleUpdate-Listener wenn Firebase write durchgeht
        Map<String, Object> u = new HashMap<>();
        u.put("online", onlineState);
        u.put("dispatchStatus", onlineState ? "online" : "offline");
        db.getReference("vehicles/" + currentVehicleId).updateChildren(u);
        Toast.makeText(this, onlineState ? "🟢 Online" : "⏸ Pause", Toast.LENGTH_SHORT).show();
    }

    private void calcTodayEarnings(DataSnapshot s) {
        Calendar c = Calendar.getInstance();
        c.set(Calendar.HOUR_OF_DAY, 0);
        c.set(Calendar.MINUTE, 0);
        c.set(Calendar.SECOND, 0);
        c.set(Calendar.MILLISECOND, 0);
        long dayStart = c.getTimeInMillis();
        double sum = 0;
        int count = 0;
        for (DataSnapshot child : s.getChildren()) {
            Object statusObj = child.child("status").getValue();
            String st = statusObj != null ? String.valueOf(statusObj).toLowerCase() : "";
            if (!st.equals("completed") && !st.equals("abgeschlossen") && !st.equals("done")) continue;
            Object completedAtObj = child.child("completedAt").getValue();
            long completedAt = 0;
            if (completedAtObj instanceof Long) completedAt = (Long) completedAtObj;
            else if (completedAtObj instanceof Number) completedAt = ((Number) completedAtObj).longValue();
            if (completedAt < dayStart) {
                // Fallback: pickupTimestamp
                Object pickObj = child.child("pickupTimestamp").getValue();
                long pickTs = 0;
                if (pickObj instanceof Long) pickTs = (Long) pickObj;
                else if (pickObj instanceof Number) pickTs = ((Number) pickObj).longValue();
                if (pickTs < dayStart) continue;
            }
            Object pObj = child.child("price").getValue();
            double price = 0;
            if (pObj instanceof Number) price = ((Number) pObj).doubleValue();
            else if (pObj instanceof String) try { price = Double.parseDouble((String) pObj); } catch (Throwable _t) {}
            sum += price;
            count++;
        }
        todayEarnings = sum;
        tvTodayEarnings.setText(String.format(Locale.GERMANY, "💰 %.2f € (%d)", sum, count));
    }

    private void onRidesUpdate(DataSnapshot s) {
        // v6.42.7: Vorbestellungen erst 20 Min vor Pickup zeigen
        long now = System.currentTimeMillis();
        long windowPast = now - 12L * 3600L * 1000L;
        long windowFuture = now + 20L * 60L * 1000L;
        List<Ride> assigned = new ArrayList<>();
        for (DataSnapshot child : s.getChildren()) {
            Ride r = Ride.fromSnap(child);
            if (r == null) continue;
            if (r.status == null) continue;
            String st = r.status.toLowerCase();
            if (st.equals("completed") || st.equals("abgeschlossen") ||
                st.equals("cancelled") || st.equals("canceled") || st.equals("storniert") ||
                st.equals("deleted") || st.equals("gelöscht") || st.equals("rejected") ||
                st.equals("done")) continue;
            boolean isActive = st.equals("accepted") || st.equals("on_way") ||
                    st.equals("arrived") || st.equals("picked_up");
            if (!isActive) {
                if (r.pickupTimestamp == null) {
                    if (!st.equals("new") && !st.equals("sofort") && !st.equals("assigned")) continue;
                } else {
                    if (r.pickupTimestamp < windowPast) continue;
                    if (r.pickupTimestamp > windowFuture) continue;
                }
            }
            assigned.add(r);
        }
        myAssignedRides = assigned;
        renderRides();
    }

    // v6.43.1: zweiter Listener — alle UNZUGEWIESENEN offenen Fahrten (kein vehicleId).
    // So sieht der Fahrer auch Sofortfahrten/Warteschlange-Fahrten die noch keinen Fahrer haben
    // und kann sie selbst greifen.
    private void onOpenRidesUpdate(DataSnapshot s) {
        long now = System.currentTimeMillis();
        long windowFuture = now + 20L * 60L * 1000L;
        List<Ride> open = new ArrayList<>();
        for (DataSnapshot child : s.getChildren()) {
            Ride r = Ride.fromSnap(child);
            if (r == null || r.status == null) continue;
            // Nur unzugewiesene
            String vid = child.child("vehicleId").getValue(String.class);
            String aVid = child.child("assignedVehicle").getValue(String.class);
            String dId = child.child("driverId").getValue(String.class);
            if (vid != null && !vid.isEmpty()) continue;
            if (aVid != null && !aVid.isEmpty()) continue;
            if (dId != null && !dId.isEmpty()) continue;
            String st = r.status.toLowerCase();
            // Nur greifbare offene Stati
            if (!st.equals("warteschlange") && !st.equals("sofort") && !st.equals("new")) continue;
            // Zeitfenster: -2h (für hängende warteschlange) bis +20 min
            if (r.pickupTimestamp != null) {
                if (r.pickupTimestamp < now - 2L * 3600L * 1000L) continue;
                if (r.pickupTimestamp > windowFuture) continue;
            }
            open.add(r);
        }
        openUnassignedRides = open;
        renderRides();
    }

    private void renderRides() {
        List<Ride> all = new ArrayList<>();
        all.addAll(myAssignedRides);
        // Verhindere Duplikate (rides die in beiden Listen wären — sollte nicht vorkommen aber safe)
        for (Ride o : openUnassignedRides) {
            boolean dup = false;
            for (Ride a : all) if (a.id != null && a.id.equals(o.id)) { dup = true; break; }
            if (!dup) all.add(o);
        }
        all.sort((a, b) -> {
            int aRank = isActiveStatus(a.status) ? 0 : (isOpenStatus(a.status) ? 2 : 1);
            int bRank = isActiveStatus(b.status) ? 0 : (isOpenStatus(b.status) ? 2 : 1);
            if (aRank != bRank) return Integer.compare(aRank, bRank);
            return Long.compare(a.pickupTimestamp != null ? a.pickupTimestamp : 0,
                                b.pickupTimestamp != null ? b.pickupTimestamp : 0);
        });
        rideAdapter.setRides(all);
        emptyState.setVisibility(all.isEmpty() ? View.VISIBLE : View.GONE);
        rvRides.setVisibility(all.isEmpty() ? View.GONE : View.VISIBLE);
    }

    private static boolean isOpenStatus(String s) {
        if (s == null) return false;
        String st = s.toLowerCase();
        return st.equals("warteschlange") || st.equals("sofort") || st.equals("new");
    }

    private static boolean isActiveStatus(String s) {
        if (s == null) return false;
        String st = s.toLowerCase();
        return st.equals("accepted") || st.equals("on_way") || st.equals("arrived") || st.equals("picked_up");
    }

    private void toggleShift() {
        if (currentVehicleId == null) return;
        if (shiftActive) {
            DatabaseReference ref = db.getReference("vehicles/" + currentVehicleId + "/shift");
            Map<String, Object> updates = new HashMap<>();
            updates.put("status", "ended");
            updates.put("endedAt", System.currentTimeMillis());
            updates.put("endedReason", "manual_native_dashboard");
            ref.updateChildren(updates);
            // Online-Flag auf false (bei Schicht-End)
            db.getReference("vehicles/" + currentVehicleId + "/online").setValue(false);
            // v6.53.2: ForegroundService aktiv stoppen — vorher schrieb der Toggle nur
            // Firebase, der Service lief aber weiter (Notification-Icon blieb sichtbar,
            // Heartbeat ging weiter ins Leere). Patrick: 'kann mich nicht abmelden'.
            try {
                Intent stopSvc = new Intent(this, ShiftForegroundService.class);
                stopSvc.setAction(ShiftForegroundService.ACTION_STOP);
                startService(stopSvc);
                Log.i(TAG, "🛑 ShiftForegroundService STOP gesendet (Schicht-Ende)");
            } catch (Throwable t) {
                Log.w(TAG, "Service-Stop fehlgeschlagen: " + t.getMessage());
            }
        } else {
            DatabaseReference ref = db.getReference("vehicles/" + currentVehicleId + "/shift");
            Map<String, Object> updates = new HashMap<>();
            updates.put("status", "active");
            updates.put("startTime", System.currentTimeMillis());
            updates.put("startedBy", "native_dashboard");
            updates.put("lastHeartbeat", System.currentTimeMillis());
            ref.updateChildren(updates);
            db.getReference("vehicles/" + currentVehicleId + "/online").setValue(true);
            Intent svc = new Intent(this, ShiftForegroundService.class);
            svc.setAction(ShiftForegroundService.ACTION_START);
            svc.putExtra(ShiftForegroundService.EXTRA_VEHICLE_ID, currentVehicleId);
            svc.putExtra(ShiftForegroundService.EXTRA_CONTENT_TEXT, "Schicht aktiv via Native-Dashboard");
            startForegroundService(svc);
        }
    }

    private void openWebView() {
        Intent i = new Intent(this, MainActivity.class);
        startActivity(i);
    }

    private void showEinsteigerDialog() {
        if (currentVehicleId == null) return;
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        int pad = (int) (getResources().getDisplayMetrics().density * 16);
        layout.setPadding(pad, pad, pad, pad);

        EditText etPickup = new EditText(this);
        etPickup.setHint("Abholort (optional)");
        etPickup.setInputType(InputType.TYPE_CLASS_TEXT);
        layout.addView(etPickup);

        EditText etDest = new EditText(this);
        etDest.setHint("Zielort");
        etDest.setInputType(InputType.TYPE_CLASS_TEXT);
        layout.addView(etDest);

        EditText etPrice = new EditText(this);
        etPrice.setHint("Preis € (z.B. 12.50)");
        etPrice.setInputType(InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_FLAG_DECIMAL);
        layout.addView(etPrice);

        EditText etPax = new EditText(this);
        etPax.setHint("Personen (Default 1)");
        etPax.setInputType(InputType.TYPE_CLASS_NUMBER);
        layout.addView(etPax);

        new AlertDialog.Builder(this)
            .setTitle("🚖 EINSTEIGER-Fahrt")
            .setMessage("Walk-In-Fahrgast — wird sofort als 'picked_up' angelegt.")
            .setView(layout)
            .setPositiveButton("Anlegen + Starten", (d, w) -> {
                String pickup = etPickup.getText().toString().trim();
                String dest = etDest.getText().toString().trim();
                String priceStr = etPrice.getText().toString().trim();
                String paxStr = etPax.getText().toString().trim();
                createEinsteiger(pickup, dest, priceStr, paxStr);
            })
            .setNegativeButton("Abbrechen", null)
            .show();
    }

    private void createEinsteiger(String pickup, String dest, String priceStr, String paxStr) {
        if (db == null) return;
        try {
            DatabaseReference newRef = db.getReference("rides").push();
            Map<String, Object> r = new HashMap<>();
            r.put("customerName", "Einsteiger");
            r.put("vehicleId", currentVehicleId);
            r.put("status", "picked_up");
            r.put("pickup", pickup.isEmpty() ? "Standort Fahrer" : pickup);
            r.put("destination", dest);
            long now = System.currentTimeMillis();
            r.put("pickupTimestamp", now);
            r.put("pickupTime", new java.text.SimpleDateFormat("HH:mm", Locale.GERMANY).format(new java.util.Date(now)));
            r.put("createdAt", now);
            r.put("updatedAt", now);
            r.put("acceptedAt", now);
            r.put("acceptedVia", "native_dashboard_einsteiger");
            r.put("source", "native_einsteiger");
            r.put("isInsteiger", true);
            try {
                if (!priceStr.isEmpty()) r.put("price", Double.parseDouble(priceStr.replace(',', '.')));
            } catch (Throwable _t) {}
            try {
                int pax = paxStr.isEmpty() ? 1 : Integer.parseInt(paxStr);
                r.put("passengers", pax);
            } catch (Throwable _t) { r.put("passengers", 1); }
            newRef.setValue(r).addOnCompleteListener(task -> {
                if (task.isSuccessful()) Toast.makeText(this, "✅ EINSTEIGER angelegt", Toast.LENGTH_SHORT).show();
                else Toast.makeText(this, "❌ Fehler: " + (task.getException() != null ? task.getException().getMessage() : "?"), Toast.LENGTH_LONG).show();
            });
        } catch (Throwable t) {
            Toast.makeText(this, "❌ EINSTEIGER-Fehler: " + t.getMessage(), Toast.LENGTH_LONG).show();
        }
    }

    private void startNavigation(String address) {
        if (address == null || address.isEmpty()) {
            Toast.makeText(this, "Keine Adresse vorhanden", Toast.LENGTH_SHORT).show();
            return;
        }
        try {
            Uri uri = Uri.parse("google.navigation:q=" + Uri.encode(address) + "&mode=d");
            Intent i = new Intent(Intent.ACTION_VIEW, uri);
            i.setPackage("com.google.android.apps.maps");
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            try {
                startActivity(i);
            } catch (Throwable _t) {
                // Fallback: ohne Maps-Package — Android fragt User welche App
                Intent g = new Intent(Intent.ACTION_VIEW, Uri.parse("geo:0,0?q=" + Uri.encode(address)));
                g.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(g);
            }
        } catch (Throwable t) {
            Toast.makeText(this, "Navigation-Fehler: " + t.getMessage(), Toast.LENGTH_LONG).show();
        }
    }

    private void callPhone(String number) {
        if (number == null || number.isEmpty()) {
            Toast.makeText(this, "Keine Telefonnummer vorhanden", Toast.LENGTH_SHORT).show();
            return;
        }
        try {
            Uri uri = Uri.parse("tel:" + number.replaceAll("[^+0-9]", ""));
            Intent i = new Intent(Intent.ACTION_DIAL, uri);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(i);
        } catch (Throwable t) {
            Toast.makeText(this, "Anruf-Fehler: " + t.getMessage(), Toast.LENGTH_LONG).show();
        }
    }

    private void sendTrackingSMS(String rideId, String phone) {
        if (phone == null || phone.isEmpty()) {
            Toast.makeText(this, "Keine Telefonnummer", Toast.LENGTH_SHORT).show();
            return;
        }
        String url = TRACKING_BASE + rideId;
        String body = "Ihr Funk Taxi Tracking: " + url;
        try {
            Uri uri = Uri.parse("smsto:" + phone.replaceAll("[^+0-9]", ""));
            Intent i = new Intent(Intent.ACTION_SENDTO, uri);
            i.putExtra("sms_body", body);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(i);
        } catch (Throwable t) {
            Toast.makeText(this, "SMS-Fehler: " + t.getMessage(), Toast.LENGTH_LONG).show();
        }
    }

    private void cancelRide(String rideId) {
        if (db == null || rideId == null) return;
        String[] reasons = {
            "Kunde nicht erschienen",
            "Adresse falsch / nicht erreichbar",
            "Fahrt nicht möglich (technisch)",
            "Sonstiges"
        };
        new AlertDialog.Builder(this)
            .setTitle("Fahrt stornieren — Grund?")
            .setItems(reasons, (d, which) -> {
                Map<String, Object> u = new HashMap<>();
                u.put("status", "cancelled");
                u.put("cancelledAt", System.currentTimeMillis());
                u.put("cancelledBy", currentVehicleId);
                u.put("cancelledVia", "native_dashboard");
                u.put("cancelReason", reasons[which]);
                u.put("updatedAt", System.currentTimeMillis());
                db.getReference("rides/" + rideId).updateChildren(u);
                Toast.makeText(this, "Fahrt storniert", Toast.LENGTH_SHORT).show();
            })
            .setNegativeButton("Abbrechen", null)
            .show();
    }

    private static String nextStatus(String current) {
        if (current == null) return null;
        switch (current.toLowerCase()) {
            case "accepted": return "on_way";
            case "on_way":   return "arrived";
            case "arrived":  return "picked_up";
            case "picked_up":return "completed";
            default: return null;
        }
    }

    private static String nextStatusLabel(String current) {
        if (current == null) return "▶ Weiter";
        switch (current.toLowerCase()) {
            case "accepted": return "▶ Bin unterwegs";
            case "on_way":   return "📍 Bin da";
            case "arrived":  return "👤 Eingestiegen";
            case "picked_up":return "✓ Fahrt fertig";
            default: return "▶ Weiter";
        }
    }

    private void advanceStatus(Ride r) {
        String next = nextStatus(r.status);
        if (next == null) return;

        // v6.44.0: Vor Status=completed → erst Bezahl-Dialog zeigen
        if (next.equals("completed")) {
            showPaymentDialog(r);
            return;
        }

        Map<String, Object> u = new HashMap<>();
        u.put("status", next);
        u.put("updatedAt", System.currentTimeMillis());
        if (next.equals("on_way")) u.put("onWayAt", System.currentTimeMillis());
        else if (next.equals("arrived")) u.put("arrivedAt", System.currentTimeMillis());
        else if (next.equals("picked_up")) u.put("pickedUpAt", System.currentTimeMillis());
        db.getReference("rides/" + r.id).updateChildren(u);

        // v6.43.2: Auto-SMS-Tracking-Link bei 'Losfahren' (Status accepted → on_way).
        if (next.equals("on_way")) {
            resolvePhoneAndAct(r, phone -> {
                if (phone != null && !phone.isEmpty()) sendTrackingSMS(r.id, phone);
            });
        }
    }

    // v6.44.0: Bezahl-Dialog nach "Fahrt fertig" — Bar/iZettle/Hotel/Mail
    private static final int REQ_ZETTLE = 4711;
    private String pendingZettleRideId = null;
    private double pendingZettleAmount = 0.0;

    private void showPaymentDialog(Ride r) {
        if (db == null || r.id == null) return;
        // Hotel-Auftraggeber-Check — wenn Hotel/Firma als Auftraggeber gesetzt → eigener Button
        DatabaseReference rideRef = db.getReference("rides/" + r.id);
        rideRef.addListenerForSingleValueEvent(new ValueEventListener() {
            @Override public void onDataChange(@NonNull DataSnapshot s) {
                String auftraggeberName = firstNonEmpty(
                    s.child("auftraggeberName").getValue(String.class),
                    s.child("_auftraggeberName").getValue(String.class),
                    s.child("auftraggeber").getValue(String.class)
                );
                Boolean isAuftraggeberBooking = s.child("_isAuftraggeberBooking").getValue(Boolean.class);
                boolean hasAuftraggeber = (isAuftraggeberBooking != null && isAuftraggeberBooking) ||
                        (auftraggeberName != null && !auftraggeberName.trim().isEmpty());
                String hotelName = (auftraggeberName != null && !auftraggeberName.trim().isEmpty())
                        ? auftraggeberName.trim() : null;
                renderPaymentDialog(r, hotelName, hasAuftraggeber);
            }
            @Override public void onCancelled(@NonNull DatabaseError e) {
                renderPaymentDialog(r, null, false);
            }
        });
    }

    private void renderPaymentDialog(Ride r, String hotelName, boolean hasAuftraggeber) {
        double amount = r.price != null ? r.price : 0.0;
        String amountStr = String.format(Locale.GERMANY, "%.2f €", amount);
        List<String> options = new ArrayList<>();
        List<String> methods = new ArrayList<>();
        options.add("💵 Bar (" + amountStr + ")");                        methods.add("cash");
        options.add("💳 iZettle Karte (" + amountStr + ")");              methods.add("izettle");
        if (hasAuftraggeber) {
            options.add("🏨 An " + (hotelName != null ? hotelName : "Auftraggeber") + " abrechnen");
            methods.add("invoice_auftraggeber");
        }
        options.add("✉ Email-Rechnung");                                  methods.add("invoice_email");
        options.add("✗ Abbrechen (Fahrt offen lassen)");                  methods.add("cancel");

        new AlertDialog.Builder(this)
            .setTitle("💰 Bezahlung — wie?")
            .setItems(options.toArray(new String[0]), (d, which) -> {
                String m = methods.get(which);
                switch (m) {
                    case "cash":        markCompleted(r.id, "cash", amount, null); break;
                    case "izettle":     payViaZettle(r.id, amount); break;
                    case "invoice_auftraggeber":
                                        markCompleted(r.id, "invoice_auftraggeber", amount, hotelName); break;
                    case "invoice_email":
                                        showMailInvoiceDialog(r, amount); break;
                    case "cancel":      /* nichts tun, Status bleibt picked_up */ break;
                }
            })
            .setOnCancelListener(d -> {/* nichts */})
            .show();
    }

    private void markCompleted(String rideId, String paymentMethod, double amount, String note) {
        Map<String, Object> u = new HashMap<>();
        u.put("status", "completed");
        u.put("completedAt", System.currentTimeMillis());
        u.put("updatedAt", System.currentTimeMillis());
        u.put("paymentMethod", paymentMethod);
        u.put("paymentAmount", amount);
        if (note != null) u.put("paymentNote", note);
        db.getReference("rides/" + rideId).updateChildren(u);
        Toast.makeText(this, "✅ Fahrt abgeschlossen — " + paymentMethod, Toast.LENGTH_SHORT).show();
    }

    private void payViaZettle(String rideId, double amount) {
        if (amount <= 0) {
            Toast.makeText(this, "Kein Preis hinterlegt — Betrag eingeben", Toast.LENGTH_LONG).show();
            return;
        }
        pendingZettleRideId = rideId;
        pendingZettleAmount = amount;
        try {
            // iZettle App-to-App Intent
            Intent i = new Intent("com.izettle.android.action.START_PAYMENT");
            i.setPackage("com.izettle.android");
            i.putExtra("amount", (int) Math.round(amount * 100));  // Cent
            i.putExtra("currency", "EUR");
            i.putExtra("reference", rideId);
            i.putExtra("enableTipping", false);
            i.putExtra("enableInstallments", false);
            try {
                startActivityForResult(i, REQ_ZETTLE);
            } catch (android.content.ActivityNotFoundException _e) {
                // Fallback: Open Zettle App directly
                Intent launch = getPackageManager().getLaunchIntentForPackage("com.izettle.android");
                if (launch != null) {
                    Toast.makeText(this, "iZettle Intent nicht verfügbar — App geöffnet, manuell abrechnen", Toast.LENGTH_LONG).show();
                    startActivity(launch);
                } else {
                    Toast.makeText(this, "iZettle-App nicht installiert", Toast.LENGTH_LONG).show();
                }
            }
        } catch (Throwable t) {
            Toast.makeText(this, "iZettle-Fehler: " + t.getMessage(), Toast.LENGTH_LONG).show();
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_ZETTLE && pendingZettleRideId != null) {
            if (resultCode == RESULT_OK) {
                markCompleted(pendingZettleRideId, "izettle", pendingZettleAmount, "App-to-App Intent OK");
            } else {
                Toast.makeText(this, "iZettle: Bezahlung abgebrochen oder fehlgeschlagen", Toast.LENGTH_LONG).show();
            }
            pendingZettleRideId = null;
            pendingZettleAmount = 0;
        }
    }

    private void showMailInvoiceDialog(Ride r, double amount) {
        EditText et = new EditText(this);
        et.setHint("Email-Adresse");
        et.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS);
        new AlertDialog.Builder(this)
            .setTitle("✉ Email-Rechnung")
            .setMessage("An welche Email senden? (Rechnung wird Cloud-seitig generiert)")
            .setView(et)
            .setPositiveButton("Senden", (d, w) -> {
                String email = et.getText().toString().trim();
                if (email.isEmpty() || !email.contains("@")) {
                    Toast.makeText(this, "Ungültige Email", Toast.LENGTH_SHORT).show();
                    return;
                }
                Map<String, Object> u = new HashMap<>();
                u.put("status", "completed");
                u.put("completedAt", System.currentTimeMillis());
                u.put("updatedAt", System.currentTimeMillis());
                u.put("paymentMethod", "invoice_email");
                u.put("paymentAmount", amount);
                u.put("invoiceEmail", email);
                u.put("invoiceRequested", true); // Cloud Function reagiert auf Flag
                db.getReference("rides/" + r.id).updateChildren(u);
                Toast.makeText(this, "✅ Rechnung beauftragt", Toast.LENGTH_SHORT).show();
            })
            .setNegativeButton("Abbrechen", null)
            .show();
    }

    private void resolvePhoneAndAct(Ride r, java.util.function.Consumer<String> onPhone) {
        if (db == null || r.id == null) { onPhone.accept(null); return; }
        DatabaseReference rideRef = db.getReference("rides/" + r.id);
        rideRef.addListenerForSingleValueEvent(new ValueEventListener() {
            @Override public void onDataChange(@NonNull DataSnapshot s) {
                String phone = firstNonEmpty(
                    s.child("customerMobile").getValue(String.class),
                    s.child("customerPhone").getValue(String.class),
                    s.child("mobilePhone").getValue(String.class),
                    s.child("phone").getValue(String.class)
                );
                if (phone != null && !phone.isEmpty()) { onPhone.accept(phone); return; }
                String customerId = s.child("customerId").getValue(String.class);
                if (customerId == null || customerId.isEmpty()) { onPhone.accept(null); return; }
                db.getReference("customers/" + customerId).addListenerForSingleValueEvent(new ValueEventListener() {
                    @Override public void onDataChange(@NonNull DataSnapshot c) {
                        String p = firstNonEmpty(
                            c.child("mobilePhone").getValue(String.class),
                            c.child("phone").getValue(String.class),
                            c.child("phoneNumber").getValue(String.class)
                        );
                        onPhone.accept(p);
                    }
                    @Override public void onCancelled(@NonNull DatabaseError e) { onPhone.accept(null); }
                });
            }
            @Override public void onCancelled(@NonNull DatabaseError e) { onPhone.accept(null); }
        });
    }

    private static String firstNonEmpty(String... values) {
        for (String v : values) if (v != null && !v.trim().isEmpty()) return v;
        return null;
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        timerHandler.removeCallbacks(timerTick);
        // v6.50.1: Heartbeat-Loop stoppen, Lock NICHT automatisch löschen — wenn die App
        // nur kurz geschlossen wird, soll der Lock nach STALE_LOCK_MS (5 Min) auslaufen.
        // Beim expliziten Logout/Lock-Stolen wird der Lock anders gehandhabt.
        try { lockHandler.removeCallbacks(lockHeartbeatTick); } catch (Throwable _t) {}
        if (vehicleRef != null && shiftListener != null) vehicleRef.removeEventListener(shiftListener);
        if (ridesQuery != null && ridesListener != null) ridesQuery.removeEventListener(ridesListener);
        if (todayCompletedQuery != null && todayCompletedListener != null) todayCompletedQuery.removeEventListener(todayCompletedListener);
        if (openRidesQuery != null && openRidesListener != null) openRidesQuery.removeEventListener(openRidesListener);
    }

    static class Ride {
        String id, customerName, pickup, destination, pickupTime, status;
        Double price, distance;
        Long pickupTimestamp;

        static Ride fromSnap(DataSnapshot s) {
            try {
                Ride r = new Ride();
                r.id = s.getKey();
                r.customerName = s.child("customerName").getValue(String.class);
                r.pickup = s.child("pickup").getValue(String.class);
                r.destination = s.child("destination").getValue(String.class);
                r.pickupTime = s.child("pickupTime").getValue(String.class);
                r.status = s.child("status").getValue(String.class);
                Object p = s.child("price").getValue();
                if (p instanceof Number) r.price = ((Number) p).doubleValue();
                else if (p instanceof String) try { r.price = Double.parseDouble((String) p); } catch (NumberFormatException _e) {}
                Object d = s.child("distance").getValue();
                if (d instanceof Number) r.distance = ((Number) d).doubleValue();
                else if (d instanceof String) try { r.distance = Double.parseDouble((String) d); } catch (NumberFormatException _e) {}
                Object ts = s.child("pickupTimestamp").getValue();
                if (ts instanceof Long) r.pickupTimestamp = (Long) ts;
                else if (ts instanceof Number) r.pickupTimestamp = ((Number) ts).longValue();
                return r;
            } catch (Throwable _t) { return null; }
        }
    }

    class RideAdapter extends RecyclerView.Adapter<RideAdapter.VH> {
        private List<Ride> data = new ArrayList<>();
        void setRides(List<Ride> list) { this.data = list; notifyDataSetChanged(); }
        @NonNull @Override
        public VH onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
            View v = LayoutInflater.from(parent.getContext()).inflate(R.layout.item_ride_card, parent, false);
            return new VH(v);
        }
        @Override public void onBindViewHolder(@NonNull VH holder, int position) { holder.bind(data.get(position)); }
        @Override public int getItemCount() { return data.size(); }

        class VH extends RecyclerView.ViewHolder {
            TextView tvBadge, tvTime, tvName, tvPickup, tvDest, tvPriceDist;
            MaterialButton btnAccept, btnReject, btnNavigate, btnCall, btnSmsTrack, btnStatusNext, btnCancelRide;
            LinearLayout actionRow, activeToolbar;
            VH(View v) {
                super(v);
                tvBadge = v.findViewById(R.id.tv_status_badge);
                tvTime = v.findViewById(R.id.tv_pickup_time);
                tvName = v.findViewById(R.id.tv_customer_name);
                tvPickup = v.findViewById(R.id.tv_pickup);
                tvDest = v.findViewById(R.id.tv_destination);
                tvPriceDist = v.findViewById(R.id.tv_price_distance);
                btnAccept = v.findViewById(R.id.btn_accept);
                btnReject = v.findViewById(R.id.btn_reject);
                actionRow = v.findViewById(R.id.action_row);
                activeToolbar = v.findViewById(R.id.active_toolbar);
                btnNavigate = v.findViewById(R.id.btn_navigate);
                btnCall = v.findViewById(R.id.btn_call);
                btnSmsTrack = v.findViewById(R.id.btn_sms_track);
                btnStatusNext = v.findViewById(R.id.btn_status_next);
                btnCancelRide = v.findViewById(R.id.btn_cancel_ride);
            }
            void bind(Ride r) {
                tvName.setText(r.customerName != null ? r.customerName : "(Kunde)");
                tvPickup.setText("📍 " + (r.pickup != null ? r.pickup : "-"));
                tvDest.setText("🎯 " + (r.destination != null ? r.destination : "-"));
                tvTime.setText(r.pickupTime != null ? r.pickupTime : "Sofort");
                String pd = String.format(Locale.GERMANY, "💰 %s€ · 🛣️ %s km",
                    r.price != null ? String.format(Locale.GERMANY, "%.2f", r.price) : "--",
                    r.distance != null ? String.format(Locale.GERMANY, "%.1f", r.distance) : "--");
                tvPriceDist.setText(pd);
                String s = r.status != null ? r.status : "?";
                String badge; int bgColor;
                switch (s.toLowerCase()) {
                    case "new":           badge = "🆕 NEU"; bgColor = Color.parseColor("#F59E0B"); break;
                    case "sofort":        badge = "⚡ SOFORT"; bgColor = Color.parseColor("#F59E0B"); break;
                    case "warteschlange": badge = "🆘 OFFEN"; bgColor = Color.parseColor("#EF4444"); break;
                    case "vorbestellt":   badge = "📅 VORBESTELLT"; bgColor = Color.parseColor("#3B82F6"); break;
                    case "assigned":      badge = "🎯 ZUGEWIESEN"; bgColor = Color.parseColor("#3B82F6"); break;
                    case "accepted":      badge = "✅ ANGENOMMEN"; bgColor = Color.parseColor("#10B981"); break;
                    case "on_way":        badge = "🚗 UNTERWEGS"; bgColor = Color.parseColor("#F59E0B"); break;
                    case "arrived":       badge = "📍 BIN DA"; bgColor = Color.parseColor("#3B82F6"); break;
                    case "picked_up":     badge = "🎉 ABGEHOLT"; bgColor = Color.parseColor("#10B981"); break;
                    default:              badge = s.toUpperCase(); bgColor = Color.parseColor("#64748B");
                }
                tvBadge.setText(badge);
                tvBadge.setBackgroundColor(bgColor);

                String stl = s.toLowerCase();
                boolean canAcceptReject = stl.equals("new") || stl.equals("assigned") || stl.equals("sofort") || stl.equals("vorbestellt") || stl.equals("warteschlange");
                boolean isActive = isActiveStatus(s);

                // v6.47.7: Vergangene vorbestellt/assigned-Aufträge → 'Erledigt'/'Storno' statt
                // 'Annehmen/Ablehnen'. Patrick erlebte: Hartmann 8:50 vorbei, konnte nicht abrechnen.
                long nowMs = System.currentTimeMillis();
                boolean isPast = canAcceptReject && r.pickupTimestamp != null && r.pickupTimestamp < nowMs - 5L * 60L * 1000L;

                actionRow.setVisibility(canAcceptReject ? View.VISIBLE : View.GONE);
                activeToolbar.setVisibility(isActive ? View.VISIBLE : View.GONE);

                if (canAcceptReject) {
                    if (isPast) {
                        btnReject.setText("✗ Storno");
                        btnAccept.setText("✓ Erledigt");
                        btnReject.setOnClickListener(v -> cancelRide(r.id));
                        btnAccept.setOnClickListener(v -> showPaymentDialog(r));
                    } else {
                        btnReject.setText("❌ Ablehnen");
                        btnAccept.setText("✅ Annehmen");
                        btnReject.setOnClickListener(v -> rejectRide(r.id));
                        btnAccept.setOnClickListener(v -> acceptRide(r.id));
                    }
                }
                if (isActive) {
                    btnStatusNext.setText(nextStatusLabel(r.status));
                    btnStatusNext.setOnClickListener(v -> advanceStatus(r));
                    // Navigation: vor Pickup → pickup-Adresse, ab picked_up → destination
                    String navAddr = (stl.equals("picked_up") || stl.equals("arrived"))
                        ? (r.destination != null ? r.destination : r.pickup)
                        : (r.pickup != null ? r.pickup : r.destination);
                    btnNavigate.setOnClickListener(v -> startNavigation(navAddr));
                    btnCall.setOnClickListener(v -> resolvePhoneAndAct(r, phone -> {
                        if (phone == null) Toast.makeText(DriverDashboardActivity.this, "Keine Telefonnummer hinterlegt", Toast.LENGTH_SHORT).show();
                        else callPhone(phone);
                    }));
                    btnSmsTrack.setOnClickListener(v -> resolvePhoneAndAct(r, phone -> {
                        if (phone == null) Toast.makeText(DriverDashboardActivity.this, "Keine Telefonnummer für SMS", Toast.LENGTH_SHORT).show();
                        else sendTrackingSMS(r.id, phone);
                    }));
                    btnCancelRide.setOnClickListener(v -> cancelRide(r.id));
                }
            }
        }
    }

    private void updateStatus(String rideId, String newStatus) {
        if (db == null || rideId == null) return;
        Map<String, Object> u = new HashMap<>();
        u.put("status", newStatus);
        u.put("acceptedAt", System.currentTimeMillis());
        u.put("acceptedVia", "native_dashboard");
        u.put("updatedAt", System.currentTimeMillis());
        db.getReference("rides/" + rideId).updateChildren(u);
    }

    // v6.43.1: Annehmen — bei unzugewiesenen Aufträgen (warteschlange/sofort/new)
    // muss zusätzlich vehicleId + assignedBy gesetzt werden, damit die Fahrt wirklich
    // an den Fahrer geht und der Cloud-Watchdog Ruhe gibt.
    private void acceptRide(String rideId) {
        if (db == null || rideId == null || currentVehicleId == null) return;
        Map<String, Object> u = new HashMap<>();
        u.put("status", "accepted");
        u.put("vehicleId", currentVehicleId);
        u.put("assignedVehicle", currentVehicleId);
        u.put("assignedAt", System.currentTimeMillis());
        u.put("assignedBy", "native_dashboard_grab");
        u.put("acceptedAt", System.currentTimeMillis());
        u.put("acceptedVia", "native_dashboard");
        u.put("updatedAt", System.currentTimeMillis());
        u.put("openRideWarned", null);  // Watchdog reset
        db.getReference("rides/" + rideId).updateChildren(u);
    }

    private void rejectRide(String rideId) {
        if (db == null || rideId == null) return;
        Map<String, Object> u = new HashMap<>();
        u.put("vehicleId", null);
        u.put("assignedVehicle", null);
        u.put("vehicle", null);
        u.put("status", "new");
        u.put("rejectedBy", currentVehicleId);
        u.put("rejectedAt", System.currentTimeMillis());
        u.put("rejectedVia", "native_dashboard");
        u.put("updatedAt", System.currentTimeMillis());
        db.getReference("rides/" + rideId).updateChildren(u);
    }
}
