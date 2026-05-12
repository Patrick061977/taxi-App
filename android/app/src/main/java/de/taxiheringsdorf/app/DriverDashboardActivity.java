package de.taxiheringsdorf.app;

import android.app.AlertDialog;
import android.app.NotificationManager;
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
    // v6.62.304: Patrick (05.05. 14:11): Fahrer-Name unter dem App-Titel anzeigen
    private TextView tvDriverName;
    private TextView tvPauseBanner; // v6.62.26: grosser Pause-Banner
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
    // v6.62.377: separate Liste fuer Banner — Vorbestellungen <4h ohne 20-Min-Filter
    private List<Ride> myBannerLookaheadRides = new ArrayList<>();

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
    // v6.60.0: Wenn fremdes Gerät den Lock übernimmt, Heartbeat NICHT mehr schreiben —
    // sonst würden wir den fremden Lock direkt wieder mit unseren Daten überschreiben (Loop).
    private volatile boolean iOwnTheLock = true;
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

        // v6.62.86: Periodischer ETA-Trigger starten (v6.62.318: alle 15s)
        etaTickHandler.postDelayed(etaTick, 15_000L);
        // v6.62.320: Display-Tick alle 5s — rendert Adapter-Items neu damit der
        // 'in N Min'-Sekundenzaehler im LIVE-ETA runterzaehlt, ohne OSRM-Call.
        displayTickHandler.postDelayed(displayTick, 5_000L);

        // v6.62.71: FullScreen-Notification-Permission pruefen.
        // Patrick: 'wenn der Push kommt soll die App in den Vordergrund springen'.
        // Code (setFullScreenIntent in TaxiFCMService) ist seit v6.42.7 da, ABER Android 14+
        // erlaubt das nur wenn der User in den App-Einstellungen 'Vollbild-Benachrichtigungen'
        // aktiviert hat. Wir prompten EINMALIG (per SharedPref-Flag) wenn Permission fehlt.
        checkFullScreenNotificationPermission();

        // v6.42.3: Optionaler Intent-Extra für ADB-Setup ohne WebView-Login
        String intentVehicleId = getIntent() != null ? getIntent().getStringExtra("setVehicleId") : null;
        if (intentVehicleId != null && !intentVehicleId.isEmpty()) {
            getSharedPreferences("driver", MODE_PRIVATE).edit().putString("vehicleId", intentVehicleId).apply();
            getSharedPreferences("fcm", MODE_PRIVATE).edit().putString("vehicleId", intentVehicleId).apply();
            Log.i(TAG, "vehicleId via Intent-Extra gesetzt: " + intentVehicleId);
        }

        tvVehicleInfo = findViewById(R.id.tv_vehicle_info);
        tvDriverName = findViewById(R.id.tv_driver_name);
        tvShiftStatus = findViewById(R.id.tv_shift_status);
        tvPauseBanner = findViewById(R.id.tv_pause_banner);
        // v6.62.26: Pause-Banner-Tap schaltet direkt Online (schneller als Hamburger-Menue)
        if (tvPauseBanner != null) tvPauseBanner.setOnClickListener(v -> toggleOnline());
        // Auch der kleine Header-Badge ist jetzt klickbar — Tap auf '🟢 Aktiv' fuer Pause
        if (tvShiftStatus != null) tvShiftStatus.setOnClickListener(v -> {
            if (shiftActive) toggleOnline();
        });
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

        // v6.62.105: Patrick: 'wenn man die App neu startet und nicht angemeldet ist
        // duerfte man nicht ins Hauptmenue kommen — muss sich erst anmelden'.
        // Vorher: nur SharedPrefs-vehicleId-Check. Wenn Firebase-Auth aber abgelaufen
        // ist (token expired, fremder Logout, etc.) und SharedPrefs noch vehicleId
        // hat → User landet im Dashboard mit stale State + Firebase-Reads schlagen fehl.
        // Jetzt: BEIDE pruefen — Auth UND vehicleId. Eines fehlt → LoginActivity.
        com.google.firebase.auth.FirebaseUser _curUser = null;
        try { _curUser = com.google.firebase.auth.FirebaseAuth.getInstance().getCurrentUser(); } catch (Throwable _authErr) {}
        if (currentVehicleId == null || _curUser == null) {
            // Stale SharedPrefs leeren falls Auth fehlt aber prefs noch was hatten
            if (_curUser == null && currentVehicleId != null) {
                Log.w(TAG, "FirebaseAuth-User ist null obwohl vehicleId in SharedPrefs — Prefs werden bereinigt + Login");
                prefs.edit().clear().apply();
                getSharedPreferences("fcm", MODE_PRIVATE).edit().remove("vehicleId").apply();
            }
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
        // v6.62.304: Fahrer-Namen aus /staff laden + anzeigen
        loadAndShowDriverName(_curUser);
        connectFirebase();

        btnMenu.setOnClickListener(v -> showHamburgerMenu(v));
        btnEinsteiger.setOnClickListener(v -> showEinsteigerDialog());
        btnCallLog.setOnClickListener(v -> startActivity(new Intent(this, CallLogActivity.class)));

        // v6.50.0: Update-Check beim Start
        // v6.52.1: nutzt jetzt geteilte UpdateChecker-Klasse (gleiche Logik im LoginActivity)
        UpdateChecker.checkAsync(this, updateBanner, updateBannerText, updateBannerBtn);

        // v6.62.11: Pre-Heartbeat-Check — Patrick: 'das 20 hat einfach mit übernommen ich
        // musste nichts drücken'. App-Restart klaut sonst den Lock ohne UI-Aktion!
        // Vor dem ersten Heartbeat: lese activeDevice. Wenn fremde DeviceID + frisch (<5 Min)
        // → KEIN Heartbeat schreiben + Dialog + zurück zum VehiclePicker.
        try {
            FirebaseDatabase _db = FirebaseDatabase.getInstance(DB_INSTANCE_URL);
            _db.getReference("vehicles/" + currentVehicleId + "/activeDevice")
                .addListenerForSingleValueEvent(new ValueEventListener() {
                    @Override
                    public void onDataChange(@NonNull DataSnapshot s) {
                        String _lockedDevId = s.child("deviceId").getValue(String.class);
                        Long _lockHb = null;
                        Object _lockHbObj = s.child("lastHeartbeat").getValue();
                        if (_lockHbObj instanceof Number) _lockHb = ((Number) _lockHbObj).longValue();
                        String _lockedLabel = s.child("label").getValue(String.class);
                        long _now = System.currentTimeMillis();
                        boolean _lockStale = _lockHb == null || (_now - _lockHb) > 5 * 60 * 1000L;
                        String _myDevId = DeviceIdHelper.getOrCreate(DriverDashboardActivity.this);
                        boolean _ownsIt = _lockedDevId != null && _lockedDevId.equals(_myDevId);

                        if (_lockedDevId != null && !_lockedDevId.isEmpty() && !_ownsIt && !_lockStale) {
                            // Fremder aktiver Lock → KEIN Reclaim. Patrick will 1 Fahrzeug = 1 Gerät.
                            iOwnTheLock = false;
                            String _lbl = _lockedLabel != null ? _lockedLabel : "anderes Gerät";
                            new androidx.appcompat.app.AlertDialog.Builder(DriverDashboardActivity.this)
                                .setTitle("🔒 Fahrzeug woanders aktiv")
                                .setMessage("Dieses Fahrzeug wird gerade auf einem anderen Gerät genutzt:\n\n" + _lbl + "\n\n"
                                    + "Du wirst zur Fahrzeug-Auswahl zurückgeschickt — bitte ein anderes Fahrzeug wählen "
                                    + "oder dort 'Schicht beenden' drücken.")
                                .setCancelable(false)
                                .setPositiveButton("OK", (d, _w) -> {
                                    // v6.62.13: Patrick: 'dann darf aber oben nicht aktiv stehen'.
                                    // ShiftForegroundService läuft unabhängig weiter mit eigener
                                    // Notification → 'Schicht aktiv' bleibt sichtbar obwohl Fahrzeug
                                    // weg. Daher: Service explizit stoppen wenn Lock verloren.
                                    try {
                                        Intent stopSvc = new Intent(DriverDashboardActivity.this, ShiftForegroundService.class);
                                        stopSvc.setAction(ShiftForegroundService.ACTION_STOP);
                                        startService(stopSvc);
                                    } catch (Throwable _e) {}
                                    getSharedPreferences("driver", MODE_PRIVATE).edit().remove("vehicleId").remove("vehicleName").apply();
                                    startActivity(new Intent(DriverDashboardActivity.this, VehiclePickerActivity.class));
                                    finish();
                                })
                                .show();
                            return;
                        }
                        // Wir besitzen oder Lock ist frei/stale → Heartbeat starten
                        sendLockHeartbeat();
                        lockHandler.postDelayed(lockHeartbeatTick, LOCK_HEARTBEAT_MS);
                    }
                    @Override public void onCancelled(@NonNull DatabaseError e) {
                        // Bei DB-Fehler: vorsichtig weitermachen (Heartbeat starten, listener fängt später)
                        sendLockHeartbeat();
                        lockHandler.postDelayed(lockHeartbeatTick, LOCK_HEARTBEAT_MS);
                    }
                });
        } catch (Throwable _t) {
            // Fallback bei Init-Fehler
            sendLockHeartbeat();
            lockHandler.postDelayed(lockHeartbeatTick, LOCK_HEARTBEAT_MS);
        }
    }

    // v6.62.304: Patrick (05.05. 14:11): Fahrer soll oben sehen, dass er eingeloggt ist
    // mit seinem Namen (aktuell stand da nur "Taxi-App-Fahrer").
    // Sucht in /staff den Eintrag mit linkedDriverId == currentUid → zeigt firstName+lastName.
    // Fallback: Email oder Telefonnummer aus Auth.
    private void loadAndShowDriverName(com.google.firebase.auth.FirebaseUser user) {
        if (tvDriverName == null || user == null) return;
        // 🔧 v6.62.422: displayName aus Google-Profil zuerst — viel lesbarer als Email.
        // Patrick (07.05.): "Bei Danilo wird der Name auch noch nicht angezeigt".
        String fallback = null;
        String dn = user.getDisplayName();
        if (dn != null && !dn.trim().isEmpty()) {
            fallback = dn.trim();
        } else if (user.getEmail() != null) {
            fallback = user.getEmail();
        } else if (user.getPhoneNumber() != null) {
            fallback = user.getPhoneNumber();
        }
        if (fallback != null) {
            tvDriverName.setText("👤 " + fallback);
            tvDriverName.setVisibility(View.VISIBLE);
        }
        // Asynchron /staff durchsuchen — wenn match → mit echtem Namen ersetzen
        final String uid = user.getUid();
        try {
            FirebaseDatabase.getInstance(DB_INSTANCE_URL).getReference("staff")
                .orderByChild("linkedDriverId").equalTo(uid).limitToFirst(1)
                .addListenerForSingleValueEvent(new ValueEventListener() {
                    @Override public void onDataChange(@NonNull DataSnapshot snap) {
                        for (DataSnapshot child : snap.getChildren()) {
                            String first = child.child("firstName").getValue(String.class);
                            String last = child.child("lastName").getValue(String.class);
                            String fullName = (first != null ? first : "") + (last != null ? " " + last : "");
                            fullName = fullName.trim();
                            if (!fullName.isEmpty()) {
                                tvDriverName.setText("👤 " + fullName);
                                tvDriverName.setVisibility(View.VISIBLE);
                            }
                            return;
                        }
                    }
                    @Override public void onCancelled(@NonNull DatabaseError err) {
                        Log.w(TAG, "loadAndShowDriverName: " + err.getMessage());
                    }
                });
        } catch (Throwable t) {
            Log.w(TAG, "loadAndShowDriverName fehlgeschlagen: " + t.getMessage());
        }
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
        // v6.50.1/v6.51.3/v6.60.0: Lock-Stolen-Check.
        // v6.51.3 hatten wir Auto-Logout deaktiviert weil 2 Auth-UIDs (Email vs Phone) sich
        // endlos rausschmissen. v6.60.0 nutzt jetzt deviceId (per-Install-UUID) statt UID:
        // - Andere DeviceID im Lock → wirklich anderes Handy → Auto-Logout (richtig)
        // - Gleiche DeviceID → wir selbst (egal welcher UID) → kein Kick
        // - Lock ohne deviceId (Legacy-Build) → fall back auf UID-Vergleich, OHNE Logout
        DataSnapshot dev = s.child("activeDevice");
        if (dev.exists() && !lockStolenDialogShown) {
            String lockDeviceId = dev.child("deviceId").getValue(String.class);
            String myDeviceId = DeviceIdHelper.getOrCreate(this);
            String otherLabel = dev.child("label").getValue(String.class);
            if (lockDeviceId != null && !lockDeviceId.isEmpty()) {
                if (!lockDeviceId.equals(myDeviceId)) {
                    iOwnTheLock = false;
                    lockStolenDialogShown = true;
                    runOnUiThread(() -> showLockStolenDialog(otherLabel));
                    return;
                } else {
                    iOwnTheLock = true;
                }
            } else {
                // Legacy-Lock ohne deviceId → nur informativer Toast, kein Logout
                String lockUid = dev.child("uid").getValue(String.class);
                FirebaseUser fu = FirebaseAuth.getInstance().getCurrentUser();
                String myUid = fu != null ? fu.getUid() : "anon-" + Build.MODEL;
                if (lockUid != null && !lockUid.equals(myUid)) {
                    lockStolenDialogShown = true;
                    runOnUiThread(() -> Toast.makeText(this,
                        "ℹ️ Lock von älterer App-Version: " + (otherLabel != null ? otherLabel : "anderes Gerät"),
                        Toast.LENGTH_LONG).show());
                }
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

        // v6.62.26: Grosser Pause-Banner — sichtbar nur wenn Schicht aktiv + auf Pause
        if (tvPauseBanner != null) {
            tvPauseBanner.setVisibility((shiftActive && !onlineState) ? View.VISIBLE : View.GONE);
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

        // v6.62.62: Bei jedem Vehicle-Update (kommt mit jedem GPS-Write alle 10-15s)
        // Live-ETA für aktive Rides via OSRM neu berechnen.
        Object latObj = s.child("lat").getValue();
        Object lonObj = s.child("lon").getValue();
        Object tsObj = s.child("timestamp").getValue();
        if (latObj instanceof Number && lonObj instanceof Number) {
            double vLat = ((Number) latObj).doubleValue();
            double vLon = ((Number) lonObj).doubleValue();
            long gpsAge = (tsObj instanceof Number)
                ? System.currentTimeMillis() - ((Number) tsObj).longValue()
                : 0;
            if (gpsAge < 5L * 60L * 1000L) {
                recalculateETAsForActiveRides(vLat, vLon);
            }
        }
    }

    // v6.62.62: Pro Ride throttle — nicht oefter als alle 10s OSRM-Call
    // (v6.62.318: 20s → 10s, Patrick: ETA zeigt Wert aber bewegt sich nicht beim Fahren)
    private final java.util.Map<String, Long> lastEtaCalc = new java.util.HashMap<>();

    private void recalculateETAsForActiveRides(double vLat, double vLon) {
        if (myAssignedRides == null) return;
        long now = System.currentTimeMillis();
        for (Ride r : new ArrayList<>(myAssignedRides)) {
            if (r == null || r.id == null) continue;
            String st = r.status != null ? r.status.toLowerCase() : "";
            // v6.62.75: 2 Modi:
            //  - vor Pickup (assigned/accepted/sofort/vorbestellt/on_way): ETA zu pickupCoords → drivingTimeToPickup
            //  - nach Pickup (picked_up): ETA zu destinationCoords → drivingTimeToDestination
            boolean isPrePickup = st.equals("assigned") || st.equals("accepted") || st.equals("sofort") || st.equals("vorbestellt") || st.equals("on_way");
            boolean isPostPickup = st.equals("picked_up");
            if (!isPrePickup && !isPostPickup) continue;
            // v6.62.318: Throttle 20s → 10s (Patrick: ETA aktualisiert nicht beim Fahren).
            // Plus: bei jedem Skip einen Debug-Counter inkrementieren — hilft Diagnose
            // wenn die ETA trotzdem noch steht.
            Long lastCall = lastEtaCalc.get(r.id);
            if (lastCall != null && (now - lastCall) < 10_000L) {
                logEtaDebug(r.id, "skip-throttle", vLat, vLon, (now - lastCall) + "ms-since-last");
                continue;
            }
            if (isPrePickup) {
                if (r.pickupLat == null || r.pickupLon == null) {
                    logEtaDebug(r.id, "skip-no-pickup-coords", vLat, vLon, "");
                    continue;
                }
                // v6.62.313: Patrick (05.05. 19:51): "Entfernung bei annehmen schon sehr
                //   gut aber bleibt dann stehen". Bug: 'pickupTimestamp <= now' filterte
                //   Sofort-Fahrten (pickupTs ~ createdAt = sofort Vergangenheit) und
                //   accepted/on_way-Fahrten weg → ETA wurde nach Annehmen nie aktualisiert.
                //   Fix: Timestamp-Check NUR fuer 'vorbestellt'/'assigned' wo Pickup wirklich
                //   in Zukunft ist. accepted/on_way/sofort: IMMER ETA weiter rechnen.
                if ((st.equals("vorbestellt") || st.equals("assigned"))
                        && r.pickupTimestamp != null
                        && r.pickupTimestamp <= now - 5L * 60_000L) {
                    logEtaDebug(r.id, "skip-overdue-vorbestellt", vLat, vLon, "pickupTs=" + r.pickupTimestamp);
                    continue; // sehr alte Vorbestellung (>5 Min ueberfaellig) → skip
                }
                lastEtaCalc.put(r.id, now);
                logEtaDebug(r.id, "fetch-pickup", vLat, vLon, "to=" + r.pickupLat + "," + r.pickupLon);
                fetchOsrmETA(r.id, vLat, vLon, r.pickupLat, r.pickupLon, "pickup");
            } else if (isPostPickup) {
                if (r.destinationLat == null || r.destinationLon == null) {
                    logEtaDebug(r.id, "skip-no-dest-coords", vLat, vLon, "");
                    continue;
                }
                lastEtaCalc.put(r.id, now);
                logEtaDebug(r.id, "fetch-destination", vLat, vLon, "to=" + r.destinationLat + "," + r.destinationLon);
                fetchOsrmETA(r.id, vLat, vLon, r.destinationLat, r.destinationLon, "destination");
            }
        }
    }

    // v6.62.437: ETA-Debug-Logging entfernt. Patrick's Admin-Dashboard las /errorLogs
    // und wurde durch >1000 etadbg-Einträge ausgebremst (08.05. 07:50: "Seite lädt 1
    // Min, hängt"). Untersuchung aus v6.62.318 ist abgeschlossen — der Spam-Output war
    // nur noch Ballast. Aufruf bleibt als No-Op falls noch Aufrufer im Code sind.
    private void logEtaDebug(String rideId, String event, double vLat, double vLon, String extra) {
        // No-op (v6.62.437)
    }

    private void fetchOsrmETA(String rideId, double fromLat, double fromLon, double toLat, double toLon, String mode) {
        new Thread(() -> {
            try {
                String url = String.format(Locale.US,
                    "https://router.project-osrm.org/route/v1/driving/%f,%f;%f,%f?overview=false",
                    fromLon, fromLat, toLon, toLat);
                java.net.HttpURLConnection conn = (java.net.HttpURLConnection) new java.net.URL(url).openConnection();
                conn.setConnectTimeout(5000);
                conn.setReadTimeout(5000);
                conn.setRequestProperty("User-Agent", "FunkTaxiHeringsdorf-DriverApp");
                int code = conn.getResponseCode();
                if (code != 200) { conn.disconnect(); return; }
                java.io.BufferedReader br = new java.io.BufferedReader(new java.io.InputStreamReader(conn.getInputStream()));
                StringBuilder sb = new StringBuilder();
                String line;
                while ((line = br.readLine()) != null) sb.append(line);
                br.close();
                conn.disconnect();
                org.json.JSONObject json = new org.json.JSONObject(sb.toString());
                if (!json.has("routes")) return;
                org.json.JSONArray routes = json.getJSONArray("routes");
                if (routes.length() == 0) return;
                double durationSec = routes.getJSONObject(0).getDouble("duration");
                int durationMin = Math.max(1, (int) Math.round(durationSec / 60.0));
                // v6.62.318: Patrick (06.05. 07:12): "Fahrer sieht nicht, wie weit er
                // jetzt vom Kunden entfernt ist". OSRM liefert auch distance in Metern
                // → wir speichern km zusaetzlich zur Min-Anzeige.
                double distanceMeters = routes.getJSONObject(0).optDouble("distance", 0);
                final double distanceKm = Math.round(distanceMeters / 100.0) / 10.0; // 1 Nachkommastelle
                // Local update + UI redraw
                final String _mode = mode;
                runOnUiThread(() -> {
                    boolean changed = false;
                    for (Ride rr : myAssignedRides) {
                        if (rr.id != null && rr.id.equals(rideId)) {
                            if ("destination".equals(_mode)) {
                                if (rr.drivingTimeToDestination == null || rr.drivingTimeToDestination != durationMin) {
                                    rr.drivingTimeToDestination = durationMin;
                                    changed = true;
                                }
                                if (rr.drivingDistanceToDestKm == null || Math.abs(rr.drivingDistanceToDestKm - distanceKm) > 0.05) {
                                    rr.drivingDistanceToDestKm = distanceKm;
                                    changed = true;
                                }
                            } else {
                                if (rr.drivingTimeToPickup == null || rr.drivingTimeToPickup != durationMin) {
                                    rr.drivingTimeToPickup = durationMin;
                                    changed = true;
                                }
                                if (rr.drivingDistanceToPickupKm == null || Math.abs(rr.drivingDistanceToPickupKm - distanceKm) > 0.05) {
                                    rr.drivingDistanceToPickupKm = distanceKm;
                                    changed = true;
                                }
                            }
                            break;
                        }
                    }
                    if (changed && rideAdapter != null) rideAdapter.notifyDataSetChanged();
                });
                // Firebase update damit Admin-Dashboard den Live-Wert sieht
                if (db != null) {
                    String field = "destination".equals(mode) ? "drivingTimeToDestination" : "drivingTimeToPickup";
                    String distField = "destination".equals(mode) ? "drivingDistanceToDestKm" : "drivingDistanceToPickupKm";
                    db.getReference("rides/" + rideId + "/" + field).setValue(durationMin);
                    db.getReference("rides/" + rideId + "/" + distField).setValue(distanceKm);
                    db.getReference("rides/" + rideId + "/liveEtaUpdatedAt").setValue(System.currentTimeMillis());
                }
                logEtaDebug(rideId, "fetch-success", fromLat, fromLon, durationMin + "min " + distanceKm + "km");
            } catch (Exception e) {
                Log.w(TAG, "OSRM-ETA fuer ride " + rideId + " fehlgeschlagen: " + e.getMessage());
                logEtaDebug(rideId, "fetch-error", fromLat, fromLon, e.getMessage());
                // 🆕 v6.62.607: Haversine-Fallback wenn OSRM nicht antwortet.
                // Patrick (11.05. 12:29): "GPS ist exakt, aber Native zeigt 5 Min obwohl ich
                // schon da bin. Track-HTML hat das hin, Fahrer-App nicht."
                // Track-HTML (Kunden-Seite) hat schon laenger ein Haversine-Fallback. Native
                // ist hinten geblieben. → Bei OSRM-Fehler grobe Live-Distanz aus GPS:
                //   distKm = haversine(from, to), durationMin = max(1, round(distKm * 1.3 / 40 * 60))
                try {
                    double dLat = (toLat - fromLat) * Math.PI / 180.0;
                    double dLon = (toLon - fromLon) * Math.PI / 180.0;
                    double a = Math.sin(dLat/2.0)*Math.sin(dLat/2.0) +
                        Math.cos(fromLat * Math.PI/180.0) * Math.cos(toLat * Math.PI/180.0) *
                        Math.sin(dLon/2.0) * Math.sin(dLon/2.0);
                    double distKm = 6371.0 * 2.0 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
                    int durMin = Math.max(1, (int) Math.round(distKm * 1.3 / 40.0 * 60.0));
                    final double distKmF = Math.round(distKm * 10.0) / 10.0;
                    final int durMinF = durMin;
                    final String _modeF = mode;
                    runOnUiThread(() -> {
                        boolean changed = false;
                        for (Ride rr : myAssignedRides) {
                            if (rr.id != null && rr.id.equals(rideId)) {
                                if ("destination".equals(_modeF)) {
                                    if (rr.drivingTimeToDestination == null || rr.drivingTimeToDestination != durMinF) {
                                        rr.drivingTimeToDestination = durMinF;
                                        changed = true;
                                    }
                                    if (rr.drivingDistanceToDestKm == null || Math.abs(rr.drivingDistanceToDestKm - distKmF) > 0.05) {
                                        rr.drivingDistanceToDestKm = distKmF;
                                        changed = true;
                                    }
                                } else {
                                    if (rr.drivingTimeToPickup == null || rr.drivingTimeToPickup != durMinF) {
                                        rr.drivingTimeToPickup = durMinF;
                                        changed = true;
                                    }
                                    if (rr.drivingDistanceToPickupKm == null || Math.abs(rr.drivingDistanceToPickupKm - distKmF) > 0.05) {
                                        rr.drivingDistanceToPickupKm = distKmF;
                                        changed = true;
                                    }
                                }
                                break;
                            }
                        }
                        if (changed && rideAdapter != null) rideAdapter.notifyDataSetChanged();
                    });
                    if (db != null) {
                        String field = "destination".equals(mode) ? "drivingTimeToDestination" : "drivingTimeToPickup";
                        String distField = "destination".equals(mode) ? "drivingDistanceToDestKm" : "drivingDistanceToPickupKm";
                        db.getReference("rides/" + rideId + "/" + field).setValue(durMin);
                        db.getReference("rides/" + rideId + "/" + distField).setValue(distKmF);
                        db.getReference("rides/" + rideId + "/liveEtaUpdatedAt").setValue(System.currentTimeMillis());
                        db.getReference("rides/" + rideId + "/liveEtaMethod").setValue("haversine-fallback");
                    }
                    Log.i(TAG, "ETA Haversine-Fallback fuer ride " + rideId + ": " + durMin + " Min, " + distKmF + " km");
                } catch (Throwable _t) {
                    Log.w(TAG, "Haversine-Fallback ebenfalls fehlgeschlagen: " + _t.getMessage());
                }
            }
        }, "osrm-eta-" + rideId).start();
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
            if (id == R.id.menu_check_update)   {
                // v6.62.605: Manueller Update-Check ohne Logout (Patrick 11.05.: "musste mich
                // abmelden damit Banner erscheint"). Triggert UpdateChecker erneut.
                Toast.makeText(this, "🔄 Pruefe auf Updates...", Toast.LENGTH_SHORT).show();
                UpdateChecker.checkAsync(this, updateBanner, updateBannerText, updateBannerBtn);
                return true;
            }
            if (id == R.id.menu_shift_toggle)   { toggleShift(); return true; }
            if (id == R.id.menu_online_toggle)  { toggleOnline(); return true; }
            if (id == R.id.menu_stats)          { startActivity(new Intent(this, StatsActivity.class)); return true; }
            if (id == R.id.menu_crm)            { startActivity(new Intent(this, CrmSearchActivity.class)); return true; }
            // v6.62.153: Disposition öffnet AdminDashboardActivity (Operator-Modus
            // mit Liste aller aktiven Fahrten + Tap-to-Edit). isAdminMode-Flag wird in
            // AdminDashboardActivity selbst gesetzt — beim Zurück automatisch zurueckgenommen.
            if (id == R.id.menu_dispo)          { startActivity(new Intent(this, AdminDashboardActivity.class)); return true; }
            // v6.62.650: Patrick (12.05. 19:16) 'Im Browser geht es' — WebView in der App
            // hat persistente Cache-Probleme. Pragmatik: oeffne im externen Standard-Browser,
            // der nachweislich funktioniert. Zurueck-Button-UX ist zweitrangig wenn die Karte
            // ueberhaupt sichtbar sein muss.
            if (id == R.id.menu_map) {
                String myVid = getSharedPreferences("driver", MODE_PRIVATE).getString("vehicleId", "");
                String url = "https://umwelt-taxi-insel-usedom.de/fahrer-map.html?myVehicle="
                    + java.net.URLEncoder.encode(myVid) + "&nc=" + System.currentTimeMillis();
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, android.net.Uri.parse(url)));
                } catch (Throwable t) {
                    Toast.makeText(this, "Karte kann nicht geoeffnet werden: " + t.getMessage(), Toast.LENGTH_LONG).show();
                }
                return true;
            }
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

    // v6.62.209: Public Getter fuer UpdateChecker.
    public boolean isShiftActive() {
        return shiftActive;
    }

    // v6.62.209: Profi-Update-Flow. Patrick: "Schicht sauber beenden bevor
    // Update installiert wird, dann App schliessen, dann Update — keine
    // Geist-Schichten in Firebase". Beendet Schicht, stoppt Service, loescht
    // Lock, ruft onDone nach 800ms (damit Firebase-Updates committet sind).
    // Auth + SharedPrefs bleiben — nach Update landet der Fahrer wieder
    // direkt am Dashboard und kann eine neue Schicht starten.
    public void cleanShutdownForUpdate(Runnable onDone) {
        if (shiftActive && currentVehicleId != null && db != null) {
            try {
                DatabaseReference shiftRef = db.getReference("vehicles/" + currentVehicleId + "/shift");
                Map<String, Object> updates = new HashMap<>();
                updates.put("status", "ended");
                updates.put("endedAt", System.currentTimeMillis());
                updates.put("endedReason", "app_update");
                shiftRef.updateChildren(updates);
                db.getReference("vehicles/" + currentVehicleId + "/online").setValue(false);
                shiftActive = false;
                Log.i(TAG, "🛑 Schicht beendet wegen App-Update (vehicle=" + currentVehicleId + ")");
            } catch (Throwable t) {
                Log.w(TAG, "Schicht-Ende vor Update fehlgeschlagen: " + t.getMessage());
            }
        }
        try {
            Intent stopSvc = new Intent(this, ShiftForegroundService.class);
            stopSvc.setAction(ShiftForegroundService.ACTION_STOP);
            startService(stopSvc);
        } catch (Throwable _t) {}
        clearVehicleLock();
        // 800ms warten damit Firebase die Updates committet bevor System-Installer
        // die App killt. Auth + SharedPrefs bleiben absichtlich erhalten.
        new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(onDone, 800);
    }

    private void doLogout() {
        // v6.62.93: Wenn Schicht noch aktiv ist beim Abmelden → automatisch beenden.
        // Patrick: 'erst Schicht stoppen und dann abmelden' war die manuelle Lösung —
        // Notification blieb sonst persistent, Service lief weiter, Heartbeat ins Leere.
        if (shiftActive && currentVehicleId != null && db != null) {
            try {
                DatabaseReference ref = db.getReference("vehicles/" + currentVehicleId + "/shift");
                Map<String, Object> updates = new HashMap<>();
                updates.put("status", "ended");
                updates.put("endedAt", System.currentTimeMillis());
                updates.put("endedReason", "logout_native_dashboard");
                ref.updateChildren(updates);
                db.getReference("vehicles/" + currentVehicleId + "/online").setValue(false);
                Log.i(TAG, "🛑 Schicht beendet wegen Logout (vehicle=" + currentVehicleId + ")");
            } catch (Throwable t) {
                Log.w(TAG, "Schicht-Ende beim Logout fehlgeschlagen: " + t.getMessage());
            }
        }
        try {
            Intent stopSvc = new Intent(this, ShiftForegroundService.class);
            stopSvc.setAction(ShiftForegroundService.ACTION_STOP);
            startService(stopSvc);
            Log.i(TAG, "🛑 ShiftForegroundService STOP gesendet (Logout)");
        } catch (Throwable t) {
            Log.w(TAG, "Service-Stop beim Logout fehlgeschlagen: " + t.getMessage());
        }
        clearVehicleLock();
        try { FirebaseAuth.getInstance().signOut(); } catch (Throwable _t) {}
        getSharedPreferences("driver", MODE_PRIVATE).edit().clear().apply();
        // FCM-Token NICHT löschen — bleibt für Push-Empfang nach Re-Login
        startActivity(new Intent(this, LoginActivity.class));
        finish();
    }

    // v6.50.1/v6.60.0: Lock-Heartbeat — schreibt uid/label/deviceId/lastHeartbeat.
    // v6.60.0: Skip wenn iOwnTheLock=false (fremde DeviceID hat den Lock übernommen).
    // Sonst würde der Heartbeat den fremden Lock direkt wieder überschreiben → Loop.
    private void sendLockHeartbeat() {
        if (!iOwnTheLock) return;
        if (db == null || currentVehicleId == null) {
            try {
                db = FirebaseDatabase.getInstance(DB_INSTANCE_URL);
            } catch (Throwable _t) { return; }
        }
        if (currentVehicleId == null) return;
        FirebaseUser fu = FirebaseAuth.getInstance().getCurrentUser();
        String myUid = fu != null ? fu.getUid() : "anon-" + Build.MODEL;
        String myLabel = VehiclePickerActivity.buildDeviceLabel(fu);
        String myDeviceId = DeviceIdHelper.getOrCreate(this);
        Map<String, Object> u = new HashMap<>();
        u.put("uid", myUid);
        u.put("label", myLabel);
        u.put("deviceId", myDeviceId);
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

    // v6.62.67: Pause-Resume-Handler fuer Auto-Resume nach 15/30 Min
    private final Handler pauseResumeHandler = new Handler(Looper.getMainLooper());
    private Runnable pauseResumeTask = null;

    // v6.62.86: Periodischer ETA-Trigger — alle 30s. vehicles/{id}-Listener feuert
    // v6.62.320: Display-Tick — rendert NUR die Adapter-Items neu (kein OSRM).
    // So zaehlt 'Losfahren in 25 Min' alle 5s sichtbar runter ohne Battery-Drain.
    private final Handler displayTickHandler = new Handler(Looper.getMainLooper());
    private final Runnable displayTick = new Runnable() {
        @Override public void run() {
            try {
                if (rideAdapter != null && rideAdapter.getItemCount() > 0) {
                    rideAdapter.notifyDataSetChanged();
                }
            } catch (Throwable _t) {}
            displayTickHandler.postDelayed(this, 5_000L);
        }
    };

    // nur bei Wert-Aenderung; im Stillstand kein Update. Dieser Loop zwingt Recalc.
    private final Handler etaTickHandler = new Handler(Looper.getMainLooper());
    private final Runnable etaTick = new Runnable() {
        @Override public void run() {
            try {
                if (currentVehicleId != null && db != null) {
                    db.getReference("vehicles/" + currentVehicleId).addListenerForSingleValueEvent(new ValueEventListener() {
                        @Override public void onDataChange(@NonNull DataSnapshot s) {
                            Object lat = s.child("lat").getValue();
                            Object lon = s.child("lon").getValue();
                            Object ts = s.child("timestamp").getValue();
                            if (lat instanceof Number && lon instanceof Number) {
                                long age = (ts instanceof Number) ? System.currentTimeMillis() - ((Number) ts).longValue() : 0;
                                if (age < 5L * 60L * 1000L) {
                                    recalculateETAsForActiveRides(((Number) lat).doubleValue(), ((Number) lon).doubleValue());
                                }
                            }
                        }
                        @Override public void onCancelled(@NonNull DatabaseError e) {}
                    });
                }
            } catch (Throwable _e) {}
            etaTickHandler.postDelayed(this, 15_000L); // v6.62.318: 30s → 15s
        }
    };

    private void toggleOnline() {
        if (db == null || currentVehicleId == null) return;
        if (onlineState) {
            // Aktuell online → Pause-Dialog zeigen mit 15/30/Manuell-Auswahl
            showPauseDialog();
        } else {
            // Aktuell in Pause → sofort wieder online (Patrick: "manuell zurueck")
            cancelPauseResumeTask();
            Map<String, Object> u = new HashMap<>();
            u.put("online", true);
            u.put("dispatchStatus", "online");
            u.put("pauseUntil", null);
            u.put("pauseResumedAt", System.currentTimeMillis());
            u.put("pauseResumedBy", "manual");
            db.getReference("vehicles/" + currentVehicleId).updateChildren(u);
            Toast.makeText(this, "🟢 Online", Toast.LENGTH_SHORT).show();
        }
    }

    // v6.62.67: Pause-Dialog mit 15/30/Manuell. Spec von Patrick 28.04.:
    // "der springt dann automatisch nach 15 Minuten wieder in frei oder
    //  nach 30 Minuten ... dann weiss zumindest auch die Vermittlung,
    //  wann das Fahrzeug wieder frei ist."
    private void showPauseDialog() {
        new androidx.appcompat.app.AlertDialog.Builder(this)
            .setTitle("⏸ Pause machen")
            .setItems(new String[]{
                "15 Minuten (auto-zurueck)",
                "30 Minuten (auto-zurueck)",
                "Manuell (manuell zurueck)"
            }, (dialog, which) -> {
                int minutes = 0;
                if (which == 0) minutes = 15;
                else if (which == 1) minutes = 30;
                setPause(minutes);
            })
            .setNegativeButton("Abbrechen", null)
            .show();
    }

    private void setPause(int minutes) {
        if (db == null || currentVehicleId == null) return;
        cancelPauseResumeTask();
        long now = System.currentTimeMillis();
        Map<String, Object> u = new HashMap<>();
        u.put("online", false);
        u.put("dispatchStatus", "pause");
        u.put("pauseStartedAt", now);
        if (minutes > 0) {
            long pauseUntil = now + (long) minutes * 60_000L;
            u.put("pauseUntil", pauseUntil);
            // Lokaler Timer als primaerer Trigger; Cloud Function als Backup
            pauseResumeTask = () -> {
                if (db == null || currentVehicleId == null) return;
                Map<String, Object> resumeU = new HashMap<>();
                resumeU.put("online", true);
                resumeU.put("dispatchStatus", "online");
                resumeU.put("pauseUntil", null);
                resumeU.put("pauseResumedAt", System.currentTimeMillis());
                resumeU.put("pauseResumedBy", "app-timer");
                db.getReference("vehicles/" + currentVehicleId).updateChildren(resumeU);
                runOnUiThread(() -> Toast.makeText(this, "🟢 Pause vorbei — wieder online", Toast.LENGTH_LONG).show());
                pauseResumeTask = null;
            };
            pauseResumeHandler.postDelayed(pauseResumeTask, (long) minutes * 60_000L);
            Toast.makeText(this, "⏸ Pause " + minutes + " Min — auto-zurueck um " +
                new java.text.SimpleDateFormat("HH:mm", Locale.GERMANY).format(new java.util.Date(pauseUntil)),
                Toast.LENGTH_LONG).show();
        } else {
            u.put("pauseUntil", null); // Manuell — kein Auto-Resume
            Toast.makeText(this, "⏸ Pause manuell — tippe nochmal um wieder online zu gehen", Toast.LENGTH_LONG).show();
        }
        db.getReference("vehicles/" + currentVehicleId).updateChildren(u);
    }

    private void cancelPauseResumeTask() {
        if (pauseResumeTask != null) {
            pauseResumeHandler.removeCallbacks(pauseResumeTask);
            pauseResumeTask = null;
        }
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
        // v6.62.84: Patrick: 'doch nicht 60 Min vorher'. Auch 'accepted' im 20-Min-Fenster
        // halten — nur wirklich laufende Fahrten (on_way/arrived/picked_up) immer zeigen.
        long now = System.currentTimeMillis();
        long windowPast = now - 12L * 3600L * 1000L;
        long windowFuture = now + 20L * 60L * 1000L;
        List<Ride> assigned = new ArrayList<>();
        for (DataSnapshot child : s.getChildren()) {
            Ride r = Ride.fromSnap(child);
            if (r == null) continue;
            if (r.status == null) continue;
            String st = r.status.toLowerCase();
            // v6.62.358 (06.05.): Patrick: "der fahrer sieht die stornierte fahrt nicht mehr".
            // Bisher wurden cancelled/storniert komplett ausgefiltert → Fahrer wusste nicht
            // warum die Fahrt weg war. Jetzt: in den letzten 30 Min stornierte Fahrten die
            // diesem Fahrzeug zugewiesen waren bleiben sichtbar (mit rotem Banner in der UI).
            if (st.equals("completed") || st.equals("abgeschlossen") ||
                st.equals("deleted") || st.equals("gelöscht") || st.equals("rejected") ||
                st.equals("done")) continue;
            boolean isCancelled = st.equals("cancelled") || st.equals("canceled") || st.equals("storniert");
            if (isCancelled) {
                // v6.62.359: Fallback auf deletedAt (alte buchen.html-Stornos vor 13:55 schrieben
                // nur deletedAt statt cancelledAt). Auch updatedAt als allerletzter Fallback.
                Long ca = r.cancelledAt != null ? r.cancelledAt
                       : (r.deletedAt != null ? r.deletedAt : null);
                long age = ca != null ? (now - ca) : Long.MAX_VALUE;
                boolean wasMine = currentVehicleId != null
                    && (currentVehicleId.equals(r.assignedVehicle) || currentVehicleId.equals(r.vehicleId));
                // v6.62.523: Patrick (09.05.): "das storniert geht nicht weg". 30 Min war zu
                // lang — auf 10 Min reduziert. Plus: lokales Wegklicken via getDismissedCancelledIds().
                if (age > 10L * 60L * 1000L || !wasMine) continue;
                if (isCancelledRideDismissed(r.id)) continue;
                // sichtbar bleiben — Adapter zeigt Storno-Banner anhand r.status
            }
            // v6.62.132: Patrick: 'warum erscheint die Vorbestellung jetzt nicht in meiner Liste?'
            // Bug: angenommene Vorbestellungen (status=assigned/accepted) wurden durchs 20-Min-
            // Fenster gefiltert, obwohl der Fahrer sie schon angenommen hat. Wenn der Fahrer
            // die Annahme bestaetigt hat, will er die Buchung IMMER im Blick haben — sonst
            // weiss er nach Annehmen nicht mehr was als Naechstes ansteht.
            // Fix: accepted/assigned auch als 'immer-sichtbar' behandeln, gleich wie laufende
            // Fahrten. Nur new/sofort/warteschlange/vorbestellt fallen unters 20-Min-Fenster.
            boolean isLive = st.equals("on_way") || st.equals("arrived") || st.equals("picked_up")
                          || st.equals("accepted") || st.equals("assigned");
            if (!isLive) {
                if (r.pickupTimestamp == null) {
                    if (!st.equals("new") && !st.equals("sofort")) continue;
                } else {
                    if (r.pickupTimestamp < windowPast) continue;
                    if (r.pickupTimestamp > windowFuture) continue;
                }
            }
            assigned.add(r);
        }
        myAssignedRides = assigned;
        // 🆕 v6.62.377+v6.62.379: Patrick: "20 Min sind nicht schlecht, 4h Quatsch".
        // Kompromiss: 30 Min Banner-Lookahead — sieht naechste Vorbestellung etwas frueher
        // als die 20-Min-Listenanzeige aber nicht 4h vorher.
        List<Ride> banner4h = new ArrayList<>();
        long bannerWindow = now + 30L * 60L * 1000L;
        for (DataSnapshot child : s.getChildren()) {
            Ride r = Ride.fromSnap(child);
            if (r == null || r.status == null || r.pickupTimestamp == null) continue;
            String st = r.status.toLowerCase();
            if (!(st.equals("vorbestellt") || st.equals("accepted") || st.equals("assigned") || st.equals("new"))) continue;
            if (r.pickupTimestamp <= now || r.pickupTimestamp > bannerWindow) continue;
            banner4h.add(r);
        }
        myBannerLookaheadRides = banner4h;
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
        // v6.62.369: Driver-Banner aktualisieren
        updateFreeBusyBanner(all);
    }

    // 🆕 v6.62.523: Lokales Wegklicken stornierter Fahrten (Patrick: "das storniert geht nicht weg").
    // Dismissed-IDs werden pro Geraet in SharedPreferences gespeichert (kein Firebase, kein Sync).
    private static final String PREFS_DISMISSED_CANCELLED = "dismissedCancelledRides";
    private static final String KEY_DISMISSED_IDS = "ids";

    private java.util.Set<String> getDismissedCancelledIds() {
        java.util.Set<String> empty = new java.util.HashSet<>();
        return getSharedPreferences(PREFS_DISMISSED_CANCELLED, MODE_PRIVATE).getStringSet(KEY_DISMISSED_IDS, empty);
    }

    private boolean isCancelledRideDismissed(String rideId) {
        if (rideId == null || rideId.isEmpty()) return false;
        return getDismissedCancelledIds().contains(rideId);
    }

    private void dismissCancelledRide(String rideId) {
        if (rideId == null || rideId.isEmpty()) return;
        java.util.Set<String> set = new java.util.HashSet<>(getDismissedCancelledIds());
        set.add(rideId);
        getSharedPreferences(PREFS_DISMISSED_CANCELLED, MODE_PRIVATE)
            .edit().putStringSet(KEY_DISMISSED_IDS, set).apply();
    }

    // 🆕 v6.62.369: Banner "🟢 Frei bis HH:MM · Naechste Vorbestellung HH:MM" oben in der Toolbar.
    // Patrick (06.05. 14:30): "wie kriegen wir dem Fahrer uebermittelt dass irgendwann ne Fahrt
    // auf ihn zukommt". Phase-1-3-Zonen-Modell (v6.62.362) macht Tesla bis kurz vor Pickup frei
    // fuer Sofort-Anfragen — Banner zeigt dem Fahrer wann er sich bewegen muss.
    private void updateFreeBusyBanner(List<Ride> rides) {
        android.widget.LinearLayout banner = findViewById(R.id.freebusy_banner);
        TextView statusText = findViewById(R.id.freebusy_status);
        TextView nextText = findViewById(R.id.freebusy_next);
        if (banner == null || statusText == null || nextText == null) return;
        // Wenn aktuell laufende Fahrt (on_way / picked_up) → Banner aus
        boolean hasActive = false;
        for (Ride r : rides) {
            if (r == null || r.status == null) continue;
            String st = r.status.toLowerCase();
            if (st.equals("on_way") || st.equals("picked_up") || st.equals("arrived")) { hasActive = true; break; }
        }
        if (hasActive) { banner.setVisibility(View.GONE); return; }
        // Nächste Vorbestellung mit pickupTimestamp > now suchen
        // v6.62.377: nutze myBannerLookaheadRides (4h-Lookahead, kein 20-Min-Filter)
        long now = System.currentTimeMillis();
        Ride nextRide = null;
        long nextPickup = Long.MAX_VALUE;
        List<Ride> bannerSource = (myBannerLookaheadRides != null && !myBannerLookaheadRides.isEmpty())
            ? myBannerLookaheadRides : rides;
        for (Ride r : bannerSource) {
            if (r == null || r.pickupTimestamp == null || r.status == null) continue;
            String st = r.status.toLowerCase();
            if (!st.equals("vorbestellt") && !st.equals("accepted") && !st.equals("assigned") && !st.equals("new")) continue;
            if (r.pickupTimestamp <= now) continue;
            if (r.pickupTimestamp < nextPickup) { nextPickup = r.pickupTimestamp; nextRide = r; }
        }
        if (nextRide == null) {
            // Kein Termin in Sicht — Fahrer komplett frei
            banner.setBackgroundColor(android.graphics.Color.parseColor("#059669"));
            statusText.setText("🟢 Frei für Sofort-Anfragen — keine Vorbestellung in Sicht");
            nextText.setVisibility(View.GONE);
            banner.setVisibility(View.VISIBLE);
            return;
        }
        // Berechnung: blockiert ab pickup - max(15 Min, drivingTimeToPickup + 3 Min)
        int anfahrtMin = (nextRide.drivingTimeToPickup != null && nextRide.drivingTimeToPickup > 0)
            ? nextRide.drivingTimeToPickup : 10;
        int blockBufMin = Math.max(15, anfahrtMin + 3);
        long blockAt = nextRide.pickupTimestamp - (blockBufMin * 60_000L);
        long minBisBlock = (blockAt - now) / 60_000L;
        java.text.SimpleDateFormat hmFmt = new java.text.SimpleDateFormat("HH:mm", Locale.GERMANY);
        hmFmt.setTimeZone(java.util.TimeZone.getTimeZone("Europe/Berlin"));
        String pickupHM = hmFmt.format(new java.util.Date(nextRide.pickupTimestamp));
        String blockHM = hmFmt.format(new java.util.Date(blockAt));
        // v6.62.517: Patrick (09.05.): "warum man nicht alles sieht oben bei jetzt losfahren".
        // Vorher Truncate auf 40 Zeichen — "Heringsdorf, Bahnhof, Am Bahnhof, 17424 …".
        // TextView ist wrap_content ohne maxLines, darf also auf zwei Zeilen umbrechen.
        String pickupAddr = nextRide.pickup != null ? nextRide.pickup : "?";
        // 🆕 v6.62.378: Patrick (06.05. 18:07): "4 Min Restzeit — keine Sofortfahrt mehr".
        // Banner zeigt jetzt realistisch was noch geht: max-Fahrtzeit = restzeit - Puffer
        // (5 Min Anfahrt zu Sofort + 3 Min Boarding + 5 Min Rueckfahrt).
        long maxFahrtMin = minBisBlock - 13;
        if (minBisBlock <= 0) {
            // In Losfahr-Zone — los
            banner.setBackgroundColor(android.graphics.Color.parseColor("#dc2626"));
            statusText.setText("🚗 LOSFAHREN! Pickup " + pickupHM + " · " + anfahrtMin + " Min Anfahrt");
            nextText.setText("📍 " + pickupAddr);
            nextText.setVisibility(View.VISIBLE);
        } else if (minBisBlock < 15) {
            // Zu kurz fuer eine sinnvolle Sofortfahrt — rot
            banner.setBackgroundColor(android.graphics.Color.parseColor("#dc2626"));
            statusText.setText("🔴 Keine Sofortfahrt mehr — in " + minBisBlock + " Min losfahren!");
            nextText.setText("📅 Pickup " + pickupHM + " · " + pickupAddr);
            nextText.setVisibility(View.VISIBLE);
        } else if (minBisBlock <= 30) {
            // Nur kurze Sofortfahrt moeglich — gelb
            banner.setBackgroundColor(android.graphics.Color.parseColor("#f59e0b"));
            statusText.setText("🟡 Nur kurze Fahrt: max " + maxFahrtMin + " Min Fahrtzeit (frei bis " + blockHM + ")");
            nextText.setText("📅 Pickup " + pickupHM + " · " + pickupAddr);
            nextText.setVisibility(View.VISIBLE);
        } else {
            // Locker — gruen
            banner.setBackgroundColor(android.graphics.Color.parseColor("#059669"));
            statusText.setText("🟢 Frei für Sofort · max " + maxFahrtMin + " Min Fahrtzeit (bis " + blockHM + ")");
            nextText.setText("📅 Nächste Vorbestellung " + pickupHM + " · " + pickupAddr);
            nextText.setVisibility(View.VISIBLE);
        }
        banner.setVisibility(View.VISIBLE);
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
            // v6.62.98: Patrick: 'Fahrer-SMS soll Namen enthalten — Ihr Fahrer Patrick
            // ist jetzt unterwegs'.
            // 🆕 v6.62.333: Patrick (06.05. 09:05): "warum steht da Patrick?" — IK ist mit
            // funktaxi.dk@gmail.com angemeldet (Mitarbeiter Kulpa), aber Auth-DisplayName
            // ist 'Patrick Wydra'. Bug: Code las Auth-DisplayName direkt → falsch.
            // Fix: User-Doc aus /users/{uid} laden → linkedStaffId → /staff/{id}.firstName +
            // lastName. Auth-DisplayName + Email-Praefix nur als letzter Fallback.
            try {
                com.google.firebase.auth.FirebaseUser _user = com.google.firebase.auth.FirebaseAuth.getInstance().getCurrentUser();
                if (_user != null) {
                    final String _uid = _user.getUid();
                    final String _authDn = _user.getDisplayName();
                    final String _authEm = _user.getEmail();
                    updates.put("userId", _uid);
                    // Erst nur die sicheren Felder schreiben
                    ref.updateChildren(updates);
                    // Async: korrekten Namen aus /staff/{linkedStaffId} nachziehen
                    db.getReference("users/" + _uid).addListenerForSingleValueEvent(new ValueEventListener() {
                        @Override public void onDataChange(@NonNull DataSnapshot _us) {
                            String _staffId = _us.child("linkedStaffId").getValue(String.class);
                            Runnable _fallback = () -> {
                                String _dn = _authDn;
                                if (_dn == null || _dn.trim().isEmpty()) {
                                    if (_authEm != null && _authEm.contains("@")) _dn = _authEm.substring(0, _authEm.indexOf("@"));
                                }
                                if (_dn != null && !_dn.trim().isEmpty()) {
                                    ref.child("driverName").setValue(_dn.trim());
                                }
                            };
                            if (_staffId == null || _staffId.trim().isEmpty()) { _fallback.run(); return; }
                            db.getReference("staff/" + _staffId).addListenerForSingleValueEvent(new ValueEventListener() {
                                @Override public void onDataChange(@NonNull DataSnapshot _ss) {
                                    String _fn = _ss.child("firstName").getValue(String.class);
                                    String _ln = _ss.child("lastName").getValue(String.class);
                                    String _composed = ((_fn != null ? _fn : "") + " " + (_ln != null ? _ln : "")).trim();
                                    if (_composed.isEmpty()) { _fallback.run(); return; }
                                    ref.child("driverName").setValue(_composed);
                                    Log.i(TAG, "✅ shift.driverName aus /staff/" + _staffId + " gesetzt: " + _composed);
                                }
                                @Override public void onCancelled(@NonNull DatabaseError e) { _fallback.run(); }
                            });
                        }
                        @Override public void onCancelled(@NonNull DatabaseError e) {
                            // ohne /users/{uid} → Auth-DisplayName-Fallback
                            String _dn = _authDn;
                            if (_dn == null || _dn.trim().isEmpty()) {
                                if (_authEm != null && _authEm.contains("@")) _dn = _authEm.substring(0, _authEm.indexOf("@"));
                            }
                            if (_dn != null && !_dn.trim().isEmpty()) ref.child("driverName").setValue(_dn.trim());
                        }
                    });
                } else {
                    ref.updateChildren(updates);
                }
            } catch (Throwable _shiftIdErr) {
                Log.w(TAG, "Shift driverName Schreibfehler: " + _shiftIdErr.getMessage());
                ref.updateChildren(updates);
            }
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
        String cleanPhone = phone.replaceAll("[^+0-9]", "");
        // v6.62.8: Patrick: 'können auch die SMS automatisch verschickt werden, ohne
        // dass ich das mal bestätigen muss, weil das nervt'.
        // Direct via SmsManager statt ACTION_SENDTO-Intent (das öffnet SMS-App + erfordert
        // Tap auf 'Senden'). Voraussetzung: SEND_SMS Permission einmalig erteilt.
        try {
            if (androidx.core.content.ContextCompat.checkSelfPermission(this,
                    android.Manifest.permission.SEND_SMS) == android.content.pm.PackageManager.PERMISSION_GRANTED) {
                android.telephony.SmsManager smsMgr = android.telephony.SmsManager.getDefault();
                java.util.ArrayList<String> parts = smsMgr.divideMessage(body);
                if (parts.size() == 1) {
                    smsMgr.sendTextMessage(cleanPhone, null, body, null, null);
                } else {
                    smsMgr.sendMultipartTextMessage(cleanPhone, null, parts, null, null);
                }
                Toast.makeText(this, "✅ SMS gesendet an " + cleanPhone, Toast.LENGTH_SHORT).show();
                return;
            }
            // Permission noch nicht da → einmalig anfragen, danach Fallback auf Intent
            androidx.core.app.ActivityCompat.requestPermissions(this,
                new String[]{ android.Manifest.permission.SEND_SMS }, 5009);
            // Bis Permission erteilt: Intent-Fallback
            Uri uri = Uri.parse("smsto:" + cleanPhone);
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

        // v6.62.69: Tap-Audit — wer hat den Status-Tap ausgeloest. Cloud onRideUpdated
        // loggt den Status-Wechsel selbst, aber wir wissen nicht ob es ein Driver-Tap oder
        // anderer Trigger war. Patrick will das im Verlauf nachvollziehen koennen.
        logLifecycleTap(r.id, "👆", "Fahrer-Tap: Status → " + next, next);

        // v6.62.61: Auto-SMS-Tracking-Link entfernt. Cloud-Function schickt bei Status-Wechsel
        // bereits 2 SMS (Bestaetigung + "Fahrer faehrt los", beide mit Track-Link inline) —
        // die zusaetzliche Fahrer-SIM-SMS war doppelt. Manueller btn_sms_track bleibt fuer Notfaelle.
    }

    // v6.62.71: Pruefe ob Vollbild-Notification erlaubt — sonst springt App nicht in
    // Vordergrund bei neuer Fahrt obwohl setFullScreenIntent gesetzt ist.
    private void checkFullScreenNotificationPermission() {
        // Erst ab Android 14 (API 34) explizit pruefen — vorher ging FullScreen automatisch
        if (android.os.Build.VERSION.SDK_INT < 34) return;
        try {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return;
            if (nm.canUseFullScreenIntent()) return; // alles gut
            SharedPreferences prefs = getSharedPreferences("perms", MODE_PRIVATE);
            // EINMALIG zeigen pro Tag — sonst nervt es den User wenn er ablehnt
            long lastPrompt = prefs.getLong("fullScreenPromptShownAt", 0);
            if (System.currentTimeMillis() - lastPrompt < 24L * 3600L * 1000L) return;
            prefs.edit().putLong("fullScreenPromptShownAt", System.currentTimeMillis()).apply();
            new androidx.appcompat.app.AlertDialog.Builder(this)
                .setTitle("⚠️ App soll bei neuer Fahrt aufspringen")
                .setMessage("Damit die Fahrer-App bei neuen Aufträgen automatisch den Bildschirm einschaltet und in den Vordergrund kommt, brauchen wir die Berechtigung 'Vollbild-Benachrichtigungen'.\n\nKurz tippen: 'Erlauben' → 'Funk Taxi' → Schalter AN → zurück.")
                .setPositiveButton("Einstellungen öffnen", (d, w) -> {
                    try {
                        Intent i = new Intent(android.provider.Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT);
                        i.setData(android.net.Uri.parse("package:" + getPackageName()));
                        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        startActivity(i);
                    } catch (Throwable _e) {
                        // Fallback: App-Settings allgemein
                        Intent i = new Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                        i.setData(android.net.Uri.parse("package:" + getPackageName()));
                        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        startActivity(i);
                    }
                })
                .setNegativeButton("Spaeter", null)
                .show();
        } catch (Throwable t) {
            Log.w(TAG, "FullScreen-Permission-Check fehlgeschlagen: " + t.getMessage());
        }
    }

    // v6.62.69: Lifecycle-Eintrag fuer Fahrer-Aktionen (Tap-Events) ins rides/{id}/lifecycleLog
    private void logLifecycleTap(String rideId, String icon, String action, String newStatus) {
        if (db == null || rideId == null || rideId.isEmpty()) return;
        try {
            Map<String, Object> entry = new HashMap<>();
            entry.put("t", System.currentTimeMillis());
            entry.put("icon", icon);
            entry.put("action", action);
            entry.put("source", "🤖 Native v" + de.taxiheringsdorf.app.BuildConfig.VERSION_NAME);
            entry.put("device", android.os.Build.MODEL);
            org.json.JSONObject details = new org.json.JSONObject();
            details.put("vehicleId", currentVehicleId != null ? currentVehicleId : "?");
            if (newStatus != null) details.put("newStatus", newStatus);
            entry.put("details", details.toString());
            db.getReference("rides/" + rideId + "/lifecycleLog").push().setValue(entry);
        } catch (Throwable _e) { Log.w(TAG, "logLifecycleTap fehlgeschlagen: " + _e.getMessage()); }
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
        // v6.59.0: Patrick-Wunsch — vor der Bezahlart-Wahl Preis-Modal mit Edit-Möglichkeit
        // (wie im Web-CRM: completeRide → Preis-Input → showCheckoutScreen → Bezahlart-Buttons)
        showPriceStage(r, hotelName, hasAuftraggeber);
    }

    private void showPriceStage(Ride r, String hotelName, boolean hasAuftraggeber) {
        // v6.59.2: Patrick: 'Preis sollte beim nächsten Mal vorbelegt sein'.
        // Wenn ride.actualPrice schon gesetzt (aus früherer Eingabe) → nutze den.
        // Lese aus Firebase damit auch nach App-Restart der zuletzt eingetippte
        // Wert vorgemerkt ist.
        if (db == null || r.id == null) {
            // Fallback: nimm r.price
            renderPriceStage(r, r.price != null ? r.price : 0.0, hotelName, hasAuftraggeber);
            return;
        }
        db.getReference("rides/" + r.id + "/actualPrice")
            .addListenerForSingleValueEvent(new ValueEventListener() {
                @Override public void onDataChange(@NonNull DataSnapshot s) {
                    Object v = s.getValue();
                    double prefill = (v instanceof Number) ? ((Number) v).doubleValue()
                        : (r.price != null ? r.price : 0.0);
                    renderPriceStage(r, prefill, hotelName, hasAuftraggeber);
                }
                @Override public void onCancelled(@NonNull DatabaseError e) {
                    renderPriceStage(r, r.price != null ? r.price : 0.0, hotelName, hasAuftraggeber);
                }
            });
    }

    private void renderPriceStage(Ride r, double prefillPrice, String hotelName, boolean hasAuftraggeber) {
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        int pad = (int) (getResources().getDisplayMetrics().density * 16);
        layout.setPadding(pad, pad, pad, pad);
        TextView lbl = new TextView(this);
        lbl.setText("💰 Preis (Taxameter oder Schätzung)");
        lbl.setPadding(0, 0, 0, pad / 2);
        layout.addView(lbl);
        EditText etPrice = new EditText(this);
        etPrice.setInputType(InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_FLAG_DECIMAL);
        etPrice.setText(String.format(Locale.GERMANY, "%.2f", prefillPrice));
        etPrice.setSelectAllOnFocus(true);
        layout.addView(etPrice);

        // v6.62.316: Patrick (05.05. 20:40): "Kann ich die Rechnung nicht nach der
        //   Barzahlung oder stripe Zahlung erstellen". → Rechnung-Checkbox aus
        //   Preis-Modal raus, Frage kommt JETZT NACH der Zahlart-Wahl als Receipt-
        //   Screen (genau wie Web showReceiptScreen mit 'Rechnung erstellen' Button).
        new AlertDialog.Builder(this)
            .setTitle("💰 Fahrt abschließen — " + (r.customerName != null ? r.customerName : "?"))
            .setView(layout)
            .setPositiveButton("Weiter →", (d, w) -> {
                double price = prefillPrice;
                try { price = Double.parseDouble(etPrice.getText().toString().trim().replace(',', '.')); } catch (Throwable _t) {}
                if (price <= 0) {
                    Toast.makeText(this, "Gültigen Preis eingeben", Toast.LENGTH_SHORT).show();
                    return;
                }
                if (db != null && r.id != null) {
                    Map<String, Object> upd = new HashMap<>();
                    upd.put("actualPrice", price);
                    upd.put("priceUpdatedAt", System.currentTimeMillis());
                    db.getReference("rides/" + r.id).updateChildren(upd);
                }
                showPaymentMethodStage(r, price, hotelName, hasAuftraggeber);
            })
            .setNegativeButton("Abbrechen", null)
            .show();
    }


    // v6.62.316: showPaymentMethodStage. Nach Zahlart-Wahl ruft NEU showReceiptStage()
    //   auf — Web-Style: Bezahlart bestaetigt → 'Rechnung erstellen?' Frage als
    //   prominenter Button-Screen.
    private void showPaymentMethodStage(Ride r, double amount, String hotelName, boolean hasAuftraggeber) {
        String amountStr = String.format(Locale.GERMANY, "%.2f €", amount);
        List<String> options = new ArrayList<>();
        List<String> methods = new ArrayList<>();
        options.add("💵 Bar (" + amountStr + ")");                        methods.add("cash");
        options.add("💳 iZettle Karte (" + amountStr + ")");              methods.add("izettle");
        options.add("📱 Stripe-QR (" + amountStr + ")");                  methods.add("stripe");
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
                    case "cash":
                        // v6.62.316: Erst markComplete, DANN Receipt-Screen
                        markCompleted(r.id, "cash", amount, null);
                        showReceiptStage(r, amount, "cash");
                        break;
                    case "izettle":
                        payViaZettle(r.id, amount);
                        // payViaZettle endet asynchron; Receipt-Screen wird vom Zettle-Callback
                        // aufgerufen oder hier nach Erfolg. Vereinfacht: direkt zeigen.
                        showReceiptStage(r, amount, "izettle");
                        break;
                    case "stripe":
                        showStripeQrStage(r, amount);
                        // Stripe-Stage hat eigenen Confirm-Button "Als bezahlt markieren"
                        // → Receipt-Screen kommt von dort (renderStripeQrDialog v6.62.316)
                        break;
                    case "invoice_auftraggeber":
                        // Auftraggeber-Rechnung: das IST die Bezahlart, automatisch invoiceRequested
                        if (db != null && r.id != null) {
                            db.getReference("rides/" + r.id).child("invoiceRequested").setValue(true);
                            db.getReference("rides/" + r.id).child("needsInvoice").setValue(true);
                        }
                        markCompleted(r.id, "invoice_auftraggeber", amount, hotelName);
                        break;
                    case "invoice_email":
                        showMailInvoiceDialog(r, amount);
                        break;
                    case "cancel":      /* nichts tun, Status bleibt picked_up */ break;
                }
            })
            .setOnCancelListener(d -> {/* nichts */})
            .show();
    }

    // v6.62.316: Patrick (05.05. 20:40): "Kann ich die Rechnung nicht nach der
    //   Barzahlung oder stripe Zahlung erstellen". → Receipt-Screen analog Web
    //   showReceiptScreen — nach Bezahlung 2 grosse Buttons: 'Rechnung erstellen'
    //   oder 'Kein Beleg, fertig'. Cloud-Function generiert dann automatisch
    //   die Rechnung (oder Patrick kann sie auch manuell im Admin nachtraeglich
    //   anlegen wenn er auf 'Kein Beleg' geklickt hat).
    private void showReceiptStage(Ride r, double amount, String paymentMethod) {
        String methodLabel;
        switch (paymentMethod) {
            case "cash":    methodLabel = "💵 Bar bezahlt"; break;
            case "izettle": methodLabel = "💳 Karte bezahlt"; break;
            case "stripe":  methodLabel = "📱 Stripe bezahlt"; break;
            default:        methodLabel = paymentMethod;
        }
        String amountStr = String.format(Locale.GERMANY, "%.2f €", amount);
        new AlertDialog.Builder(this)
            .setTitle("✅ " + methodLabel + " — " + amountStr)
            .setMessage("Soll für " + (r.customerName != null ? r.customerName : "den Kunden") +
                " eine Rechnung erstellt werden?\n\n" +
                "Wenn Ja → Kunde sieht in track.html '⬇️ Rechnung herunterladen'.\n" +
                "Wenn Nein → keine Rechnung (Walk-In ohne Beleg).")
            .setPositiveButton("✅ Ja, Rechnung", (d, w) -> {
                if (db != null && r.id != null) {
                    Map<String, Object> upd = new HashMap<>();
                    upd.put("invoiceRequested", true);
                    upd.put("needsInvoice", true);
                    db.getReference("rides/" + r.id).updateChildren(upd);
                }
                Toast.makeText(this, "🧾 Rechnung wird erstellt", Toast.LENGTH_SHORT).show();
            })
            .setNegativeButton("❌ Nein, kein Beleg", (d, w) -> {
                if (db != null && r.id != null) {
                    Map<String, Object> upd = new HashMap<>();
                    upd.put("invoiceRequested", false);
                    upd.put("needsInvoice", false);
                    db.getReference("rides/" + r.id).updateChildren(upd);
                }
            })
            .setCancelable(false)
            .show();
    }

    // v6.59.0: Stripe-QR-Stage — ruft createStripeCheckout Cloud Function, zeigt QR-Code
    private void showStripeQrStage(Ride r, double amount) {
        Toast.makeText(this, "⏳ Stripe-Checkout wird erstellt…", Toast.LENGTH_SHORT).show();
        new Thread(() -> {
            try {
                String invoiceNumber = "RIDE-" + r.id.substring(Math.max(0, r.id.length() - 8));
                org.json.JSONObject body = new org.json.JSONObject();
                body.put("invoiceNumber", invoiceNumber);
                body.put("amount", amount);
                body.put("customerName", r.customerName != null ? r.customerName : "Kunde");
                body.put("description", "Funk Taxi Heringsdorf — Fahrt " + (r.pickup != null ? r.pickup : ""));
                java.net.URL url = new java.net.URL("https://europe-west1-taxi-heringsdorf.cloudfunctions.net/createStripeCheckout");
                java.net.HttpURLConnection conn = (java.net.HttpURLConnection) url.openConnection();
                conn.setRequestMethod("POST");
                conn.setRequestProperty("Content-Type", "application/json");
                conn.setDoOutput(true);
                conn.setConnectTimeout(10000);
                conn.setReadTimeout(15000);
                conn.getOutputStream().write(body.toString().getBytes("UTF-8"));
                int code = conn.getResponseCode();
                java.io.BufferedReader br = new java.io.BufferedReader(new java.io.InputStreamReader(
                    code >= 200 && code < 300 ? conn.getInputStream() : conn.getErrorStream()));
                StringBuilder sb = new StringBuilder();
                String line; while ((line = br.readLine()) != null) sb.append(line);
                br.close();
                org.json.JSONObject resp = new org.json.JSONObject(sb.toString());
                if (code < 200 || code >= 300) {
                    String err = resp.optString("error", "HTTP " + code);
                    runOnUiThread(() -> Toast.makeText(this, "❌ Stripe: " + err, Toast.LENGTH_LONG).show());
                    return;
                }
                // v6.59.3/4: Cloud Function liefert Feld 'checkoutUrl' (nicht 'url') — Bug aus v6.59.0.
                // v6.59.4: tmp-Variable + final für Lambda (Java-Constraint).
                String tmp = resp.optString("checkoutUrl", null);
                if (tmp == null || tmp.isEmpty()) tmp = resp.optString("url", null);
                final String checkoutUrl = tmp;
                if (checkoutUrl == null || checkoutUrl.isEmpty()) {
                    runOnUiThread(() -> Toast.makeText(this, "❌ Stripe: keine Checkout-URL erhalten — Response: " + resp.toString().substring(0, Math.min(120, resp.toString().length())), Toast.LENGTH_LONG).show());
                    return;
                }
                runOnUiThread(() -> renderStripeQrDialog(r, amount, checkoutUrl));
            } catch (Throwable t) {
                runOnUiThread(() -> Toast.makeText(this, "❌ Stripe-Fehler: " + t.getMessage(), Toast.LENGTH_LONG).show());
            }
        }).start();
    }

    private void renderStripeQrDialog(Ride r, double amount, String checkoutUrl) {
        try {
            // QR-Bitmap erzeugen mit ZXing
            com.google.zxing.qrcode.QRCodeWriter writer = new com.google.zxing.qrcode.QRCodeWriter();
            int size = (int) (getResources().getDisplayMetrics().density * 220);
            com.google.zxing.common.BitMatrix matrix = writer.encode(checkoutUrl, com.google.zxing.BarcodeFormat.QR_CODE, size, size);
            android.graphics.Bitmap bmp = android.graphics.Bitmap.createBitmap(size, size, android.graphics.Bitmap.Config.ARGB_8888);
            for (int x = 0; x < size; x++) {
                for (int y = 0; y < size; y++) {
                    bmp.setPixel(x, y, matrix.get(x, y) ? 0xFF000000 : 0xFFFFFFFF);
                }
            }
            LinearLayout layout = new LinearLayout(this);
            layout.setOrientation(LinearLayout.VERTICAL);
            int pad = (int) (getResources().getDisplayMetrics().density * 16);
            layout.setPadding(pad, pad, pad, pad);
            layout.setGravity(android.view.Gravity.CENTER);

            TextView title = new TextView(this);
            title.setText(String.format(Locale.GERMANY, "📱 Kunde scannt QR-Code\nzu zahlen: %.2f €", amount));
            title.setTextSize(15);
            title.setGravity(android.view.Gravity.CENTER);
            layout.addView(title);

            android.widget.ImageView img = new android.widget.ImageView(this);
            img.setImageBitmap(bmp);
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(size, size);
            lp.topMargin = pad;
            lp.bottomMargin = pad;
            img.setLayoutParams(lp);
            layout.addView(img);

            TextView hint = new TextView(this);
            hint.setText("Sobald der Kunde gescannt + bezahlt hat → 'Als bezahlt markieren'.\nLink für Email/SMS:\n" + checkoutUrl);
            hint.setTextSize(11);
            hint.setGravity(android.view.Gravity.CENTER);
            layout.addView(hint);

            new AlertDialog.Builder(this)
                .setTitle("📱 Stripe-Online-Zahlung")
                .setView(layout)
                .setPositiveButton("✅ Als bezahlt markieren", (d, w) -> {
                    markCompleted(r.id, "stripe", amount, checkoutUrl);
                    // v6.62.316: Receipt-Screen mit Rechnung-Frage nach Stripe-Bezahlung
                    showReceiptStage(r, amount, "stripe");
                })
                .setNeutralButton("📋 Link kopieren", (d, w) -> {
                    android.content.ClipboardManager cm = (android.content.ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                    if (cm != null) {
                        cm.setPrimaryClip(android.content.ClipData.newPlainText("Stripe", checkoutUrl));
                        Toast.makeText(this, "Link kopiert", Toast.LENGTH_SHORT).show();
                    }
                })
                .setNegativeButton("Abbrechen", null)
                .show();
        } catch (Throwable t) {
            Toast.makeText(this, "QR-Fehler: " + t.getMessage(), Toast.LENGTH_LONG).show();
        }
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
        // v6.59.3: Patrick hat S9+ wo iZettle nicht funktioniert ('Handy zu alt').
        // Vor dem Intent erstmal prüfen ob die App überhaupt installiert ist.
        boolean izettleInstalled = false;
        try {
            getPackageManager().getPackageInfo("com.izettle.android", 0);
            izettleInstalled = true;
        } catch (android.content.pm.PackageManager.NameNotFoundException _e) {}
        if (!izettleInstalled) {
            new AlertDialog.Builder(this)
                .setTitle("💳 iZettle nicht verfügbar")
                .setMessage("Die iZettle/Zettle-App ist auf diesem Handy nicht installiert oder nicht kompatibel (z.B. S9+ mit Android 8 zu alt).\n\nAlternative:\n• 💵 Bar — direkt vom Kunden\n• 📱 Stripe-QR — Kunde scannt + bezahlt online")
                .setPositiveButton("OK", null)
                .show();
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

    // v6.62.31: Patrick: 'Hasbargen-Auftrag angenommen, aber er erscheint nicht in meiner Liste,
    // erst nach App-Neustart'. Root-Cause: RideActionReceiver launched mit CLEAR_TOP-Flag, ruft
    // onNewIntent statt onCreate. Bestehende Activity hatte Firebase-Listener attached, aber
    // nach App-Idle scheinbar 'silent' (keine Updates mehr). Reattach forciert Cache-Refresh.
    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        Log.i(TAG, "🔁 onNewIntent: Listener neu attachen (Push-Wakeup)");
        try {
            if (vehicleRef != null && shiftListener != null) vehicleRef.removeEventListener(shiftListener);
            if (ridesQuery != null && ridesListener != null) ridesQuery.removeEventListener(ridesListener);
            if (todayCompletedQuery != null && todayCompletedListener != null) todayCompletedQuery.removeEventListener(todayCompletedListener);
            if (openRidesQuery != null && openRidesListener != null) openRidesQuery.removeEventListener(openRidesListener);
        } catch (Throwable _t) {}
        connectFirebase();
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        timerHandler.removeCallbacks(timerTick);
        // v6.50.1: Heartbeat-Loop stoppen, Lock NICHT automatisch löschen — wenn die App
        // nur kurz geschlossen wird, soll der Lock nach STALE_LOCK_MS (5 Min) auslaufen.
        // Beim expliziten Logout/Lock-Stolen wird der Lock anders gehandhabt.
        try { lockHandler.removeCallbacks(lockHeartbeatTick); } catch (Throwable _t) {}
        try { etaTickHandler.removeCallbacks(etaTick); } catch (Throwable _t) {}
        try { displayTickHandler.removeCallbacks(displayTick); } catch (Throwable _t) {} // v6.62.320
        if (vehicleRef != null && shiftListener != null) vehicleRef.removeEventListener(shiftListener);
        if (ridesQuery != null && ridesListener != null) ridesQuery.removeEventListener(ridesListener);
        if (todayCompletedQuery != null && todayCompletedListener != null) todayCompletedQuery.removeEventListener(todayCompletedListener);
        if (openRidesQuery != null && openRidesListener != null) openRidesQuery.removeEventListener(openRidesListener);
    }

    static class Ride {
        String id, customerName, pickup, destination, pickupTime, status, notes;
        Double price, distance;
        // v6.62.439: actualPrice = der ECHTE kassierte Wert nach Bezahl-Dialog,
        //   price = Vorab-Schätzung (OSRM). Nach Fahrtende soll der echte Wert gewinnen.
        Double actualPrice;
        Long pickupTimestamp;
        List<String> waypoints; // v6.62.2: Zwischenstopps (Patrick: 'Zwischenstopp wird nicht angezeigt')
        Integer drivingTimeToPickup; // v6.62.6: Anfahrtszeit in Min (Patrick: 'wie lange braucht er bis zum Ziel')
        Double pickupLat, pickupLon; // v6.62.62: für Live-ETA-Neuberechnung via OSRM
        Double destinationLat, destinationLon; // v6.62.75: für ETA bis Ziel nach picked_up
        Integer drivingTimeToDestination; // v6.62.75: Min bis Ziel (live, nach picked_up)
        Double drivingDistanceToPickupKm; // v6.62.318: km-Distanz zum Pickup (Patrick: 'Fahrer sieht nicht wie weit weg')
        Double drivingDistanceToDestKm; // v6.62.318: km-Distanz zum Ziel
        // v6.62.358: Patrick "der fahrer sieht die stornierte fahrt nicht mehr"
        Long cancelledAt;
        String cancelledBy, cancelledVia, cancelReason;
        String assignedVehicle, vehicleId;
        // v6.62.359: Fallback fuer alte Stornos die nur deletedAt hatten
        Long deletedAt;

        static Ride fromSnap(DataSnapshot s) {
            try {
                Ride r = new Ride();
                r.id = s.getKey();
                r.customerName = s.child("customerName").getValue(String.class);
                r.pickup = s.child("pickup").getValue(String.class);
                r.destination = s.child("destination").getValue(String.class);
                r.pickupTime = s.child("pickupTime").getValue(String.class);
                r.status = s.child("status").getValue(String.class);
                r.notes = s.child("notes").getValue(String.class);
                // v6.62.2: Waypoints sind Array von Objekten mit address/lat/lon
                DataSnapshot wpSnap = s.child("waypoints");
                if (wpSnap.exists() && wpSnap.hasChildren()) {
                    r.waypoints = new ArrayList<>();
                    for (DataSnapshot wp : wpSnap.getChildren()) {
                        String addr = wp.child("address").getValue(String.class);
                        if (addr != null && !addr.trim().isEmpty()) r.waypoints.add(addr);
                    }
                }
                Object p = s.child("price").getValue();
                if (p instanceof Number) r.price = ((Number) p).doubleValue();
                else if (p instanceof String) try { r.price = Double.parseDouble((String) p); } catch (NumberFormatException _e) {}
                // v6.62.439: echter kassierter Preis (nach Bezahl-Dialog) — gewinnt im Display
                Object ap = s.child("actualPrice").getValue();
                if (ap instanceof Number) r.actualPrice = ((Number) ap).doubleValue();
                else if (ap instanceof String) try { r.actualPrice = Double.parseDouble((String) ap); } catch (NumberFormatException _e) {}
                Object d = s.child("distance").getValue();
                if (d instanceof Number) r.distance = ((Number) d).doubleValue();
                else if (d instanceof String) try { r.distance = Double.parseDouble((String) d); } catch (NumberFormatException _e) {}
                Object ts = s.child("pickupTimestamp").getValue();
                if (ts instanceof Long) r.pickupTimestamp = (Long) ts;
                else if (ts instanceof Number) r.pickupTimestamp = ((Number) ts).longValue();
                Object dt = s.child("drivingTimeToPickup").getValue();
                if (dt instanceof Number) r.drivingTimeToPickup = ((Number) dt).intValue();
                // v6.62.318: km-Distanz aus Firebase laden (von vorigem fetchOsrmETA gespeichert)
                Object dpkm = s.child("drivingDistanceToPickupKm").getValue();
                if (dpkm instanceof Number) r.drivingDistanceToPickupKm = ((Number) dpkm).doubleValue();
                Object ddkm = s.child("drivingDistanceToDestKm").getValue();
                if (ddkm instanceof Number) r.drivingDistanceToDestKm = ((Number) ddkm).doubleValue();
                // v6.62.62: pickupCoords als {lat, lon} ODER Top-Level pickupLat/pickupLon
                DataSnapshot pcSnap = s.child("pickupCoords");
                if (pcSnap.exists()) {
                    Object pl = pcSnap.child("lat").getValue();
                    Object pn = pcSnap.child("lon").getValue();
                    if (pl instanceof Number) r.pickupLat = ((Number) pl).doubleValue();
                    if (pn instanceof Number) r.pickupLon = ((Number) pn).doubleValue();
                }
                if (r.pickupLat == null) {
                    Object pl = s.child("pickupLat").getValue();
                    Object pn = s.child("pickupLon").getValue();
                    if (pl instanceof Number) r.pickupLat = ((Number) pl).doubleValue();
                    if (pn instanceof Number) r.pickupLon = ((Number) pn).doubleValue();
                }
                // v6.62.75: destinationCoords fuer ETA bis Ziel
                DataSnapshot dcSnap = s.child("destinationCoords");
                if (dcSnap.exists()) {
                    Object dl = dcSnap.child("lat").getValue();
                    Object dn = dcSnap.child("lon").getValue();
                    if (dl instanceof Number) r.destinationLat = ((Number) dl).doubleValue();
                    if (dn instanceof Number) r.destinationLon = ((Number) dn).doubleValue();
                }
                if (r.destinationLat == null) {
                    Object dl = s.child("destinationLat").getValue();
                    Object dn = s.child("destinationLon").getValue();
                    if (dl instanceof Number) r.destinationLat = ((Number) dl).doubleValue();
                    if (dn instanceof Number) r.destinationLon = ((Number) dn).doubleValue();
                }
                Object dtd = s.child("drivingTimeToDestination").getValue();
                if (dtd instanceof Number) r.drivingTimeToDestination = ((Number) dtd).intValue();
                // v6.62.358: cancellation-Felder + Vehicle-Zuweisung
                Object ca = s.child("cancelledAt").getValue();
                if (ca instanceof Number) r.cancelledAt = ((Number) ca).longValue();
                Object da = s.child("deletedAt").getValue();
                if (da instanceof Number) r.deletedAt = ((Number) da).longValue();
                r.cancelledBy = s.child("cancelledBy").getValue(String.class);
                r.cancelledVia = s.child("cancelledVia").getValue(String.class);
                r.cancelReason = s.child("cancelReason").getValue(String.class);
                if (r.cancelReason == null) r.cancelReason = s.child("cancellationReason").getValue(String.class);
                r.assignedVehicle = s.child("assignedVehicle").getValue(String.class);
                r.vehicleId = s.child("vehicleId").getValue(String.class);
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
            TextView tvBadge, tvTime, tvName, tvPickup, tvDest, tvPriceDist, tvLiveEta;
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
                tvLiveEta = v.findViewById(R.id.tv_live_eta);
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
                // v6.62.358: Storno-Banner — Patrick "der fahrer sieht die stornierte fahrt nicht mehr"
                String _stCancelCheck = r.status != null ? r.status.toLowerCase() : "";
                boolean _isCancelled = _stCancelCheck.equals("cancelled") || _stCancelCheck.equals("canceled") || _stCancelCheck.equals("storniert");
                if (_isCancelled) {
                    String _cancelTime = "";
                    if (r.cancelledAt != null) {
                        java.text.SimpleDateFormat _f = new java.text.SimpleDateFormat("HH:mm", Locale.GERMANY);
                        _f.setTimeZone(java.util.TimeZone.getTimeZone("Europe/Berlin"));
                        _cancelTime = " um " + _f.format(new java.util.Date(r.cancelledAt));
                    }
                    String _by = r.cancelledBy != null && !r.cancelledBy.isEmpty() ? (" von " + r.cancelledBy) : "";
                    String _reason = r.cancelReason != null && !r.cancelReason.isEmpty() ? ("\n📝 Grund: " + r.cancelReason) : "";
                    itemView.setBackgroundColor(Color.parseColor("#451818"));  // dunkles Rot
                    // 🆕 v6.62.523: "✕ wegklicken" Hinweis im Banner — Patrick "geht nicht weg"
                    tvName.setText("❌ STORNIERT" + _cancelTime + _by + _reason + "\n\n👆 Tippen zum Wegklicken");
                    tvName.setTextColor(Color.parseColor("#fca5a5"));
                    tvPickup.setText("📍 " + (r.pickup != null ? r.pickup : "-"));
                    tvDest.setText("🎯 " + (r.destination != null ? r.destination : "-")
                        + "\n👤 " + (r.customerName != null ? r.customerName : "(Kunde)"));
                    if (tvTime != null) tvTime.setText("");
                    if (tvBadge != null) tvBadge.setText("❌ Storniert");
                    if (tvPriceDist != null) tvPriceDist.setText("");
                    if (tvLiveEta != null) tvLiveEta.setVisibility(View.GONE);
                    if (actionRow != null) actionRow.setVisibility(View.GONE);
                    if (activeToolbar != null) activeToolbar.setVisibility(View.GONE);
                    // 🆕 v6.62.523: Tippen → Wegklicken (lokal pro Geraet)
                    final String _rideIdForDismiss = r.id;
                    itemView.setOnClickListener(_v -> {
                        new AlertDialog.Builder(DriverDashboardActivity.this)
                            .setTitle("Banner wegklicken")
                            .setMessage("Diesen Storno-Hinweis ausblenden? (nur auf diesem Handy)")
                            .setPositiveButton("Ja, wegklicken", (d, w) -> {
                                dismissCancelledRide(_rideIdForDismiss);
                                // Force-Refresh: Single-Shot-Fetch + onRidesUpdate → Filter
                                // entfernt die dismissed Ride aus der Liste.
                                if (ridesQuery != null) {
                                    ridesQuery.get().addOnSuccessListener(DriverDashboardActivity.this::onRidesUpdate);
                                }
                            })
                            .setNegativeButton("Abbrechen", null)
                            .show();
                    });
                    return;
                }
                // Reset (falls View recycled aus storniert-State)
                itemView.setOnClickListener(null);  // v6.62.523: Storno-Click-Listener entfernen
                itemView.setBackgroundColor(Color.parseColor("#1E293B"));
                tvName.setTextColor(Color.parseColor("#F8FAFC"));
                if (tvLiveEta != null) tvLiveEta.setVisibility(View.VISIBLE);

                tvName.setText(r.customerName != null ? r.customerName : "(Kunde)");
                tvPickup.setText("📍 " + (r.pickup != null ? r.pickup : "-"));
                // v6.62.2: Patrick: 'Zwischenstopp wird nicht angezeigt bei Frau Balzer'.
                // Waypoints VOR dem Ziel anzeigen — Fahrer muss da durch.
                String _destText = "🎯 " + (r.destination != null ? r.destination : "-");
                if (r.waypoints != null && !r.waypoints.isEmpty()) {
                    StringBuilder _wpBuilder = new StringBuilder();
                    for (String wp : r.waypoints) {
                        _wpBuilder.append("\n🚏 via: ").append(wp);
                    }
                    _destText = "🎯 " + (r.destination != null ? r.destination : "-") + _wpBuilder.toString();
                }
                tvDest.setText(_destText);
                // v6.62.0: Patrick: 'da oben steht 8.45 Uhr aber jetzt ist 10.45 Uhr'.
                // pickupTime kann eine ISO-UTC-Zeit sein ("2026-04-27T08:45:00.000Z") wenn die
                // Buchung von Telegram/Web-App kommt. Direkt anzeigen → falsche UTC-Zeit.
                // Fix: bevorzugt pickupTimestamp → Berlin-formatieren. Fallback nur wenn
                // pickupTime ein einfaches HH:mm ist (Native erstellt, oder bereits formatiert).
                String _displayTime;
                if (r.pickupTimestamp != null && r.pickupTimestamp > 0) {
                    java.text.SimpleDateFormat _fmt = new java.text.SimpleDateFormat("HH:mm", Locale.GERMANY);
                    _fmt.setTimeZone(java.util.TimeZone.getTimeZone("Europe/Berlin"));
                    _displayTime = _fmt.format(new java.util.Date(r.pickupTimestamp));
                } else if (r.pickupTime != null && r.pickupTime.matches("\\d{1,2}:\\d{2}")) {
                    _displayTime = r.pickupTime; // schon HH:mm
                } else {
                    _displayTime = "Sofort";
                }
                // v6.62.6: Patrick: 'wie lange er braucht bis zum Ziel, damit er rechtzeitig losfahren kann'.
                // v6.62.81: kompakter — Patrick: 'sehe Zahl nicht, muss kleiner gemacht werden'.
                // v6.62.131: Patrick: 'da war nichts von wegen Anfahrt' bei Sofortfahrten — Bug:
                // der if-Block hatte 'pickupTimestamp > now' als Pflicht, was bei Sofortfahrten
                // (pickupTimestamp = jetzt) immer false war. Drei Faelle jetzt sauber getrennt:
                //   • Vorbestellung in Zukunft + Losfahrt noch NICHT faellig → 'HH:MM → 🚗 HH:MM (Nmin)'
                //   • Vorbestellung in Zukunft + Losfahrt schon faellig     → 'HH:MM → ⚠️ JETZT (Nmin)'
                //   • Sofort (pickupTimestamp = jetzt / Vergangenheit)      → 'Sofort → 🚗 Nmin'
                if (r.drivingTimeToPickup != null && r.drivingTimeToPickup > 0) {
                    if (r.pickupTimestamp != null && r.pickupTimestamp > System.currentTimeMillis()) {
                        long _losfahrtMs = r.pickupTimestamp - r.drivingTimeToPickup * 60_000L;
                        if (_losfahrtMs > System.currentTimeMillis()) {
                            java.text.SimpleDateFormat _lfFmt = new java.text.SimpleDateFormat("HH:mm", Locale.GERMANY);
                            _lfFmt.setTimeZone(java.util.TimeZone.getTimeZone("Europe/Berlin"));
                            _displayTime += " → 🚗 " + _lfFmt.format(new java.util.Date(_losfahrtMs))
                                + " (" + r.drivingTimeToPickup + "min)";
                        } else {
                            _displayTime += " → ⚠️ JETZT (" + r.drivingTimeToPickup + "min)";
                        }
                    } else {
                        // Sofortfahrt oder pickupTimestamp in Vergangenheit — einfach Anfahrt anzeigen
                        _displayTime += " → 🚗 " + r.drivingTimeToPickup + " min";
                    }
                }
                // v6.62.75: Wenn Status picked_up + Live-ETA zum Ziel verfuegbar
                // v6.62.81: kompakter — '⏱️ X min' statt 'Ziel in X Min'
                String _stLow = r.status != null ? r.status.toLowerCase() : "";
                if (_stLow.equals("picked_up") && r.drivingTimeToDestination != null && r.drivingTimeToDestination > 0) {
                    _displayTime += " → ⏱️ " + r.drivingTimeToDestination + "min";
                }
                tvTime.setText(_displayTime);

                // v6.62.320: Patrick (06.05. 07:35): Native uebernimmt 1:1 die Web-Logik
                // aus index.html:27258 updateLiveEtaForRideCards. Vier klare Status-Phasen:
                //   • assigned/sofort/new: 'Anfahrt zum Kunden: N Min · X km'
                //   • accepted: 'Losfahren um HH:MM (in N Min) · Anfahrt N Min'
                //              + GELB ab ≤5 Min vor Losfahrt
                //              + ROT 'JETZT LOSFAHREN! · Anfahrt N Min · ⚠️ N Min zu spaet'
                //   • on_way: 'Noch N Min zum Kunden — Ankunft ca. HH:MM'
                //   • picked_up: 'Noch N Min zum Ziel — Ankunft ca. HH:MM'
                String _stLow2 = r.status != null ? r.status.toLowerCase() : "";
                String _liveEtaText = null;
                // 🆕 v6.62.577: Patrick (10.05. 18:02): "Solange ich im Limit bin soll alles
                //   gruen bleiben. Erst wenn Verspaetung droht orange/rot." Default jetzt
                //   GRUEN (#059669) — nur bei knapp/spaet wechselt zu Gelb (#F59E0B) / Rot
                //   (#DC2626). Vorher war default Blau, was als 'normal' wahrgenommen wurde
                //   aber kein Status-Hinweis gab.
                final int COLOR_GREEN = 0xFF059669;
                final int COLOR_YELLOW = 0xFFF59E0B;
                final int COLOR_RED = 0xFFDC2626;
                int _liveEtaColor = COLOR_GREEN; // Default GRUEN (= im Plan)
                long _nowMs = System.currentTimeMillis();
                java.text.SimpleDateFormat _hmFmt = new java.text.SimpleDateFormat("HH:mm", Locale.GERMANY);
                _hmFmt.setTimeZone(java.util.TimeZone.getTimeZone("Europe/Berlin"));

                if ((_stLow2.equals("assigned") || _stLow2.equals("new") || _stLow2.equals("sofort"))
                        && r.drivingTimeToPickup != null && r.drivingTimeToPickup > 0) {
                    // Vorgesehen oder Sofort, noch nicht angenommen
                    String _kmStr = (r.drivingDistanceToPickupKm != null && r.drivingDistanceToPickupKm > 0)
                        ? " · " + String.format(Locale.GERMANY, "%.1f km", r.drivingDistanceToPickupKm) : "";
                    _liveEtaText = "🚗 Anfahrt zum Kunden: " + r.drivingTimeToPickup + " Min" + _kmStr;
                    // Bei Vorbestellung mit pickupTimestamp: pruefe ob Anfahrt es schafft
                    if (r.pickupTimestamp != null && r.pickupTimestamp > 0) {
                        long _arrivalMs = _nowMs + r.drivingTimeToPickup * 60_000L;
                        long _delayMin = (_arrivalMs - r.pickupTimestamp) / 60_000L;
                        if (_delayMin > 5) _liveEtaColor = COLOR_RED;
                        else if (_delayMin > 0) _liveEtaColor = COLOR_YELLOW;
                        else _liveEtaColor = COLOR_GREEN;
                    } else _liveEtaColor = COLOR_GREEN; // Sofort ohne TS = im Plan
                } else if (_stLow2.equals("accepted")
                        && r.drivingTimeToPickup != null && r.drivingTimeToPickup > 0) {
                    // Vorbestellung angenommen → zeige Losfahrt-Zeit
                    String _kmStr = (r.drivingDistanceToPickupKm != null && r.drivingDistanceToPickupKm > 0)
                        ? " · " + String.format(Locale.GERMANY, "%.1f km", r.drivingDistanceToPickupKm) : "";
                    if (r.pickupTimestamp != null && r.pickupTimestamp > 0) {
                        long _losfahrtAt = r.pickupTimestamp - r.drivingTimeToPickup * 60_000L;
                        String _losfahrtHM = _hmFmt.format(new java.util.Date(_losfahrtAt));
                        long _minBisLos = Math.round((_losfahrtAt - _nowMs) / 60_000.0);
                        if (_minBisLos <= 0) {
                            long _minSpaet = -_minBisLos;
                            String _lateText = _minSpaet > 0 ? " · ⚠️ " + _minSpaet + " Min zu spaet" : "";
                            _liveEtaText = "⚠️ JETZT LOSFAHREN! · Anfahrt " + r.drivingTimeToPickup + " Min" + _kmStr + _lateText;
                            _liveEtaColor = COLOR_RED;
                        } else if (_minBisLos <= 5) {
                            _liveEtaText = "⏰ Losfahren um " + _losfahrtHM + " (in " + _minBisLos + " Min) · Anfahrt " + r.drivingTimeToPickup + " Min" + _kmStr;
                            _liveEtaColor = COLOR_YELLOW;
                        } else {
                            _liveEtaText = "⏰ Losfahren um " + _losfahrtHM + " (in " + _minBisLos + " Min) · Anfahrt " + r.drivingTimeToPickup + " Min" + _kmStr;
                            _liveEtaColor = COLOR_GREEN;
                        }
                    } else {
                        // Sofort accepted — kein pickupTimestamp → einfach Anfahrt, GRUEN
                        _liveEtaText = "🚗 Anfahrt zum Kunden: " + r.drivingTimeToPickup + " Min" + _kmStr;
                        _liveEtaColor = COLOR_GREEN;
                    }
                } else if (_stLow2.equals("on_way") && r.drivingTimeToPickup != null && r.drivingTimeToPickup > 0) {
                    // Auf dem Weg zum Kunden
                    String _kmStr = (r.drivingDistanceToPickupKm != null && r.drivingDistanceToPickupKm > 0)
                        ? " · " + String.format(Locale.GERMANY, "%.1f km", r.drivingDistanceToPickupKm) : "";
                    String _ankunftHM = _hmFmt.format(new java.util.Date(_nowMs + r.drivingTimeToPickup * 60_000L));
                    _liveEtaText = "⏱️ Noch " + r.drivingTimeToPickup + " Min zum Kunden" + _kmStr + " — Ankunft ca. " + _ankunftHM;
                    // 🐛 v6.62.577: Status-basierte Farbe, nicht Distanz-basiert.
                    //   Vorher: <=3min=ROT, <=7min=GELB, sonst BLAU. Verwirrend wenn Anfahrt
                    //   normal kurz ist. Jetzt: Vergleich mit pickupTimestamp.
                    if (r.pickupTimestamp != null && r.pickupTimestamp > 0) {
                        long _arrivalMs = _nowMs + r.drivingTimeToPickup * 60_000L;
                        long _delayMin = (_arrivalMs - r.pickupTimestamp) / 60_000L;
                        if (_delayMin > 5) _liveEtaColor = COLOR_RED;
                        else if (_delayMin > 0) _liveEtaColor = COLOR_YELLOW;
                        else _liveEtaColor = COLOR_GREEN;
                    } else {
                        // Sofort ohne TS: GRUEN solange Anfahrt normal (>3 Min)
                        _liveEtaColor = COLOR_GREEN;
                    }
                } else if (_stLow2.equals("picked_up") && r.drivingTimeToDestination != null && r.drivingTimeToDestination > 0) {
                    // Kunde an Bord, auf dem Weg zum Ziel
                    String _kmStr = (r.drivingDistanceToDestKm != null && r.drivingDistanceToDestKm > 0)
                        ? " · " + String.format(Locale.GERMANY, "%.1f km", r.drivingDistanceToDestKm) : "";
                    String _ankunftHM = _hmFmt.format(new java.util.Date(_nowMs + r.drivingTimeToDestination * 60_000L));
                    _liveEtaText = "🎯 Noch " + r.drivingTimeToDestination + " Min zum Ziel" + _kmStr + " — Ankunft ca. " + _ankunftHM;
                    _liveEtaColor = COLOR_GREEN;
                } else if (_stLow2.equals("arrived")) {
                    _liveEtaText = "📍 BIN DA — Kunde wartet auf Einsteigen";
                    _liveEtaColor = COLOR_GREEN;
                }
                if (_liveEtaText != null) {
                    tvLiveEta.setText(_liveEtaText);
                    tvLiveEta.setBackgroundColor(_liveEtaColor);
                    tvLiveEta.setVisibility(View.VISIBLE);
                } else {
                    tvLiveEta.setVisibility(View.GONE);
                }

                // 🆕 v6.62.439: actualPrice (kassiert) gewinnt vor price (Schätzung).
                //   Patrick (08.05. 08:25): „Fahrt sollte 11,70€ kosten, Taxameter 14,10€".
                //   Beim Bezahl-Dialog wird actualPrice gesetzt → ab da soll das im Display
                //   stehen, mit Label '(kassiert)'. Vorab nur estimatedPrice = price.
                // 🆕 v6.62.441: Patrick (08.05. 08:43): „Schreibt mal hin bei dem Preis,
                //   das sind Schätzungen, der richtige Preis wird vom Taxameter berechnet."
                //   Label klar formuliert.
                Double displayPrice;
                String priceLabel;
                if (r.actualPrice != null && r.actualPrice > 0) {
                    displayPrice = r.actualPrice;
                    priceLabel = "Taxameter";
                } else {
                    displayPrice = r.price;
                    priceLabel = "Schätzung — echt nach Taxameter";
                }
                String pd = String.format(Locale.GERMANY, "💰 %s€ (%s) · 🛣️ %s km",
                    displayPrice != null ? String.format(Locale.GERMANY, "%.2f", displayPrice) : "--",
                    priceLabel,
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
        // v6.62.69: Tap-Audit
        logLifecycleTap(rideId, "✅", "Fahrer-Tap: Status manuell → " + newStatus, newStatus);
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
        // v6.62.282: assignedTo MUSS auch gesetzt werden, sonst Inkonsistenz mit vehicleId
        // Bug-Sweep: Hotel Das Ahlbeck heute hatte vehicleId=Tesla, assignedTo=IK weil
        // assignedTo bei nativem Grab vergessen wurde → Patrick verwirrt 'IK + Tesla beide?'
        u.put("assignedTo", currentVehicleId);
        u.put("assignedAt", System.currentTimeMillis());
        u.put("assignedBy", "native_dashboard_grab");
        u.put("acceptedAt", System.currentTimeMillis());
        u.put("acceptedVia", "native_dashboard");
        u.put("acceptedByVehicle", currentVehicleId);
        u.put("updatedAt", System.currentTimeMillis());
        u.put("openRideWarned", null);  // Watchdog reset
        db.getReference("rides/" + rideId).updateChildren(u);
        // v6.62.69: Tap-Audit
        logLifecycleTap(rideId, "✅", "Fahrer-Tap: ANGENOMMEN (aus Warteschlange)", "accepted");
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
