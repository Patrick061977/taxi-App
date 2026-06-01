package de.taxiheringsdorf.app;

import android.app.AlertDialog;
import android.app.DatePickerDialog;
import android.app.TimePickerDialog;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.os.Bundle;
import android.text.InputType;
import android.util.Log;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.PopupMenu;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;
import java.util.Date;
import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.RecyclerView;
import com.google.android.material.button.MaterialButton;
// v6.62.745 (Patrick 15.05. 21:07): MapPicker fuer NewBookingDialog Pickup+Destination
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import com.google.firebase.auth.FirebaseAuth;
import com.google.firebase.auth.FirebaseUser;
import com.google.firebase.database.DataSnapshot;
import com.google.firebase.database.DatabaseError;
import com.google.firebase.database.DatabaseReference;
import com.google.firebase.database.FirebaseDatabase;
import com.google.firebase.database.Query;
import com.google.firebase.database.ValueEventListener;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Calendar;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

// v6.51.0: Admin-Modus für Patrick auf S9+ (oder anderen Admin-Geräten).
// Kein Fahrzeug, kein GPS, kein Schicht-Timer. Nur:
//  - Liste aller offenen Aufträge (warteschlange/vorbestellt/accepted/on_way/picked_up)
//  - 📞 Anrufliste → CallLogActivity (auto admin-mode via SharedPref)
//  - 🚖 Neue Buchung (manuell, ohne Anrufer)
//  - Hamburger: Logout, Zurück zu Fahrzeugauswahl
public class AdminDashboardActivity extends AppCompatActivity {
    private static final String TAG = "AdminDashboard";
    private static final String DB_INSTANCE_URL = "https://taxi-heringsdorf-default-rtdb.europe-west1.firebasedatabase.app";

    private TextView tvAdminEmail, tvQueueCount, tvOnlineAmpel;
    private MaterialButton btnMenu, btnCallLog, btnNewBooking;
    private RecyclerView rv;
    private LinearLayout emptyState;
    private AdminRideAdapter adapter;

    private FirebaseDatabase db;
    private Query openRidesQuery;
    private ValueEventListener openRidesListener;
    // 🆕 v6.63.023: Wenn von DispoActivity gestartet mit Extra auto_edit_ride_id, öffnen
    //   wir nach dem ersten Listener-Load direkt das Edit-Dialog für diese Ride.
    private String _pendingAutoEditRideId = null;

    // v6.62.745 (Patrick 15.05. 21:07): MapPicker fuer NewBookingDialog Pickup+Destination
    private EditText pendingPickerField;
    private double[] pendingPickerCoords;
    private final ActivityResultLauncher<Intent> mapPickerLauncher =
        registerForActivityResult(new ActivityResultContracts.StartActivityForResult(),
            result -> {
                if (result.getResultCode() != RESULT_OK || result.getData() == null) return;
                Intent d = result.getData();
                String addr = d.getStringExtra(MapPickerActivity.EXTRA_RESULT_ADDR);
                double lat = d.getDoubleExtra(MapPickerActivity.EXTRA_RESULT_LAT, Double.NaN);
                double lon = d.getDoubleExtra(MapPickerActivity.EXTRA_RESULT_LON, Double.NaN);
                if (pendingPickerField != null && addr != null) pendingPickerField.setText(addr);
                if (pendingPickerCoords != null && !Double.isNaN(lat) && !Double.isNaN(lon)) {
                    pendingPickerCoords[0] = lat;
                    pendingPickerCoords[1] = lon;
                }
            });

    private void launchMapPickerFor(EditText field, double[] coordsOut) {
        pendingPickerField = field;
        pendingPickerCoords = coordsOut;
        Intent i = new Intent(this, MapPickerActivity.class);
        String pre = field.getText() != null ? field.getText().toString().trim() : "";
        if (!pre.isEmpty()) i.putExtra(MapPickerActivity.EXTRA_INITIAL_QUERY, pre);
        mapPickerLauncher.launch(i);
    }
    // 🆕 v6.62.673: Patrick (13.05. 12:06): "Wo sehe ich offene Anfragen in der Native-App?"
    //   AdminDashboard liest jetzt zusaetzlich /anfragen wo status='offen'.
    private Query offeneAnfragenQuery;
    private ValueEventListener offeneAnfragenListener;
    private List<Anfrage> _currentOffeneAnfragen = new ArrayList<>();
    private List<Ride> _currentRides = new ArrayList<>();
    // v6.62.153 + v6.62.705: Active-Statuses fuer Disposition-Liste (alle Fahrten die noch nicht abgeschlossen sind)
    // v6.62.705: "wartepool" hinzu — Patrick (14.05.): "8:45 See-Eck steht gar nicht in meiner Disposition".
    // Fahrten die nach 3× Auto-Assign-Fehlschlag in den Wartepool fallen waren bisher unsichtbar.
    private static final List<String> ACTIVE_STATUSES = Arrays.asList(
        "warteschlange", "wartepool", "vorbestellt", "new", "accepted", "on_way", "picked_up");

    // v6.62.353: Patrick (06.05. 11:50): "Abholort kann ich nicht bearbeiten, ist nur ein
    // Name kein Geopoint" — Edit-Dialog hat fuer pickup/destination nur EditText. Fix:
    // Picker-Buttons daneben, Result-State pro aktivem Edit-Dialog hier merken.
    private EditText editPickupTextRef, editDestTextRef;
    private final double[] editPickupCoords = new double[]{Double.NaN, Double.NaN};
    private final double[] editDestCoords = new double[]{Double.NaN, Double.NaN};
    private boolean pickerForPickup = false;
    private final androidx.activity.result.ActivityResultLauncher<Intent> mapPickerLauncherDispo =
        registerForActivityResult(new androidx.activity.result.contract.ActivityResultContracts.StartActivityForResult(),
            result -> {
                if (result.getResultCode() != RESULT_OK || result.getData() == null) return;
                Intent rd = result.getData();
                String addr = rd.getStringExtra(MapPickerActivity.EXTRA_RESULT_ADDR);
                double lat = rd.getDoubleExtra(MapPickerActivity.EXTRA_RESULT_LAT, Double.NaN);
                double lon = rd.getDoubleExtra(MapPickerActivity.EXTRA_RESULT_LON, Double.NaN);
                if (addr == null || Double.isNaN(lat) || Double.isNaN(lon)) return;
                // v6.62.364: Patrick (06.05. 14:42): Kaiserbaeder auch in MapPickerActivity-Result strippen
                addr = CrmSearchActivity.stripTouristAndRegion(addr);
                if (pickerForPickup) {
                    if (editPickupTextRef != null) editPickupTextRef.setText(addr);
                    editPickupCoords[0] = lat; editPickupCoords[1] = lon;
                } else {
                    if (editDestTextRef != null) editDestTextRef.setText(addr);
                    editDestCoords[0] = lat; editDestCoords[1] = lon;
                }
                // v6.62.364: Patrick (06.05. 14:42): "kann nach Bearbeiten Adresse nicht
                // speichern". Bestaetigungs-Toast damit Patrick sieht dass der Picker-Result
                // angekommen ist + Coords gespeichert wurden — sonst Diagnose unmoeglich.
                Toast.makeText(this, "📍 " + addr.substring(0, Math.min(50, addr.length())) + " uebernommen — jetzt 'Speichern' klicken", Toast.LENGTH_LONG).show();
            });

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        setContentView(R.layout.activity_admin_dashboard);

        // Admin-Mode Flag setzen — CallLogActivity nutzt das um EINSTEIGER zu verstecken
        getSharedPreferences("admin", MODE_PRIVATE).edit().putBoolean("isAdminMode", true).apply();

        // 🆕 v6.63.023: Auto-Edit-Trigger von DispoActivity übernehmen
        if (getIntent() != null) {
            String _eid = getIntent().getStringExtra("auto_edit_ride_id");
            if (_eid != null && !_eid.isEmpty()) {
                _pendingAutoEditRideId = _eid;
                getIntent().removeExtra("auto_edit_ride_id");
            }
        }

        // v6.62.197: Update-Banner aktivieren — vorher kamen Updates auf Admin-Geraeten
        // nicht durch weil dieser Activity keinen UpdateChecker-Aufruf hatte. Patrick:
        // 'warum werden die updates der apk nicht auf das handy runtergeladen?'.
        android.widget.LinearLayout updateBanner = findViewById(R.id.admin_update_banner);
        android.widget.TextView updateBannerText = findViewById(R.id.admin_update_banner_text);
        com.google.android.material.button.MaterialButton updateBannerBtn = findViewById(R.id.admin_update_banner_btn);
        if (updateBanner != null && updateBannerText != null && updateBannerBtn != null) {
            UpdateChecker.checkAsync(this, updateBanner, updateBannerText, updateBannerBtn);
        }

        tvAdminEmail = findViewById(R.id.tv_admin_email);
        tvQueueCount = findViewById(R.id.tv_admin_queue_count);
        tvOnlineAmpel = findViewById(R.id.tv_admin_online_ampel);
        // v6.62.726: Online-Fahrer-Ampel — liest /settings/onlineFahrerStatus (cloud-Fn schreibt alle 5 Min)
        try {
            db.getReference("settings/onlineFahrerStatus").addValueEventListener(new ValueEventListener() {
                @Override public void onDataChange(@NonNull DataSnapshot s) {
                    if (tvOnlineAmpel == null) return;
                    Integer count = s.child("count").getValue(Integer.class);
                    String level = s.child("level").getValue(String.class);
                    if (count == null) count = 0;
                    if (level == null) level = "rot";
                    int color;
                    String emoji;
                    switch (level) {
                        case "gruen": color = 0xFF059669; emoji = "🟢"; break;
                        case "gelb":  color = 0xFFF59E0B; emoji = "🟡"; break;
                        default:      color = 0xFFDC2626; emoji = "🔴"; break;
                    }
                    tvOnlineAmpel.setBackgroundColor(color);
                    tvOnlineAmpel.setText(emoji + " " + count + " Fahrer");
                }
                @Override public void onCancelled(@NonNull DatabaseError e) {}
            });
        } catch (Throwable t) { Log.w(TAG, "Online-Ampel-Listener: " + t.getMessage()); }
        btnMenu = findViewById(R.id.btn_admin_menu);
        btnCallLog = findViewById(R.id.btn_admin_call_log);
        btnNewBooking = findViewById(R.id.btn_admin_new_booking);
        rv = findViewById(R.id.rv_admin_rides);
        emptyState = findViewById(R.id.admin_empty_state);

        rv.setLayoutManager(new LinearLayoutManager(this));
        adapter = new AdminRideAdapter();
        rv.setAdapter(adapter);

        FirebaseUser u = FirebaseAuth.getInstance().getCurrentUser();
        if (u != null) {
            tvAdminEmail.setText(u.getEmail() != null ? u.getEmail() : (u.getPhoneNumber() != null ? u.getPhoneNumber() : "Admin"));
        }

        btnMenu.setOnClickListener(this::showMenu);
        btnCallLog.setOnClickListener(v -> startActivity(new Intent(this, CallLogActivity.class)));
        // v6.62.749 (Patrick 15.05. 21:30): "Neue Buchung" oeffnet CrmSearchActivity
        // statt eigenem Dialog → genau gleicher Flow wie 'Neuer Kunde + Vorbestellung'.
        // User kann Kunde suchen ODER neu anlegen, dann Vorbestellungs-Maske mit
        // Karten-Picker + Festpreisen + allem was dort schon poliert ist.
        btnNewBooking.setOnClickListener(v -> startActivity(new Intent(this, CrmSearchActivity.class)));

        connectFirebase();

        // 🆕 v6.62.667: Patrick (13.05. 08:56): "Web-Anfragen muss man auch ueber die
        //   Native-App bestaetigen koennen — man kann nicht immer in die Web-App gehen."
        //   FCM-Token unter /adminFcmTokens/{deviceId} registrieren, Cloud Function sendet
        //   bei neuen buchen.html/qr-aufsteller-Buchungen Push hierhin (type=new_web_booking).
        registerAdminFcmToken();
    }

    // 🆕 v6.62.667: FCM-Token fuer Admin-Push registrieren.
    //   /adminFcmTokens/{deviceId} = { token, label, uid, updatedAt }
    //   Cloud Function durchlaeuft alle Eintraege bei web-booking-Trigger.
    private void registerAdminFcmToken() {
        try {
            com.google.firebase.messaging.FirebaseMessaging.getInstance().getToken()
                .addOnCompleteListener(task -> {
                    if (!task.isSuccessful() || task.getResult() == null) {
                        Log.w(TAG, "Admin-FCM-Token konnte nicht geholt werden: " + (task.getException() != null ? task.getException().getMessage() : "?"));
                        return;
                    }
                    String token = task.getResult();
                    try {
                        String deviceId = DeviceIdHelper.getOrCreate(this);
                        FirebaseUser u = FirebaseAuth.getInstance().getCurrentUser();
                        String label = (u != null && u.getEmail() != null) ? u.getEmail()
                            : (u != null && u.getPhoneNumber() != null) ? u.getPhoneNumber()
                            : android.os.Build.MODEL;
                        Map<String, Object> entry = new HashMap<>();
                        entry.put("token", token);
                        entry.put("label", label);
                        entry.put("uid", u != null ? u.getUid() : null);
                        entry.put("device", android.os.Build.MODEL);
                        entry.put("appVersion", de.taxiheringsdorf.app.BuildConfig.VERSION_NAME);
                        entry.put("updatedAt", System.currentTimeMillis());
                        FirebaseDatabase.getInstance(DB_INSTANCE_URL)
                            .getReference("adminFcmTokens/" + deviceId)
                            .setValue(entry);
                        Log.d(TAG, "Admin-FCM-Token registriert (" + token.substring(0, Math.min(12, token.length())) + "...)");
                    } catch (Throwable _t) { Log.w(TAG, "Admin-FCM-Token Save Fehler: " + _t.getMessage()); }
                });
        } catch (Throwable t) { Log.w(TAG, "registerAdminFcmToken Fehler: " + t.getMessage()); }
    }

    private void connectFirebase() {
        try {
            db = FirebaseDatabase.getInstance(DB_INSTANCE_URL);
            // v6.62.153: Alle Fahrten ab letzten 24h ziehen, client-seitig nach
            // ACTIVE_STATUSES filtern. Vorher nur warteschlange.
            // 🔧 v6.62.161 FIX: Patrick: 'Disposition wie normaler Kalender, sortiert nach Tagen'.
            // Vorher createdAt-Filter (24h zurueck) — verlor Vorbestellungen die vor 3 Tagen
            // angelegt wurden fuer uebermorgen. Jetzt pickupTimestamp-Filter: 2h vor jetzt
            // bis +14 Tage, deckt aktive + alle naechste-Wochen-Vorbestellungen ab.
            // v6.62.636: _includePast → 30 Tage zurueck (Default 2h zurueck)
            long pastHours = _includePast ? (30L * 24) : 2L;
            long since = System.currentTimeMillis() - pastHours * 60 * 60 * 1000;
            long until = System.currentTimeMillis() + 14L * 24 * 60 * 60 * 1000;
            openRidesQuery = db.getReference("rides").orderByChild("pickupTimestamp").startAt(since).endAt(until);
            openRidesListener = new ValueEventListener() {
                @Override public void onDataChange(@NonNull DataSnapshot s) { onOpenRides(s); }
                @Override public void onCancelled(@NonNull DatabaseError e) { Log.e(TAG, e.getMessage()); }
            };
            openRidesQuery.addValueEventListener(openRidesListener);

            // 🆕 v6.62.673: Patrick (13.05. 12:06): "Wo sehe ich offene Anfragen in der
            //   Native-App?" — Listener auf /anfragen mit status='offen'.
            offeneAnfragenQuery = db.getReference("anfragen").orderByChild("status").equalTo("offen");
            offeneAnfragenListener = new ValueEventListener() {
                @Override public void onDataChange(@NonNull DataSnapshot s) {
                    _currentOffeneAnfragen.clear();
                    for (DataSnapshot c : s.getChildren()) {
                        Anfrage a = Anfrage.fromSnap(c);
                        if (a != null) _currentOffeneAnfragen.add(a);
                    }
                    // Re-render
                    rebuildAdapterList();
                }
                @Override public void onCancelled(@NonNull DatabaseError e) { Log.e(TAG, "Anfragen-Listener: " + e.getMessage()); }
            };
            offeneAnfragenQuery.addValueEventListener(offeneAnfragenListener);
        } catch (Throwable t) {
            Log.e(TAG, "Firebase-Setup: " + t.getMessage());
            Toast.makeText(this, "Firebase-Fehler: " + t.getMessage(), Toast.LENGTH_LONG).show();
        }
    }

    private void onOpenRides(DataSnapshot s) {
        _currentRides.clear();
        for (DataSnapshot c : s.getChildren()) {
            Ride r = Ride.fromSnap(c);
            if (r == null || r.status == null) continue;
            // v6.62.153: client-seitiger Filter nach Active-Status (siehe ACTIVE_STATUSES)
            // v6.62.636: bei _includePast zusaetzlich completed durchlassen — fuer die Wiederholungs-Funktion
            boolean isActive = ACTIVE_STATUSES.contains(r.status);
            boolean isCompletedPast = _includePast && "completed".equals(r.status);
            if (isActive || isCompletedPast) _currentRides.add(r);
        }
        rebuildAdapterList();
        // 🆕 v6.63.023: Wenn DispoActivity uns mit auto_edit_ride_id gestartet hat,
        //   jetzt nach Listener-Load das Edit-Dialog für diese Ride öffnen.
        if (_pendingAutoEditRideId != null) {
            String _eid = _pendingAutoEditRideId;
            _pendingAutoEditRideId = null;
            for (Ride _r : _currentRides) {
                if (_eid.equals(_r.id)) {
                    showEditRideDialog(_r);
                    break;
                }
            }
        }
    }

    // 🆕 v6.62.673: Adapter-Liste neu bauen aus _currentRides + _currentOffeneAnfragen.
    //   Beide Listener (Rides + Anfragen) rufen das jetzt auf — Layout-Reihenfolge:
    //     1) "📥 OFFENE ANFRAGEN" Sektion (aus /anfragen status='offen')
    //     2) "🆕 NEUE WEB-ANFRAGEN" Sektion (aus /rides web-source ohne Vehicle)
    //     3) Tag-Header + Fahrten chronologisch
    private void rebuildAdapterList() {
        List<Ride> list = new ArrayList<>(_currentRides);
        list.sort(Comparator.comparingLong(r -> r.pickupTimestamp != null ? r.pickupTimestamp : Long.MAX_VALUE));
        // 🆕 v6.62.199: Patrick: 'Web-Anfragen direkt in der Native-App sehen'
        // Unzugewiesene Web-Bookings nach oben in eigene Sektion ziehen.
        List<Ride> webRequests = new ArrayList<>();
        List<Ride> rest = new ArrayList<>();
        for (Ride r : list) {
            if (r.isUnclaimedWebBooking()) webRequests.add(r);
            else rest.add(r);
        }
        // v6.62.161: Tag-Header zwischen Fahrten einfuegen (HEUTE / MORGEN / Datum)
        // Patrick: 'Disposition wie normaler Kalender, sortiert nach Tagen'.
        List<Object> sectioned = new ArrayList<>();

        // 🆕 v6.62.958 (Patrick 25.05. 19:20 + 26.05. 07:20 'beides'): Wartepool-Fahrten
        //   bleiben jetzt INLINE in der Tag-Timeline + rot markiert (Card-Render Z1322).
        //   Die getrennte Wartepool-Sektion oben (v6.62.712) ist weggefallen — der
        //   Banner v6.62.932 zeigt die Anzahl prominent, der Rest erscheint im
        //   normalen Zeitplan-Flow.
        // Wartepool-Count nur fuer Statistik
        int wartepoolCount = 0;
        for (Ride r : rest) {
            if (r.status != null && "wartepool".equalsIgnoreCase(r.status)) wartepoolCount++;
        }
        // rest bleibt unveraendert — wartepool-Rides werden in der Tag-Loop einsortiert

        // 🆕 v6.62.673: OFFENE ANFRAGEN aus /anfragen — ganz oben, da sie noch nicht
        //   in /rides sind und manuell uebernommen werden muessen.
        if (!_currentOffeneAnfragen.isEmpty()) {
            // Nach Erstellungs-Zeit absteigend (neueste oben)
            _currentOffeneAnfragen.sort((a, b) -> Long.compare(b.createdAt == null ? 0 : b.createdAt, a.createdAt == null ? 0 : a.createdAt));
            sectioned.add("📥 OFFENE ANFRAGEN (" + _currentOffeneAnfragen.size() + ") — tippen zum übernehmen");
            sectioned.addAll(_currentOffeneAnfragen);
        }
        if (!webRequests.isEmpty()) {
            sectioned.add("🆕 NEUE WEB-ANFRAGEN (" + webRequests.size() + ") — bitte annehmen");
            sectioned.addAll(webRequests);
        }

        // 🆕 v6.62.932 (Patrick 25.05. 12:29-12:30 'e' + 'dispo'): Wartepool +
        //   offene Anfragen als prominente Top-Banner — geht in der Dispo-Liste sonst unter.
        try {
            android.widget.LinearLayout _wpBanner = findViewById(R.id.admin_wartepool_banner);
            android.widget.TextView _wpText = findViewById(R.id.admin_wartepool_banner_text);
            if (_wpBanner != null && _wpText != null) {
                if (wartepoolCount > 0) {
                    _wpText.setText("⚠️ WARTEPOOL: " + wartepoolCount + " Fahrt" + (wartepoolCount == 1 ? "" : "en") + " warten — manuelle Disposition!");
                    _wpBanner.setVisibility(android.view.View.VISIBLE);
                    // v6.62.958: erste Wartepool-Ride in sectioned finden (inline jetzt)
                    _wpBanner.setOnClickListener(_v -> {
                        try {
                            for (int i = 0; i < sectioned.size(); i++) {
                                Object o = sectioned.get(i);
                                if (o instanceof Ride && "wartepool".equalsIgnoreCase(((Ride)o).status)) {
                                    if (rv != null) rv.smoothScrollToPosition(i);
                                    break;
                                }
                            }
                        } catch (Throwable _ignore) {}
                    });
                } else {
                    _wpBanner.setVisibility(android.view.View.GONE);
                    _wpBanner.setOnClickListener(null);
                }
            }
            android.widget.LinearLayout _anfBanner = findViewById(R.id.admin_anfragen_banner);
            android.widget.TextView _anfText = findViewById(R.id.admin_anfragen_banner_text);
            if (_anfBanner != null && _anfText != null) {
                int _anfCount = _currentOffeneAnfragen.size() + webRequests.size();
                if (_anfCount > 0) {
                    _anfText.setText("📥 " + _anfCount + " offene Web-/WhatsApp-Anfrage" + (_anfCount == 1 ? "" : "n") + " — bitte uebernehmen");
                    _anfBanner.setVisibility(android.view.View.VISIBLE);
                    _anfBanner.setOnClickListener(_v -> {
                        try {
                            // v6.63.068 (Patrick 01.06. 11:51 Bridge: "der rödelt erstmal
                            //   durch den ganzen Kalender, das dauert 5 Sekunden"). Direkter
                            //   Sprung statt smoothScroll — bei langer Liste war der animierte
                            //   Scroll spürbar zäh.
                            for (int i = 0; i < sectioned.size(); i++) {
                                Object o = sectioned.get(i);
                                if (o instanceof String) {
                                    String s = (String) o;
                                    if (s.startsWith("📥 OFFENE ANFRAGEN") || s.startsWith("🆕 NEUE WEB-ANFRAGEN")) {
                                        if (rv != null) {
                                            androidx.recyclerview.widget.RecyclerView.LayoutManager lm = rv.getLayoutManager();
                                            if (lm instanceof androidx.recyclerview.widget.LinearLayoutManager) {
                                                ((androidx.recyclerview.widget.LinearLayoutManager) lm).scrollToPositionWithOffset(i, 0);
                                            } else {
                                                rv.scrollToPosition(i);
                                            }
                                        }
                                        break;
                                    }
                                }
                            }
                        } catch (Throwable _ignore) {}
                    });
                } else {
                    _anfBanner.setVisibility(android.view.View.GONE);
                    _anfBanner.setOnClickListener(null);
                }
            }
        } catch (Throwable _ignore) { /* defensive — falls Banner-IDs in altem Layout fehlen */ }
        Calendar lastDay = null;
        Calendar today = Calendar.getInstance();
        today.set(Calendar.HOUR_OF_DAY, 0); today.set(Calendar.MINUTE, 0);
        today.set(Calendar.SECOND, 0); today.set(Calendar.MILLISECOND, 0);
        Calendar tomorrow = (Calendar) today.clone();
        tomorrow.add(Calendar.DAY_OF_MONTH, 1);

        // 🆕 v6.62.950 (Patrick 25.05. 19:10+19:21+19:22 'Smart-Scheduler'):
        //   Konflikt-Detection pro Fahrzeug: sortiere alle zukuenftigen Pickups,
        //   berechne Gap zwischen Ende-Fahrt-X und Pickup-Fahrt-Y. Wenn Gap < Anfahrt
        //   + 5min Buffer → setze conflictHint mit Vorschlags-Text. Wird in der Card
        //   als ⚠️-Badge angezeigt + Tap öffnet Time-Picker.
        try {
            java.util.Map<String, java.util.List<Ride>> _byVid = new java.util.HashMap<>();
            for (Ride r : rest) {
                if (r.pickupTimestamp == null || r.pickupTimestamp < System.currentTimeMillis() - 60000) continue;
                String vid = r.assignedVehicle;
                if (vid == null || vid.isEmpty()) continue;
                _byVid.computeIfAbsent(vid, k -> new java.util.ArrayList<>()).add(r);
            }
            for (java.util.Map.Entry<String, java.util.List<Ride>> e : _byVid.entrySet()) {
                java.util.List<Ride> rides = e.getValue();
                rides.sort((a, b) -> Long.compare(a.pickupTimestamp, b.pickupTimestamp));
                for (int i = 0; i < rides.size() - 1; i++) {
                    Ride cur = rides.get(i);
                    Ride nxt = rides.get(i + 1);
                    long curDur = cur.estimatedDuration != null && cur.estimatedDuration > 0 ? cur.estimatedDuration : 10;
                    long curEnd = cur.pickupTimestamp + curDur * 60_000;
                    long nxtDrive = nxt.drivingTimeToPickup != null && nxt.drivingTimeToPickup > 0 ? nxt.drivingTimeToPickup : 10;
                    long gapMin = (nxt.pickupTimestamp - curEnd) / 60_000;
                    long required = nxtDrive + 3;
                    if (gapMin < required) {
                        long deficit = required - gapMin;
                        // 🆕 v6.62.954 Phase 2A: Bahnhof-Priorität HIGH (Verspätung = Zug verpasst)
                        boolean curIsBahnhof = cur.destination != null && cur.destination.toLowerCase().contains("bahnhof");
                        boolean nxtIsBahnhof = nxt.destination != null && nxt.destination.toLowerCase().contains("bahnhof");
                        String curPrio = curIsBahnhof ? " 🚆HIGH" : "";
                        String nxtPrio = nxtIsBahnhof ? " 🚆HIGH" : "";
                        // Wenn next.Bahnhof HIGH und cur.normal: cur soll vorgezogen werden (kann nicht zu spät an Bahnhof kommen)
                        // Wenn cur.Bahnhof HIGH: nxt verschieben oder Re-Assign
                        cur.conflictHint = "⚠️ Engpass" + curPrio + ": nächste Fahrt (" + (nxt.customerName != null ? nxt.customerName : "?") + nxtPrio + " " +
                            new SimpleDateFormat("HH:mm", Locale.GERMANY).format(new Date(nxt.pickupTimestamp)) + ") in " + gapMin + " Min, " + nxtDrive + " Min Anfahrt — " + deficit + " Min zu spät";
                        cur.conflictDeficit = (int) deficit;
                        cur.conflictNextRideId = nxt.id;
                        cur.conflictIsBahnhofNext = nxtIsBahnhof;
                        nxt.conflictHint = "🚆 Vorgaenger (" + (cur.customerName != null ? cur.customerName : "?") + curPrio + " " +
                            new SimpleDateFormat("HH:mm", Locale.GERMANY).format(new Date(cur.pickupTimestamp)) + ") läuft über — " + deficit + " Min Konflikt" + nxtPrio;
                        nxt.conflictDeficit = (int) deficit;
                        nxt.conflictIsBahnhofSelf = nxtIsBahnhof;
                    }
                }
            }
        } catch (Throwable _confErr) { Log.w(TAG, "Konflikt-Detection: " + _confErr.getMessage()); }

        for (Ride r : rest) {
            if (r.pickupTimestamp == null) continue;
            Calendar c = Calendar.getInstance();
            c.setTimeInMillis(r.pickupTimestamp);
            if (lastDay == null || c.get(Calendar.YEAR) != lastDay.get(Calendar.YEAR)
                    || c.get(Calendar.DAY_OF_YEAR) != lastDay.get(Calendar.DAY_OF_YEAR)) {
                String header;
                if (sameDay(c, today)) header = "🟡 HEUTE — " + new SimpleDateFormat("EEE dd.MM.yyyy", Locale.GERMANY).format(c.getTime());
                else if (sameDay(c, tomorrow)) header = "🔵 MORGEN — " + new SimpleDateFormat("EEE dd.MM.yyyy", Locale.GERMANY).format(c.getTime());
                else header = "📅 " + new SimpleDateFormat("EEEE dd.MM.yyyy", Locale.GERMANY).format(c.getTime());
                sectioned.add(header);
                lastDay = c;
            }
            sectioned.add(r);
        }
        adapter.set(sectioned);
        // 🆕 v6.62.673: Queue-Count zaehlt jetzt auch offene Anfragen
        int totalCount = list.size() + _currentOffeneAnfragen.size();
        tvQueueCount.setText(String.valueOf(totalCount));
        emptyState.setVisibility(totalCount == 0 ? View.VISIBLE : View.GONE);
        rv.setVisibility(totalCount == 0 ? View.GONE : View.VISIBLE);

        // 🆕 v6.62.636: Patrick (12.05. 09:05): "wenn er trotzdem zur aktuellen Fahrt
        // springt". Auto-Scroll zur ersten Fahrt deren pickupTimestamp >= now —
        // wird nur 1x pro Listener-Lifecycle ausgefuehrt, sonst springt es bei jedem
        // Firebase-Tick zurueck.
        // 🆕 v6.62.682: Patrick (13.05. 15:22): "Beim Disposition-Oeffnen soll der
        //   naechste Termin GANZ OBEN stehen, nicht 2-3 alte daruber." Zwei Aenderungen:
        //   1) _autoScrolled wird NUR auf true gesetzt wenn ein future-Termin gefunden wurde
        //      — sonst bleibt false und der naechste Render versucht's nochmal (wichtig
        //      wenn die ersten Snapshots noch keine future-Rides hatten)
        //   2) scrollTo positioniert direkt auf den Index (kein pos-1-Offset mehr), damit
        //      der naechste Termin als oberstes sichtbares Element steht — keine Past-
        //      Rides mehr im sichtbaren Bereich oberhalb.
        if (!_autoScrolled && !list.isEmpty()) {
            long _now = System.currentTimeMillis();
            int scrollTo = -1;
            for (int i = 0; i < sectioned.size(); i++) {
                Object o = sectioned.get(i);
                if (o instanceof Ride) {
                    Ride r = (Ride) o;
                    if (r.pickupTimestamp != null && r.pickupTimestamp >= _now) {
                        // Wenn direkt davor ein Tag-Header steht, mit auf den Header scrollen
                        scrollTo = (i > 0 && sectioned.get(i - 1) instanceof String) ? (i - 1) : i;
                        break;
                    }
                }
            }
            if (scrollTo >= 0) {
                final int pos = scrollTo;
                rv.post(() -> {
                    androidx.recyclerview.widget.LinearLayoutManager lm =
                        (androidx.recyclerview.widget.LinearLayoutManager) rv.getLayoutManager();
                    if (lm != null) lm.scrollToPositionWithOffset(pos, 0);
                });
                _autoScrolled = true; // Nur markieren wenn wirklich gescrollt wurde
            }
            // Wenn kein future-Termin gefunden, lassen wir _autoScrolled=false damit
            // der naechste Tick es nochmal versucht (Daten koennen noch nachladen).
        }
    }
    private boolean _autoScrolled = false;

    // v6.62.638: Patrick (12.05. 13:03) "kann nicht in die Vergangenheit gucken" — Toggle
    // im Menue wurde nicht gefunden. Jetzt Default = TRUE (30 Tage Rueckblick beim Oeffnen),
    // Toggle bleibt zum AUSSCHALTEN bei Performance-Problemen.
    private boolean _includePast = true;

    private void showMenu(View anchor) {
        PopupMenu p = new PopupMenu(this, anchor);
        p.getMenu().add(0, 3, 0, _includePast ? "📅 Nur kommende anzeigen" : "📅 +30 Tage Vergangenheit anzeigen");
        // v6.62.750 (Patrick 15.05. 21:36): Web-Disposition mit Gantt + Drag&Drop in Chrome Custom Tab
        p.getMenu().add(0, 4, 0, "🌐 Web-Disposition (Timeline + Drag&Drop)");
        // v6.62.828 (Patrick 22.05. 14:48): Lokale ACR-Phone Aufnahmen
        p.getMenu().add(0, 5, 0, "🎙️ Anruf-Aufnahmen");
        // 🆕 v6.62.909 (Patrick 24.05. 09:35): Live-Schichtstatus aller Fahrzeuge
        p.getMenu().add(0, 6, 0, "🚗 Fahrzeug-Status (Live)");
        // 🆕 v6.62.922 (Patrick 25.05. 09:27): Schichtplan-Editor in Native-App
        p.getMenu().add(0, 7, 0, "📅 Schichtplan-Editor");
        p.getMenu().add(0, 1, 0, "🚗 Zurück zu Fahrzeugauswahl");
        p.getMenu().add(0, 2, 0, "🚪 Logout");
        p.setOnMenuItemClickListener(item -> {
            if (item.getItemId() == 3) {
                _includePast = !_includePast;
                _autoScrolled = false; // beim Reload erneut zur aktuellen Fahrt scrollen
                Toast.makeText(this, _includePast ? "Vergangenheit (30 Tage) wird mitgeladen" : "Nur kommende Fahrten", Toast.LENGTH_SHORT).show();
                // Listener neu binden mit neuer Range
                if (openRidesQuery != null && openRidesListener != null) {
                    openRidesQuery.removeEventListener(openRidesListener);
                }
                connectFirebase();
                return true;
            }
            if (item.getItemId() == 4) {
                // v6.62.750: Chrome Custom Tab mit Web-Disposition (Gantt+Drag&Drop)
                try {
                    androidx.browser.customtabs.CustomTabsIntent intent =
                        new androidx.browser.customtabs.CustomTabsIntent.Builder()
                            .setShowTitle(true)
                            .build();
                    intent.launchUrl(this, android.net.Uri.parse("https://umwelt-taxi-insel-usedom.de/index.html"));
                } catch (Throwable t) {
                    // Fallback Standard-Browser
                    try {
                        startActivity(new Intent(Intent.ACTION_VIEW,
                            android.net.Uri.parse("https://umwelt-taxi-insel-usedom.de/index.html")));
                    } catch (Throwable _t2) {
                        Toast.makeText(this, "Kein Browser verfuegbar: " + t.getMessage(), Toast.LENGTH_LONG).show();
                    }
                }
                return true;
            }
            if (item.getItemId() == 5) {
                // v6.62.828: Lokale ACR-Aufnahmen
                startActivity(new Intent(this, CallRecordingsActivity.class));
                return true;
            }
            if (item.getItemId() == 6) {
                // 🆕 v6.62.909: Live-Schichtstatus-Modal
                showFleetStatusDialog();
                return true;
            }
            if (item.getItemId() == 7) {
                // 🆕 v6.62.922: Schichtplan-Editor (3 Tabs: Editor/Anwesenheit/Fahrer-View)
                startActivity(new Intent(this, ShiftEditorActivity.class));
                return true;
            }
            if (item.getItemId() == 1) {
                getSharedPreferences("admin", MODE_PRIVATE).edit().putBoolean("isAdminMode", false).apply();
                startActivity(new Intent(this, VehiclePickerActivity.class));
                finish();
                return true;
            }
            if (item.getItemId() == 2) {
                getSharedPreferences("admin", MODE_PRIVATE).edit().putBoolean("isAdminMode", false).apply();
                try { FirebaseAuth.getInstance().signOut(); } catch (Throwable _t) {}
                getSharedPreferences("driver", MODE_PRIVATE).edit().clear().apply();
                startActivity(new Intent(this, LoginActivity.class));
                finish();
                return true;
            }
            return false;
        });
        p.show();
    }

    // v6.62.638: Wiederholungs-Dialog mit 2 Varianten — gleiche Strecke oder Rueckfahrt
    // Patrick (12.05. 13:03): "Fahrten kopieren und Abholort/Zielort tauschen"
    // v6.62.640: Koordinaten auch uebernehmen/tauschen (Lattorf-Bug-Fix)
    // 🆕 v6.62.679: Patrick (13.05. 14:55): "Das normale Umdrehen sind alles Strings.
    //   Ich will doch die gleiche Maske wie in CRM-Suche bei vergangenen Fahrten — da
    //   kann ich Places-Autocomplete + Stecknadel benutzen." Statt eigener String-Dialog
    //   launch'en wir die CrmSearchActivity mit auto_template_ride_id-Extra, die laedt
    //   dann die volle Ride als Template + zeigt die polierte showVorbestellungMaske.
    // 🆕 v6.62.909 (Patrick 24.05. 09:35): Live-Schichtstatus aller Fahrzeuge.
    //   Patrick: 'jeder so sieht welches Fahrzeug zurzeit aktiv ist'. Schritt 1
    //   nur Anzeige — Editor kommt spaeter (v6.62.910+).
    private void showFleetStatusDialog() {
        com.google.firebase.database.FirebaseDatabase fdb;
        try { fdb = com.google.firebase.database.FirebaseDatabase.getInstance("https://taxi-heringsdorf-default-rtdb.europe-west1.firebasedatabase.app"); }
        catch (Throwable _t) { Toast.makeText(this, "Firebase nicht erreichbar", Toast.LENGTH_LONG).show(); return; }
        LinearLayout container = new LinearLayout(this);
        container.setOrientation(LinearLayout.VERTICAL);
        container.setPadding(20, 24, 20, 12);
        TextView loading = new TextView(this);
        loading.setText("⏳ Lade Fahrzeuge…");
        loading.setTextColor(0xFF94a3b8);
        loading.setPadding(0, 16, 0, 16);
        container.addView(loading);

        android.widget.ScrollView sv = new android.widget.ScrollView(this);
        sv.addView(container);
        androidx.appcompat.app.AlertDialog d = new androidx.appcompat.app.AlertDialog.Builder(this)
            .setTitle("🚗 Fahrzeug-Status (Live)")
            .setView(sv)
            .setNegativeButton("Schliessen", null)
            .show();

        fdb.getReference("vehicles").addListenerForSingleValueEvent(new com.google.firebase.database.ValueEventListener() {
            @Override public void onDataChange(@NonNull com.google.firebase.database.DataSnapshot snap) {
                container.removeView(loading);
                long now = System.currentTimeMillis();
                int rendered = 0;
                for (com.google.firebase.database.DataSnapshot c : snap.getChildren()) {
                    String vid = c.getKey();
                    Object plate = c.child("plate").getValue();
                    Object name = c.child("name").getValue();
                    Object currentDriver = c.child("currentDriverName").getValue();
                    Object online = c.child("online").getValue();
                    Object shiftStatus = c.child("shift/status").getValue();
                    Boolean forceEnded = (Boolean) c.child("shift/forceEnded").getValue();
                    Object lastUpdate = c.child("lastUpdate").getValue();
                    long lastUpdateMs = (lastUpdate instanceof Number) ? ((Number) lastUpdate).longValue() : 0;
                    long ageSec = lastUpdateMs > 0 ? (now - lastUpdateMs) / 1000 : -1;

                    String emoji; int bg, fg;
                    boolean isActive = "active".equals(shiftStatus) && Boolean.TRUE.equals(online);
                    boolean isPaused = "active".equals(shiftStatus) && !Boolean.TRUE.equals(online);
                    boolean isForceEnded = Boolean.TRUE.equals(forceEnded);
                    if (isForceEnded) { emoji = "🚪"; bg = 0xFFfde2e2; fg = 0xFF991b1b; }
                    else if (isActive) { emoji = "🟢"; bg = 0xFFd1fae5; fg = 0xFF065f46; }
                    else if (isPaused) { emoji = "🟡"; bg = 0xFFfef3c7; fg = 0xFF78350f; }
                    else { emoji = "🔴"; bg = 0xFFf3f4f6; fg = 0xFF374151; }

                    LinearLayout row = new LinearLayout(AdminDashboardActivity.this);
                    row.setOrientation(LinearLayout.VERTICAL);
                    row.setBackgroundColor(bg);
                    row.setPadding(16, 12, 16, 12);
                    LinearLayout.LayoutParams rl = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
                    rl.setMargins(0, 0, 0, 10);
                    row.setLayoutParams(rl);
                    TextView title = new TextView(AdminDashboardActivity.this);
                    String _name = name != null ? name.toString() : vid;
                    String _plate = plate != null ? plate.toString() : "";
                    title.setText(emoji + "  " + _name + (!_plate.isEmpty() ? " (" + _plate + ")" : ""));
                    title.setTextColor(fg);
                    title.setTextSize(15);
                    title.setTypeface(null, android.graphics.Typeface.BOLD);
                    row.addView(title);

                    if (currentDriver != null && !currentDriver.toString().isEmpty()) {
                        TextView drv = new TextView(AdminDashboardActivity.this);
                        drv.setText("👤 " + currentDriver);
                        drv.setTextColor(fg);
                        drv.setTextSize(13);
                        row.addView(drv);
                    }

                    String stStr = isForceEnded ? "Schicht beendet (Admin)" : (
                        isActive ? "Aktiv im Dienst" : (isPaused ? "Pause" : "Ausser Dienst"));
                    TextView st = new TextView(AdminDashboardActivity.this);
                    st.setText("⚙️ " + stStr + (ageSec >= 0 ? " · GPS vor " + (ageSec < 60 ? ageSec + " sec" : (ageSec / 60) + " min") : ""));
                    st.setTextColor(fg);
                    st.setTextSize(12);
                    row.addView(st);

                    container.addView(row);
                    rendered++;
                }
                if (rendered == 0) {
                    TextView none = new TextView(AdminDashboardActivity.this);
                    none.setText("Keine Fahrzeuge gefunden.");
                    none.setTextColor(0xFF94a3b8);
                    container.addView(none);
                }
            }
            @Override public void onCancelled(@NonNull com.google.firebase.database.DatabaseError err) {
                loading.setText("⚠️ Fehler: " + err.getMessage());
            }
        });
    }

    // 🆕 v6.63.073 (Patrick 01.06. Bridge "Serien-Termine"): Multi-Day-Copy.
    //   N Termine in einem Schwung anlegen mit gemeinsamer seriesId + 1
    //   Sammel-SMS in /smsQueue. Cloud onRideCreated skippt Einzel-SMS bei
    //   seriesId, daher gibt's nur die Sammel-Bestätigung. Pendant zur
    //   Web-Funktion copyRideToMultipleDays (index.html v6.14.0).
    private void showMultiDayCopyDialog(final Ride r) {
        if (r == null) return;
        final java.util.List<String> selectedDates = new java.util.ArrayList<>();
        final int pad = (int)(getResources().getDisplayMetrics().density * 16);
        final SimpleDateFormat dateFmt = new SimpleDateFormat("yyyy-MM-dd", Locale.GERMANY);
        final SimpleDateFormat displayFmt = new SimpleDateFormat("EEE dd.MM.yyyy", Locale.GERMANY);
        dateFmt.setTimeZone(java.util.TimeZone.getTimeZone("Europe/Berlin"));
        displayFmt.setTimeZone(java.util.TimeZone.getTimeZone("Europe/Berlin"));

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(pad, pad, pad, pad);

        TextView tvHeader = new TextView(this);
        tvHeader.setText("📋 " + (r.customerName != null ? r.customerName : "?") + "\n📍 "
            + (r.pickup != null ? r.pickup : "?") + "\n🎯 " + (r.destination != null ? r.destination : "?"));
        tvHeader.setTextSize(13);
        tvHeader.setPadding(0, 0, 0, pad);
        root.addView(tvHeader);

        TextView tvTimeLabel = new TextView(this);
        tvTimeLabel.setText("Uhrzeit für alle Kopien:");
        tvTimeLabel.setTextSize(12);
        root.addView(tvTimeLabel);

        final EditText etTime = new EditText(this);
        etTime.setInputType(InputType.TYPE_NULL);
        etTime.setFocusable(false);
        etTime.setKeyListener(null);
        String origTime = "08:00";
        if (r.pickupTimestamp != null && r.pickupTimestamp > 0) {
            SimpleDateFormat tf = new SimpleDateFormat("HH:mm", Locale.GERMANY);
            tf.setTimeZone(java.util.TimeZone.getTimeZone("Europe/Berlin"));
            origTime = tf.format(new Date(r.pickupTimestamp));
        } else if (r.pickupTime != null && r.pickupTime.matches("\\d{2}:\\d{2}")) {
            origTime = r.pickupTime;
        }
        etTime.setText(origTime);
        etTime.setOnClickListener(_v -> {
            String[] parts = etTime.getText().toString().split(":");
            int h = (parts.length >= 2) ? Integer.parseInt(parts[0]) : 8;
            int m = (parts.length >= 2) ? Integer.parseInt(parts[1]) : 0;
            new android.app.TimePickerDialog(this,
                (tp, h2, m2) -> etTime.setText(String.format(Locale.GERMANY, "%02d:%02d", h2, m2)),
                h, m, true).show();
        });
        root.addView(etTime);

        TextView tvDateLabel = new TextView(this);
        tvDateLabel.setText("\nTage hinzufügen:");
        tvDateLabel.setTextSize(12);
        root.addView(tvDateLabel);

        LinearLayout dateRow = new LinearLayout(this);
        dateRow.setOrientation(LinearLayout.HORIZONTAL);
        final EditText etDate = new EditText(this);
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
            new android.app.DatePickerDialog(this,
                (dp, y, mo, dy) -> etDate.setText(String.format(Locale.GERMANY, "%04d-%02d-%02d", y, mo + 1, dy)),
                c.get(Calendar.YEAR), c.get(Calendar.MONTH), c.get(Calendar.DAY_OF_MONTH)).show();
        });
        dateRow.addView(etDate);

        final TextView tvDatesList = new TextView(this);
        tvDatesList.setText("(keine Tage)");
        tvDatesList.setTextSize(12);
        tvDatesList.setPadding(0, pad, 0, pad);
        final TextView tvDatesCount = new TextView(this);
        tvDatesCount.setText("0 Tage ausgewählt");
        tvDatesCount.setTextSize(12);

        final Runnable[] renderHolder = new Runnable[1];
        renderHolder[0] = () -> {
            java.util.Collections.sort(selectedDates);
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

        com.google.android.material.button.MaterialButton btnAdd = new com.google.android.material.button.MaterialButton(this);
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
        LinearLayout quickRow = new LinearLayout(this);
        quickRow.setOrientation(LinearLayout.HORIZONTAL);

        com.google.android.material.button.MaterialButton btn7 = new com.google.android.material.button.MaterialButton(this);
        btn7.setText("+7 Tage");
        btn7.setTextSize(11);
        btn7.setLayoutParams(qp);
        btn7.setOnClickListener(_v -> {
            try {
                Date d = dateFmt.parse(etDate.getText().toString());
                Calendar c = Calendar.getInstance();
                c.setTime(d);
                for (int i = 0; i < 7; i++) {
                    String ds = dateFmt.format(c.getTime());
                    if (!selectedDates.contains(ds)) selectedDates.add(ds);
                    c.add(Calendar.DAY_OF_MONTH, 1);
                }
                renderHolder[0].run();
            } catch (Throwable _t) {}
        });
        quickRow.addView(btn7);

        com.google.android.material.button.MaterialButton btnMoFr = new com.google.android.material.button.MaterialButton(this);
        btnMoFr.setText("+Mo-Fr");
        btnMoFr.setTextSize(11);
        btnMoFr.setLayoutParams(qp);
        btnMoFr.setOnClickListener(_v -> {
            try {
                Date d = dateFmt.parse(etDate.getText().toString());
                Calendar c = Calendar.getInstance();
                c.setTime(d);
                for (int i = 0; i < 14; i++) {
                    int dow = c.get(Calendar.DAY_OF_WEEK);
                    if (dow != Calendar.SATURDAY && dow != Calendar.SUNDAY) {
                        String ds = dateFmt.format(c.getTime());
                        if (!selectedDates.contains(ds)) selectedDates.add(ds);
                    }
                    c.add(Calendar.DAY_OF_MONTH, 1);
                }
                renderHolder[0].run();
            } catch (Throwable _t) {}
        });
        quickRow.addView(btnMoFr);

        com.google.android.material.button.MaterialButton btnClear = new com.google.android.material.button.MaterialButton(this);
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

        android.widget.ScrollView scroll = new android.widget.ScrollView(this);
        scroll.addView(root);

        AlertDialog dlg = new AlertDialog.Builder(this)
            .setTitle("📋 Auf mehrere Tage kopieren")
            .setView(scroll)
            .setPositiveButton("✅ Jetzt kopieren", null)
            .setNegativeButton("Abbrechen", null)
            .create();
        dlg.show();
        dlg.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(_v -> {
            if (selectedDates.isEmpty()) {
                Toast.makeText(this, "Bitte mindestens einen Tag wählen", Toast.LENGTH_SHORT).show();
                return;
            }
            String timeStr = etTime.getText().toString();
            if (!timeStr.matches("\\d{2}:\\d{2}")) {
                Toast.makeText(this, "Bitte Uhrzeit eingeben (HH:MM)", Toast.LENGTH_SHORT).show();
                return;
            }
            dlg.dismiss();
            executeMultiDayCopy(r, new java.util.ArrayList<>(selectedDates), timeStr);
        });
        renderHolder[0].run();
    }

    // v6.63.073: Multi-Day-Copy ausführen — N Rides mit gemeinsamer seriesId
    //   anlegen + 1 Sammel-SMS in /smsQueue legen. Cloud onRideCreated skippt
    //   Customer-Bestätigungen bei seriesId, daher gibt's nur diese eine SMS.
    private void executeMultiDayCopy(final Ride r, java.util.List<String> dates, String timeStr) {
        if (r == null || dates == null || dates.isEmpty()) return;
        java.util.Collections.sort(dates);

        SimpleDateFormat dateTimeFmt = new SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.GERMANY);
        dateTimeFmt.setTimeZone(java.util.TimeZone.getTimeZone("Europe/Berlin"));
        SimpleDateFormat prettyFmt = new SimpleDateFormat("dd.MM.yyyy", Locale.GERMANY);
        prettyFmt.setTimeZone(java.util.TimeZone.getTimeZone("Europe/Berlin"));

        final long now = System.currentTimeMillis();
        final int total = dates.size();
        final String seriesId = db.getReference("rides").push().getKey();

        java.util.List<String> allDatesPretty = new java.util.ArrayList<>();
        java.util.List<String> allDatesIso = new java.util.ArrayList<>();
        for (String ds : dates) {
            try {
                Date d = dateTimeFmt.parse(ds + " " + timeStr);
                allDatesPretty.add(prettyFmt.format(d) + " " + timeStr);
                allDatesIso.add(ds + " " + timeStr);
            } catch (Throwable _t) {}
        }

        java.util.Map<String, Object> updates = new java.util.HashMap<>();
        int idx = 0;
        for (String ds : dates) {
            idx++;
            Long pickupTs;
            try {
                pickupTs = dateTimeFmt.parse(ds + " " + timeStr).getTime();
            } catch (Throwable _t) { continue; }

            java.util.Map<String, Object> newRide = new java.util.HashMap<>();
            if (r.customerName != null) newRide.put("customerName", r.customerName);
            if (r.customerPhone != null) {
                newRide.put("customerPhone", r.customerPhone);
                newRide.put("customerMobile", r.customerPhone);
            }
            if (r.pickup != null) newRide.put("pickup", r.pickup);
            if (r.destination != null) newRide.put("destination", r.destination);
            if (r.pickupLat != null) newRide.put("pickupLat", r.pickupLat);
            if (r.pickupLon != null) newRide.put("pickupLon", r.pickupLon);
            if (r.destinationLat != null) newRide.put("destinationLat", r.destinationLat);
            if (r.destinationLon != null) newRide.put("destinationLon", r.destinationLon);
            newRide.put("passengers", r.passengers != null ? r.passengers : 1);
            newRide.put("status", "vorbestellt");
            newRide.put("pickupTimestamp", pickupTs);
            newRide.put("pickupTime", timeStr);
            newRide.put("createdAt", now);
            newRide.put("updatedAt", now);
            newRide.put("source", "native_dashboard_multi_copy");
            newRide.put("seriesId", seriesId);
            newRide.put("seriesIndex", idx);
            newRide.put("seriesTotal", total);
            newRide.put("seriesAllDates", allDatesIso);

            String rideKey = (idx == 1) ? seriesId : db.getReference("rides").push().getKey();
            updates.put("/rides/" + rideKey, newRide);
        }

        String custMobile = r.customerPhone;
        if (custMobile != null && custMobile.replaceAll("[^0-9]", "").length() >= 8) {
            StringBuilder smsText = new StringBuilder();
            smsText.append("Funktaxi Heringsdorf: Hallo ");
            smsText.append(r.customerName != null ? r.customerName : "Kunde");
            smsText.append(", wir bestätigen Ihre ").append(total).append(" Termine:\n");
            for (String pretty : allDatesPretty) smsText.append("• ").append(pretty).append("\n");
            smsText.append("Alle Fahrten ").append(r.pickup != null ? r.pickup : "");
            smsText.append(" → ").append(r.destination != null ? r.destination : "");
            smsText.append("\nBei Fragen 038378/22022.");

            java.util.Map<String, Object> sms = new java.util.HashMap<>();
            sms.put("phone", custMobile);
            sms.put("text", smsText.toString());
            sms.put("seriesId", seriesId);
            sms.put("type", "series_confirmation");
            sms.put("status", "pending");
            sms.put("createdAt", now);
            sms.put("createdBy", "native_dashboard_multi_copy-v6.63.073");
            String smsKey = db.getReference("smsQueue").push().getKey();
            updates.put("/smsQueue/" + smsKey, sms);
        }

        db.getReference().updateChildren(updates).addOnCompleteListener(task -> {
            if (task.isSuccessful()) {
                Toast.makeText(this, "✅ " + total + " Termine angelegt + Sammel-SMS", Toast.LENGTH_LONG).show();
            } else {
                Toast.makeText(this, "❌ Fehler: " + (task.getException() != null ? task.getException().getMessage() : "?"), Toast.LENGTH_LONG).show();
            }
        });
    }

    private void showRepeatPastRideDialog(Ride r) {
        String msg = "Diese Fahrt als neue Vorbestellung anlegen?\n\n"
            + (r.customerName != null ? r.customerName : "?") + "\n"
            + (r.pickup != null ? r.pickup : "?") + "\n→ "
            + (r.destination != null ? r.destination : "?")
            + "\n\nDie polierte Vorbestellungs-Maske oeffnet sich mit Karte + Adress-Suche.";
        new androidx.appcompat.app.AlertDialog.Builder(this)
            .setTitle("📅 Fahrt wiederholen")
            .setMessage(msg)
            .setPositiveButton("📅 Gleiche Strecke", (d, w) -> launchCrmTemplate(r, false))
            .setNeutralButton("🔄 Rueckfahrt (getauscht)", (d, w) -> launchCrmTemplate(r, true))
            .setNegativeButton("Abbrechen", null)
            .show();
    }

    // 🆕 v6.62.679: Launch CrmSearchActivity mit Template-Extras. CrmSearchActivity laedt
    //   die volle Ride, baut Vorlage, optional Swap (Rueckfahrt) und zeigt die Maske.
    private void launchCrmTemplate(Ride r, boolean swap) {
        if (r == null || r.id == null) {
            Toast.makeText(this, "❌ Fahrt-ID fehlt — Vorlage nicht moeglich", Toast.LENGTH_LONG).show();
            return;
        }
        Intent i = new Intent(this, CrmSearchActivity.class);
        i.putExtra("auto_template_ride_id", r.id);
        if (swap) i.putExtra("auto_template_swap", "true");
        // customerId / customerName als Fallback fuer den CrmEntry-Lookup
        // (wenn der Kunde nicht im CRM ist, baut CrmSearchActivity einen temp-Entry)
        // CRM-Suche braucht die customerId direkt aus der Ride.
        startActivity(i);
    }

    // Manuelle Buchung ohne Anrufer-Kontext
    // 🆕 v6.62.673: Anfrage uebernehmen — Patrick (13.05.) "wo sehe ich offene Anfragen
    //   in der Native-App?". Tap auf Anfrage-Item oeffnet diesen Dialog: zeigt alle
    //   Felder als Read-Preview, "Übernehmen" → wandelt nach /rides um (status='vorbestellt'
    //   wenn future, sonst 'sofort'), markiert die Anfrage als bestaetigt.
    private void showAnfrageUebernehmenDialog(Anfrage a) {
        StringBuilder details = new StringBuilder();
        details.append("Kanal: ").append(a.channel != null ? a.channel : "?").append("\n");
        if (a.name != null) details.append("Name: ").append(a.name).append("\n");
        if (a.phone != null) details.append("Tel: ").append(a.phone).append("\n");
        if (a.email != null) details.append("Email: ").append(a.email).append("\n");
        if (a.passengers != null) details.append("Personen: ").append(a.passengers).append("\n");
        if (a.date != null) details.append("Datum: ").append(a.date).append("\n");
        if (a.time != null) details.append("Uhrzeit: ").append(a.time).append("\n");
        if (a.pickup != null) details.append("Abholort: ").append(a.pickup).append("\n");
        if (a.stopp != null && !a.stopp.isEmpty()) details.append("Zwischenstopp: ").append(a.stopp).append("\n");
        if (a.destination != null) details.append("Zielort: ").append(a.destination).append("\n");
        if (a.notes != null && !a.notes.isEmpty()) details.append("Notiz: ").append(a.notes).append("\n");

        // v6.63.069 (Patrick 01.06. 11:52 Bridge): WhatsApp-Anfragen sollen die
        //   Bestätigung auch per WhatsApp zurückkriegen. Cloud Function
        //   onAnfrageStatusChanged sendet jetzt je nach a.channel automatisch:
        //   whatsapp → sendWhatsAppMessage, email → personalMailQueue, sonst SMS.
        //   Native ruft also nur noch uebernehmeAnfrage auf — Cloud regelt den
        //   Versand-Kanal. Mit "Nur Übernehmen" wird confirmSkipped=true gesetzt,
        //   damit Cloud die Bestätigung skippt (für Fälle in denen Patrick
        //   telefonisch schon zugesagt hat).
        final String _channel = a.channel != null ? a.channel.toLowerCase() : "";
        final String _kanalLabel;
        if ("whatsapp".equals(_channel)) _kanalLabel = "WhatsApp";
        else if ("email".equals(_channel)) _kanalLabel = "Email";
        else _kanalLabel = "SMS";

        // v6.63.067: setMessage()+setItems() im AlertDialog.Builder blendet die
        //   ListView aus — Custom-View nötig damit Buttons sichtbar werden.
        int pad = (int) (getResources().getDisplayMetrics().density * 16);
        TextView tvDetails = new TextView(this);
        tvDetails.setText(details.toString());
        tvDetails.setTextSize(14);
        tvDetails.setPadding(pad, pad, pad, pad);
        android.widget.ScrollView scroll = new android.widget.ScrollView(this);
        scroll.addView(tvDetails);

        new AlertDialog.Builder(this)
            .setTitle("📥 Anfrage Aktionen")
            .setView(scroll)
            .setPositiveButton("✅ Übernehmen + " + _kanalLabel + "-Bestätigung", (d, w) -> uebernehmeAnfrage(a))
            .setNeutralButton("⚪ Nur Übernehmen", (d, w) -> uebernehmeAnfrageOhneBestaetigung(a))
            .setNegativeButton("❌ Ablehnen", (d, w) -> {
                db.getReference("anfragen/" + a.id + "/status").setValue("abgelehnt");
                Toast.makeText(this, "Anfrage abgelehnt", Toast.LENGTH_SHORT).show();
            })
            .show();
    }

    // v6.63.069: Variante von uebernehmeAnfrage die confirmSkipped=true setzt,
    // damit die Cloud-Function-Bestätigung nicht ausgelöst wird.
    private void uebernehmeAnfrageOhneBestaetigung(Anfrage a) {
        try {
            db.getReference("anfragen/" + a.id + "/confirmSkipped").setValue(true);
        } catch (Throwable _t) { Log.w(TAG, "confirmSkipped set fail: " + _t.getMessage()); }
        uebernehmeAnfrage(a);
    }

    // v6.63.065 (Patrick 31.05. 19:42): Bestätigungs-Mail-Vorschau VOR Send.
    // Memory: feedback_mail-immer-entwurf-zeigen.md — Brieftext muss vor Versand
    // gezeigt + freigegeben werden.
    private void showAnfrageBestaetigungVorschau(Anfrage a) {
        if (a.email == null || !a.email.contains("@")) {
            Toast.makeText(this, "Keine Email-Adresse in der Anfrage", Toast.LENGTH_LONG).show();
            return;
        }
        StringBuilder preview = new StringBuilder();
        preview.append("An: ").append(a.email).append("\n");
        preview.append("Betreff: Bestätigung Ihrer Funk-Taxi-Anfrage\n\n");
        preview.append("Sehr geehrte/r ").append(a.name != null ? a.name : "Kundin/Kunde").append(",\n\n");
        preview.append("vielen Dank für Ihre Anfrage. Wir bestätigen folgende Fahrt:\n");
        if (a.date != null) preview.append("  Datum:    ").append(a.date);
        if (a.time != null) preview.append(" um ").append(a.time).append(" Uhr");
        preview.append("\n");
        if (a.pickup != null) preview.append("  Von:      ").append(a.pickup).append("\n");
        if (a.destination != null) preview.append("  Nach:     ").append(a.destination).append("\n");
        if (a.passengers != null) preview.append("  Personen: ").append(a.passengers).append("\n");
        preview.append("\nBei Fragen erreichen Sie uns unter 038378/22022.\n\n");
        preview.append("Mit freundlichen Grüßen\nPatrick Wydra\nTaxiunternehmen Patrick Wydra");
        preview.append("\n\n──────────────────────\n");
        preview.append("VORSCHAU — bitte vor Versand prüfen.");

        new AlertDialog.Builder(this)
            .setTitle("📧 Mail-Entwurf — Freigabe?")
            .setMessage(preview.toString())
            .setPositiveButton("📤 Senden", (d, w) -> sendAnfrageBestaetigungMail(a))
            .setNegativeButton("Abbrechen", null)
            .show();
    }

    private void sendAnfrageBestaetigungMail(Anfrage a) {
        Toast.makeText(this, "📨 Bestätigung wird versendet…", Toast.LENGTH_SHORT).show();
        final String _name = a.name != null ? a.name : "Kundin/Kunde";
        final String _email = a.email;
        final String _date = a.date != null ? a.date : "";
        final String _time = a.time != null ? a.time : "";
        final String _pickup = a.pickup != null ? a.pickup : "";
        final String _dest = a.destination != null ? a.destination : "";
        final String _pax = a.passengers != null ? a.passengers.toString() : "1";
        final String _anfrageId = a.id != null ? a.id : "";
        new Thread(() -> {
            try {
                org.json.JSONObject body = new org.json.JSONObject();
                body.put("invoiceNumber", "ANFR-" + _anfrageId.substring(Math.max(0, _anfrageId.length()-8)));
                body.put("toEmail", _email);
                body.put("toName", _name);
                body.put("subject", "Bestätigung Ihrer Funk-Taxi-Anfrage");
                body.put("attachPdf", false);
                StringBuilder html = new StringBuilder();
                html.append("<div style='font-family:Arial,sans-serif;font-size:14px;color:#222;max-width:640px;'>");
                html.append("<p>Sehr geehrte/r ").append(_name).append(",</p>");
                html.append("<p>vielen Dank für Ihre Anfrage. Wir bestätigen folgende Fahrt:</p>");
                html.append("<table cellpadding='4' style='border-collapse:collapse;font-size:13px;margin:8px 0;'>");
                if (!_date.isEmpty()) html.append("<tr><td>Datum:</td><td><b>").append(_date);
                if (!_time.isEmpty()) html.append(" um ").append(_time).append(" Uhr");
                if (!_date.isEmpty()) html.append("</b></td></tr>");
                if (!_pickup.isEmpty()) html.append("<tr><td>Von:</td><td>").append(_pickup).append("</td></tr>");
                if (!_dest.isEmpty()) html.append("<tr><td>Nach:</td><td>").append(_dest).append("</td></tr>");
                html.append("<tr><td>Personen:</td><td>").append(_pax).append("</td></tr>");
                html.append("</table>");
                html.append("<p>Bei Fragen erreichen Sie uns gerne unter <a href='tel:+4938378220 22'>038378/22022</a>.</p>");
                html.append("<p>Mit freundlichen Grüßen<br><br>Patrick Wydra<br>Taxiunternehmen Patrick Wydra<br>");
                html.append("Amselring 10, 17424 Ostseebad Heringsdorf<br>Tel.: 038378/22022 · taxiwydra@googlemail.com</p>");
                html.append("</div>");
                body.put("htmlBody", html.toString());

                java.net.URL url = new java.net.URL("https://europe-west1-taxi-heringsdorf.cloudfunctions.net/sendInvoiceEmail");
                java.net.HttpURLConnection conn = (java.net.HttpURLConnection) url.openConnection();
                conn.setRequestMethod("POST");
                conn.setRequestProperty("Content-Type", "application/json");
                conn.setDoOutput(true);
                conn.setConnectTimeout(15000);
                conn.setReadTimeout(60000);
                conn.getOutputStream().write(body.toString().getBytes("UTF-8"));
                int code = conn.getResponseCode();
                final boolean ok = (code >= 200 && code < 300);
                runOnUiThread(() -> {
                    if (ok) {
                        Toast.makeText(this, "✅ Bestätigung an " + _email + " versendet", Toast.LENGTH_LONG).show();
                        // Audit-Log in Firebase
                        if (_anfrageId != null && !_anfrageId.isEmpty()) {
                            db.getReference("anfragen/" + _anfrageId).child("confirmationSentAt").setValue(System.currentTimeMillis());
                            db.getReference("anfragen/" + _anfrageId).child("confirmationSentBy").setValue("native_admin");
                            db.getReference("anfragen/" + _anfrageId).child("confirmationSentTo").setValue(_email);
                        }
                    } else {
                        Toast.makeText(this, "❌ Versand fehlgeschlagen (HTTP " + code + ")", Toast.LENGTH_LONG).show();
                    }
                });
            } catch (Throwable t) {
                runOnUiThread(() -> Toast.makeText(this, "❌ Versand-Fehler: " + t.getMessage(), Toast.LENGTH_LONG).show());
            }
        }).start();
    }

    private void uebernehmeAnfrage(Anfrage a) {
        try {
            DatabaseReference newRideRef = db.getReference("rides").push();
            String rideId = newRideRef.getKey();
            long now = System.currentTimeMillis();
            // pickupTimestamp aus date + time
            Long pickupTs = null;
            String pickupTime = a.time;
            try {
                if (a.date != null && a.time != null) {
                    SimpleDateFormat sdf = new SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.GERMANY);
                    sdf.setTimeZone(java.util.TimeZone.getTimeZone("Europe/Berlin"));
                    pickupTs = sdf.parse(a.date + " " + a.time).getTime();
                }
            } catch (Throwable _t) { Log.w(TAG, "Anfrage-Datum-Parse: " + _t.getMessage()); }
            boolean isSofort = pickupTs == null || (pickupTs - now) < 30 * 60_000L;
            Map<String, Object> ride = new HashMap<>();
            if (a.name != null) ride.put("customerName", a.name);
            if (a.phone != null) {
                ride.put("customerPhone", a.phone);
                ride.put("customerMobile", a.phone);
            }
            if (a.email != null) ride.put("customerEmail", a.email);
            if (a.pickup != null) ride.put("pickup", a.pickup);
            if (a.destination != null) ride.put("destination", a.destination);
            if (a.stopp != null && !a.stopp.isEmpty()) ride.put("zwischenstopp", a.stopp);
            ride.put("passengers", a.passengers != null ? a.passengers : 1);
            ride.put("status", isSofort ? "sofort" : "vorbestellt");
            ride.put("source", "anfrage-uebernahme-native");
            ride.put("anfrageId", a.id);
            if (a.notes != null && !a.notes.isEmpty()) ride.put("notes", a.notes);
            ride.put("createdAt", now);
            ride.put("updatedAt", now);
            if (pickupTs != null) ride.put("pickupTimestamp", pickupTs);
            if (pickupTime != null) ride.put("pickupTime", pickupTime);
            // v6.63.066 (Patrick 31.05.2026 — Task #14): anfrage.price respektieren
            // wenn der Kunde einen Festpreis-Wunsch hinterlegt hat. Vorher hat die
            // Übernahme die anfrage-eigene Preis-Eingabe ignoriert und die Cloud-
            // Function rechnete eigenständig neu (z.B. Fürst: 59€ Kundenwunsch →
            // 39,20€ System-Berechnung → 19,80€ Diskrepanz + manuelle Reparatur nötig).
            // Plus prepay-Detection: wenn notes 'Zahlungslink' enthalten, markiere die
            // Ride als prepayRequested → Cloud Function kann Stripe-Checkout triggern.
            try {
                if (a.price != null && !a.price.isEmpty() && !"—".equals(a.price)) {
                    String _priceStr = a.price.replace("€","").replace(",",".").trim();
                    double _priceVal = Double.parseDouble(_priceStr);
                    if (_priceVal > 0) {
                        ride.put("price", String.format(Locale.GERMANY, "%.2f", _priceVal));
                        ride.put("estimatedPrice", String.format(Locale.GERMANY, "%.2f", _priceVal));
                        ride.put("priceFromAnfrage", true);
                        ride.put("priceFromAnfrageAt", now);
                    }
                }
            } catch (Throwable _pErr) { Log.w(TAG, "Anfrage-Price-Parse: " + _pErr.getMessage()); }
            if (a.notes != null && a.notes.toLowerCase().contains("zahlungslink")) {
                ride.put("prepayRequested", true);
                ride.put("prepayDetectedFromNotes", true);
            }
            ride.put("paymentMethod", "bar");
            // Atomares Update: ride anlegen + anfrage als bestaetigt markieren
            Map<String, Object> updates = new HashMap<>();
            updates.put("/rides/" + rideId, ride);
            updates.put("/anfragen/" + a.id + "/status", "bestaetigt");
            updates.put("/anfragen/" + a.id + "/rideId", rideId);
            updates.put("/anfragen/" + a.id + "/uebernommenAt", now);
            updates.put("/anfragen/" + a.id + "/uebernommenBy", "native_admin");
            db.getReference().updateChildren(updates).addOnCompleteListener(task -> {
                if (task.isSuccessful()) {
                    Toast.makeText(this, "✅ Anfrage übernommen → Ride " + (isSofort ? "sofort" : "vorbestellt"), Toast.LENGTH_LONG).show();
                } else {
                    Toast.makeText(this, "❌ Fehler: " + (task.getException() != null ? task.getException().getMessage() : "?"), Toast.LENGTH_LONG).show();
                }
            });
        } catch (Throwable t) {
            Toast.makeText(this, "❌ Anfrage-Übernahme-Fehler: " + t.getMessage(), Toast.LENGTH_LONG).show();
        }
    }

    private void showNewBookingDialog() { showNewBookingDialog(null); }
    private void showNewBookingDialog(Ride preset) {
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        int pad = (int) (getResources().getDisplayMetrics().density * 16);
        layout.setPadding(pad, pad, pad, pad);

        EditText etName = new EditText(this);
        etName.setHint("Kundenname");
        if (preset != null && preset.customerName != null) etName.setText(preset.customerName);
        layout.addView(etName);

        EditText etPhone = new EditText(this);
        etPhone.setHint("Telefonnummer");
        etPhone.setInputType(InputType.TYPE_CLASS_PHONE);
        if (preset != null && preset.customerPhone != null) etPhone.setText(preset.customerPhone);
        layout.addView(etPhone);

        // v6.62.745 (Patrick 15.05. 21:07): Pickup mit Karten-Picker
        final double[] newBookingPickupCoords = new double[]{
            preset != null && preset.pickupLat != null ? preset.pickupLat : 0,
            preset != null && preset.pickupLon != null ? preset.pickupLon : 0
        };
        final double[] newBookingDestCoords = new double[]{
            preset != null && preset.destinationLat != null ? preset.destinationLat : 0,
            preset != null && preset.destinationLon != null ? preset.destinationLon : 0
        };

        EditText etPickup = new EditText(this);
        // v6.62.752 (Patrick 22:05): Tap-to-Picker
        etPickup.setHint("🗺 Tippen zum Abholort waehlen (Karte + Suche)");
        etPickup.setInputType(InputType.TYPE_NULL);
        etPickup.setFocusable(false);
        etPickup.setKeyListener(null);
        if (preset != null && preset.pickup != null) etPickup.setText(preset.pickup);
        etPickup.setOnClickListener(v -> launchMapPickerFor(etPickup, newBookingPickupCoords));
        layout.addView(etPickup);

        MaterialButton btnPickupPicker = new MaterialButton(this);
        btnPickupPicker.setText("🗺 Abholort auf Karte waehlen");
        btnPickupPicker.setBackgroundColor(Color.parseColor("#3b82f6"));
        btnPickupPicker.setTextColor(Color.WHITE);
        LinearLayout.LayoutParams nbLp1 = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        int nbGap = (int) (getResources().getDisplayMetrics().density * 6);
        nbLp1.setMargins(0, nbGap, 0, nbGap);
        btnPickupPicker.setLayoutParams(nbLp1);
        btnPickupPicker.setOnClickListener(v -> launchMapPickerFor(etPickup, newBookingPickupCoords));
        layout.addView(btnPickupPicker);

        EditText etDest = new EditText(this);
        // v6.62.752 (Patrick 22:05): Tap-to-Picker
        etDest.setHint("🗺 Tippen zum Zielort waehlen (Karte + Suche)");
        etDest.setInputType(InputType.TYPE_NULL);
        etDest.setFocusable(false);
        etDest.setKeyListener(null);
        if (preset != null && preset.destination != null) etDest.setText(preset.destination);
        etDest.setOnClickListener(v -> launchMapPickerFor(etDest, newBookingDestCoords));
        layout.addView(etDest);

        MaterialButton btnDestPicker = new MaterialButton(this);
        btnDestPicker.setText("🗺 Zielort auf Karte waehlen");
        btnDestPicker.setBackgroundColor(Color.parseColor("#3b82f6"));
        btnDestPicker.setTextColor(Color.WHITE);
        LinearLayout.LayoutParams nbLp2 = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        nbLp2.setMargins(0, nbGap, 0, nbGap);
        btnDestPicker.setLayoutParams(nbLp2);
        btnDestPicker.setOnClickListener(v -> launchMapPickerFor(etDest, newBookingDestCoords));
        layout.addView(btnDestPicker);

        EditText etPax = new EditText(this);
        etPax.setHint("Personen (Default 1)");
        etPax.setInputType(InputType.TYPE_CLASS_NUMBER);
        if (preset != null && preset.passengers != null) etPax.setText(String.valueOf(preset.passengers));
        layout.addView(etPax);

        Calendar cal = Calendar.getInstance();
        cal.add(Calendar.HOUR_OF_DAY, 1);
        long[] datetime = { cal.getTimeInMillis() };

        TextView tvDate = new TextView(this);
        tvDate.setText("📅 " + new SimpleDateFormat("EEE dd.MM.yyyy HH:mm", Locale.GERMANY).format(cal.getTime()));
        tvDate.setPadding(0, pad, 0, pad);
        tvDate.setOnClickListener(v -> {
            Calendar curr = Calendar.getInstance();
            curr.setTimeInMillis(datetime[0]);
            new DatePickerDialog(this, (dp, y, m, d) -> {
                new TimePickerDialog(this, (tp, h, mi) -> {
                    Calendar nc = Calendar.getInstance();
                    nc.set(y, m, d, h, mi, 0);
                    datetime[0] = nc.getTimeInMillis();
                    tvDate.setText("📅 " + new SimpleDateFormat("EEE dd.MM.yyyy HH:mm", Locale.GERMANY).format(nc.getTime()));
                }, curr.get(Calendar.HOUR_OF_DAY), curr.get(Calendar.MINUTE), true).show();
            }, curr.get(Calendar.YEAR), curr.get(Calendar.MONTH), curr.get(Calendar.DAY_OF_MONTH)).show();
        });
        layout.addView(tvDate);

        // v6.62.652: Patrick (12.05. 20:22): "ich moechte es bei Vorbestellung eingeben
        // koennen wenn etwas manuell bleiben soll". Checkbox direkt im Anlegen-Dialog.
        android.widget.CheckBox cbLock = new android.widget.CheckBox(this);
        cbLock.setText("🔒 Zuweisung sperren (Cloud-Auto-Assign aus)");
        cbLock.setTextSize(13);
        cbLock.setChecked(false);
        LinearLayout.LayoutParams _lockLp = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        _lockLp.setMargins(0, pad, 0, 0);
        cbLock.setLayoutParams(_lockLp);
        layout.addView(cbLock);

        // v6.63.075 (Patrick 01.06. Bridge "Ich will erst die Vorbestellung
        //   anlegen, daraus die Serie machen"): zweiter Pfad direkt aus dem
        //   Anlege-Dialog. Patrick füllt Kundenname/Pickup/Ziel/Uhrzeit ein
        //   und tippt "📋 Serie" — der Multi-Day-Picker übernimmt die Eingabe
        //   und legt die N Termine inkl. Sammel-SMS an, statt erst eine
        //   einzelne Vorbestellung anzulegen die er dann nochmal antippen muss.
        new AlertDialog.Builder(this)
            .setTitle("🚖 Neue Buchung (Admin)")
            .setView(layout)
            .setNeutralButton("📋 Serie", (d, w) -> {
                String name = etName.getText().toString().trim();
                String phone = etPhone.getText().toString().trim();
                String pickup = etPickup.getText().toString().trim();
                String dest = etDest.getText().toString().trim();
                if (name.isEmpty() || pickup.isEmpty() || dest.isEmpty()) {
                    Toast.makeText(this, "Name + Abholort + Zielort Pflicht", Toast.LENGTH_LONG).show();
                    return;
                }
                int pax = 1;
                try { pax = Integer.parseInt(etPax.getText().toString().trim()); } catch (Throwable _t) {}
                Ride syn = new Ride();
                syn.id = "new-booking-series";
                syn.customerName = name;
                syn.customerPhone = phone.isEmpty() ? null : phone;
                syn.pickup = pickup;
                syn.destination = dest;
                if (newBookingPickupCoords[0] != 0) syn.pickupLat = newBookingPickupCoords[0];
                if (newBookingPickupCoords[1] != 0) syn.pickupLon = newBookingPickupCoords[1];
                if (newBookingDestCoords[0] != 0) syn.destinationLat = newBookingDestCoords[0];
                if (newBookingDestCoords[1] != 0) syn.destinationLon = newBookingDestCoords[1];
                syn.passengers = pax;
                syn.pickupTimestamp = datetime[0];
                showMultiDayCopyDialog(syn);
            })
            .setPositiveButton("Anlegen", (d, w) -> {
                String name = etName.getText().toString().trim();
                String phone = etPhone.getText().toString().trim();
                String pickup = etPickup.getText().toString().trim();
                String dest = etDest.getText().toString().trim();
                if (name.isEmpty() || pickup.isEmpty() || dest.isEmpty()) {
                    Toast.makeText(this, "Name + Abholort + Zielort Pflicht", Toast.LENGTH_LONG).show();
                    return;
                }
                int pax = 1;
                try { pax = Integer.parseInt(etPax.getText().toString().trim()); } catch (Throwable _t) {}
                final boolean _lock = cbLock.isChecked();
                DatabaseReference ref = FirebaseDatabase.getInstance(DB_INSTANCE_URL).getReference("rides").push();
                long now = System.currentTimeMillis();
                Map<String, Object> r = new HashMap<>();
                r.put("customerName", name);
                if (!phone.isEmpty()) {
                    r.put("customerPhone", phone);
                    r.put("customerMobile", phone);
                }
                r.put("pickup", pickup);
                r.put("destination", dest);
                // v6.62.745 (Patrick 15.05. 21:07): Coords aus Map-Picker bevorzugen, dann Preset
                if (newBookingPickupCoords[0] != 0 && newBookingPickupCoords[1] != 0) {
                    r.put("pickupLat", newBookingPickupCoords[0]);
                    r.put("pickupLon", newBookingPickupCoords[1]);
                    java.util.Map<String, Object> _pc = new java.util.HashMap<>();
                    _pc.put("lat", newBookingPickupCoords[0]); _pc.put("lon", newBookingPickupCoords[1]);
                    r.put("pickupCoords", _pc);
                } else if (preset != null && preset.pickupLat != null && preset.pickupLon != null
                    && pickup.equals(preset.pickup != null ? preset.pickup : "")) {
                    r.put("pickupLat", preset.pickupLat);
                    r.put("pickupLon", preset.pickupLon);
                    java.util.Map<String, Object> _pc = new java.util.HashMap<>();
                    _pc.put("lat", preset.pickupLat); _pc.put("lon", preset.pickupLon);
                    r.put("pickupCoords", _pc);
                }
                if (newBookingDestCoords[0] != 0 && newBookingDestCoords[1] != 0) {
                    r.put("destinationLat", newBookingDestCoords[0]);
                    r.put("destinationLon", newBookingDestCoords[1]);
                    java.util.Map<String, Object> _dc = new java.util.HashMap<>();
                    _dc.put("lat", newBookingDestCoords[0]); _dc.put("lon", newBookingDestCoords[1]);
                    r.put("destCoords", _dc);
                } else if (preset != null && preset.destinationLat != null && preset.destinationLon != null
                    && dest.equals(preset.destination != null ? preset.destination : "")) {
                    r.put("destinationLat", preset.destinationLat);
                    r.put("destinationLon", preset.destinationLon);
                    java.util.Map<String, Object> _dc = new java.util.HashMap<>();
                    _dc.put("lat", preset.destinationLat); _dc.put("lon", preset.destinationLon);
                    r.put("destCoords", _dc);
                }
                r.put("pickupTimestamp", datetime[0]);
                r.put("pickupTime", new SimpleDateFormat("HH:mm", Locale.GERMANY).format(new java.util.Date(datetime[0])));
                // Nahe-Fahrt → warteschlange (sofort), sonst vorbestellt
                long deltaMin = (datetime[0] - now) / 60000L;
                r.put("status", deltaMin < 15 ? "warteschlange" : "vorbestellt");
                r.put("createdAt", now);
                r.put("updatedAt", now);
                r.put("source", "native_admin_manual");
                r.put("passengers", pax);
                if (_lock) {
                    r.put("assignmentLocked", true);
                    r.put("lockedBy", "native_admin_create");
                    r.put("lockedAt", now);
                }
                ref.setValue(r).addOnSuccessListener(_v -> {
                    Toast.makeText(this, _lock ? "✅ Buchung angelegt + gesperrt" : "✅ Buchung angelegt", Toast.LENGTH_SHORT).show();
                }).addOnFailureListener(ex -> Toast.makeText(this, "Fehler: " + ex.getMessage(), Toast.LENGTH_LONG).show());
            })
            .setNegativeButton("Abbrechen", null)
            .show();
    }

    // 🆕 v6.62.667: Foreground-Flag fuer TaxiFCMService — Push spielt dann Ton + Vibration
    //   auch wenn die App offen ist (sonst wuerde Android Heads-Up unterdruecken).
    @Override
    protected void onResume() {
        super.onResume();
        TaxiFCMService.setForeground(true);
    }

    @Override
    protected void onPause() {
        super.onPause();
        TaxiFCMService.setForeground(false);
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        TaxiFCMService.setForeground(false);
        if (openRidesQuery != null && openRidesListener != null) openRidesQuery.removeEventListener(openRidesListener);
        // 🆕 v6.62.673: Anfragen-Listener auch entfernen
        if (offeneAnfragenQuery != null && offeneAnfragenListener != null) offeneAnfragenQuery.removeEventListener(offeneAnfragenListener);
        // v6.62.153: Wenn Patrick von Driver-Hamburger-'Disposition' kam, Admin-Mode wieder
        // ausschalten — sonst denkt CallLogActivity nach Rueckkehr es laeuft Admin-Modus.
        // Nur ausschalten wenn Driver-Vehicle gesetzt ist (= wir kamen aus Driver-Mode).
        try {
            String vehicleId = getSharedPreferences("driver", MODE_PRIVATE).getString("vehicleId", null);
            if (vehicleId != null) {
                getSharedPreferences("admin", MODE_PRIVATE).edit().putBoolean("isAdminMode", false).apply();
            }
        } catch (Throwable _t) {}
    }

    static class Ride {
        String id, customerName, customerPhone, pickup, destination, pickupTime, status;
        String assignedVehicle; // v6.62.193: Patrick: "autos kann ich auch nicht zuweisen"
        String assignedVehicleName; // v6.62.636: Patrick (12.05. 09:05): "welches Fahrzeug ist vorgesehen"
        // v6.62.640: Patrick (12.05. 13:59): Lattorf-Rueckfahrt hatte keine Koords →
        // Daten-Inkonsistenz-Warning. Koords muessen mit gespeichert + getauscht werden.
        Double pickupLat, pickupLon, destinationLat, destinationLon;
        // v6.62.655: Patrick (12.05. 21:04) 'Lock auch im Edit-Dialog der Disposition'.
        Boolean assignmentLocked;
        Long pickupTimestamp;
        Integer passengers;
        // 🆕 v6.62.707: Fahrtdauer (Min) — fuer Live-Ankunfts-Anzeige + Konflikt-Check im EditDialog
        Integer estimatedDuration;
        // 🆕 v6.62.707: Anfahrt zum Pickup (Min) — wird vom Cloud-Backend gesetzt
        Integer drivingTimeToPickup;
        // 🆕 v6.62.950: Smart-Scheduler Konflikt-Hint (gerendert als ⚠️-Badge auf Card)
        transient String conflictHint;
        transient Integer conflictDeficit; // Min die fehlen
        transient String conflictNextRideId;
        // 🆕 v6.62.954 Phase 2A: Bahnhof-Prio
        transient boolean conflictIsBahnhofNext;
        transient boolean conflictIsBahnhofSelf;
        // 🆕 v6.62.199: Patrick: 'Web-Anfragen muessen in der Native-App sichtbar sein'
        // 🆕 v6.62.668: Patrick (13.05. 10:55): "Aber die Web-Anfragen sehe ich noch nicht."
        //   Bug-Quelle: source-Strings sind nicht einheitlich — buchen.html schreibt
        //   'web-booking', der alte Anfragen-Uebernahme-Flow schreibt 'web-anfrage',
        //   Berlin-Shuttle 'berlin-shuttle-anfrage'. Wir muessen ALLE matchen.
        String source; // 'web-booking', 'web-anfrage', 'berlin-shuttle-anfrage', 'qr-aufsteller', ...
        // v6.62.193: Patrick (01.05.): "Zwischenstops nicht angezeigt im kalender nativ app".
        // Waypoints fuer Sammeltransfers (Vetter Touristik) — addr + Pax-Name pro Stop.
        java.util.List<String> waypointDisplay; // formatierte Anzeige-Strings ("Adresse — Pax-Name")

        static boolean isWebSource(String s) {
            return s != null && (
                s.equals("web-booking") ||
                s.equals("web-anfrage") ||
                s.equals("berlin-shuttle-anfrage") ||
                s.equals("qr-aufsteller")
            );
        }

        boolean isUnclaimedWebBooking() {
            return isWebSource(source)
                && (assignedVehicle == null || assignedVehicle.isEmpty())
                && status != null && (status.equals("new") || status.equals("vorbestellt") || status.equals("warteschlange"));
        }

        boolean isWebBookingAnySource() {
            return isWebSource(source);
        }

        static Ride fromSnap(DataSnapshot s) {
            try {
                Ride r = new Ride();
                r.id = s.getKey();
                r.customerName = s.child("customerName").getValue(String.class);
                r.customerPhone = s.child("customerPhone").getValue(String.class);
                r.pickup = s.child("pickup").getValue(String.class);
                r.destination = s.child("destination").getValue(String.class);
                r.pickupTime = s.child("pickupTime").getValue(String.class);
                r.status = s.child("status").getValue(String.class);
                r.source = s.child("source").getValue(String.class);
                Object t = s.child("pickupTimestamp").getValue();
                if (t instanceof Number) r.pickupTimestamp = ((Number) t).longValue();
                Object p = s.child("passengers").getValue();
                if (p instanceof Number) r.passengers = ((Number) p).intValue();
                // 🆕 v6.62.707: Fahrtdauer aus duration/estimatedDuration (Min). Default 15.
                Object _dur = s.child("estimatedDuration").getValue();
                if (_dur == null) _dur = s.child("duration").getValue();
                if (_dur instanceof Number) r.estimatedDuration = ((Number) _dur).intValue();
                // v6.62.950 Smart-Scheduler braucht Anfahrtszeit
                Object _drv = s.child("drivingTimeToPickup").getValue();
                if (_drv instanceof Number) r.drivingTimeToPickup = ((Number) _drv).intValue();
                r.assignedVehicle = s.child("assignedVehicle").getValue(String.class);
                if (r.assignedVehicle == null) r.assignedVehicle = s.child("vehicleId").getValue(String.class);
                r.assignedVehicleName = s.child("assignedVehicleName").getValue(String.class);
                if (r.assignedVehicleName == null) r.assignedVehicleName = s.child("vehicleName").getValue(String.class);
                if (r.assignedVehicleName == null) r.assignedVehicleName = s.child("vehicle").getValue(String.class);
                // v6.62.640: Koordinaten lesen — bevorzugt direkte Felder, sonst aus Coords-Objekt
                Object _pL = s.child("pickupLat").getValue();
                Object _pO = s.child("pickupLon").getValue();
                Object _dL = s.child("destinationLat").getValue();
                Object _dO = s.child("destinationLon").getValue();
                if (_pL instanceof Number) r.pickupLat = ((Number)_pL).doubleValue();
                if (_pO instanceof Number) r.pickupLon = ((Number)_pO).doubleValue();
                if (_dL instanceof Number) r.destinationLat = ((Number)_dL).doubleValue();
                if (_dO instanceof Number) r.destinationLon = ((Number)_dO).doubleValue();
                // Fallback: pickupCoords/destCoords Objekte
                if (r.pickupLat == null) {
                    Object _pcL = s.child("pickupCoords/lat").getValue();
                    Object _pcO = s.child("pickupCoords/lon").getValue();
                    if (_pcL instanceof Number) r.pickupLat = ((Number)_pcL).doubleValue();
                    if (_pcO instanceof Number) r.pickupLon = ((Number)_pcO).doubleValue();
                }
                if (r.destinationLat == null) {
                    Object _dcL = s.child("destCoords/lat").getValue();
                    Object _dcO = s.child("destCoords/lon").getValue();
                    if (_dcL instanceof Number) r.destinationLat = ((Number)_dcL).doubleValue();
                    if (_dcO instanceof Number) r.destinationLon = ((Number)_dcO).doubleValue();
                }
                // v6.62.655: Lock-State lesen
                Object _lock = s.child("assignmentLocked").getValue();
                if (_lock instanceof Boolean) r.assignmentLocked = (Boolean) _lock;
                // Waypoints: Liste von Objekten mit address+name — analog DriverDashboard
                DataSnapshot wpSnap = s.child("waypoints");
                if (wpSnap.exists() && wpSnap.hasChildren()) {
                    r.waypointDisplay = new java.util.ArrayList<>();
                    for (DataSnapshot wp : wpSnap.getChildren()) {
                        String addr = wp.child("address").getValue(String.class);
                        String name = wp.child("name").getValue(String.class);
                        if (addr != null && !addr.trim().isEmpty()) {
                            String line = addr;
                            if (name != null && !name.trim().isEmpty()) line += " — " + name;
                            r.waypointDisplay.add(line);
                        }
                    }
                }
                return r;
            } catch (Throwable _t) { return null; }
        }
    }

    // 🆕 v6.62.673: Anfrage-Klasse (/anfragen/{id}) — Web-/WhatsApp-Anfragen die noch
    //   nicht in /rides/ uebertragen wurden. Patrick: "wo sehe ich offene Anfragen
    //   in der Native-App?". Felder spiegeln das in dms-Code etablierte Schema:
    static class Anfrage {
        String id, name, phone, email, pickup, destination, stopp, date, time, notes, channel, type, status, festpreisAdresse;
        Integer passengers;
        Long createdAt;
        String price; // kann String '—' oder Zahl sein

        static Anfrage fromSnap(DataSnapshot s) {
            try {
                Anfrage a = new Anfrage();
                a.id = s.getKey();
                a.name = s.child("name").getValue(String.class);
                a.phone = s.child("phone").getValue(String.class);
                a.email = s.child("email").getValue(String.class);
                a.pickup = s.child("pickup").getValue(String.class);
                a.destination = s.child("destination").getValue(String.class);
                a.stopp = s.child("stopp").getValue(String.class);
                a.date = s.child("date").getValue(String.class);
                a.time = s.child("time").getValue(String.class);
                a.notes = s.child("notes").getValue(String.class);
                a.channel = s.child("channel").getValue(String.class);
                a.type = s.child("type").getValue(String.class);
                a.status = s.child("status").getValue(String.class);
                a.festpreisAdresse = s.child("festpreisAdresse").getValue(String.class);
                Object px = s.child("passengers").getValue();
                if (px instanceof Number) a.passengers = ((Number) px).intValue();
                Object ct = s.child("createdAt").getValue();
                if (ct instanceof Number) a.createdAt = ((Number) ct).longValue();
                Object pr = s.child("price").getValue();
                if (pr != null) a.price = String.valueOf(pr);
                return a;
            } catch (Throwable t) { return null; }
        }
    }

    class AdminRideAdapter extends RecyclerView.Adapter<RecyclerView.ViewHolder> {
        private List<Object> data = new ArrayList<>();
        private static final int TYPE_HEADER = 0;
        private static final int TYPE_RIDE = 1;
        private static final int TYPE_ANFRAGE = 2;
        void set(List<Object> list) { data = list; notifyDataSetChanged(); }
        @Override public int getItemViewType(int pos) {
            Object o = data.get(pos);
            if (o instanceof String) return TYPE_HEADER;
            if (o instanceof Anfrage) return TYPE_ANFRAGE;
            return TYPE_RIDE;
        }
        @NonNull @Override
        public RecyclerView.ViewHolder onCreateViewHolder(@NonNull ViewGroup p, int t) {
            if (t == TYPE_HEADER) {
                TextView v = new TextView(p.getContext());
                v.setBackgroundColor(Color.parseColor("#0F172A"));
                v.setPadding(28, 22, 28, 22);
                v.setTextSize(15);
                v.setTextColor(Color.parseColor("#FBBF24"));
                v.setLayoutParams(new RecyclerView.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
                return new HeaderVH(v);
            }
            if (t == TYPE_ANFRAGE) {
                View v = LayoutInflater.from(p.getContext()).inflate(android.R.layout.simple_list_item_2, p, false);
                v.setBackgroundColor(Color.parseColor("#7C2D12")); // dunkles Orange — Anfragen sind dringlich
                v.setPadding(24, 24, 24, 24);
                return new AnfrageVH(v);
            }
            View v = LayoutInflater.from(p.getContext()).inflate(android.R.layout.simple_list_item_2, p, false);
            v.setBackgroundColor(Color.parseColor("#1E293B"));
            v.setPadding(24, 24, 24, 24);
            return new RideVH(v);
        }
        @Override public void onBindViewHolder(@NonNull RecyclerView.ViewHolder h, int pos) {
            Object item = data.get(pos);
            if (h instanceof HeaderVH && item instanceof String) ((HeaderVH) h).bind((String) item);
            else if (h instanceof RideVH && item instanceof Ride) ((RideVH) h).bind((Ride) item);
            else if (h instanceof AnfrageVH && item instanceof Anfrage) ((AnfrageVH) h).bind((Anfrage) item);
        }
        @Override public int getItemCount() { return data.size(); }

        class HeaderVH extends RecyclerView.ViewHolder {
            TextView tv;
            HeaderVH(View v) { super(v); tv = (TextView) v; }
            void bind(String header) {
                tv.setText(header);
                // 🆕 v6.62.199: Web-Anfragen-Header in Rot/Orange damit's auffaellt
                if (header != null && header.startsWith("⚠️ WARTEPOOL")) {
                    // 🆕 v6.62.712: Wartepool-Header in tiefem Rot (kraeftiger als andere Sektionen)
                    tv.setBackgroundColor(Color.parseColor("#7F1D1D"));
                    tv.setTextColor(Color.parseColor("#FECACA"));
                } else if (header != null && header.startsWith("🆕")) {
                    tv.setBackgroundColor(Color.parseColor("#7C2D12")); // dunkles Orange-Rot
                    tv.setTextColor(Color.parseColor("#FED7AA"));
                } else if (header != null && header.startsWith("📥")) {
                    // 🆕 v6.62.673: Offene-Anfragen-Header noch auffälliger (rot)
                    tv.setBackgroundColor(Color.parseColor("#991B1B"));
                    tv.setTextColor(Color.parseColor("#FECACA"));
                } else {
                    tv.setBackgroundColor(Color.parseColor("#0F172A"));
                    tv.setTextColor(Color.parseColor("#FBBF24"));
                }
            }
        }

        // 🆕 v6.62.673: AnfrageVH — zeigt eine /anfragen-Anfrage im selben Layout wie Ride
        //   aber mit dunkel-orangem Hintergrund + 📥-Prefix. Tap oeffnet Uebernahme-Dialog.
        class AnfrageVH extends RecyclerView.ViewHolder {
            TextView t1, t2;
            AnfrageVH(View v) {
                super(v);
                t1 = v.findViewById(android.R.id.text1);
                t2 = v.findViewById(android.R.id.text2);
                t1.setTextColor(Color.parseColor("#FED7AA"));
                t2.setTextColor(Color.parseColor("#FBA74D"));
            }
            void bind(Anfrage a) {
                StringBuilder line1 = new StringBuilder();
                line1.append("📥 ").append(a.channel != null ? a.channel.toUpperCase() : "WEB").append("  ");
                if (a.date != null) line1.append(a.date);
                if (a.time != null) line1.append(' ').append(a.time);
                line1.append("  ").append(a.name != null ? a.name : "?");
                if (a.passengers != null && a.passengers > 1) line1.append("  👥 ").append(a.passengers);
                t1.setText(line1.toString());
                StringBuilder line2 = new StringBuilder();
                line2.append("📍 ").append(a.pickup != null ? a.pickup : "?");
                if (a.stopp != null && !a.stopp.isEmpty()) line2.append("\n🔶 ").append(a.stopp);
                line2.append("\n🎯 ").append(a.destination != null ? a.destination : "?");
                if (a.phone != null && !a.phone.isEmpty()) line2.append("\n📞 ").append(a.phone);
                if (a.email != null && !a.email.isEmpty()) line2.append("\n✉ ").append(a.email);
                if (a.notes != null && !a.notes.isEmpty()) line2.append("\n📝 ").append(a.notes);
                t2.setText(line2.toString());
                itemView.setOnClickListener(_v -> showAnfrageUebernehmenDialog(a));
            }
        }

        class RideVH extends RecyclerView.ViewHolder {
            TextView t1, t2;
            RideVH(View v) {
                super(v);
                t1 = v.findViewById(android.R.id.text1);
                t2 = v.findViewById(android.R.id.text2);
                t1.setTextColor(Color.parseColor("#F8FAFC"));
                t2.setTextColor(Color.parseColor("#94A3B8"));
            }
            void bind(Ride r) {
                String when = r.pickupTime != null ? r.pickupTime : "—";
                String statusBadge = r.status != null ? "  [" + statusEmoji(r.status) + " " + r.status + "]" : "";
                // 🆕 v6.62.636: Fahrzeug-Badge — Patrick (12.05. 09:05): "in der
                // Dispositionsübersicht sehe ich aber auch nicht, welches Fahrzeug jetzt
                // dafür vorgesehen ist". Wenn assignedVehicle/vehicleId gesetzt → Name am
                // Ende der Zeile mit Auto-Emoji. Wenn null → 'kein Fzg' als Hint.
                String vehicleBadge;
                if (r.assignedVehicleName != null && !r.assignedVehicleName.isEmpty()) {
                    vehicleBadge = "   🚗 " + r.assignedVehicleName;
                } else if (r.assignedVehicle != null && !r.assignedVehicle.isEmpty()) {
                    vehicleBadge = "   🚗 " + r.assignedVehicle;
                } else {
                    vehicleBadge = "   ⚪ kein Fzg";
                }
                // 🆕 v6.62.199: Web-Anfrage visuell hervorheben
                // 🆕 v6.62.668: Patrick (13.05. 10:55) "Web-Anfragen sehe ich noch nicht."
                //   Sabine Reißer (source='web-anfrage', schon Tesla zugewiesen) war in der
                //   regulaeren Liste ohne Marker — nicht erkennbar als Web-Quelle. Jetzt
                //   bekommen ALLE Web-Source-Rides einen 🌐-Prefix, auch wenn bereits zugewiesen.
                // 🆕 v6.62.712: Sonderbehandlung fuer Wartepool + Sofort-warteschlange.
                //   Patrick (14.05. 11:01): "Wartepool prominenter, Sofort-Buchung soll
                //   erkennbar sein wer sieht das".
                final boolean _isWartepool = "wartepool".equalsIgnoreCase(r.status);
                final boolean _isSofortWarteschlange = "warteschlange".equalsIgnoreCase(r.status);
                // 🆕 v6.62.950 Smart-Scheduler — Konflikt-Hint rendert als ⚠️-Prefix + Tap öffnet Time-Picker
                final String conflictPrefix = r.conflictHint != null ? "⚠️ ENGPASS  " : "";
                if (_isWartepool) {
                    itemView.setBackgroundColor(Color.parseColor("#7F1D1D")); // tiefes Rot
                    t1.setText("⚠️ " + when + "  " + (r.customerName != null ? r.customerName : "?") + "  · WARTEPOOL" + vehicleBadge);
                } else if (r.conflictHint != null) {
                    itemView.setBackgroundColor(Color.parseColor("#7C2D12")); // Rot-Braun bei Konflikt
                    t1.setText(conflictPrefix + when + "  " + (r.customerName != null ? r.customerName : "?") + statusBadge + vehicleBadge);
                } else if (_isSofortWarteschlange) {
                    itemView.setBackgroundColor(Color.parseColor("#78350F")); // dunkles Bernstein
                    t1.setText("⚡ SOFORT-WS  " + when + "  " + (r.customerName != null ? r.customerName : "?") + statusBadge + vehicleBadge);
                } else if (r.isUnclaimedWebBooking()) {
                    itemView.setBackgroundColor(Color.parseColor("#451A03")); // dunkles Orange
                    t1.setText("🆕 WEB  " + when + "  " + (r.customerName != null ? r.customerName : "?") + statusBadge + vehicleBadge);
                } else if (r.isWebBookingAnySource()) {
                    // Zugewiesene Web-Anfrage — 🌐 sichtbar machen ohne Background-Highlight
                    itemView.setBackgroundColor(Color.parseColor("#1E293B"));
                    t1.setText("🌐 " + when + "  " + (r.customerName != null ? r.customerName : "?") + statusBadge + vehicleBadge);
                } else {
                    itemView.setBackgroundColor(Color.parseColor("#1E293B"));
                    t1.setText(when + "  " + (r.customerName != null ? r.customerName : "?") + statusBadge + vehicleBadge);
                }
                // v6.62.193: Waypoints zwischen Pickup und Ziel anzeigen (Patrick: 'Zwischenstops
                // nicht angezeigt im Kalender nativ app'). Mehrzeilig — eine Zeile pro Stop mit
                // Adresse + Pax-Name. So sieht Admin bei Sammeltransfers welche Familie wo raus muss.
                StringBuilder route = new StringBuilder();
                route.append("📍 ").append(r.pickup != null ? r.pickup : "?");
                if (r.waypointDisplay != null && !r.waypointDisplay.isEmpty()) {
                    for (String wp : r.waypointDisplay) {
                        route.append("\n🔶 ").append(wp);
                    }
                }
                route.append("\n🎯 ").append(r.destination != null ? r.destination : "?");
                // 🆕 v6.62.950 Smart-Scheduler: Konflikt-Hint unter Route
                if (r.conflictHint != null) {
                    route.append("\n").append(r.conflictHint).append("\n💡 Karte tippen → Pickup verschieben um Konflikt zu lösen");
                }
                t2.setText(route.toString());
                // v6.62.153: Tap → Edit-Dialog (Patrick: 'will Fahrten bearbeiten aus der App')
                // v6.62.636: Bei abgeschlossenen Vergangenheits-Fahrten → Wiederhol-Dialog
                //   (Patrick 12.05. 09:05: 'in der Vergangenheit Fahrten sehen und daraus
                //   wieder Vorbestellungen machen').
                // 🆕 v6.62.950 Smart-Scheduler: Bei Konflikt → Time-Shift-Dialog statt Edit
                final boolean isCompletedPast = "completed".equals(r.status)
                    && r.pickupTimestamp != null && r.pickupTimestamp < System.currentTimeMillis();
                if (isCompletedPast) {
                    itemView.setOnClickListener(_v -> showRepeatPastRideDialog(r));
                } else if (r.conflictHint != null) {
                    itemView.setOnClickListener(_v -> showTimeShiftDialog(r));
                } else {
                    itemView.setOnClickListener(_v -> showEditRideDialog(r));
                }
            }
        }
    }

    // 🆕 v6.62.950 Smart-Scheduler: Time-Shift-Dialog
    private void showTimeShiftDialog(Ride r) {
        if (r == null || r.pickupTimestamp == null) return;
        SimpleDateFormat tf = new SimpleDateFormat("HH:mm", Locale.GERMANY);
        tf.setTimeZone(java.util.TimeZone.getTimeZone("Europe/Berlin"));
        String currentTime = tf.format(new Date(r.pickupTimestamp));
        int deficit = r.conflictDeficit != null ? r.conflictDeficit : 5;
        int suggested = Math.max(deficit + 1, 5); // mind. 1 Min mehr als Defizit, mind. 5 Min
        StringBuilder msg = new StringBuilder();
        msg.append("Aktueller Pickup: ").append(currentTime).append("\n\n");
        if (r.conflictHint != null) msg.append(r.conflictHint).append("\n\n");
        msg.append("💡 Vorschlag: ").append(suggested).append(" Min vorziehen → ");
        msg.append(tf.format(new Date(r.pickupTimestamp - suggested * 60_000L)));
        msg.append("\n\nWie viele Min vorziehen?");

        // Buttons: -5 / -10 / -15 / vorgeschlagen
        AlertDialog.Builder b = new AlertDialog.Builder(this)
            .setTitle("⏰ Pickup verschieben — " + (r.customerName != null ? r.customerName : "?"))
            .setMessage(msg.toString());

        final String _rid = r.id;
        final long _origTs = r.pickupTimestamp;
        final String _custName = r.customerName != null ? r.customerName : "Kunde";
        final String _custPhone = r.customerPhone;
        // 🆕 v6.62.954 Phase 2A: SMS-Checkbox unter Buttons (default off)
        java.util.function.BiConsumer<Integer, Boolean> apply = (min, sendSms) -> {
            long newTs = _origTs - min * 60_000L;
            java.util.Map<String, Object> u = new java.util.HashMap<>();
            u.put("pickupTimestamp", newTs);
            SimpleDateFormat _tf = new SimpleDateFormat("HH:mm", Locale.GERMANY);
            _tf.setTimeZone(java.util.TimeZone.getTimeZone("Europe/Berlin"));
            String newTimeStr = _tf.format(new Date(newTs));
            u.put("pickupTime", newTimeStr);
            u.put("smartScheduleShiftedMin", min);
            u.put("smartScheduleShiftedAt", System.currentTimeMillis());
            u.put("smartScheduleShiftedBy", "admin-time-shift");
            u.put("updatedAt", System.currentTimeMillis());
            com.google.firebase.database.FirebaseDatabase.getInstance(DB_URL_AD).getReference("rides/" + _rid).updateChildren(u)
                .addOnSuccessListener(_ok -> {
                    Toast.makeText(AdminDashboardActivity.this,
                        "✅ Pickup um " + min + " Min vorgezogen → " + newTimeStr, Toast.LENGTH_LONG).show();
                    // 🆕 v6.62.954: optional SMS an Kunde
                    if (sendSms && _custPhone != null && _custPhone.length() > 4) {
                        java.util.Map<String, Object> sms = new java.util.HashMap<>();
                        sms.put("phone", _custPhone);
                        sms.put("message", "Funktaxi: Hallo " + _custName + ", Ihr Taxi kommt " + min + " Min frueher als geplant — neue Pickup-Zeit: " + newTimeStr + ".");
                        sms.put("reason", "smart-schedule-shift");
                        sms.put("rideId", _rid);
                        sms.put("ts", System.currentTimeMillis());
                        com.google.firebase.database.FirebaseDatabase.getInstance(DB_URL_AD).getReference("pendingSMS").push().setValue(sms);
                        Toast.makeText(AdminDashboardActivity.this, "📲 SMS an " + _custName + " in Queue", Toast.LENGTH_SHORT).show();
                    }
                })
                .addOnFailureListener(e -> Toast.makeText(AdminDashboardActivity.this,
                    "❌ Fehler: " + e.getMessage(), Toast.LENGTH_LONG).show());
        };
        // Container für Checkbox + Edit-Button
        LinearLayout container = new LinearLayout(this);
        container.setOrientation(LinearLayout.VERTICAL);
        int pad = (int)(16 * getResources().getDisplayMetrics().density);
        container.setPadding(pad, pad/2, pad, 0);
        // 🆕 v6.63.031 (Patrick 30.05. 09:30 "Wartepool nicht bearbeiten können"):
        //   Edit-Button direkt im Time-Shift-Dialog. Patrick will mehr als nur
        //   hoch/runter schieben — Adresse, Pax, Vehicle ändern.
        final android.widget.Button btnFullEdit = new android.widget.Button(this);
        btnFullEdit.setText("✏️ Komplett bearbeiten (Adresse, Pax, Fahrzeug...)");
        btnFullEdit.setAllCaps(false);
        btnFullEdit.setTextColor(0xFF1d4ed8);
        btnFullEdit.setBackgroundColor(0xFFDDE9FB);
        LinearLayout.LayoutParams _editLp = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        _editLp.setMargins(0, 0, 0, pad/2);
        btnFullEdit.setLayoutParams(_editLp);
        container.addView(btnFullEdit);
        final android.widget.CheckBox cbSms = new android.widget.CheckBox(this);
        cbSms.setText("📲 SMS an " + _custName + " senden (frueher kommen)");
        cbSms.setChecked(_custPhone != null && _custPhone.length() > 4);
        if (_custPhone == null || _custPhone.length() <= 4) cbSms.setEnabled(false);
        container.addView(cbSms);
        b.setView(container);
        b.setPositiveButton("💡 " + suggested + " Min vorziehen (empfohlen)", (d, w) -> apply.accept(suggested, cbSms.isChecked()));
        b.setNeutralButton("− 5 Min", (d, w) -> apply.accept(5, cbSms.isChecked()));
        b.setNegativeButton("Abbrechen", null);
        final AlertDialog dlg = b.show();
        // 🆕 v6.63.031: Edit-Button schließt Time-Shift-Dialog und öffnet den vollen Edit-Dialog
        btnFullEdit.setOnClickListener(_v -> { dlg.dismiss(); showEditRideDialog(r); });
    }

    private static final String DB_URL_AD = "https://taxi-heringsdorf-default-rtdb.europe-west1.firebasedatabase.app";

    // v6.62.161: Helper fuer Tag-Vergleich
    private static boolean sameDay(Calendar a, Calendar b) {
        return a != null && b != null
            && a.get(Calendar.YEAR) == b.get(Calendar.YEAR)
            && a.get(Calendar.DAY_OF_YEAR) == b.get(Calendar.DAY_OF_YEAR);
    }

    // v6.62.153: Status-Emoji für visuelle Schnell-Erkennung in der Liste
    private static String statusEmoji(String status) {
        switch (status) {
            case "warteschlange": return "⏳";
            case "wartepool":     return "⚠️"; // v6.62.705
            case "vorbestellt":   return "📅";
            case "new":           return "🆕";
            case "accepted":      return "✅";
            case "on_way":        return "🚗";
            case "picked_up":     return "🧍";
            default:              return "❓";
        }
    }

    // v6.62.153: Edit-Dialog für eine bestehende Fahrt — bearbeitbare Felder:
    // Name, Phone, Pickup, Destination, Datum/Zeit, Personenzahl, Status. Plus Stornieren-Button.
    private void showEditRideDialog(final Ride r) {
        if (r == null || r.id == null) return;
        // v6.62.638: _dlgRef hier oben deklariert (vorher Zeile 850) damit die neuen
        // Copy/Rueckfahrt-Buttons darauf zugreifen koennen.
        final java.util.concurrent.atomic.AtomicReference<AlertDialog> _dlgRef =
            new java.util.concurrent.atomic.AtomicReference<>();
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        int pad = (int) (getResources().getDisplayMetrics().density * 16);
        int padHalf = pad / 2;
        layout.setPadding(pad, pad, pad, pad);

        // v6.62.366: Patrick (06.05. 15:05): "Ich sehe kein Speichern auch nach Bug-Fix".
        // INLINE-Speichern-Button als erste Zeile im Layout — Patrick sieht ihn sofort
        // beim Oeffnen des Dialogs, scrollen nicht noetig. Plus Builder-Buttons unten.
        com.google.android.material.button.MaterialButton btnSaveTop =
            new com.google.android.material.button.MaterialButton(this);
        btnSaveTop.setText("💾 SPEICHERN");
        btnSaveTop.setTextSize(16);
        btnSaveTop.setBackgroundColor(android.graphics.Color.parseColor("#10b981"));
        btnSaveTop.setTextColor(android.graphics.Color.WHITE);
        LinearLayout.LayoutParams _saveTopParams = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        _saveTopParams.setMargins(0, 0, 0, pad);
        btnSaveTop.setLayoutParams(_saveTopParams);
        layout.addView(btnSaveTop);

        // v6.62.638: Patrick (12.05. 13:05): "ich will Fahrt auch kopieren, Datum aendern,
        // Rueckfahrt erstellen — wie in der Web-App". Zwei Buttons als Inline-Aktionen direkt
        // unter Speichern, vor den Edit-Feldern.
        LinearLayout copyRow = new LinearLayout(this);
        copyRow.setOrientation(LinearLayout.HORIZONTAL);
        LinearLayout.LayoutParams _copyRowParams = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        _copyRowParams.setMargins(0, 0, 0, pad);
        copyRow.setLayoutParams(_copyRowParams);

        com.google.android.material.button.MaterialButton btnCopy =
            new com.google.android.material.button.MaterialButton(this);
        btnCopy.setText("📅 Kopieren");
        btnCopy.setTextSize(14);
        btnCopy.setBackgroundColor(android.graphics.Color.parseColor("#3b82f6"));
        btnCopy.setTextColor(android.graphics.Color.WHITE);
        LinearLayout.LayoutParams _cp1 = new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
        _cp1.setMargins(0, 0, pad / 2, 0);
        btnCopy.setLayoutParams(_cp1);
        copyRow.addView(btnCopy);

        com.google.android.material.button.MaterialButton btnReturn =
            new com.google.android.material.button.MaterialButton(this);
        btnReturn.setText("🔄 Rueckfahrt");
        btnReturn.setTextSize(14);
        btnReturn.setBackgroundColor(android.graphics.Color.parseColor("#8b5cf6"));
        btnReturn.setTextColor(android.graphics.Color.WHITE);
        LinearLayout.LayoutParams _cp2 = new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
        _cp2.setMargins(pad / 2, 0, pad / 2, 0);
        btnReturn.setLayoutParams(_cp2);
        copyRow.addView(btnReturn);

        // v6.63.073 (Patrick 01.06. Bridge "Serien-Termine"): dritter Button für
        //   Multi-Day-Copy — N Termine in einem Schwung anlegen, gemeinsame
        //   seriesId, eine Sammel-SMS statt N Einzel-Bestätigungen.
        com.google.android.material.button.MaterialButton btnSeries =
            new com.google.android.material.button.MaterialButton(this);
        btnSeries.setText("📋 Serie");
        btnSeries.setTextSize(14);
        btnSeries.setBackgroundColor(android.graphics.Color.parseColor("#0ea5e9"));
        btnSeries.setTextColor(android.graphics.Color.WHITE);
        LinearLayout.LayoutParams _cp3 = new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
        _cp3.setMargins(pad / 2, 0, 0, 0);
        btnSeries.setLayoutParams(_cp3);
        copyRow.addView(btnSeries);
        layout.addView(copyRow);

        btnSeries.setOnClickListener(_v -> {
            AlertDialog _d = _dlgRef.get();
            if (_d != null) _d.dismiss();
            showMultiDayCopyDialog(r);
        });

        btnCopy.setOnClickListener(_v -> {
            AlertDialog _d = _dlgRef.get();
            if (_d != null) _d.dismiss();
            showNewBookingDialog(r);
        });
        btnReturn.setOnClickListener(_v -> {
            AlertDialog _d = _dlgRef.get();
            if (_d != null) _d.dismiss();
            Ride swap = new Ride();
            swap.customerName = r.customerName;
            swap.customerPhone = r.customerPhone;
            swap.pickup = r.destination;
            swap.destination = r.pickup;
            swap.passengers = r.passengers;
            // v6.62.640: Koordinaten auch tauschen — sonst landet die Rueckfahrt ohne
            // Lat/Lon in Firebase und autoAssign kann nichts machen.
            swap.pickupLat = r.destinationLat;
            swap.pickupLon = r.destinationLon;
            swap.destinationLat = r.pickupLat;
            swap.destinationLon = r.pickupLon;
            showNewBookingDialog(swap);
        });

        // v6.62.655: Patrick (12.05. 21:04) — Lock-Checkbox auch im Edit-Dialog
        final android.widget.CheckBox cbEditLock = new android.widget.CheckBox(this);
        cbEditLock.setText(Boolean.TRUE.equals(r.assignmentLocked)
            ? "🔒 Zuweisung GESPERRT (Klick = freigeben)"
            : "🔓 Zuweisung sperren (Klick = sperren)");
        cbEditLock.setChecked(Boolean.TRUE.equals(r.assignmentLocked));
        cbEditLock.setTextSize(13);
        LinearLayout.LayoutParams _cbLp = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        _cbLp.setMargins(0, 0, 0, pad);
        cbEditLock.setLayoutParams(_cbLp);
        cbEditLock.setOnCheckedChangeListener((b, checked) -> {
            cbEditLock.setText(checked
                ? "🔒 Zuweisung GESPERRT (Klick = freigeben)"
                : "🔓 Zuweisung sperren (Klick = sperren)");
        });
        layout.addView(cbEditLock);

        EditText etName = new EditText(this);
        etName.setHint("Kundenname");
        etName.setText(r.customerName != null ? r.customerName : "");
        layout.addView(etName);

        EditText etPhone = new EditText(this);
        etPhone.setHint("Telefonnummer");
        etPhone.setInputType(InputType.TYPE_CLASS_PHONE);
        etPhone.setText(r.customerPhone != null ? r.customerPhone : "");
        layout.addView(etPhone);

        // v6.62.353: Pickup mit Maps-Picker-Button — Patrick: "Abholort ist nur Name kein Geopoint"
        editPickupCoords[0] = Double.NaN; editPickupCoords[1] = Double.NaN;
        editDestCoords[0] = Double.NaN; editDestCoords[1] = Double.NaN;

        LinearLayout puRow = new LinearLayout(this);
        puRow.setOrientation(LinearLayout.HORIZONTAL);
        EditText etPickup = new EditText(this);
        etPickup.setHint("Abholort");
        etPickup.setText(r.pickup != null ? r.pickup : "");
        LinearLayout.LayoutParams puFlex = new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
        etPickup.setLayoutParams(puFlex);
        puRow.addView(etPickup);
        com.google.android.material.button.MaterialButton btnPuPick = new com.google.android.material.button.MaterialButton(this);
        btnPuPick.setText("📍");
        btnPuPick.setOnClickListener(v -> {
            editPickupTextRef = etPickup;
            pickerForPickup = true;
            Intent ip = new Intent(this, MapPickerActivity.class);
            ip.putExtra(MapPickerActivity.EXTRA_INITIAL_QUERY, etPickup.getText().toString());
            mapPickerLauncherDispo.launch(ip);
        });
        puRow.addView(btnPuPick);
        layout.addView(puRow);

        LinearLayout deRow = new LinearLayout(this);
        deRow.setOrientation(LinearLayout.HORIZONTAL);
        EditText etDest = new EditText(this);
        etDest.setHint("Zielort");
        etDest.setText(r.destination != null ? r.destination : "");
        LinearLayout.LayoutParams deFlex = new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
        etDest.setLayoutParams(deFlex);
        deRow.addView(etDest);
        com.google.android.material.button.MaterialButton btnDePick = new com.google.android.material.button.MaterialButton(this);
        btnDePick.setText("📍");
        btnDePick.setOnClickListener(v -> {
            editDestTextRef = etDest;
            pickerForPickup = false;
            Intent id = new Intent(this, MapPickerActivity.class);
            id.putExtra(MapPickerActivity.EXTRA_INITIAL_QUERY, etDest.getText().toString());
            mapPickerLauncherDispo.launch(id);
        });
        deRow.addView(btnDePick);
        layout.addView(deRow);

        // Datum + Zeit
        final long[] dateTime = { r.pickupTimestamp != null ? r.pickupTimestamp : System.currentTimeMillis() };
        Calendar cal = Calendar.getInstance();
        cal.setTimeInMillis(dateTime[0]);
        TextView tvDate = new TextView(this);
        tvDate.setText("📅 " + new SimpleDateFormat("EEE dd.MM.yyyy HH:mm", Locale.GERMANY).format(cal.getTime()));
        tvDate.setPadding(0, pad, 0, pad);
        layout.addView(tvDate);

        // 🆕 v6.62.707: Live-Konflikt-Check (Feddertouristik-Stil).
        // Patrick (14.05. 09:31): "Da konnte man die Kette ja so weit spulen, dass man sagt,
        //   wenn man jetzt die Abholung 10:20 macht, dann ist man zu der Zeit am Zielort".
        // Anzeige direkt unter dem Datum-Feld:
        //   1) Live-Ankunftszeit (pickup + duration)
        //   2) Konflikte mit anderen Fahrten desselben Fahrzeugs (sichtbar mit Pickup-Zeit)
        // Aktualisiert nach Time-Picker-Auswahl + Vehicle-Spinner-Aenderung.
        final TextView tvDateInfo = new TextView(this);
        tvDateInfo.setPadding(0, 0, 0, pad);
        tvDateInfo.setTextSize(13);
        tvDateInfo.setLineSpacing(4f, 1f);
        layout.addView(tvDateInfo);

        // updateDateInfo: berechnet Ankunftszeit + Konflikte und schreibt in tvDateInfo.
        // Wird unten nach den Vehicle-Spinner-Definitionen erst erstmal aufgerufen (Runnable
        // braucht Zugriff auf spnVehicle/vehIds, die kommen weiter unten).
        final Runnable[] updateDateInfoHolder = new Runnable[1];

        tvDate.setOnClickListener(v -> {
            Calendar curr = Calendar.getInstance();
            curr.setTimeInMillis(dateTime[0]);
            new DatePickerDialog(this, (dp, y, m, d) ->
                new TimePickerDialog(this, (tp, h, mi) -> {
                    Calendar nc = Calendar.getInstance();
                    nc.set(y, m, d, h, mi, 0);
                    dateTime[0] = nc.getTimeInMillis();
                    tvDate.setText("📅 " + new SimpleDateFormat("EEE dd.MM.yyyy HH:mm", Locale.GERMANY).format(nc.getTime()));
                    if (updateDateInfoHolder[0] != null) updateDateInfoHolder[0].run();
                }, curr.get(Calendar.HOUR_OF_DAY), curr.get(Calendar.MINUTE), true).show(),
                curr.get(Calendar.YEAR), curr.get(Calendar.MONTH), curr.get(Calendar.DAY_OF_MONTH)).show();
        });

        // Personenzahl-Spinner 1-8
        TextView tvPaxLabel = new TextView(this);
        tvPaxLabel.setText("👥 Personen:");
        tvPaxLabel.setTextSize(13);
        tvPaxLabel.setPadding(0, pad, 0, padHalf);
        layout.addView(tvPaxLabel);
        final android.widget.Spinner spnPax = new android.widget.Spinner(this);
        android.widget.ArrayAdapter<String> paxAdapter = new android.widget.ArrayAdapter<>(
            this, android.R.layout.simple_spinner_item,
            new String[]{"1 Person", "2 Personen", "3 Personen", "4 Personen",
                         "5 Personen (Bus)", "6 Personen (Bus)", "7 Personen (Bus)", "8 Personen (Bus)"});
        paxAdapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        spnPax.setAdapter(paxAdapter);
        int paxSel = (r.passengers != null && r.passengers >= 1 && r.passengers <= 8) ? r.passengers - 1 : 0;
        spnPax.setSelection(paxSel);
        layout.addView(spnPax);

        // Status-Spinner
        TextView tvStatusLabel = new TextView(this);
        tvStatusLabel.setText("📊 Status:");
        tvStatusLabel.setTextSize(13);
        tvStatusLabel.setPadding(0, pad, 0, padHalf);
        layout.addView(tvStatusLabel);
        final android.widget.Spinner spnStatus = new android.widget.Spinner(this);
        final String[] statusVals = {"warteschlange", "wartepool", "vorbestellt", "new", "accepted", "on_way", "picked_up", "completed", "cancelled"};
        android.widget.ArrayAdapter<String> statAdapter = new android.widget.ArrayAdapter<>(
            this, android.R.layout.simple_spinner_item, statusVals);
        statAdapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        spnStatus.setAdapter(statAdapter);
        int statSel = 0;
        for (int i = 0; i < statusVals.length; i++) if (statusVals[i].equals(r.status)) { statSel = i; break; }
        spnStatus.setSelection(statSel);
        layout.addView(spnStatus);

        // 🆕 v6.62.193: Fahrzeug-Zuweisung (Patrick: 'autos kann ich auch nicht zuweisen').
        // Hardcoded Fleet — wenn neue Autos dazukommen, hier ergaenzen. Index 0 = nicht zugewiesen.
        TextView tvVehLabel = new TextView(this);
        tvVehLabel.setText("🚗 Fahrzeug:");
        tvVehLabel.setTextSize(13);
        tvVehLabel.setPadding(0, pad, 0, padHalf);
        layout.addView(tvVehLabel);
        final android.widget.Spinner spnVehicle = new android.widget.Spinner(this);
        final String[] vehIds = {"", "pw-ik-222", "pw-my-222-e", "pw-ki-222", "pw-sk-222", "vg-lk-111", "pw-ym-222-e"};
        final String[] vehLabels = {"— Nicht zugewiesen —",
            "Toyota Prius IK (PW-IK 222)",
            "Tesla MY222 (PW-MY 222 E)",
            "Toyota Prius II (PW-KI 222)",
            "Renault Traffic 8 Pax (PW-SK 222)",
            "Mercedes Vito 8 Pax (VG-LK 111)",
            "Tesla YM222 (PW-YM 222 E)"};
        // 🆕 v6.62.823 (Patrick 19.05. 10:15): Tesla-Namen eindeutig — beide hießen 'Tesla'
        //   bzw 'Tesla Model Y' → Patrick hat sich beim Schicht-Start vertan.
        final String[] vehNames = {"",
            "Toyota Prius IK", "Tesla MY222", "Toyota Prius II",
            "Renault Traffic 8 Pax", "Mercedes Vito 8 Pax", "Tesla YM222"};
        final String[] vehPlates = {"",
            "PW-IK 222", "PW-MY 222 E", "PW-KI 222",
            "PW-SK 222", "VG-LK 111", "PW-YM 222 E"};
        android.widget.ArrayAdapter<String> vehAdapter = new android.widget.ArrayAdapter<>(
            this, android.R.layout.simple_spinner_item, vehLabels);
        vehAdapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        spnVehicle.setAdapter(vehAdapter);
        int vehSel = 0;
        if (r.assignedVehicle != null) {
            for (int i = 0; i < vehIds.length; i++) {
                if (vehIds[i].equals(r.assignedVehicle)) { vehSel = i; break; }
            }
        }
        spnVehicle.setSelection(vehSel);
        layout.addView(spnVehicle);

        // 🆕 v6.62.707: updateDateInfo — Ankunfts-Zeit + Konflikt-Check.
        // Wird aufgerufen: initial, nach Date/Time-Picker, nach Vehicle-Spinner-Wechsel.
        // Konflikt = Ueberlapp dieser Fahrt [dateTime ... dateTime+duration+puffer] mit
        // anderer Fahrt desselben Fahrzeugs [pickupTs ... pickupTs+oDur+puffer].
        // Puffer: 5 Min vor Pickup (Anfahrt) + 5 Min nach Ankunft (Wechsel).
        final java.text.SimpleDateFormat _hmFmt = new java.text.SimpleDateFormat("HH:mm", Locale.GERMANY);
        final int _curDur = (r.estimatedDuration != null && r.estimatedDuration > 0) ? r.estimatedDuration : 15;
        Runnable updateDateInfo = () -> {
            long arrivalTs = dateTime[0] + (long) _curDur * 60_000L;
            String arrivalHM = _hmFmt.format(new java.util.Date(arrivalTs));
            StringBuilder info = new StringBuilder();
            info.append("→ Ankunft am Ziel: ").append(arrivalHM).append(" Uhr  (").append(_curDur).append(" Min Fahrt)");

            int vSel = spnVehicle.getSelectedItemPosition();
            String selVehId = (vSel > 0 && vSel < vehIds.length) ? vehIds[vSel] : null;
            int conflictTextColor = android.graphics.Color.parseColor("#059669");

            if (selVehId == null || selVehId.isEmpty()) {
                info.append("\nℹ️ Kein Fahrzeug zugewiesen — Konflikt-Check ausgesetzt");
                conflictTextColor = android.graphics.Color.parseColor("#64748b");
            } else {
                long newStart = dateTime[0] - 5L * 60_000L;
                long newEnd = arrivalTs + 5L * 60_000L;
                java.util.List<String> conflicts = new java.util.ArrayList<>();
                for (Ride other : _currentRides) {
                    if (other == null || other.id == null) continue;
                    if (other.id.equals(r.id)) continue;
                    if (other.status != null) {
                        String st = other.status.toLowerCase();
                        if (st.equals("completed") || st.equals("cancelled") || st.equals("storniert")
                                || st.equals("deleted") || st.equals("rejected")) continue;
                    }
                    if (!selVehId.equals(other.assignedVehicle)) continue;
                    if (other.pickupTimestamp == null) continue;
                    int oDur = (other.estimatedDuration != null && other.estimatedDuration > 0) ? other.estimatedDuration : 15;
                    long oStart = other.pickupTimestamp - 5L * 60_000L;
                    long oEnd = other.pickupTimestamp + (long) oDur * 60_000L + 5L * 60_000L;
                    if (newStart < oEnd && newEnd > oStart) {
                        String oName = (other.customerName != null && !other.customerName.isEmpty())
                                ? other.customerName : "?";
                        String oHM = _hmFmt.format(new java.util.Date(other.pickupTimestamp));
                        conflicts.add("⚠️ Konflikt: " + oName + " um " + oHM + " (" + oDur + " Min)");
                    }
                }
                if (conflicts.isEmpty()) {
                    info.append("\n✅ Keine Konflikte mit anderen Fahrten dieses Fahrzeugs");
                } else {
                    conflictTextColor = android.graphics.Color.parseColor("#dc2626");
                    for (String c : conflicts) info.append("\n").append(c);
                    info.append("\n\n💡 Tipp: Pickup ± 5/10/15 Min testen um Konflikte zu umgehen");
                }
            }
            tvDateInfo.setText(info.toString());
            tvDateInfo.setTextColor(conflictTextColor);
        };
        updateDateInfoHolder[0] = updateDateInfo;
        updateDateInfo.run();

        // Spinner-Listener: Vehicle-Wechsel triggert Konflikt-Re-Check
        spnVehicle.setOnItemSelectedListener(new android.widget.AdapterView.OnItemSelectedListener() {
            @Override
            public void onItemSelected(android.widget.AdapterView<?> parent, View view, int position, long id) {
                updateDateInfo.run();
            }
            @Override
            public void onNothingSelected(android.widget.AdapterView<?> parent) { }
        });

        // v6.62.365: Patrick (06.05. 14:47): "Ich sehe kein Speichern" — Edit-Dialog ist
        // zu lang, Buttons unten verschwinden vom Screen. Fix: ScrollView begrenzt sich
        // selbst auf 55% der Screen-Hoehe — Builder-Buttons (Speichern/Abbrechen/Stornieren)
        // bleiben damit IMMER unten sichtbar.
        final int _maxScrollHeight = (int)(getResources().getDisplayMetrics().heightPixels * 0.55);
        ScrollView sv = new ScrollView(this) {
            @Override
            protected void onMeasure(int widthMeasureSpec, int heightMeasureSpec) {
                heightMeasureSpec = MeasureSpec.makeMeasureSpec(_maxScrollHeight, MeasureSpec.AT_MOST);
                super.onMeasure(widthMeasureSpec, heightMeasureSpec);
            }
        };
        sv.addView(layout);

        // v6.62.366: Save-Logik als Runnable extrahiert — wird vom INLINE-Top-Button
        // UND vom Builder-positiveButton aufgerufen. Damit hat Patrick einen Speichern-
        // Button immer sichtbar (oben groß, plus unten als Backup).
        // v6.62.638: _dlgRef-Deklaration hier entfernt — wurde an Methodenanfang verschoben
        Runnable saveAction = () -> {
            Toast.makeText(this, "💾 Speichere…", Toast.LENGTH_SHORT).show();
            Map<String, Object> upd = new HashMap<>();
            upd.put("customerName", etName.getText().toString().trim());
            upd.put("customerPhone", etPhone.getText().toString().trim());
            upd.put("pickup", etPickup.getText().toString().trim());
            upd.put("destination", etDest.getText().toString().trim());
            // 🐛 v6.63.029 (Patrick 30.05. 07:28 "Cloud rechnet 265 Min Anfahrt"):
            //   Sub-Objekte pickupCoords/destCoords wurden NICHT aktualisiert.
            //   Cloud-Function liest pickupCoords zuerst (Fallback pickupLat) → bei
            //   Scholl-Dresden-Bug blieben Dresden-Koordinaten im Sub-Objekt während
            //   pickupLat/Lon längst auf Heringsdorf korrigiert waren. Telegram-Block-
            //   Alarm rechnete 265 Min Anfahrt zu Dresden statt 4 Min zu Heringsdorf.
            //   Fix: BEIDE Pfade synchron updaten.
            if (!Double.isNaN(editPickupCoords[0]) && !Double.isNaN(editPickupCoords[1])) {
                upd.put("pickupLat", editPickupCoords[0]);
                upd.put("pickupLon", editPickupCoords[1]);
                Map<String, Object> _pc = new HashMap<>();
                _pc.put("lat", editPickupCoords[0]);
                _pc.put("lon", editPickupCoords[1]);
                upd.put("pickupCoords", _pc);
            }
            if (!Double.isNaN(editDestCoords[0]) && !Double.isNaN(editDestCoords[1])) {
                upd.put("destinationLat", editDestCoords[0]);
                upd.put("destinationLon", editDestCoords[1]);
                Map<String, Object> _dc = new HashMap<>();
                _dc.put("lat", editDestCoords[0]);
                _dc.put("lon", editDestCoords[1]);
                upd.put("destCoords", _dc);
            }
            upd.put("pickupTimestamp", dateTime[0]);
            upd.put("pickupTime", new SimpleDateFormat("HH:mm", Locale.GERMANY).format(new java.util.Date(dateTime[0])));
            // 🆕 v6.63.022 (Patrick 29.05. 20:54 'Cloud plant nicht um'): Bei Adress-/Zeit-
            //   Änderung müssen drivingTimeToPickup + drivingDistanceToPickupKm gelöscht
            //   werden, sonst rechnet autoResolveConflicts mit der alten Anfahrt (z.B.
            //   Scholl hatte 277 Min Anfahrt nach versehentlicher Dresden-Eingabe) und
            //   blockiert das Re-Assign. Plus pickupDate aus pickupTimestamp neu setzen +
            //   autoAssignAttempts=0 für sauberen Re-Run.
            // 🆕 v6.63.027 (Patrick 30.05. 06:51 Scholl-Lifecycle bestätigt Dresden-Bug):
            //   ZUSÄTZLICH estimatedDistance/Duration + distance/duration + price/estimatedPrice
            //   nullen — beim versehentlichen Falsch-Eingeben einer Adresse blieben die
            //   OSRM-Werte (446 km, 991€) im Ride hängen obwohl pickup-String + Coords schon
            //   korrigiert waren. Cloud-Function muss bei nächstem Trigger neu rechnen.
            SimpleDateFormat _dfPickupDate = new SimpleDateFormat("yyyy-MM-dd", Locale.GERMANY);
            _dfPickupDate.setTimeZone(java.util.TimeZone.getTimeZone("Europe/Berlin"));
            upd.put("pickupDate", _dfPickupDate.format(new java.util.Date(dateTime[0])));
            upd.put("drivingTimeToPickup", null);
            upd.put("drivingDistanceToPickupKm", null);
            upd.put("etaUpdatedAt", null);
            upd.put("liveEtaUpdatedAt", null);
            upd.put("liveEtaMethod", null);
            upd.put("estimatedArrivalAt", null);
            // 🆕 v6.63.027: Stale OSRM-Werte aus falsch-eingegebener Adresse löschen
            upd.put("estimatedDistance", null);
            upd.put("estimatedDuration", null);
            upd.put("distance", null);
            upd.put("duration", null);
            upd.put("price", null);
            upd.put("estimatedPrice", null);
            upd.put("priceCalculatedAt", null);
            upd.put("priceCalculatedBy", null);
            upd.put("autoAssignAttempts", 0);
            upd.put("wartepoolReason", null);
            if ("wartepool".equals(r.status)) upd.put("status", "vorbestellt");
            upd.put("resetForAssignAt", System.currentTimeMillis());
            upd.put("resetBy", "native_admin_dispo_edit_v6.63.027");
            // v6.62.655: Lock-State aus Checkbox
            boolean _newLock = cbEditLock.isChecked();
            boolean _oldLock = Boolean.TRUE.equals(r.assignmentLocked);
            if (_newLock != _oldLock) {
                upd.put("assignmentLocked", _newLock);
                if (_newLock) {
                    upd.put("lockedBy", "native_admin_edit");
                    upd.put("lockedAt", System.currentTimeMillis());
                } else {
                    upd.put("lockedBy", null);
                    upd.put("lockedAt", null);
                    upd.put("unlockedAt", System.currentTimeMillis());
                }
            }
            upd.put("passengers", spnPax.getSelectedItemPosition() + 1);
            upd.put("status", statusVals[spnStatus.getSelectedItemPosition()]);
            int vIdx = spnVehicle.getSelectedItemPosition();
            if (vIdx > 0 && vIdx < vehIds.length) {
                String newVehId = vehIds[vIdx];
                if (!newVehId.equals(r.assignedVehicle)) {
                    upd.put("assignedVehicle", newVehId);
                    upd.put("vehicleId", newVehId);
                    upd.put("assignedTo", newVehId);
                    upd.put("assignedVehicleName", vehNames[vIdx]);
                    upd.put("assignedVehiclePlate", vehPlates[vIdx]);
                    upd.put("assignedAt", System.currentTimeMillis());
                    upd.put("assignedBy", "native_admin_dispo_assign");
                }
            } else if (vIdx == 0 && r.assignedVehicle != null) {
                upd.put("assignedVehicle", null);
                upd.put("vehicleId", null);
                upd.put("assignedTo", null);
                upd.put("assignedVehicleName", null);
                upd.put("assignedVehiclePlate", null);
                upd.put("unassignedAt", System.currentTimeMillis());
                upd.put("unassignedBy", "native_admin_dispo_assign");
            }
            upd.put("updatedAt", System.currentTimeMillis());
            upd.put("updatedBy", "native_admin_dispo_edit");
            FirebaseDatabase.getInstance(DB_INSTANCE_URL).getReference("rides/" + r.id)
                .updateChildren(upd)
                .addOnSuccessListener(_v -> {
                    Toast.makeText(this, "✅ Fahrt aktualisiert", Toast.LENGTH_SHORT).show();
                    AlertDialog _d = _dlgRef.get();
                    if (_d != null) _d.dismiss();
                })
                .addOnFailureListener(ex -> Toast.makeText(this, "Fehler: " + ex.getMessage(), Toast.LENGTH_LONG).show());
        };
        // INLINE-Top-Button feuert den selben Save
        btnSaveTop.setOnClickListener(v -> saveAction.run());

        // v6.62.638: _dlgRef-Deklaration wurde nach oben verschoben — hier nur noch verwenden
        AlertDialog dlg = new AlertDialog.Builder(this)
            .setTitle("✏️ Fahrt bearbeiten")
            .setMessage("ID: " + r.id)
            .setView(sv)
            .setPositiveButton("💾 Speichern", (d, w) -> saveAction.run())
            // 🆕 v6.62.191: Stornieren-Button war unter "Abbrechen" platziert — Patrick hat
            // versehentlich gedrueckt und Vetter-Touristik 11:20-Tour war weg. Jetzt mit
            // Bestaetigungs-Dialog davor: "Wirklich stornieren?" Yes/No.
            .setNeutralButton("🚫 Stornieren", (d, w) -> {
                String confirmMsg = "Diese Fahrt wirklich stornieren?\n\n" +
                    (r.customerName != null ? "👤 " + r.customerName + "\n" : "") +
                    (r.pickupTime != null ? "🕒 " + r.pickupTime + "\n" : "") +
                    (r.pickup != null ? "📍 " + r.pickup + "\n" : "");
                new AlertDialog.Builder(AdminDashboardActivity.this)
                    .setTitle("⚠️ Stornieren bestaetigen")
                    .setMessage(confirmMsg)
                    .setPositiveButton("🚫 Ja, stornieren", (d2, w2) -> {
                        Map<String, Object> upd = new HashMap<>();
                        upd.put("status", "cancelled");
                        upd.put("cancelledAt", System.currentTimeMillis());
                        upd.put("cancelledBy", "native_admin_dispo");
                        upd.put("updatedAt", System.currentTimeMillis());
                        FirebaseDatabase.getInstance(DB_INSTANCE_URL).getReference("rides/" + r.id)
                            .updateChildren(upd)
                            .addOnSuccessListener(_v -> Toast.makeText(this, "🚫 Fahrt storniert", Toast.LENGTH_SHORT).show())
                            .addOnFailureListener(ex -> Toast.makeText(this, "Fehler: " + ex.getMessage(), Toast.LENGTH_LONG).show());
                    })
                    .setNegativeButton("Nein, behalten", null)
                    .show();
            })
            .setNegativeButton("Abbrechen", null)
            .create();
        _dlgRef.set(dlg);
        dlg.show();
    }
}
