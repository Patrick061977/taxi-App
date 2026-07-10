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
    private MaterialButton btnMenu, btnCallLog, btnNewBooking, btnInvoices;
    private RecyclerView rv;
    private LinearLayout emptyState;
    private AdminRideAdapter adapter;
    // 🆕 v6.63.561: Suchfeld
    private EditText etAdminSearch;
    private MaterialButton btnAdminSearchClear;
    private android.os.Handler _searchHandler;
    private Runnable _searchRunnable;
    private AlertDialog _currentSearchDialog;

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
        btnInvoices = findViewById(R.id.btn_admin_invoices);
        btnNewBooking = findViewById(R.id.btn_admin_new_booking);
        rv = findViewById(R.id.rv_admin_rides);
        emptyState = findViewById(R.id.admin_empty_state);

        rv.setLayoutManager(new LinearLayoutManager(this));
        adapter = new AdminRideAdapter();
        rv.setAdapter(adapter);

        // 🆕 v6.63.561: Suchfeld-Setup
        // 🔧 v6.63.563: Suche NUR bei Enter/IME-Search oder Lupe-Button — KEIN Auto-Debounce
        etAdminSearch = findViewById(R.id.et_admin_search);
        btnAdminSearchClear = findViewById(R.id.btn_admin_search_clear);
        if (etAdminSearch != null) {
            // TextWatcher: nur Clear-Button zeigen/verstecken — KEINE automatische Suche
            etAdminSearch.addTextChangedListener(new android.text.TextWatcher() {
                @Override public void beforeTextChanged(CharSequence s, int start, int count, int after) {}
                @Override public void onTextChanged(CharSequence s, int start, int before, int count) {
                    String q = s.toString().trim();
                    if (btnAdminSearchClear != null)
                        btnAdminSearchClear.setVisibility(q.isEmpty() ? View.GONE : View.VISIBLE);
                }
                @Override public void afterTextChanged(android.text.Editable s) {}
            });
            // Enter / Lupe-Taste auf Tastatur → Suche auslösen
            etAdminSearch.setOnEditorActionListener((v, actionId, event) -> {
                if (actionId == android.view.inputmethod.EditorInfo.IME_ACTION_SEARCH
                        || actionId == android.view.inputmethod.EditorInfo.IME_ACTION_DONE
                        || (event != null && event.getKeyCode() == android.view.KeyEvent.KEYCODE_ENTER)) {
                    String q = etAdminSearch.getText() != null ? etAdminSearch.getText().toString().trim() : "";
                    if (q.length() >= 2) performAdminSearch(q);
                    // Tastatur ausblenden
                    android.view.inputmethod.InputMethodManager imm =
                        (android.view.inputmethod.InputMethodManager) getSystemService(INPUT_METHOD_SERVICE);
                    if (imm != null) imm.hideSoftInputFromWindow(etAdminSearch.getWindowToken(), 0);
                    return true;
                }
                return false;
            });
        }
        if (btnAdminSearchClear != null) {
            btnAdminSearchClear.setOnClickListener(v -> {
                if (etAdminSearch != null) etAdminSearch.setText("");
                btnAdminSearchClear.setVisibility(View.GONE);
            });
        }

        FirebaseUser u = FirebaseAuth.getInstance().getCurrentUser();
        if (u != null) {
            tvAdminEmail.setText(u.getEmail() != null ? u.getEmail() : (u.getPhoneNumber() != null ? u.getPhoneNumber() : "Admin"));
        }

        btnMenu.setOnClickListener(this::showMenu);
        btnCallLog.setOnClickListener(v -> startActivity(new Intent(this, CallLogActivity.class)));
        if (btnInvoices != null) btnInvoices.setOnClickListener(v -> startActivity(new Intent(this, InvoicesActivity.class)));
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
            // v6.63.565: 2h → 12h — Fahrten die vor >2h Pickup-Zeit noch aktiv sind
            //   (on_way, picked_up, accepted) verschwanden aus der Dispo (Weimann-Bug 30.06.)
            long pastHours = _includePast ? (30L * 24) : 12L;
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
        // 🆕 v6.63.375 (Patrick 17.06. 07:39 Bridge: "Nimm die Wartepool-Sachen aus der App
        //   vorne raus, wir können sonst keine Fahrt mehr annehmen. Die schreibt sie nur
        //   nach oben dass Wartepool eigentlich gar nicht zu sehen ist"):
        //   Wartepool-Rides aus der Tag-Timeline rausziehen, am Ende als eigene Sektion.
        //   Plus Banner-Tap soll dorthin scrollen.
        List<Ride> wartepoolRides = new ArrayList<>();
        for (Ride r : list) {
            if (r.isUnclaimedWebBooking()) webRequests.add(r);
            else if (r.status != null && "wartepool".equalsIgnoreCase(r.status)) wartepoolRides.add(r);
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
        // 🆕 v6.63.375: Wartepool-Count aus separater Liste (rest enthält jetzt KEINE wartepool-Rides mehr)
        int wartepoolCount = wartepoolRides.size();

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

        // 🆕 v6.63.558: FREIE FAHRTEN — new/sofort ohne Fahrzeug-Zuweisung (Patrick 29.06.
        //   19:40 Bridge: "Da muss irgendwo am besten oben so ein Fahrradpool sein, wo die
        //   offenen Fahrten drinnen stehen, wo die jetzt nicht zugeteilt wurden")
        List<Ride> _freieRides = new ArrayList<>();
        for (Ride _r2 : rest) {
            if (("new".equalsIgnoreCase(_r2.status) || "sofort".equalsIgnoreCase(_r2.status))
                    && (_r2.assignedVehicle == null || _r2.assignedVehicle.isEmpty())) {
                _freieRides.add(_r2);
            }
        }
        if (!_freieRides.isEmpty()) {
            _freieRides.sort(Comparator.comparingLong(_r3 -> _r3.pickupTimestamp != null ? _r3.pickupTimestamp : Long.MAX_VALUE));
            sectioned.add("🆓 FREIE FAHRTEN (" + _freieRides.size() + ") — kein Fahrer zugewiesen");
            sectioned.addAll(_freieRides);
        }

        // 🆕 v6.63.671 (Patrick 10.07. 11:09 Bridge "Koch war nirgendwo — Fahrt hängt tot",
        //   "assigned ist nur wenn der Fahrer wirklich bestätigt"):
        //   Fahrten die formal zugewiesen sind, aber der Fahrer hat NIE bestätigt (acceptedAt=null).
        //   Diese fallen sonst durchs Netz: nicht im Wartepool (formal zugewiesen), nicht im
        //   Freie-Fahrten-Block (hat ja ein Fahrzeug), und der Stuck-Watchdog greift nur bei
        //   Pickup > jetzt (msUntil > 0). Der Koch-Fall (Pickup 10:00, jetzt 10:10, assigned
        //   an offline-Fahrer seit 06:39) blieb komplett unsichtbar.
        //
        //   Kriterium: status='assigned' + acceptedAt=null + (assignedAt älter als 5 Min ODER
        //     Pickup weniger als 30 Min entfernt/überfällig).
        List<Ride> _vorgesehenRides = new ArrayList<>();
        long _nowMs = System.currentTimeMillis();
        for (Ride _rv : rest) {
            if (!"assigned".equalsIgnoreCase(_rv.status)) continue;
            if (_rv.acceptedAt != null) continue; // schon bestätigt → normale Fahrzeug-Kette
            boolean _oldAssign = _rv.assignedAt != null && (_nowMs - _rv.assignedAt) > 5 * 60_000L;
            boolean _pickupClose = _rv.pickupTimestamp != null && (_rv.pickupTimestamp - _nowMs) < 30 * 60_000L;
            if (_oldAssign || _pickupClose) _vorgesehenRides.add(_rv);
        }
        if (!_vorgesehenRides.isEmpty()) {
            _vorgesehenRides.sort(Comparator.comparingLong(_r4 -> _r4.pickupTimestamp != null ? _r4.pickupTimestamp : Long.MAX_VALUE));
            sectioned.add("🕐 VORGESEHEN — nicht bestätigt (" + _vorgesehenRides.size() + ") — Fahrer hat NICHT angenommen");
            sectioned.addAll(_vorgesehenRides);
            // Aus rest entfernen damit sie nicht auch in der Tag-Timeline nochmal auftauchen
            rest.removeAll(_vorgesehenRides);
        }

        // v6.63.678 (Patrick 10.07. 16:05 Bridge "der wartepool wird oben angezeigt und
        //   aus der Disposition verschwindet das ist unübersichtlich"):
        //   Wartepool-Rides bleiben in der Tag-Timeline INLINE sichtbar (Zeit-Kontext),
        //   MIT expanded Diagnose per Default (v6.63.678 Fix Z3297).
        //   Wir wollen NICHT eine separate obere Sektion die die Rides dupliziert.
        rest.addAll(wartepoolRides);

        // 🆕 v6.62.932 (Patrick 25.05. 12:29-12:30 'e' + 'dispo'): Wartepool +
        //   offene Anfragen als prominente Top-Banner — geht in der Dispo-Liste sonst unter.
        try {
            android.widget.LinearLayout _wpBanner = findViewById(R.id.admin_wartepool_banner);
            android.widget.TextView _wpText = findViewById(R.id.admin_wartepool_banner_text);
            if (_wpBanner != null && _wpText != null) {
                if (wartepoolCount > 0) {
                    _wpText.setText("⚠️ WARTEPOOL: " + wartepoolCount + " Fahrt" + (wartepoolCount == 1 ? "" : "en") + " warten — manuelle Disposition!");
                    // 🆕 v6.63.566: Wartepool-Banner ausblenden wenn Anfragen-Banner sichtbar
                    //   (Anfragen haben höhere Priorität — beide gleichzeitig = visuelles Chaos)
                    android.widget.LinearLayout _anfBannerCheck = findViewById(R.id.admin_anfragen_banner);
                    if (_anfBannerCheck != null && _anfBannerCheck.getVisibility() == android.view.View.VISIBLE) {
                        _wpBanner.setVisibility(android.view.View.GONE);
                    } else {
                        _wpBanner.setVisibility(android.view.View.VISIBLE);
                    }
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
                    // v6.63.608: drivingTimeToPickup=999 ist ein Routing-Fehler-Placeholder → Fallback 10 Min
                    long nxtDrive = nxt.drivingTimeToPickup != null && nxt.drivingTimeToPickup > 0 && nxt.drivingTimeToPickup < 999 ? nxt.drivingTimeToPickup : 10;
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
        // 🆕 v6.63.375 (Patrick 17.06. 07:39 Bridge): Wartepool-Rides am ENDE als eigene
        //   Sektion. Vorne in der Tag-Timeline stehen nur normale Vorbestellungen +
        //   completed, damit Patrick die regulären Fahrten annehmen kann ohne dass die
        //   Wartepool-Karten die Liste verstopfen.
        // v6.63.678 (Patrick 10.07. 16:04 Bridge "das habe ich nirgends gesehen"):
        //   Wartepool wird jetzt OBEN direkt nach VORGESEHEN gezeigt (siehe oben).
        //   Untere Sektion entfernt — sonst tauchen die Rides doppelt auf.
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

    // 🆕 v6.63.501: Changelog aus Firebase settings/appChangelog laden und anzeigen
    private void showChangelogDialog() {
        com.google.firebase.database.FirebaseDatabase.getInstance(DB_URL_AD)
            .getReference("settings/appChangelog")
            .addListenerForSingleValueEvent(new com.google.firebase.database.ValueEventListener() {
                @Override public void onDataChange(@NonNull com.google.firebase.database.DataSnapshot snap) {
                    StringBuilder sb = new StringBuilder();
                    try {
                        Object entries = snap.child("entries").getValue();
                        if (snap.child("entries").exists()) {
                            for (com.google.firebase.database.DataSnapshot e : snap.child("entries").getChildren()) {
                                String ver = e.child("version").getValue(String.class);
                                String date = e.child("date").getValue(String.class);
                                String title = e.child("title").getValue(String.class);
                                sb.append("▶ v").append(ver != null ? ver : "?");
                                sb.append("  (").append(date != null ? date : "?").append(")\n");
                                sb.append("  ").append(title != null ? title : "").append("\n");
                                for (com.google.firebase.database.DataSnapshot c : e.child("changes").getChildren()) {
                                    String ch = c.getValue(String.class);
                                    if (ch != null) sb.append("  • ").append(ch).append("\n");
                                }
                                sb.append("\n");
                            }
                        }
                    } catch (Throwable _t) {
                        sb.append("Fehler beim Laden: ").append(_t.getMessage());
                    }
                    if (sb.length() == 0) sb.append("Kein Changelog verfügbar.");
                    runOnUiThread(() -> new androidx.appcompat.app.AlertDialog.Builder(AdminDashboardActivity.this)
                        .setTitle("📋 Versions-Info (App v" + de.taxiheringsdorf.app.BuildConfig.VERSION_NAME + ")")
                        .setMessage(sb.toString())
                        .setPositiveButton("OK", null)
                        .show());
                }
                @Override public void onCancelled(@NonNull com.google.firebase.database.DatabaseError e) {
                    runOnUiThread(() -> new androidx.appcompat.app.AlertDialog.Builder(AdminDashboardActivity.this)
                        .setTitle("📋 Versions-Info")
                        .setMessage("Fehler: " + e.getMessage())
                        .setPositiveButton("OK", null)
                        .show());
                }
            });
    }

    private void showMenu(View anchor) {
        PopupMenu p = new PopupMenu(this, anchor);
        p.getMenu().add(0, 3, 0, _includePast ? "📅 Nur kommende anzeigen" : "📅 +30 Tage Vergangenheit anzeigen");
        // v6.62.828 (Patrick 22.05. 14:48): Lokale ACR-Phone Aufnahmen
        p.getMenu().add(0, 5, 0, "🎙️ Anruf-Aufnahmen");
        // 🆕 v6.62.909 (Patrick 24.05. 09:35): Live-Schichtstatus aller Fahrzeuge
        p.getMenu().add(0, 6, 0, "🚗 Fahrzeug-Status (Live)");
        // 🆕 v6.62.922 (Patrick 25.05. 09:27): Schichtplan-Editor in Native-App
        p.getMenu().add(0, 7, 0, "📅 Schichtplan-Editor");
        // 🆕 v6.63.501: Versions-Changelog aus Firebase
        p.getMenu().add(0, 8, 0, "📋 Was ist neu? v" + de.taxiheringsdorf.app.BuildConfig.VERSION_NAME);
        // 🆕 v6.63.598: Rechnungen-Übersicht
        p.getMenu().add(0, 9, 0, "🧾 Rechnungen");
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
            if (item.getItemId() == 8) {
                showChangelogDialog();
                return true;
            }
            if (item.getItemId() == 9) {
                startActivity(new Intent(this, InvoicesActivity.class));
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
        // v6.63.636: "📧 Rechnung an Auftraggeber" als erste Option direkt zugänglich
        String header = (r.customerName != null ? r.customerName : "?")
            + "\n" + (r.pickup != null ? r.pickup : "?") + " → " + (r.destination != null ? r.destination : "?");
        new androidx.appcompat.app.AlertDialog.Builder(this)
            .setTitle("Abgeschlossene Fahrt")
            .setMessage(header)
            .setItems(new String[]{
                "📧 Rechnung an Auftraggeber senden",
                "📅 Gleiche Strecke (neue Vorbestellung)",
                "🔄 Rueckfahrt (Adressen tauschen)",
                "✏️ Preis / Notiz / Status bearbeiten"
            }, (d, which) -> {
                if (which == 0) launchInvoiceEmailFromRide(r);
                else if (which == 1) launchCrmTemplate(r, false);
                else if (which == 2) launchCrmTemplate(r, true);
                else showEditRideDialog(r);
            })
            .setNegativeButton("Abbrechen", null)
            .show();
    }

    // v6.63.636: Email-Vorschau für Rechnung direkt aus Fahrt öffnen
    private void launchInvoiceEmailFromRide(Ride r) {
        if (r.invoiceNumber == null || r.invoiceNumber.isEmpty()) {
            new androidx.appcompat.app.AlertDialog.Builder(this)
                .setTitle("Keine Rechnung vorhanden")
                .setMessage("Für diese Fahrt wurde noch keine Rechnung erstellt. Bitte zuerst unter 'Preis / Notiz / Status bearbeiten' → '🧾 Quittung / Rechnung erstellen'.")
                .setPositiveButton("OK", null)
                .show();
            return;
        }
        // 🆕 v6.63.639: Auftraggeber-Email bevorzugen (Hotel/Firma bucht für Gast)
        // Reihenfolge: ride.customerEmail → CRM Auftraggeber → CRM Kunde
        String knownEmail = r.customerEmail != null ? r.customerEmail : "";
        boolean isAuftr = Boolean.TRUE.equals(r.isAuftraggeberBooking);
        String auftrId = r.auftraggeberId != null ? r.auftraggeberId : "";
        if (isAuftr && !auftrId.isEmpty()) {
            com.google.firebase.database.FirebaseDatabase.getInstance(DB_URL_AD)
                .getReference("customers/" + auftrId + "/email").get()
                .addOnSuccessListener(snap -> {
                    String auftrEmail = snap.getValue() instanceof String ? (String) snap.getValue() : "";
                    if (!auftrEmail.isEmpty()) {
                        runOnUiThread(() -> doLaunchInvoiceEmail(r, auftrEmail));
                    } else if (!knownEmail.isEmpty()) {
                        runOnUiThread(() -> doLaunchInvoiceEmail(r, knownEmail));
                    } else if (r.customerId != null && !r.customerId.isEmpty()) {
                        com.google.firebase.database.FirebaseDatabase.getInstance(DB_URL_AD)
                            .getReference("customers/" + r.customerId + "/email").get()
                            .addOnSuccessListener(s2 -> {
                                String ce = s2.getValue() instanceof String ? (String) s2.getValue() : "";
                                runOnUiThread(() -> doLaunchInvoiceEmail(r, ce));
                            })
                            .addOnFailureListener(e2 -> runOnUiThread(() -> doLaunchInvoiceEmail(r, "")));
                    } else {
                        runOnUiThread(() -> doLaunchInvoiceEmail(r, ""));
                    }
                })
                .addOnFailureListener(e -> runOnUiThread(() -> doLaunchInvoiceEmail(r, knownEmail)));
        } else if (knownEmail.isEmpty() && r.customerId != null && !r.customerId.isEmpty()) {
            com.google.firebase.database.FirebaseDatabase.getInstance(DB_URL_AD)
                .getReference("customers/" + r.customerId + "/email").get()
                .addOnSuccessListener(snap -> {
                    String crmEmail = snap.getValue() instanceof String ? (String) snap.getValue() : "";
                    runOnUiThread(() -> doLaunchInvoiceEmail(r, crmEmail));
                })
                .addOnFailureListener(e -> runOnUiThread(() -> doLaunchInvoiceEmail(r, "")));
        } else {
            doLaunchInvoiceEmail(r, knownEmail);
        }
    }

    private void doLaunchInvoiceEmail(Ride r, String email) {
        android.content.Intent ep = new android.content.Intent(this, EmailPreviewActivity.class);
        if (r.id != null) ep.putExtra(EmailPreviewActivity.EXTRA_RIDE_ID, r.id);
        ep.putExtra(EmailPreviewActivity.EXTRA_INVOICE_KEY, r.invoiceNumber);
        if (r.invoicePdfUrl != null && !r.invoicePdfUrl.isEmpty()) ep.putExtra("prefillPdfUrl", r.invoicePdfUrl);
        ep.putExtra(EmailPreviewActivity.EXTRA_MODE, EmailPreviewActivity.MODE_INVOICE);
        if (!email.isEmpty()) ep.putExtra("prefillEmail", email);
        startActivity(ep);
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
        // Kein scroll.addView(tvDetails) hier — tvDetails kommt direkt in btnLayout unten

        // v6.63.516: Vier-Button-Dialog — Custom-View erlaubt nur 3 AlertDialog-Buttons,
        // deshalb 4. Button als eigene Zeile in der ScrollView.
        int btnPad = (int) (getResources().getDisplayMetrics().density * 12);
        android.widget.LinearLayout btnLayout = new android.widget.LinearLayout(this);
        btnLayout.setOrientation(android.widget.LinearLayout.VERTICAL);
        btnLayout.setPadding(btnPad, 0, btnPad, btnPad);

        // 🆕 v6.63.535: Kein Chrome-Custom-Tab mehr — alles nativ.
        // uebernehmeAnfrage() übernimmt den Ride, ruft danach showVorkasseEmailDialog()
        // auf wenn email+price vorhanden sind (Stripe-Link + Email-Versand nativ).
        android.widget.Button btnVorschau = new android.widget.Button(this);
        btnVorschau.setText("✅ Übernehmen + Stripe-Link per " + _kanalLabel + " senden");
        btnVorschau.setBackgroundColor(0xFF059669);
        btnVorschau.setTextColor(0xFFFFFFFF);
        btnVorschau.setPadding(btnPad, btnPad, btnPad, btnPad);
        android.widget.LinearLayout.LayoutParams lp =
            new android.widget.LinearLayout.LayoutParams(
                android.widget.LinearLayout.LayoutParams.MATCH_PARENT,
                android.widget.LinearLayout.LayoutParams.WRAP_CONTENT);
        lp.setMargins(0, btnPad, 0, btnPad / 2);
        btnVorschau.setLayoutParams(lp);

        android.widget.Button btnNurUebernehmen = new android.widget.Button(this);
        btnNurUebernehmen.setText("⚪ Nur übernehmen (kein Versand)");
        btnNurUebernehmen.setTextColor(0xFF374151);
        android.widget.LinearLayout.LayoutParams lp2 =
            new android.widget.LinearLayout.LayoutParams(
                android.widget.LinearLayout.LayoutParams.MATCH_PARENT,
                android.widget.LinearLayout.LayoutParams.WRAP_CONTENT);
        lp2.setMargins(0, 0, 0, btnPad / 2);
        btnNurUebernehmen.setLayoutParams(lp2);

        btnLayout.addView(tvDetails);
        btnLayout.addView(btnVorschau);
        btnLayout.addView(btnNurUebernehmen);
        scroll.addView(btnLayout);

        androidx.appcompat.app.AlertDialog dlg = new androidx.appcompat.app.AlertDialog.Builder(this)
            .setTitle("📥 Anfrage — " + (a.name != null ? a.name : "?"))
            .setView(scroll)
            .setNegativeButton("❌ Ablehnen", (d, w) -> {
                db.getReference("anfragen/" + a.id + "/status").setValue("abgelehnt");
                Toast.makeText(this, "Anfrage abgelehnt", Toast.LENGTH_SHORT).show();
            })
            .create();

        btnVorschau.setOnClickListener(_v -> {
            dlg.dismiss();
            // 🆕 v6.63.535: Vollständig nativ — kein Browser-Redirect.
            // uebernehmeAnfrage() schreibt Ride in Firebase; onSuccess ruft
            // showVorkasseEmailDialog() auf wenn email+price vorhanden → Stripe-Link
            // wird erstellt + Email/WA/SMS nativ versendet.
            uebernehmeAnfrage(a);
        });
        btnNurUebernehmen.setOnClickListener(_v -> {
            dlg.dismiss();
            uebernehmeAnfrageOhneBestaetigung(a);
        });
        dlg.show();
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

    // v6.63.333 (Patrick 14.06.2026 12:55 Carmen-Haas-Vorfall):
    //   Doppel-Click-Schutz fuer Anfrage-Uebernahme. Carmen Haas hatte gestern
    //   2 Rides in 9 Sek (rideId 1 → Tesla zugewiesen; rideId 2 → Wartepool weil
    //   Self-Conflict). Patrick: 'will Fakten + nicht 30 Min auf System warten'.
    //   Schutz: In-Flight-Flag + serverseitiger anfrage.status-Check vor Write.
    private final java.util.Set<String> _uebernahmeInFlight = new java.util.HashSet<>();
    private void uebernehmeAnfrage(Anfrage a) {
        if (a == null || a.id == null) return;
        synchronized (_uebernahmeInFlight) {
            if (_uebernahmeInFlight.contains(a.id)) {
                Toast.makeText(this, "⏳ Uebernahme laeuft bereits — bitte warten...", Toast.LENGTH_SHORT).show();
                return;
            }
            _uebernahmeInFlight.add(a.id);
        }
        // Race-Check serverseitig: anfrage.status muss noch != 'bestaetigt' sein
        db.getReference("anfragen/" + a.id + "/status").get().addOnSuccessListener(snap -> {
            String currentStatus = snap.exists() && snap.getValue() instanceof String ? (String) snap.getValue() : null;
            if ("bestaetigt".equalsIgnoreCase(currentStatus)) {
                synchronized (_uebernahmeInFlight) { _uebernahmeInFlight.remove(a.id); }
                Toast.makeText(this, "⚠️ Anfrage bereits uebernommen — kein Duplikat angelegt.", Toast.LENGTH_LONG).show();
                return;
            }
            _uebernehmeAnfrageImpl(a);
        }).addOnFailureListener(err -> {
            synchronized (_uebernahmeInFlight) { _uebernahmeInFlight.remove(a.id); }
            Toast.makeText(this, "❌ Pre-Check-Fehler: " + err.getMessage(), Toast.LENGTH_LONG).show();
        });
    }
    private void _uebernehmeAnfrageImpl(Anfrage a) {
        // v6.63.510: Uhrzeit-Pflichtfeld — leere Uhrzeit würde isSofort=true
        // liefern und die Fahrt mit falschem Timestamp (jetzt) anlegen.
        if (a.time == null || a.time.trim().isEmpty()) {
            synchronized (_uebernahmeInFlight) { _uebernahmeInFlight.remove(a.id); }
            runOnUiThread(() -> new android.app.AlertDialog.Builder(this)
                .setTitle("⚠️ Uhrzeit fehlt!")
                .setMessage("Die Anfrage von " + (a.name != null ? a.name : "?") + " hat keine Uhrzeit.\n\nBitte die Uhrzeit in der Web-Verwaltung ergänzen, dann erneut übernehmen.")
                .setPositiveButton("OK", null)
                .show());
            return;
        }
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
                        // 🔧 v6.63.550: Als Number (double) speichern, nicht als
                        // German-Format-String "10,00" — sonst liest native fromSnap
                        // (instanceof Number = false) und Web-App (Number("10,00")=NaN)
                        // beide 0 statt den echten Preis.
                        ride.put("price", _priceVal);
                        ride.put("estimatedPrice", _priceVal);
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
                synchronized (_uebernahmeInFlight) { _uebernahmeInFlight.remove(a.id); }
                if (task.isSuccessful()) {
                    runOnUiThread(() -> {
                        // 🆕 v6.63.666 (Patrick 09.07.: "muss in der Anfrage ausführbar sein"):
                        //   Rückfahrt-Erkennung aus Notizen — wenn "Rückfahrt" + Datum + Uhrzeit
                        //   in Notes → Dialog anbieten bevor Email/WA-Flow startet.
                        final Runnable _continueFlow = () -> {
                            if (a.email != null && a.email.contains("@")) {
                                android.content.Intent _ep = new android.content.Intent(this, EmailPreviewActivity.class);
                                _ep.putExtra(EmailPreviewActivity.EXTRA_RIDE_ID, rideId);
                                startActivity(_ep);
                            } else if (a.phone != null && !a.phone.isEmpty()) {
                                double _priceVal2 = 0;
                                try {
                                    if (a.price != null && !a.price.isEmpty() && !"—".equals(a.price))
                                        _priceVal2 = Double.parseDouble(a.price.replace("€","").replace(",",".").trim());
                                } catch (Throwable _pe) {}
                                if (_priceVal2 >= 0.5) {
                                    _createStripeAndOpenWA(rideId, a, pickupTime, _priceVal2);
                                } else {
                                    _openWhatsAppBestaetigung(a, null);
                                }
                            } else {
                                showVorkasseEmailDialog(rideId, a, pickupTime);
                            }
                        };
                        RueckfahrtHint _rfHint = _detectRueckfahrt(a.notes);
                        if (_rfHint != null) {
                            String _pickup40 = a.destination != null ? (a.destination.length() > 45 ? a.destination.substring(0, 45) + "…" : a.destination) : "?";
                            String _dest40  = a.pickup != null    ? (a.pickup.length()    > 45 ? a.pickup.substring(0, 45)    + "…" : a.pickup)    : "?";
                            new AlertDialog.Builder(AdminDashboardActivity.this)
                                .setTitle("📅 Rückfahrt erkannt")
                                .setMessage("In den Notizen steht:\n\n"
                                    + "📅 " + _rfHint.dateStr + " um " + _rfHint.timeStr + " Uhr\n"
                                    + "📍 " + _pickup40 + "\n"
                                    + "🎯 " + _dest40 + "\n"
                                    + "👤 " + (a.passengers != null ? a.passengers : 1) + " Pax\n\n"
                                    + "Jetzt als separate Fahrt anlegen?")
                                .setPositiveButton("✅ Ja, anlegen", (d2, w2) -> {
                                    _createRueckfahrtRide(a, rideId, _rfHint);
                                    _continueFlow.run();
                                })
                                .setNegativeButton("Nein", (d2, w2) -> _continueFlow.run())
                                .setCancelable(false)
                                .show();
                        } else {
                            _continueFlow.run();
                        }
                    });
                } else {
                    Toast.makeText(this, "❌ Fehler: " + (task.getException() != null ? task.getException().getMessage() : "?"), Toast.LENGTH_LONG).show();
                }
            });
        } catch (Throwable t) {
            synchronized (_uebernahmeInFlight) { _uebernahmeInFlight.remove(a.id); }
            Toast.makeText(this, "❌ Anfrage-Übernahme-Fehler: " + t.getMessage(), Toast.LENGTH_LONG).show();
        }
    }

    // v6.63.625: WhatsApp mit Bestätigungs-Text + optionalem Stripe-Link öffnen
    private void _openWhatsAppBestaetigung(Anfrage a, String stripeUrl) {
        String _name = a.name != null ? a.name : "Kunde";
        String _date = (a.date != null ? a.date : "") + (a.time != null ? " um " + a.time + " Uhr" : "");
        String _priceStr = "";
        try {
            if (a.price != null && !a.price.isEmpty() && !"—".equals(a.price)) {
                double _pv = Double.parseDouble(a.price.replace("€","").replace(",",".").trim());
                if (_pv > 0) _priceStr = "💰 " + String.format(java.util.Locale.GERMANY, "%.2f", _pv) + " €\n";
            }
        } catch (Throwable _pe) {}
        String _msg = "Hallo " + _name + ",\n\nIhre Fahrt ist bestätigt ✅\n\n" +
            (_date.isEmpty() ? "" : "🕐 " + _date + "\n") +
            "📍 " + (a.pickup != null ? a.pickup : "?") + "\n" +
            "🎯 " + (a.destination != null ? a.destination : "?") + "\n" +
            "👥 " + (a.passengers != null ? a.passengers + " Person(en)" : "1 Person") + "\n" +
            _priceStr +
            (stripeUrl != null && !stripeUrl.isEmpty() ? "\n💳 Zahlungslink:\n" + stripeUrl + "\n" : "") +
            "\nFunk Taxi Heringsdorf · 038378 / 22022";
        String _ph = a.phone.replaceAll("[\\s\\-\\/\\(\\)\\+]", "");
        if (_ph.startsWith("0")) _ph = "49" + _ph.substring(1);
        android.content.Intent _wi = new android.content.Intent(android.content.Intent.ACTION_VIEW);
        _wi.setData(android.net.Uri.parse("https://wa.me/" + _ph + "?text=" + java.net.URLEncoder.encode(_msg)));
        try { startActivity(_wi); }
        catch (Throwable _t) { Toast.makeText(this, "WhatsApp nicht installiert", Toast.LENGTH_SHORT).show(); }
    }

    // v6.63.625: Stripe-Session erstellen, dann WhatsApp öffnen (ein Schritt für den Fahrer)
    private void _createStripeAndOpenWA(String rideId, Anfrage a, String pickupTime, double price) {
        Toast.makeText(this, "⏳ Stripe-Link wird erstellt…", Toast.LENGTH_SHORT).show();
        new Thread(() -> {
            try {
                String invNum = "VKAS-" + (rideId != null ? rideId.substring(Math.max(0, rideId.length()-6)) : "RIDE");
                org.json.JSONObject body = new org.json.JSONObject();
                body.put("invoiceNumber", invNum);
                body.put("amount", String.format(java.util.Locale.US, "%.2f", price));
                body.put("customerName", a.name != null ? a.name : "");
                body.put("customerEmail", a.email != null ? a.email : "");
                body.put("description", "Funk Taxi Heringsdorf — " + (a.pickup != null ? a.pickup : "") + " → " + (a.destination != null ? a.destination : ""));
                if (a.id != null) body.put("anfrageId", a.id);

                java.net.URL url = new java.net.URL("https://europe-west1-taxi-heringsdorf.cloudfunctions.net/createStripeCheckout");
                java.net.HttpURLConnection conn = (java.net.HttpURLConnection) url.openConnection();
                conn.setRequestMethod("POST");
                conn.setRequestProperty("Content-Type", "application/json");
                conn.setDoOutput(true);
                conn.setConnectTimeout(15000);
                conn.setReadTimeout(30000);
                conn.getOutputStream().write(body.toString().getBytes("UTF-8"));

                int code = conn.getResponseCode();
                String resp = "";
                try {
                    java.io.InputStream is = code < 400 ? conn.getInputStream() : conn.getErrorStream();
                    if (is != null) { java.util.Scanner sc = new java.util.Scanner(is,"UTF-8").useDelimiter("\\A"); resp = sc.hasNext() ? sc.next() : ""; }
                } catch (Exception _re) {}
                conn.disconnect();

                final String _stripeUrl = code == 200 ? new org.json.JSONObject(resp).optString("url","") : "";
                // Stripe-URL in Firebase speichern
                if (!_stripeUrl.isEmpty() && rideId != null) {
                    java.util.Map<String,Object> _upd = new java.util.HashMap<>();
                    _upd.put("stripeCheckoutUrl", _stripeUrl);
                    _upd.put("stripePaymentStatus", "pending");
                    _upd.put("stripeCreatedAt", System.currentTimeMillis());
                    db.getReference("rides/" + rideId).updateChildren(_upd);
                }
                runOnUiThread(() -> _openWhatsAppBestaetigung(a, _stripeUrl));
            } catch (Throwable t) {
                runOnUiThread(() -> {
                    Toast.makeText(this, "❌ Stripe-Fehler: " + t.getMessage(), Toast.LENGTH_LONG).show();
                    _openWhatsAppBestaetigung(a, null); // Fallback: WA ohne Link
                });
            }
        }).start();
    }

    // 🆕 v6.63.533: Nach Übernahme — Preis bearbeiten + optional Stripe-Link senden
    // 🔧 v6.63.554: Preis-Feld hinzugefügt (Patrick: "irgendwo den Preis ändern können")
    private void showVorkasseEmailDialog(String rideId, Anfrage a, String pickupTime) {
        float dp = getResources().getDisplayMetrics().density;
        int pad = (int)(dp * 16);
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setPadding(pad, pad, pad, pad);

        android.widget.TextView info = new android.widget.TextView(this);
        info.setText("✅ Anfrage übernommen!\n\n" +
            (a.name != null ? "👤 " + a.name + "\n" : "") +
            (a.pickup != null ? "📍 " + a.pickup + "\n🎯 " + (a.destination != null ? a.destination : "?") : ""));
        info.setTextSize(14);
        info.setPadding(0, 0, 0, pad);
        layout.addView(info);

        // Preis-Feld
        android.widget.TextView priceLabel = new android.widget.TextView(this);
        priceLabel.setText("💰 Preis (€):");
        priceLabel.setTextSize(14);
        priceLabel.setTypeface(null, android.graphics.Typeface.BOLD);
        priceLabel.setPadding(0, 0, 0, pad / 4);
        layout.addView(priceLabel);

        EditText etPrice = new EditText(this);
        etPrice.setHint("z.B. 25.00");
        String _prePrice = "";
        if (a.price != null && !a.price.isEmpty() && !"—".equals(a.price)) {
            _prePrice = a.price.replace("€","").replace(",",".").trim();
        }
        etPrice.setText(_prePrice);
        etPrice.setInputType(android.text.InputType.TYPE_CLASS_NUMBER | android.text.InputType.TYPE_NUMBER_FLAG_DECIMAL);
        LinearLayout.LayoutParams _priceParams = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        _priceParams.setMargins(0, 0, 0, pad);
        etPrice.setLayoutParams(_priceParams);
        layout.addView(etPrice);

        // Email-Feld
        android.widget.TextView emailLabel = new android.widget.TextView(this);
        emailLabel.setText("📧 E-Mail (für Stripe-Link):");
        emailLabel.setTextSize(14);
        emailLabel.setTypeface(null, android.graphics.Typeface.BOLD);
        emailLabel.setPadding(0, 0, 0, pad / 4);
        layout.addView(emailLabel);

        EditText etEmail = new EditText(this);
        etEmail.setHint("E-Mail-Adresse");
        etEmail.setText(a.email != null ? a.email : "");
        etEmail.setInputType(android.text.InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS);
        layout.addView(etEmail);

        android.app.AlertDialog dlg = new android.app.AlertDialog.Builder(this)
            .setTitle("📋 Anfrage bestätigt")
            .setView(layout)
            .setPositiveButton("💳 Mit Stripe-Link senden", null)
            .setNegativeButton("⚪ Ohne Stripe bestätigen", (d, w) -> {
                // Preis in Firebase speichern wenn geändert
                String _skipPrice = etPrice.getText().toString().trim().replace(",",".");
                try {
                    double _pv = Double.parseDouble(_skipPrice);
                    if (_pv > 0) {
                        db.getReference("rides/" + rideId).updateChildren(
                            java.util.Collections.singletonMap("price", _pv));
                    }
                } catch (Throwable _pe) {}
                Toast.makeText(this, "✅ Anfrage übernommen (kein Stripe-Link)", Toast.LENGTH_SHORT).show();
            })
            .create();
        dlg.setOnShowListener(d -> {
            dlg.getButton(android.app.AlertDialog.BUTTON_POSITIVE).setOnClickListener(v -> {
                String email = etEmail.getText().toString().trim();
                if (!email.contains("@")) {
                    etEmail.setError("Ungültige E-Mail");
                    return;
                }
                String _priceInput = etPrice.getText().toString().trim().replace(",",".");
                double _updatedPrice = 0;
                try { _updatedPrice = Double.parseDouble(_priceInput); } catch (Throwable _pe) {}
                if (_updatedPrice < 0.5) {
                    etPrice.setError("Preis muss > 0 sein");
                    return;
                }
                // Preis in Firebase aktualisieren (falls geändert)
                final double _finalPrice = _updatedPrice;
                db.getReference("rides/" + rideId).updateChildren(
                    java.util.Collections.singletonMap("price", _finalPrice));
                dlg.dismiss();
                _sendVorkasseEmail(rideId, email, a.name,
                    String.format(java.util.Locale.US, "%.2f", _finalPrice),
                    a.pickup, a.destination, pickupTime, a.id);
            });
        });
        dlg.show();
    }

    // 🆕 v6.63.558: Pickup-Uhrzeit um deltaMs verschieben (Patrick 29.06. 19:39 Bridge)
    private void _shiftPickupTime(String rideId, Long currentTs, long deltaMs,
            java.util.concurrent.atomic.AtomicReference<AlertDialog> dlgRef) {
        if (rideId == null || currentTs == null) return;
        long newTs = currentTs + deltaMs;
        java.util.Calendar _cal = java.util.Calendar.getInstance(java.util.TimeZone.getTimeZone("Europe/Berlin"));
        _cal.setTimeInMillis(newTs);
        String newTime = String.format(java.util.Locale.GERMANY, "%02d:%02d",
            _cal.get(java.util.Calendar.HOUR_OF_DAY), _cal.get(java.util.Calendar.MINUTE));
        java.util.Map<String, Object> _upd = new java.util.HashMap<>();
        _upd.put("pickupTimestamp", newTs);
        _upd.put("pickupTime", newTime);
        _upd.put("updatedAt", System.currentTimeMillis());
        db.getReference("rides/" + rideId).updateChildren(_upd)
            .addOnSuccessListener(_t -> {
                Toast.makeText(this, "⏩ Uhrzeit → " + newTime, Toast.LENGTH_SHORT).show();
                if (dlgRef.get() != null) dlgRef.get().dismiss();
            })
            .addOnFailureListener(_e -> Toast.makeText(this, "❌ Fehler: " + _e.getMessage(), Toast.LENGTH_LONG).show());
    }

    // 🆕 v6.63.561: Admin-Suche — /rides + /archiveRides durchsuchen (Patrick 30.06.)
    private void performAdminSearch(String query) {
        String q = query.toLowerCase(Locale.GERMAN).trim();
        if (q.isEmpty()) return;
        Toast.makeText(this, "🔍 Suche läuft…", Toast.LENGTH_SHORT).show();
        List<Ride> _results = new ArrayList<>();
        db.getReference("rides").addListenerForSingleValueEvent(new ValueEventListener() {
            @Override public void onDataChange(@NonNull DataSnapshot s) {
                for (DataSnapshot c : s.getChildren()) {
                    Ride r = Ride.fromSnap(c);
                    if (r != null && _rideMatchesQuery(r, q)) _results.add(r);
                }
                db.getReference("archiveRides").orderByChild("pickupTimestamp")
                    .limitToLast(300).addListenerForSingleValueEvent(new ValueEventListener() {
                        @Override public void onDataChange(@NonNull DataSnapshot as) {
                            for (DataSnapshot c : as.getChildren()) {
                                Ride r = Ride.fromSnap(c);
                                if (r != null && _rideMatchesQuery(r, q)) _results.add(r);
                            }
                            java.util.Collections.sort(_results, (ra, rb) -> {
                                long ta = ra.pickupTimestamp != null ? ra.pickupTimestamp : 0;
                                long tb = rb.pickupTimestamp != null ? rb.pickupTimestamp : 0;
                                return Long.compare(tb, ta);
                            });
                            runOnUiThread(() -> _showAdminSearchResultsDialog(_results, query));
                        }
                        @Override public void onCancelled(@NonNull DatabaseError e) {
                            runOnUiThread(() -> _showAdminSearchResultsDialog(_results, query));
                        }
                    });
            }
            @Override public void onCancelled(@NonNull DatabaseError e) {
                Toast.makeText(AdminDashboardActivity.this, "Suche fehlgeschlagen: " + e.getMessage(), Toast.LENGTH_LONG).show();
            }
        });
    }

    private boolean _rideMatchesQuery(Ride r, String q) {
        String[] tokens = q.split("\\s+");
        String haystack = (
            (r.customerName != null ? r.customerName : "") + " " +
            (r.guestName != null ? r.guestName : "") + " " +
            (r.pickup != null ? r.pickup : "") + " " +
            (r.destination != null ? r.destination : "") + " " +
            (r.customerPhone != null ? r.customerPhone : "") + " " +
            (r.notes != null ? r.notes : "") + " " +
            (r.pickupTime != null ? r.pickupTime : "")
        ).toLowerCase(Locale.GERMAN);
        for (String t : tokens) { if (!haystack.contains(t)) return false; }
        return true;
    }

    private void _showAdminSearchResultsDialog(List<Ride> results, String query) {
        if (results.isEmpty()) {
            Toast.makeText(this, "Keine Fahrten gefunden für: " + query, Toast.LENGTH_LONG).show();
            return;
        }
        AlertDialog.Builder b = new AlertDialog.Builder(this);
        b.setTitle("🔍 " + results.size() + " Ergebnis(se) — " + query);
        ScrollView sv = new ScrollView(this);
        LinearLayout ll = new LinearLayout(this);
        ll.setOrientation(LinearLayout.VERTICAL);
        int px8 = (int)(8 * getResources().getDisplayMetrics().density);
        ll.setPadding(px8 * 2, px8, px8 * 2, px8);
        sv.addView(ll);
        SimpleDateFormat sdf = new SimpleDateFormat("EE dd.MM. HH:mm", Locale.GERMAN);
        for (Ride r : results) {
            LinearLayout card = new LinearLayout(this);
            card.setOrientation(LinearLayout.VERTICAL);
            card.setBackgroundColor(0xFF1E293B);
            int px12 = (int)(12 * getResources().getDisplayMetrics().density);
            card.setPadding(px12, px12, px12, px12);
            LinearLayout.LayoutParams cp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
            cp.setMargins(0, 0, 0, px8);
            card.setLayoutParams(cp);
            // Name + Datum
            TextView tvName = new TextView(this);
            String dateStr = r.pickupTimestamp != null
                ? sdf.format(new Date(r.pickupTimestamp))
                : (r.pickupTime != null ? r.pickupTime : "?");
            String nameStr = (r.customerName != null ? r.customerName : "?")
                + (r.guestName != null && !r.guestName.isEmpty() ? " / " + r.guestName : "");
            tvName.setText("👤 " + nameStr + "  •  " + dateStr);
            tvName.setTextColor(0xFFF8FAFC);
            tvName.setTextSize(13f);
            tvName.setTypeface(null, android.graphics.Typeface.BOLD);
            card.addView(tvName);
            // Route
            TextView tvRoute = new TextView(this);
            tvRoute.setText("📍 " + (r.pickup != null ? r.pickup : "?") + "\n→ " + (r.destination != null ? r.destination : "?"));
            tvRoute.setTextColor(0xFF94A3B8);
            tvRoute.setTextSize(12f);
            LinearLayout.LayoutParams rp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
            rp.setMargins(0, (int)(4 * getResources().getDisplayMetrics().density), 0, (int)(8 * getResources().getDisplayMetrics().density));
            tvRoute.setLayoutParams(rp);
            card.addView(tvRoute);
            // Pax + Preis
            StringBuilder extra = new StringBuilder();
            if (r.passengers != null) extra.append(r.passengers).append(" Pax");
            if (r.price != null) {
                if (extra.length() > 0) extra.append(" • ");
                extra.append(String.format(Locale.GERMANY, "%.0f €", r.price));
            }
            if (extra.length() > 0) {
                TextView tvExtra = new TextView(this);
                tvExtra.setText(extra.toString());
                tvExtra.setTextColor(0xFF64748B);
                tvExtra.setTextSize(11f);
                card.addView(tvExtra);
            }
            // 🆕 v6.63.589: Erneut buchen + Bearbeiten nebeneinander
            final Ride rFinal = r;
            LinearLayout btnRow = new LinearLayout(this);
            btnRow.setOrientation(LinearLayout.HORIZONTAL);
            int _dp = (int) getResources().getDisplayMetrics().density;
            LinearLayout.LayoutParams rowLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
            rowLp.setMargins(0, 8 * _dp, 0, 0);
            btnRow.setLayoutParams(rowLp);
            btnRow.setWeightSum(2f);

            MaterialButton btnRebook = new MaterialButton(this);
            btnRebook.setText("🔄 Erneut buchen");
            btnRebook.setTextSize(11f);
            btnRebook.setTextColor(0xFFFFFFFF);
            try { btnRebook.setBackgroundTintList(android.content.res.ColorStateList.valueOf(0xFF7C3AED)); } catch (Throwable _t) {}
            LinearLayout.LayoutParams bp = new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
            bp.setMargins(0, 0, 4 * _dp, 0);
            btnRebook.setLayoutParams(bp);
            btnRebook.setOnClickListener(v -> _rebookRide(rFinal));
            btnRow.addView(btnRebook);

            MaterialButton btnEdit = new MaterialButton(this);
            btnEdit.setText("✏️ Bearbeiten");
            btnEdit.setTextSize(11f);
            btnEdit.setTextColor(0xFFFFFFFF);
            try { btnEdit.setBackgroundTintList(android.content.res.ColorStateList.valueOf(0xFF1D4ED8)); } catch (Throwable _t) {}
            LinearLayout.LayoutParams ep = new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
            btnEdit.setLayoutParams(ep);
            btnEdit.setOnClickListener(v -> {
                if (_currentSearchDialog != null && _currentSearchDialog.isShowing()) {
                    _currentSearchDialog.dismiss();
                    _currentSearchDialog = null;
                }
                showEditRideDialog(rFinal);
            });
            btnRow.addView(btnEdit);
            card.addView(btnRow);
            ll.addView(card);
        }
        b.setView(sv);
        b.setNegativeButton("Schließen", null);
        _currentSearchDialog = b.show();
    }

    // 🔧 v6.63.564: Öffnet die schöne CrmSearch-Vorbestellungsmaske statt hässlichem Edit-Dialog.
    //   Patrick 30.06.: "Das ist die hässliche Vorbestellungsmaske."
    //   Für Rides aus /rides → auto_template_ride_id direkt (CrmSearchActivity kennt die ID).
    //   Für Rides aus /archiveRides → push temp-Vorlage in /rides, CrmSearch lädt sie von dort.
    //   In CrmSearchActivity wurde _runPendingTemplateIfReady erweitert um /archiveRides als Fallback.
    private void _rebookRide(Ride template) {
        if (template == null || template.id == null) return;
        // Dialog schließen bevor wir CrmSearchActivity starten
        if (_currentSearchDialog != null && _currentSearchDialog.isShowing()) {
            _currentSearchDialog.dismiss();
            _currentSearchDialog = null;
        }
        // Prüfen ob Fahrt noch in /rides ist (activeRides enthält sie)
        boolean inActiveRides = false;
        for (Ride _cr : _currentRides) {
            if (template.id.equals(_cr.id)) { inActiveRides = true; break; }
        }
        if (inActiveRides) {
            // Direkt CrmSearchActivity mit originalem Ride-ID starten → schöne Maske
            Intent i = new Intent(this, CrmSearchActivity.class);
            i.putExtra("auto_template_ride_id", template.id);
            startActivity(i);
        } else {
            // Archiv-Ride: Vorlage temporär in /rides pushen, damit CrmSearchActivity sie findet
            Map<String, Object> _tmp = new HashMap<>();
            _tmp.put("customerName", template.customerName != null ? template.customerName : "");
            if (template.customerPhone != null) _tmp.put("customerPhone", template.customerPhone);
            if (template.customerEmail != null) _tmp.put("customerEmail", template.customerEmail);
            if (template.customerId != null) _tmp.put("customerId", template.customerId);
            if (template.guestName != null) _tmp.put("guestName", template.guestName);
            _tmp.put("pickup", template.pickup != null ? template.pickup : "");
            _tmp.put("destination", template.destination != null ? template.destination : "");
            if (template.pickupLat != null) _tmp.put("pickupLat", template.pickupLat);
            if (template.pickupLon != null) _tmp.put("pickupLon", template.pickupLon);
            if (template.destinationLat != null) _tmp.put("destinationLat", template.destinationLat);
            if (template.destinationLon != null) _tmp.put("destinationLon", template.destinationLon);
            if (template.passengers != null) _tmp.put("passengers", template.passengers);
            if (template.price != null) _tmp.put("price", template.price);
            if (template.notes != null) _tmp.put("notes", template.notes);
            _tmp.put("status", "template_draft");
            _tmp.put("_rebookTemplate", true);
            _tmp.put("createdAt", System.currentTimeMillis());
            DatabaseReference _ref = db.getReference("rides").push();
            String _tmpId = _ref.getKey();
            _ref.setValue(_tmp)
                .addOnSuccessListener(_t -> {
                    Intent i = new Intent(this, CrmSearchActivity.class);
                    i.putExtra("auto_template_ride_id", _tmpId);
                    startActivity(i);
                })
                .addOnFailureListener(_e -> Toast.makeText(this,
                    "❌ Vorlage laden fehlgeschlagen: " + _e.getMessage(), Toast.LENGTH_LONG).show());
        }
    }

    private void _sendVorkasseEmail(String rideId, String email, String name, String amount, String pickup, String destination, String pickupTime, String anfrageId) {
        Toast.makeText(this, "⏳ Stripe-Link wird erstellt...", Toast.LENGTH_SHORT).show();
        new Thread(() -> {
            try {
                org.json.JSONObject body = new org.json.JSONObject();
                body.put("rideId", rideId != null ? rideId : "");
                body.put("toEmail", email);
                body.put("toName", name != null ? name : "");
                body.put("amount", amount != null ? amount.replace("€","").replace(",",".").trim() : "0");
                body.put("pickup", pickup != null ? pickup : "");
                body.put("destination", destination != null ? destination : "");
                body.put("pickupTime", pickupTime != null ? pickupTime : "");
                if (anfrageId != null) body.put("anfrageId", anfrageId);

                java.net.URL url = new java.net.URL("https://europe-west1-taxi-heringsdorf.cloudfunctions.net/sendVorkasseEmail");
                java.net.HttpURLConnection conn = (java.net.HttpURLConnection) url.openConnection();
                conn.setRequestMethod("POST");
                conn.setRequestProperty("Content-Type", "application/json");
                conn.setDoOutput(true);
                conn.setConnectTimeout(15000);
                conn.setReadTimeout(30000);
                byte[] _b = body.toString().getBytes("UTF-8");
                conn.getOutputStream().write(_b);

                int code = conn.getResponseCode();
                String resp = "";
                try {
                    java.io.InputStream is = code < 400 ? conn.getInputStream() : conn.getErrorStream();
                    if (is != null) {
                        java.util.Scanner sc = new java.util.Scanner(is, "UTF-8").useDelimiter("\\A");
                        resp = sc.hasNext() ? sc.next() : "";
                    }
                } catch (Exception _re) {}
                conn.disconnect();

                final boolean ok = code == 200;
                final String _resp = resp;
                runOnUiThread(() -> {
                    if (ok) {
                        Toast.makeText(this, "✅ Stripe-Link erstellt + E-Mail an " + email + " gesendet!", Toast.LENGTH_LONG).show();
                    } else {
                        Toast.makeText(this, "❌ Fehler (" + code + "): " + _resp.substring(0, Math.min(_resp.length(), 100)), Toast.LENGTH_LONG).show();
                    }
                });
            } catch (Throwable t) {
                runOnUiThread(() -> Toast.makeText(this, "❌ Netzwerk-Fehler: " + t.getMessage(), Toast.LENGTH_LONG).show());
            }
        }).start();
    }

    // 🆕 v6.63.534: Rechnung an Auftraggeber — PDF-Vorschau + Email-Versand nativ
    private void showInvoiceEmailDialog(Ride r) {
        float dp = getResources().getDisplayMetrics().density;
        int pad = (int)(dp * 16);
        int padSm = (int)(dp * 8);

        // BottomSheetDialog für mehr Höhe (Vorschau braucht Platz)
        com.google.android.material.bottomsheet.BottomSheetDialog sheet =
            new com.google.android.material.bottomsheet.BottomSheetDialog(this);

        android.widget.ScrollView sv = new android.widget.ScrollView(this);
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setPadding(pad, pad, pad, pad);
        sv.addView(layout);

        // Header
        android.widget.TextView tvTitle = new android.widget.TextView(this);
        tvTitle.setText("🧾 Rechnung " + r.invoiceNumber + " per E-Mail senden");
        tvTitle.setTextSize(17);
        tvTitle.setTextColor(android.graphics.Color.parseColor("#111827"));
        tvTitle.setTypeface(null, android.graphics.Typeface.BOLD);
        LinearLayout.LayoutParams _titleP = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        _titleP.setMargins(0, 0, 0, padSm);
        tvTitle.setLayoutParams(_titleP);
        layout.addView(tvTitle);

        // v6.63.676 (Patrick 10.07. 15:12 Bridge: "Rechnung an Auftraggeber ist zu
        //   kompliziert. Ich will nur diese PDF an die Email angehängt haben, mehr nicht."):
        //   Dialog radikal vereinfacht — nur noch Betrag+Kunde (eine Zeile) + Empfänger-Feld
        //   + Send-Button. Betreff wird automatisch gesetzt (Cloud-Function-Default:
        //   "Rechnung {invoiceNumber}"). Keine Route, keine PDF-Vorschau, kein Betreff-Feld.
        double _invAmt = r.actualPrice != null ? r.actualPrice : (r.price != null ? r.price : 0.0);
        android.widget.TextView tvSum = new android.widget.TextView(this);
        String _sumTxt = String.format(Locale.GERMANY, "💰 %.2f €", _invAmt);
        if (r.customerName != null) _sumTxt += "  · 👤 " + r.customerName;
        if (r.invoicePdfUrl == null || r.invoicePdfUrl.isEmpty()) {
            _sumTxt += "  ⚠️ KEIN PDF — Send wird fehlschlagen";
        }
        tvSum.setText(_sumTxt);
        tvSum.setTextSize(15);
        tvSum.setTextColor(android.graphics.Color.parseColor("#111827"));
        tvSum.setPadding(0, 0, 0, pad);
        layout.addView(tvSum);

        // E-Mail-Empfänger
        android.widget.TextView tvEmailLabel = new android.widget.TextView(this);
        tvEmailLabel.setText("An:");
        tvEmailLabel.setTextSize(13);
        tvEmailLabel.setTextColor(android.graphics.Color.parseColor("#6b7280"));
        layout.addView(tvEmailLabel);

        EditText etEmail = new EditText(this);
        etEmail.setHint("E-Mail-Adresse des Auftraggebers");
        etEmail.setInputType(android.text.InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS);
        // Vorausfüllen wenn vorhanden (customerEmail aus Ride, z.B. Hotel-Email)
        if (r.customerEmail != null && r.customerEmail.contains("@")) {
            etEmail.setText(r.customerEmail);
        }
        LinearLayout.LayoutParams _emailP = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        _emailP.setMargins(0, 0, 0, pad);
        etEmail.setLayoutParams(_emailP);
        layout.addView(etEmail);

        // v6.63.676: Betreff-Feld ENTFERNT — Cloud-Function setzt automatisch
        // "Rechnung {invoiceNumber}" wenn subject leer. Weniger UI, weniger Klicks.
        final String _autoSubject = "Rechnung " + r.invoiceNumber + " – Funk Taxi Wydra";

        // v6.63.676 (Patrick 10.07. 15:14 Bridge: "Formular öffnen wo drin steht
        //   sehr geehrte..."): editierbares Anschreiben-Feld mit sinnvollem Default.
        android.widget.TextView tvBodyLabel = new android.widget.TextView(this);
        tvBodyLabel.setText("Text:");
        tvBodyLabel.setTextSize(13);
        tvBodyLabel.setTextColor(android.graphics.Color.parseColor("#6b7280"));
        layout.addView(tvBodyLabel);

        EditText etBody = new EditText(this);
        etBody.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_FLAG_MULTI_LINE);
        etBody.setMinLines(5);
        etBody.setGravity(android.view.Gravity.TOP | android.view.Gravity.START);
        String _empfName = (r.customerName != null && !r.customerName.isEmpty()) ? r.customerName : "Damen und Herren";
        String _bodyDefault = "Sehr geehrte " + _empfName + ",\n\n"
            + "im Anhang finden Sie die Rechnung " + r.invoiceNumber
            + " über " + String.format(Locale.GERMANY, "%.2f €", _invAmt) + ".\n\n"
            + "Vielen Dank für Ihre Buchung.\n\n"
            + "Mit freundlichen Grüßen\n"
            + "Patrick Wydra\n"
            + "Funk Taxi Heringsdorf";
        etBody.setText(_bodyDefault);
        LinearLayout.LayoutParams _bodyP = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        _bodyP.setMargins(0, 0, 0, pad);
        etBody.setLayoutParams(_bodyP);
        layout.addView(etBody);

        // Senden-Button
        com.google.android.material.button.MaterialButton btnSend =
            new com.google.android.material.button.MaterialButton(this);
        btnSend.setText("📧 Rechnung jetzt senden");
        btnSend.setTextSize(16);
        btnSend.setBackgroundColor(android.graphics.Color.parseColor("#059669"));
        btnSend.setTextColor(android.graphics.Color.WHITE);
        LinearLayout.LayoutParams _sendP = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        _sendP.setMargins(0, 0, 0, padSm);
        btnSend.setLayoutParams(_sendP);
        btnSend.setOnClickListener(_v -> {
            String email = etEmail.getText().toString().trim();
            if (!email.contains("@")) {
                etEmail.setError("Ungültige E-Mail-Adresse");
                return;
            }
            String bodyText = etBody.getText().toString().trim();
            sheet.dismiss();
            _sendInvoiceEmail(r, email, _autoSubject, bodyText);
        });
        layout.addView(btnSend);

        // Abbrechen
        com.google.android.material.button.MaterialButton btnCancel =
            new com.google.android.material.button.MaterialButton(this);
        btnCancel.setText("Abbrechen");
        btnCancel.setTextSize(15);
        btnCancel.setBackgroundColor(android.graphics.Color.parseColor("#6b7280"));
        btnCancel.setTextColor(android.graphics.Color.WHITE);
        btnCancel.setLayoutParams(new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));
        btnCancel.setOnClickListener(_v -> sheet.dismiss());
        layout.addView(btnCancel);

        sheet.setContentView(sv);
        // BottomSheet so hoch wie möglich aufziehen
        sheet.setOnShowListener(d -> {
            com.google.android.material.bottomsheet.BottomSheetBehavior<?> bsb =
                com.google.android.material.bottomsheet.BottomSheetBehavior.from(
                    (android.view.View) sv.getParent());
            bsb.setState(com.google.android.material.bottomsheet.BottomSheetBehavior.STATE_EXPANDED);
        });
        sheet.show();
    }

    private void _sendInvoiceEmail(Ride r, String toEmail, String subject, String bodyText) {
        Toast.makeText(this, "⏳ Rechnung wird gesendet...", Toast.LENGTH_SHORT).show();
        new Thread(() -> {
            try {
                org.json.JSONObject body = new org.json.JSONObject();
                body.put("invoiceNumber", r.invoiceNumber);
                body.put("toEmail", toEmail);
                if (r.customerName != null) body.put("toName", r.customerName);
                if (subject != null && !subject.isEmpty()) body.put("subject", subject);
                // v6.63.676: htmlBody aus dem editierten Formular-Text (Zeilenumbrüche → <br>)
                if (bodyText != null && !bodyText.isEmpty()) {
                    String _html = bodyText.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\n", "<br>");
                    body.put("htmlBody", "<div style=\"font-family:Arial,sans-serif;font-size:14px;line-height:1.5;color:#111\">" + _html + "</div>");
                }
                if (r.invoicePdfUrl != null && !r.invoicePdfUrl.isEmpty()) {
                    body.put("pdfUrl", r.invoicePdfUrl);
                    body.put("attachPdf", true);
                }

                java.net.URL url = new java.net.URL(
                    "https://europe-west1-taxi-heringsdorf.cloudfunctions.net/sendInvoiceEmail");
                java.net.HttpURLConnection conn = (java.net.HttpURLConnection) url.openConnection();
                conn.setRequestMethod("POST");
                conn.setRequestProperty("Content-Type", "application/json");
                conn.setDoOutput(true);
                conn.setConnectTimeout(15000);
                conn.setReadTimeout(30000);
                conn.getOutputStream().write(body.toString().getBytes("UTF-8"));

                int code = conn.getResponseCode();
                String resp = "";
                try {
                    java.io.InputStream is = code < 400 ? conn.getInputStream() : conn.getErrorStream();
                    if (is != null) {
                        java.util.Scanner sc = new java.util.Scanner(is, "UTF-8").useDelimiter("\\A");
                        resp = sc.hasNext() ? sc.next() : "";
                    }
                } catch (Exception _re) {}
                conn.disconnect();

                final boolean ok = code == 200;
                final String _resp = resp;
                final String _email = toEmail;
                runOnUiThread(() -> {
                    if (ok) {
                        Toast.makeText(this,
                            "✅ Rechnung " + r.invoiceNumber + " an " + _email + " gesendet!",
                            Toast.LENGTH_LONG).show();
                    } else {
                        Toast.makeText(this,
                            "❌ Fehler (" + code + "): " + _resp.substring(0, Math.min(_resp.length(), 120)),
                            Toast.LENGTH_LONG).show();
                    }
                });
            } catch (Throwable t) {
                runOnUiThread(() -> Toast.makeText(this,
                    "❌ Netzwerk-Fehler: " + t.getMessage(), Toast.LENGTH_LONG).show());
            }
        }).start();
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
        String id, customerName, customerPhone, customerEmail, pickup, destination, pickupTime, status;
        // 🆕 v6.63.092: Bezahlt-Badge
        String paymentStatus, paymentMethod;
        Double stripePaidAmount;
        Boolean vorkasseRequested;
        // 🆕 v6.63.503: Felder für Edit-Dialog (fehlten bisher)
        String guestName, notes;
        Double price, actualPrice;
        String assignedVehicle; // v6.62.193: Patrick: "autos kann ich auch nicht zuweisen"
        String assignedVehicleName; // v6.62.636: Patrick (12.05. 09:05): "welches Fahrzeug ist vorgesehen"
        // v6.63.671 (Patrick 10.07. 11:09 Bridge: "Assigned ist nur wenn der Fahrer wirklich
        //   bestätigt hat. Wenn nicht, ist es nur VORGESEHEN"): Wir brauchen acceptedAt +
        //   assignedAt um die zwei Zustände in der Dispo klar zu unterscheiden.
        //   Koch-Fall 10.07.: assignedAt=06:39 aber acceptedAt=null bei Pickup 10:00 —
        //   Watchdog griff nicht weil msUntil<0, Banner zeigte nichts.
        Long assignedAt;
        Long acceptedAt;
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
        // 🆕 v6.63.191 (Patrick 06.06. 10:17): Wartepool-Konflikt-Anzeige.
        //   Patrick: "Bei Hache wird nichts angezeigt wo der Konflikt herkommt."
        //   Hache hatte wartepoolReason='auto-assign-3x-failed', reassignReason
        //   ='Vito Schicht-Ende — automatische Umverteilung' + assignedVehicleName
        //   noch im Ride — aber Dispo zeigt nur "WARTEPOOL". Felder muessen sichtbar werden.
        String wartepoolReason;
        String reassignReason;
        Integer autoAssignAttempts;
        Long wartepoolAt;
        // 🆕 v6.63.359 (Patrick 16.06. 11:17 Bridge: 'Ich sehe nirgendwo ob ein
        //   Fahrzeug gelockt ist oder nicht. In der Disposition sehe ich es nicht.'):
        //   lockedBy + lockedAt sichtbar machen damit Patrick auf einen Blick
        //   sieht WER eine Fahrt gelockt hat und WANN.
        String lockedBy;
        Long lockedAt;
        // 🆕 v6.63.355 (Patrick 16.06. 07:33 Bridge "Ich will die perfekte Übersicht"):
        //   Cloud-Function schreibt bei jedem Auto-Assign-Lauf eine Klartext-Begründung
        //   in autoAssignLastReason ("6 Fahrzeuge gepr.: 3× Di nicht aktiv | 2× außerhalb
        //   Schicht | 1× Zeitkonflikt: Nayef 07:30") + detaillierte vehicleScores pro
        //   Auto. Beide Felder sollen in der Wartepool-Karte sichtbar werden damit
        //   Patrick die echte Cloud-Diagnose sieht statt nur "auto-assign-3x-failed".
        String autoAssignLastReason;
        java.util.Map<String, java.util.Map<String, Object>> vehicleScores;
        // v6.62.193: Patrick (01.05.): "Zwischenstops nicht angezeigt im kalender nativ app".
        // Waypoints fuer Sammeltransfers (Vetter Touristik) — addr + Pax-Name pro Stop.
        java.util.List<String> waypointDisplay; // formatierte Anzeige-Strings ("Adresse — Pax-Name")
        // 🆕 v6.63.534: Rechnung-an-Auftraggeber — Email-Dialog direkt aus Native-App
        String invoiceNumber;
        String customerId;
        String invoicePdfUrl;
        // 🆕 v6.63.639: Auftraggeber-Email-Lookup (Hotel/Firma bucht für Gast)
        String auftraggeberId;
        Boolean isAuftraggeberBooking;

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
                r.customerEmail = s.child("customerEmail").getValue(String.class);
                // 🆕 v6.63.092: Bezahlt-Badge
                r.paymentStatus = s.child("paymentStatus").getValue(String.class);
                r.paymentMethod = s.child("paymentMethod").getValue(String.class);
                Object _spa = s.child("stripePaidAmount").getValue();
                if (_spa instanceof Number) r.stripePaidAmount = ((Number) _spa).doubleValue();
                Object _vor = s.child("_vorkasseRequested").getValue();
                if (_vor instanceof Boolean) r.vorkasseRequested = (Boolean) _vor;
                r.guestName = s.child("guestName").getValue(String.class);
                r.notes = s.child("notes").getValue(String.class);
                Object _pr = s.child("actualPrice").getValue();
                if (_pr == null) _pr = s.child("price").getValue();
                if (_pr instanceof Number) { r.actualPrice = ((Number)_pr).doubleValue(); r.price = r.actualPrice; }
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
                // v6.63.671: assignedAt/acceptedAt für "vorgesehen vs. bestätigt"
                Object _aat = s.child("assignedAt").getValue();
                if (_aat instanceof Number) r.assignedAt = ((Number)_aat).longValue();
                Object _cat = s.child("acceptedAt").getValue();
                if (_cat instanceof Number) r.acceptedAt = ((Number)_cat).longValue();
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
                // 🆕 v6.63.359: Lock-Diagnose-Felder
                r.lockedBy = s.child("lockedBy").getValue(String.class);
                Object _lockAt = s.child("lockedAt").getValue();
                if (_lockAt instanceof Number) r.lockedAt = ((Number)_lockAt).longValue();
                // v6.63.191: Wartepool-Diagnose-Felder
                r.wartepoolReason = s.child("wartepoolReason").getValue(String.class);
                r.reassignReason = s.child("reassignReason").getValue(String.class);
                Object _aaa = s.child("autoAssignAttempts").getValue();
                if (_aaa instanceof Number) r.autoAssignAttempts = ((Number)_aaa).intValue();
                Object _wpA = s.child("wartepoolAt").getValue();
                if (_wpA instanceof Number) r.wartepoolAt = ((Number)_wpA).longValue();
                // 🆕 v6.63.355: Cloud-Auto-Assign-Diagnose-Felder
                r.autoAssignLastReason = s.child("autoAssignLastReason").getValue(String.class);
                DataSnapshot _vsSnap = s.child("vehicleScores");
                if (_vsSnap.exists() && _vsSnap.hasChildren()) {
                    r.vehicleScores = new java.util.HashMap<>();
                    for (DataSnapshot _vSnap : _vsSnap.getChildren()) {
                        java.util.Map<String, Object> _info = new java.util.HashMap<>();
                        _info.put("reason", _vSnap.child("reason").getValue(String.class));
                        _info.put("status", _vSnap.child("status").getValue(String.class));
                        _info.put("check", _vSnap.child("check").getValue(String.class));
                        String _shiftTimes355 = _vSnap.child("shiftDetails/shiftTimes").getValue(String.class);
                        if (_shiftTimes355 != null) _info.put("shiftTimes", _shiftTimes355);
                        String _blkTime355 = _vSnap.child("blockingRideTime").getValue(String.class);
                        if (_blkTime355 != null) _info.put("blockingRideTime", _blkTime355);
                        r.vehicleScores.put(_vSnap.getKey(), _info);
                    }
                }
                // 🆕 v6.63.534: Rechnungs-Felder für Email-Dialog
                r.invoiceNumber = s.child("invoiceNumber").getValue(String.class);
                r.customerId = s.child("customerId").getValue(String.class);
                r.invoicePdfUrl = s.child("invoicePdfUrl").getValue(String.class);
                if (r.invoicePdfUrl == null) r.invoicePdfUrl = s.child("pdfUrl").getValue(String.class);
                // 🆕 v6.63.639: Auftraggeber-Felder
                r.auftraggeberId = s.child("_auftraggeberId").getValue(String.class);
                Object _isAuftr = s.child("_isAuftraggeberBooking").getValue();
                r.isAuftraggeberBooking = _isAuftr instanceof Boolean ? (Boolean) _isAuftr : null;
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
                // 🆕 v6.63.667: eigenes Layout (statt simple_list_item_2) damit Rückfahrt-Button rein kann
                android.widget.LinearLayout _aRoot = new android.widget.LinearLayout(p.getContext());
                _aRoot.setOrientation(android.widget.LinearLayout.VERTICAL);
                _aRoot.setBackgroundColor(Color.parseColor("#7C2D12"));
                _aRoot.setPadding(24, 24, 24, 24);
                _aRoot.setLayoutParams(new RecyclerView.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
                TextView _at1 = new TextView(p.getContext());
                _at1.setTextSize(14);
                _at1.setTextColor(Color.parseColor("#FED7AA"));
                _aRoot.addView(_at1, new android.widget.LinearLayout.LayoutParams(
                    android.widget.LinearLayout.LayoutParams.MATCH_PARENT,
                    android.widget.LinearLayout.LayoutParams.WRAP_CONTENT));
                TextView _at2 = new TextView(p.getContext());
                _at2.setTextSize(12);
                _at2.setTextColor(Color.parseColor("#FBA74D"));
                _at2.setPadding(0, 6, 0, 0);
                _aRoot.addView(_at2, new android.widget.LinearLayout.LayoutParams(
                    android.widget.LinearLayout.LayoutParams.MATCH_PARENT,
                    android.widget.LinearLayout.LayoutParams.WRAP_CONTENT));
                // Rückfahrt-Badge (default GONE, zeigt erkannte Rückfahrt-Info)
                TextView _aRf = new TextView(p.getContext());
                _aRf.setTextSize(12);
                _aRf.setTextColor(Color.parseColor("#FDE68A"));
                _aRf.setBackgroundColor(Color.parseColor("#92400E"));
                _aRf.setPadding(12, 6, 12, 6);
                android.widget.LinearLayout.LayoutParams _aRfLp =
                    new android.widget.LinearLayout.LayoutParams(
                        android.widget.LinearLayout.LayoutParams.MATCH_PARENT,
                        android.widget.LinearLayout.LayoutParams.WRAP_CONTENT);
                _aRfLp.topMargin = 10;
                _aRf.setLayoutParams(_aRfLp);
                _aRf.setVisibility(View.GONE);
                _aRoot.addView(_aRf);
                return new AnfrageVH(_aRoot, _at1, _at2, _aRf);
            }
            // 🆕 v6.63.566: Statt simple_list_item_2 → eigenes LinearLayout damit
            //   Wartepool-Diagnose einklappbar (tvWpToggle + tvWpDiag als dritte Ebene)
            android.widget.LinearLayout _rideRoot = new android.widget.LinearLayout(p.getContext());
            _rideRoot.setOrientation(android.widget.LinearLayout.VERTICAL);
            _rideRoot.setBackgroundColor(Color.parseColor("#1E293B"));
            _rideRoot.setPadding(24, 24, 24, 24);
            _rideRoot.setLayoutParams(new RecyclerView.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
            TextView _rt1 = new TextView(p.getContext());
            _rt1.setTextSize(14);
            _rt1.setTextColor(Color.parseColor("#F8FAFC"));
            _rideRoot.addView(_rt1, new android.widget.LinearLayout.LayoutParams(
                android.widget.LinearLayout.LayoutParams.MATCH_PARENT,
                android.widget.LinearLayout.LayoutParams.WRAP_CONTENT));
            TextView _rt2 = new TextView(p.getContext());
            _rt2.setTextSize(12);
            _rt2.setTextColor(Color.parseColor("#94A3B8"));
            _rt2.setPadding(0, 6, 0, 0);
            _rideRoot.addView(_rt2, new android.widget.LinearLayout.LayoutParams(
                android.widget.LinearLayout.LayoutParams.MATCH_PARENT,
                android.widget.LinearLayout.LayoutParams.WRAP_CONTENT));
            // Toggle-Button für Wartepool-Diagnose (default GONE, nur sichtbar bei wartepool)
            TextView _rtToggle = new TextView(p.getContext());
            _rtToggle.setTextSize(12);
            _rtToggle.setTextColor(Color.parseColor("#FBBF24"));
            _rtToggle.setPadding(0, 8, 0, 4);
            _rtToggle.setVisibility(View.GONE);
            _rideRoot.addView(_rtToggle);
            // Diagnose-Inhalt (default GONE, wird per Toggle ein-/ausgeklappt)
            TextView _rtDiag = new TextView(p.getContext());
            _rtDiag.setTextSize(11);
            _rtDiag.setTextColor(Color.parseColor("#FCA5A5"));
            _rtDiag.setPadding(0, 4, 0, 0);
            _rtDiag.setVisibility(View.GONE);
            _rideRoot.addView(_rtDiag);
            return new RideVH(_rideRoot, _rt1, _rt2, _rtToggle, _rtDiag);
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
        //   v6.63.668: Rückfahrt-Badge in Karte + Tap-Dialog "Beide / Nur Hinfahrt / Abbrechen"
        class AnfrageVH extends RecyclerView.ViewHolder {
            TextView t1, t2, tvRueckfahrt;
            AnfrageVH(View v, TextView _t1, TextView _t2, TextView _rf) {
                super(v);
                t1 = _t1;
                t2 = _t2;
                tvRueckfahrt = _rf;
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
                // 🆕 v6.63.668: Rückfahrt-Badge + Tap öffnet Auswahl-Dialog
                RueckfahrtHint _rfHint = _detectRueckfahrt(a.notes);
                if (_rfHint != null) {
                    tvRueckfahrt.setText("📅 Rückfahrt erkannt: " + _rfHint.dateStr + " " + _rfHint.timeStr
                        + " Uhr  →  tippen zum Übernehmen");
                    tvRueckfahrt.setVisibility(View.VISIBLE);
                    itemView.setOnClickListener(_v -> {
                        String _h40pick = a.pickup      != null ? (a.pickup.length()      > 40 ? a.pickup.substring(0,40)+"…"      : a.pickup)      : "?";
                        String _h40dest = a.destination != null ? (a.destination.length() > 40 ? a.destination.substring(0,40)+"…" : a.destination) : "?";
                        int _pax = a.passengers != null ? a.passengers : 1;
                        new AlertDialog.Builder(AdminDashboardActivity.this)
                            .setTitle("📥 " + (a.name != null ? a.name : "Anfrage") + " — was übernehmen?")
                            .setMessage(
                                "🚕 Hinfahrt:\n  " + a.date + " " + a.time + "\n  📍 " + _h40pick + "\n  🎯 " + _h40dest
                                + "\n\n📅 Rückfahrt:\n  " + _rfHint.dateStr + " " + _rfHint.timeStr
                                + "\n  📍 " + _h40dest + "\n  🎯 " + _h40pick
                                + "\n\n👤 " + _pax + " Pax")
                            .setPositiveButton("✅ Beide übernehmen", (d2, w2) -> {
                                _createRueckfahrtRide(a, null, _rfHint);
                                _uebernehmeAnfrageImpl(a);
                            })
                            .setNeutralButton("🚕 Nur Hinfahrt", (d2, w2) ->
                                _uebernehmeAnfrageImpl(a))
                            // v6.63.670 (Patrick 10.07. 07:08): Ablehnen muss auf jeder Anfrage-Karte klar erreichbar sein
                            .setNegativeButton("❌ Ablehnen", (d2, w2) -> {
                                db.getReference("anfragen/" + a.id + "/status").setValue("abgelehnt");
                                Toast.makeText(AdminDashboardActivity.this, "Anfrage abgelehnt", Toast.LENGTH_SHORT).show();
                            })
                            .show();
                    });
                } else {
                    tvRueckfahrt.setVisibility(View.GONE);
                    // v6.63.670 (Patrick 10.07. 07:08): Tap zeigt jetzt Auswahl-Dialog statt sofort zu uebernehmen.
                    //   Vorher (v6.63.629) landete jeder Fehl-Tap sofort als accepted Ride — Ablehnen ging nur
                    //   per LongPress. Patrick: "kann ja gar nicht mehr ablehnen".
                    itemView.setOnClickListener(_v -> {
                        new AlertDialog.Builder(AdminDashboardActivity.this)
                            .setTitle("📥 " + (a.name != null ? a.name : "Anfrage") + " — was tun?")
                            .setPositiveButton("✅ Übernehmen + bestätigen", (d2, w2) -> _uebernehmeAnfrageImpl(a))
                            .setNeutralButton("⚪ Nur übernehmen", (d2, w2) -> uebernehmeAnfrageOhneBestaetigung(a))
                            .setNegativeButton("❌ Ablehnen", (d2, w2) -> {
                                db.getReference("anfragen/" + a.id + "/status").setValue("abgelehnt");
                                Toast.makeText(AdminDashboardActivity.this, "Anfrage abgelehnt", Toast.LENGTH_SHORT).show();
                            })
                            .show();
                    });
                }
                itemView.setOnLongClickListener(_v -> {
                    new AlertDialog.Builder(AdminDashboardActivity.this)
                        .setTitle("📥 " + (a.name != null ? a.name : "Anfrage"))
                        .setItems(new String[]{
                            "⚪ Nur übernehmen (kein Versand)",
                            "❌ Ablehnen"
                        }, (d, which) -> {
                            if (which == 0) uebernehmeAnfrageOhneBestaetigung(a);
                            else {
                                db.getReference("anfragen/" + a.id + "/status").setValue("abgelehnt");
                                Toast.makeText(AdminDashboardActivity.this, "Anfrage abgelehnt", Toast.LENGTH_SHORT).show();
                            }
                        }).show();
                    return true;
                });
            }
        }

        class RideVH extends RecyclerView.ViewHolder {
            TextView t1, t2, tvWpToggle, tvWpDiag;
            // 🆕 v6.63.566: Konstruktor mit allen 4 TextViews (eigenes Layout statt simple_list_item_2)
            RideVH(View v, TextView _t1, TextView _t2, TextView _toggle, TextView _diag) {
                super(v);
                t1 = _t1;
                t2 = _t2;
                tvWpToggle = _toggle;
                tvWpDiag = _diag;
            }
            void bind(Ride r) {
                // 🆕 v6.63.360 (Patrick 16.06. 11:24 Bridge: "Ich sehe in der Disposition
                //   nicht wann ein Fahrzeug eine Fahrt hat und wann die beendet ist —
                //   wie oft soll ich dir das noch sagen"):
                //   Pickup-Zeit + ENDE-Zeit + Dauer in der ersten Zeile sichtbar machen.
                //   "10:45-10:55 (10min) Kramer" statt nur "10:45 Kramer"
                String when;
                {
                    String _start = r.pickupTime != null ? r.pickupTime : "—";
                    int _durMin = (r.estimatedDuration != null && r.estimatedDuration > 0) ? r.estimatedDuration : 15;
                    if (r.pickupTimestamp != null && r.pickupTimestamp > 0) {
                        long _endTs = r.pickupTimestamp + _durMin * 60_000L;
                        java.text.SimpleDateFormat _hm = new java.text.SimpleDateFormat("HH:mm", Locale.GERMANY);
                        _hm.setTimeZone(java.util.TimeZone.getTimeZone("Europe/Berlin"));
                        String _endStr = _hm.format(new java.util.Date(_endTs));
                        when = _start + "-" + _endStr + " (" + _durMin + "min)";
                    } else {
                        when = _start;
                    }
                }
                String statusBadge = r.status != null ? "  [" + statusEmoji(r.status) + " " + r.status + "]" : "";
                // v6.63.630: Personenzahl-Badge (wenn >1) und kompaktes Bezahlt-Badge in Zeile 1
                String paxBadge = (r.passengers != null && r.passengers > 1) ? "  👥" + r.passengers : "";
                String payBadge = "";
                if ("paid".equalsIgnoreCase(r.paymentStatus)) {
                    payBadge = "  ✅" + (r.stripePaidAmount != null ? String.format(Locale.GERMANY, " %.0f€", r.stripePaidAmount) : "");
                } else if ("stripe".equalsIgnoreCase(r.paymentMethod) && r.vorkasseRequested != null && r.vorkasseRequested) {
                    payBadge = "  💳⏳";
                }
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
                // 🆕 v6.63.359 (Patrick 16.06. 11:17 Bridge): Lock-Badge prominent in
                //   der Dispo-Liste. assignmentLocked=true → 🔒 + lockedBy-Kurzform.
                //   Patrick sah bisher nirgendwo wer eine Fahrt gelockt hat → Wartepool-
                //   Ursache schwer zu finden.
                String lockBadge = "";
                if (Boolean.TRUE.equals(r.assignmentLocked)) {
                    lockBadge = "  🔒";
                    if (r.lockedBy != null && !r.lockedBy.isEmpty()) {
                        String _short = r.lockedBy
                            .replace("native_admin_", "")
                            .replace("claude-bridge-", "C-")
                            .replace("cloud-", "");
                        lockBadge += "(" + _short + ")";
                    }
                }
                vehicleBadge += lockBadge;
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
                final String _name = (r.customerName != null ? r.customerName : "?");
                if (_isWartepool) {
                    itemView.setBackgroundColor(Color.parseColor("#7F1D1D"));
                    t1.setText("⚠️ " + when + "  " + _name + paxBadge + payBadge + "  · WARTEPOOL" + vehicleBadge);
                } else if (r.conflictHint != null) {
                    itemView.setBackgroundColor(Color.parseColor("#7C2D12"));
                    t1.setText(conflictPrefix + when + "  " + _name + paxBadge + payBadge + statusBadge + vehicleBadge);
                } else if (_isSofortWarteschlange) {
                    itemView.setBackgroundColor(Color.parseColor("#78350F"));
                    t1.setText("⚡ SOFORT-WS  " + when + "  " + _name + paxBadge + payBadge + statusBadge + vehicleBadge);
                } else if (r.isUnclaimedWebBooking()) {
                    itemView.setBackgroundColor(Color.parseColor("#451A03"));
                    t1.setText("🆕 WEB  " + when + "  " + _name + paxBadge + payBadge + statusBadge + vehicleBadge);
                } else if (r.isWebBookingAnySource()) {
                    itemView.setBackgroundColor(Color.parseColor("#1E293B"));
                    t1.setText("🌐 " + when + "  " + _name + paxBadge + payBadge + statusBadge + vehicleBadge);
                } else {
                    itemView.setBackgroundColor(Color.parseColor("#1E293B"));
                    t1.setText(when + "  " + _name + paxBadge + payBadge + statusBadge + vehicleBadge);
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
                // 🆕 v6.63.191 (Patrick 06.06. 10:17): Wartepool-Konflikt-Grund sichtbar machen
                // 🆕 v6.63.566: Diagnose wird NICHT mehr in route angehängt, sondern in
                //   tvWpDiag (einklappbar per Toggle-Button — default: GONE)
                if (_isWartepool) {
                    StringBuilder wpDiag = new StringBuilder("⏸️ ");
                    if (r.wartepoolAt != null) {
                        java.text.SimpleDateFormat _wf = new java.text.SimpleDateFormat("HH:mm", Locale.GERMANY);
                        _wf.setTimeZone(java.util.TimeZone.getTimeZone("Europe/Berlin"));
                        wpDiag.append("Wartepool seit ").append(_wf.format(new java.util.Date(r.wartepoolAt)));
                    } else {
                        wpDiag.append("Wartepool");
                    }
                    if (r.wartepoolReason != null && !r.wartepoolReason.isEmpty()) {
                        wpDiag.append(" (").append(r.wartepoolReason).append(")");
                    }
                    if (r.reassignReason != null && !r.reassignReason.isEmpty()) {
                        wpDiag.append("\n🔁 ").append(r.reassignReason);
                    }
                    if (r.assignedVehicleName != null && !r.assignedVehicleName.isEmpty() && (r.assignedVehicle == null || r.assignedVehicle.isEmpty())) {
                        wpDiag.append("\n🚗 Vorheriges Fahrzeug: ").append(r.assignedVehicleName);
                    }
                    if (r.autoAssignAttempts != null && r.autoAssignAttempts > 0) {
                        wpDiag.append("\n🔁 Auto-Assign-Versuche: ").append(r.autoAssignAttempts).append("×");
                    }
                    // 🆕 v6.63.355: Cloud-Auto-Assign-Klartext-Begründung
                    if (r.autoAssignLastReason != null && !r.autoAssignLastReason.isEmpty()) {
                        wpDiag.append("\n📊 ").append(r.autoAssignLastReason);
                    }
                    // 🆕 v6.63.359: Lock-Detail wenn gelockt (sollte normalerweise nicht
                    //   sein bei Wartepool — wenn doch: wichtige Diag-Info)
                    if (Boolean.TRUE.equals(r.assignmentLocked)) {
                        wpDiag.append("\n🔒 GELOCKT");
                        if (r.lockedBy != null && !r.lockedBy.isEmpty()) {
                            wpDiag.append(" durch ").append(r.lockedBy);
                        }
                        if (r.lockedAt != null) {
                            SimpleDateFormat _lf = new SimpleDateFormat("HH:mm", Locale.GERMANY);
                            _lf.setTimeZone(java.util.TimeZone.getTimeZone("Europe/Berlin"));
                            wpDiag.append(" um ").append(_lf.format(new java.util.Date(r.lockedAt)));
                        }
                    }
                    // 🆕 v6.63.355: Bevorzugt Cloud-vehicleScores nutzen (echte Cloud-Diagnose
                    //   mit Schicht-Status, Wochenplan, Konflikt-Details). Fallback auf eigene
                    //   Konflikt-Berechnung wenn die Cloud noch nicht gescort hat.
                    final String[] _v355Ids   = {"pw-my-222-e", "pw-ik-222", "pw-sk-222", "pw-ki-222", "pw-ym-222-e", "vg-lk-111"};
                    final String[] _v355Names = {"Tesla MY222", "Prius IK", "Renault SK", "Toyota KI", "Tesla YM222", "Mercedes LK"};
                    if (r.vehicleScores != null && !r.vehicleScores.isEmpty()) {
                        wpDiag.append("\n\n💡 CLOUD-DIAGNOSE PRO FAHRZEUG:");
                        for (int _vi = 0; _vi < _v355Ids.length; _vi++) {
                            java.util.Map<String, Object> _info = r.vehicleScores.get(_v355Ids[_vi]);
                            if (_info == null) continue;
                            String _st = String.valueOf(_info.get("status"));
                            String _rs = String.valueOf(_info.get("reason"));
                            String _icon = "available".equals(_st) ? "🟢" : "❌";
                            wpDiag.append("\n").append(_icon).append(" ").append(_v355Names[_vi]);
                            if (_rs != null && !"null".equals(_rs) && !_rs.isEmpty()) {
                                wpDiag.append(" — ").append(_rs);
                            }
                        }
                        wpDiag.append("\n👉 Karte tippen → Fahrzeug wählen / Pickup verschieben");
                    } else if (r.pickupTimestamp != null) {
                        // 🆕 v6.63.361 (Patrick 16.06. 12:53 Bridge): Pro Fahrzeug letzte
                        //   Belegung VOR Wartepool-Pickup-Zeit + Frei-Ab. Rückfahrt-Heuristik.
                        wpDiag.append("\n\n💡 FAHRZEUG-LAGE:");
                        int _dur354 = (r.estimatedDuration != null && r.estimatedDuration > 0) ? r.estimatedDuration : 15;
                        long _rideStart354 = r.pickupTimestamp - 30L * 60_000L;
                        long _rideEnd354 = r.pickupTimestamp + (long) _dur354 * 60_000L + 30L * 60_000L;
                        final String[] _v354Ids   = {"pw-my-222-e", "pw-ik-222", "pw-sk-222", "pw-ki-222", "pw-ym-222-e", "vg-lk-111"};
                        final String[] _v354Names = {"Tesla MY222", "Prius IK", "Renault SK", "Toyota KI", "Tesla YM222", "Mercedes LK"};
                        java.text.SimpleDateFormat _wpHm = new java.text.SimpleDateFormat("HH:mm", Locale.GERMANY);
                        _wpHm.setTimeZone(java.util.TimeZone.getTimeZone("Europe/Berlin"));
                        for (int _vi354 = 0; _vi354 < _v354Ids.length; _vi354++) {
                            String _vid354 = _v354Ids[_vi354];
                            String _conflictLabel = null;
                            long _conflictTs = 0;
                            long _busyUntil = 0;
                            String _busyByName = null;
                            for (Ride _other : _currentRides) {
                                if (_other == null || _other.id == null || _other.id.equals(r.id)) continue;
                                if (!_vid354.equals(_other.assignedVehicle)) continue;
                                if (_other.pickupTimestamp == null) continue;
                                if (_other.status != null && ("completed".equals(_other.status) || "cancelled".equals(_other.status) || "storniert".equals(_other.status) || "rejected".equals(_other.status))) continue;
                                int _oDur = (_other.estimatedDuration != null && _other.estimatedDuration > 0) ? _other.estimatedDuration : 15;
                                long _oStart = _other.pickupTimestamp;
                                long _oEnd = _oStart + (long) _oDur * 60_000L;
                                if (_oStart < _rideEnd354 && _oEnd > _rideStart354) {
                                    if (_conflictLabel == null) {
                                        _conflictLabel = _other.customerName != null ? _other.customerName : "?";
                                        _conflictTs = _oStart;
                                    }
                                }
                                // 🆕 v6.63.362: Rückfahrt-Heuristik bei Langstrecke (>30 Min)
                                long _oRideEndPlusReturn = _oEnd;
                                if (_oDur > 30) {
                                    _oRideEndPlusReturn = _oEnd + (long) _oDur * 60_000L;
                                }
                                if (_oRideEndPlusReturn <= r.pickupTimestamp && _oRideEndPlusReturn > _busyUntil) {
                                    _busyUntil = _oRideEndPlusReturn;
                                    _busyByName = _other.customerName != null ? _other.customerName : "?";
                                }
                            }
                            wpDiag.append("\n");
                            if (_conflictLabel != null) {
                                wpDiag.append("🟡 ").append(_v354Names[_vi354]).append(" — Konflikt ").append(_conflictLabel)
                                     .append(" ").append(_wpHm.format(new java.util.Date(_conflictTs)));
                            } else if (_busyUntil > 0) {
                                wpDiag.append("🟢 ").append(_v354Names[_vi354]).append(" frei ab ")
                                     .append(_wpHm.format(new java.util.Date(_busyUntil)))
                                     .append(" (nach ").append(_busyByName).append(")");
                            } else {
                                wpDiag.append("🟢 ").append(_v354Names[_vi354]).append(" frei");
                            }
                        }
                        wpDiag.append("\n👉 Karte tippen → Fahrzeug wählen / Pickup verschieben");
                    }
                    // 🆕 v6.63.566: Diagnose in tvWpDiag (einklappbar), nicht mehr in route
                    final String _wpDiagText = wpDiag.toString();
                    tvWpDiag.setText(_wpDiagText);
                    // v6.63.678 (Patrick 10.07. 16:04 Bridge: "es zeigt aber auch keinen Grund
                    //   an"): Wartepool-Diagnose per Default AUFGEKLAPPT statt versteckt.
                    //   Der '💡 Details'-Button-Trick war zu subtil — Patrick sah nur "kein
                    //   Fahrzeug" ohne Ahnung warum.
                    tvWpDiag.setVisibility(View.VISIBLE);
                    tvWpToggle.setText("▲ Details");
                    tvWpToggle.setVisibility(View.VISIBLE);
                    tvWpToggle.setOnClickListener(_tv -> {
                        if (tvWpDiag.getVisibility() == View.VISIBLE) {
                            tvWpDiag.setVisibility(View.GONE);
                            tvWpToggle.setText("💡 Details");
                        } else {
                            tvWpDiag.setVisibility(View.VISIBLE);
                            tvWpToggle.setText("▲ Details");
                        }
                    });
                } else {
                    // Nicht-Wartepool: Toggle + Diagnose ausblenden
                    tvWpToggle.setVisibility(View.GONE);
                    tvWpToggle.setOnClickListener(null);
                    tvWpDiag.setVisibility(View.GONE);
                }
                // 🆕 v6.63.096 (Patrick 03.06. 07:30): Krankenfahrt-Banner prominent.
                //   Wenn paymentMethod=transportschein → grüner "🏥 KRANKENFAHRT" Banner damit
                //   Fahrer SOFORT sieht: kein Bezahl-Dialog, Foto vom Transportschein nötig.
                if ("transportschein".equalsIgnoreCase(r.paymentMethod)) {
                    route.append("\n🏥 KRANKENFAHRT (Transportschein) — Foto am Ende, keine Rechnung");
                }
                // v6.63.630: Bezahlt/Vorkasse-Badge jetzt in Zeile 1 (t1) als kompaktes Icon.
                // Nur Sonderfälle die der Fahrer WISSEN muss bleiben in t2:
                if ("stored".equalsIgnoreCase(r.paymentMethod)) {
                    route.append("\n💳 Lastschrift — wird automatisch abgebucht, kein Kassieren nötig");
                } else if ("stripe".equalsIgnoreCase(r.paymentMethod) && !"paid".equalsIgnoreCase(r.paymentStatus) && (r.vorkasseRequested == null || !r.vorkasseRequested)) {
                    route.append("\n💳 Stripe — wird automatisch abgebucht, kein Kassieren nötig");
                }
                // 🆕 v6.63.665: Notizen in Disposition-Karte anzeigen (Patrick: "Kindersitz sehe ich nicht")
                if (r.notes != null && !r.notes.isEmpty()) {
                    route.append("\n📝 ").append(r.notes);
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

    // v6.63.601: Time-Shift-Dialog — beide Richtungen (früher + später)
    // Patrick 04.07.: "Ich müsste ja den Termin zurückschieben können" — Flughafen kann man nicht vorziehen
    private void showTimeShiftDialog(Ride r) {
        if (r == null || r.pickupTimestamp == null) return;
        SimpleDateFormat tf = new SimpleDateFormat("HH:mm", Locale.GERMANY);
        tf.setTimeZone(java.util.TimeZone.getTimeZone("Europe/Berlin"));
        String currentTime = tf.format(new Date(r.pickupTimestamp));
        int deficit = r.conflictDeficit != null ? r.conflictDeficit : 5;
        int suggested = Math.max(deficit + 1, 5);

        // Nachfolge-Fahrt (Vorgänger läuft über) → nach hinten schieben; Engpass → vorziehen
        boolean isSuccessorRide = r.conflictHint != null && r.conflictHint.contains("Vorgaenger");

        StringBuilder msg = new StringBuilder();
        msg.append("Aktueller Pickup: ").append(currentTime).append("\n\n");
        if (r.conflictHint != null) msg.append(r.conflictHint).append("\n\n");
        if (isSuccessorRide) {
            msg.append("💡 Vorschlag: ").append(suggested).append(" Min nach hinten → ");
            msg.append(tf.format(new Date(r.pickupTimestamp + suggested * 60_000L)));
        } else {
            msg.append("💡 Vorschlag: ").append(suggested).append(" Min vorziehen → ");
            msg.append(tf.format(new Date(r.pickupTimestamp - suggested * 60_000L)));
        }

        AlertDialog.Builder b = new AlertDialog.Builder(this)
            .setTitle("⏰ Pickup verschieben — " + (r.customerName != null ? r.customerName : "?"))
            .setMessage(msg.toString());

        final String _rid = r.id;
        final long _origTs = r.pickupTimestamp;
        final String _custName = r.customerName != null ? r.customerName : "Kunde";
        final String _custPhone = r.customerPhone;

        final AlertDialog[] _dlgHolder = {null};

        // Container
        LinearLayout container = new LinearLayout(this);
        container.setOrientation(LinearLayout.VERTICAL);
        int pad = (int)(16 * getResources().getDisplayMetrics().density);
        container.setPadding(pad, pad/2, pad, 0);

        // SMS-Checkbox (muss vor Buttons stehen damit apply darauf zugreifen kann)
        final android.widget.CheckBox cbSms = new android.widget.CheckBox(this);
        cbSms.setChecked(_custPhone != null && _custPhone.length() > 4);
        if (_custPhone == null || _custPhone.length() <= 4) cbSms.setEnabled(false);

        // Shift-Helper (min > 0 = später, min < 0 = früher)
        java.util.function.BiConsumer<Integer, Boolean> doShift = (deltaMin, sendSms) -> {
            long newTs = _origTs + (long) deltaMin * 60_000L;
            java.util.Map<String, Object> u = new java.util.HashMap<>();
            u.put("pickupTimestamp", newTs);
            SimpleDateFormat _tf = new SimpleDateFormat("HH:mm", Locale.GERMANY);
            _tf.setTimeZone(java.util.TimeZone.getTimeZone("Europe/Berlin"));
            String newTimeStr = _tf.format(new Date(newTs));
            u.put("pickupTime", newTimeStr);
            u.put("smartScheduleShiftedMin", deltaMin);
            u.put("smartScheduleShiftedAt", System.currentTimeMillis());
            u.put("smartScheduleShiftedBy", "admin-time-shift");
            u.put("updatedAt", System.currentTimeMillis());
            com.google.firebase.database.FirebaseDatabase.getInstance(DB_URL_AD).getReference("rides/" + _rid).updateChildren(u)
                .addOnSuccessListener(_ok -> {
                    String dir = deltaMin > 0 ? "nach hinten geschoben" : "vorgezogen";
                    Toast.makeText(AdminDashboardActivity.this,
                        "✅ Pickup " + dir + " → " + newTimeStr, Toast.LENGTH_LONG).show();
                    if (sendSms && _custPhone != null && _custPhone.length() > 4) {
                        java.util.Map<String, Object> sms = new java.util.HashMap<>();
                        sms.put("phone", _custPhone);
                        String smsText = deltaMin > 0
                            ? "Funktaxi: Hallo " + _custName + ", Ihr Pickup wurde auf " + newTimeStr + " Uhr verschoben."
                            : "Funktaxi: Hallo " + _custName + ", Ihr Taxi kommt " + Math.abs(deltaMin) + " Min frueher — neue Pickup-Zeit: " + newTimeStr + ".";
                        sms.put("message", smsText);
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

        // ─── Abschnitt: Nach hinten schieben ───────────────────────────────
        TextView tvLaterLabel = new TextView(this);
        tvLaterLabel.setText("➡️ Nach hinten schieben (später):");
        tvLaterLabel.setTextSize(13);
        tvLaterLabel.setTextColor(isSuccessorRide ? 0xFF059669 : 0xFF374151);
        tvLaterLabel.setTypeface(null, isSuccessorRide ? android.graphics.Typeface.BOLD : android.graphics.Typeface.NORMAL);
        tvLaterLabel.setPadding(0, pad/2, 0, pad/4);
        container.addView(tvLaterLabel);
        LinearLayout rowLater = new LinearLayout(this);
        rowLater.setOrientation(LinearLayout.HORIZONTAL);
        for (int m : new int[]{5, 10, 15}) {
            final int _m = m;
            android.widget.Button btnL = new android.widget.Button(this);
            btnL.setText("+" + m + " Min\n→ " + tf.format(new Date(_origTs + (long) m * 60_000L)));
            btnL.setAllCaps(false);
            btnL.setTextSize(11);
            btnL.setTextColor(0xFFFFFFFF);
            btnL.setBackgroundColor(isSuccessorRide && m == suggested ? 0xFF059669 : 0xFF0F766E);
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
            lp.setMargins(0, 0, pad/4, 0);
            btnL.setLayoutParams(lp);
            btnL.setOnClickListener(_v -> {
                if (_dlgHolder[0] != null) _dlgHolder[0].dismiss();
                doShift.accept(_m, cbSms.isChecked());
            });
            rowLater.addView(btnL);
        }
        container.addView(rowLater);

        // ─── Abschnitt: Vorziehen ───────────────────────────────────────────
        TextView tvEarlierLabel = new TextView(this);
        tvEarlierLabel.setText("⬅️ Vorziehen (früher):");
        tvEarlierLabel.setTextSize(13);
        tvEarlierLabel.setTextColor(!isSuccessorRide ? 0xFF7C3AED : 0xFF374151);
        tvEarlierLabel.setTypeface(null, !isSuccessorRide ? android.graphics.Typeface.BOLD : android.graphics.Typeface.NORMAL);
        tvEarlierLabel.setPadding(0, pad/2, 0, pad/4);
        container.addView(tvEarlierLabel);
        LinearLayout rowEarlier = new LinearLayout(this);
        rowEarlier.setOrientation(LinearLayout.HORIZONTAL);
        for (int m : new int[]{5, 10, 15}) {
            final int _m = m;
            android.widget.Button btnE = new android.widget.Button(this);
            btnE.setText("−" + m + " Min\n→ " + tf.format(new Date(_origTs - (long) m * 60_000L)));
            btnE.setAllCaps(false);
            btnE.setTextSize(11);
            btnE.setTextColor(0xFFFFFFFF);
            btnE.setBackgroundColor(!isSuccessorRide && m == suggested ? 0xFF7C3AED : 0xFF6D28D9);
            LinearLayout.LayoutParams lpE = new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
            lpE.setMargins(0, 0, pad/4, 0);
            btnE.setLayoutParams(lpE);
            btnE.setOnClickListener(_v -> {
                if (_dlgHolder[0] != null) _dlgHolder[0].dismiss();
                doShift.accept(-_m, cbSms.isChecked());
            });
            rowEarlier.addView(btnE);
        }
        container.addView(rowEarlier);

        // ─── Fahrzeug-Wechsel-Spinner ───────────────────────────────────────
        TextView tvVehicleLabel = new TextView(this);
        tvVehicleLabel.setText("🚗 Fahrzeug wechseln:");
        tvVehicleLabel.setTextSize(13);
        tvVehicleLabel.setPadding(0, pad, 0, pad/4);
        container.addView(tvVehicleLabel);
        final String[] _wpVehIds = {"", "pw-ik-222", "pw-my-222-e", "pw-ki-222", "pw-sk-222", "vg-lk-111", "pw-ym-222-e"};
        final String[] _wpVehNames = {"— Nicht zugewiesen —", "Toyota IK", "Tesla MY222", "Toyota KI", "Renault SK", "Mercedes LK", "Tesla YM222"};
        // v6.63.610: Kapazitäten parallel zu _wpVehIds (0 = unbegrenzt/unbekannt)
        final int[] _wpVehCaps = {0, 4, 4, 4, 8, 8, 4};
        final int _ridePax = r.passengers != null ? r.passengers : 1;
        int[] _wpVehStatus = new int[_wpVehIds.length];
        _wpVehStatus[0] = 1;
        long _rideStart = _origTs - 5L * 60_000L;
        int _rideDur = (r.estimatedDuration != null && r.estimatedDuration > 0) ? r.estimatedDuration : 15;
        long _rideEnd = _origTs + (long) _rideDur * 60_000L + 5L * 60_000L;
        for (int i = 1; i < _wpVehIds.length; i++) {
            String vid = _wpVehIds[i];
            boolean hasConflict = false;
            for (Ride other : _currentRides) {
                if (other == null || other.id == null || other.id.equals(r.id)) continue;
                if (!vid.equals(other.assignedVehicle)) continue;
                if (other.pickupTimestamp == null) continue;
                if (other.status != null && (other.status.equals("completed") || other.status.equals("cancelled") || other.status.equals("storniert"))) continue;
                int oDur = (other.estimatedDuration != null && other.estimatedDuration > 0) ? other.estimatedDuration : 15;
                long oStart = other.pickupTimestamp - 5L * 60_000L;
                long oEnd = other.pickupTimestamp + (long) oDur * 60_000L + 5L * 60_000L;
                if (_rideStart < oEnd && _rideEnd > oStart) { hasConflict = true; break; }
            }
            _wpVehStatus[i] = hasConflict ? 2 : 1;
        }
        String[] _wpVehDisplayLabels = new String[_wpVehIds.length];
        for (int i = 0; i < _wpVehIds.length; i++) {
            String icon = i == 0 ? "" : (_wpVehStatus[i] == 2 ? "🔴 " : "🟢 ");
            // v6.63.610: Kapazitäts-Warnung wenn Fahrzeug zu klein für Personenzahl
            boolean _capWarn = i > 0 && _wpVehCaps[i] > 0 && _ridePax > _wpVehCaps[i];
            String _capSuffix = _capWarn ? " ⚠️ " + _wpVehCaps[i] + " Plätze / " + _ridePax + " Pax" : "";
            _wpVehDisplayLabels[i] = icon + _wpVehNames[i] + _capSuffix;
        }
        final android.widget.Spinner _wpSpnVehicle = new android.widget.Spinner(this);
        android.widget.ArrayAdapter<String> _wpVehAdapter = new android.widget.ArrayAdapter<>(
            this, android.R.layout.simple_spinner_item, _wpVehDisplayLabels);
        _wpVehAdapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        _wpSpnVehicle.setAdapter(_wpVehAdapter);
        int _wpVehSel = 0;
        for (int i = 0; i < _wpVehIds.length; i++) if (_wpVehIds[i].equals(r.assignedVehicle != null ? r.assignedVehicle : "")) { _wpVehSel = i; break; }
        _wpSpnVehicle.setSelection(_wpVehSel);
        LinearLayout.LayoutParams _wpVehLp = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        _wpVehLp.setMargins(0, 0, 0, pad/2);
        _wpSpnVehicle.setLayoutParams(_wpVehLp);
        container.addView(_wpSpnVehicle);
        TextView tvVehicleHint = new TextView(this);
        tvVehicleHint.setText("🟢 = passt | 🔴 = Konflikt mit anderer Fahrt");
        tvVehicleHint.setTextSize(11);
        tvVehicleHint.setTextColor(0xFF64748b);
        tvVehicleHint.setPadding(0, 0, 0, pad/2);
        container.addView(tvVehicleHint);
        final android.widget.Button _wpBtnVehSave = new android.widget.Button(this);
        _wpBtnVehSave.setText("💾 Fahrzeug speichern");
        _wpBtnVehSave.setAllCaps(false);
        _wpBtnVehSave.setTextColor(0xFFffffff);
        _wpBtnVehSave.setBackgroundColor(0xFF059669);
        LinearLayout.LayoutParams _wpVehSaveLp = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        _wpVehSaveLp.setMargins(0, 0, 0, pad/2);
        _wpBtnVehSave.setLayoutParams(_wpVehSaveLp);
        container.addView(_wpBtnVehSave);

        final android.widget.Button btnFullEdit = new android.widget.Button(this);
        btnFullEdit.setText("✏️ Komplett bearbeiten (Adresse, Pax, Notiz...)");
        btnFullEdit.setAllCaps(false);
        btnFullEdit.setTextColor(0xFF1d4ed8);
        btnFullEdit.setBackgroundColor(0xFFDDE9FB);
        LinearLayout.LayoutParams _editLp = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        _editLp.setMargins(0, 0, 0, pad/2);
        btnFullEdit.setLayoutParams(_editLp);
        container.addView(btnFullEdit);

        cbSms.setText("📲 SMS an " + _custName + " senden");
        container.addView(cbSms);

        b.setView(container);
        b.setNegativeButton("Abbrechen", null);
        final AlertDialog dlg = b.show();
        _dlgHolder[0] = dlg;
        btnFullEdit.setOnClickListener(_v -> { dlg.dismiss(); showEditRideDialog(r); });
        _wpBtnVehSave.setOnClickListener(_v -> {
            int sel = _wpSpnVehicle.getSelectedItemPosition();
            final String selVid = (sel >= 0 && sel < _wpVehIds.length) ? _wpVehIds[sel] : "";
            final String selName = (sel >= 0 && sel < _wpVehNames.length) ? _wpVehNames[sel] : "";
            java.util.Map<String, Object> vu = new java.util.HashMap<>();
            if (selVid.isEmpty()) {
                vu.put("assignedVehicle", null);
                vu.put("vehicleId", null);
                vu.put("vehicle", null);
                vu.put("vehicleLabel", null);
                vu.put("vehiclePlate", null);
                vu.put("assignedTo", null);
                vu.put("assignedVehicleName", null);
                vu.put("assignedVehiclePlate", null);
            } else {
                vu.put("assignedVehicle", selVid);
                vu.put("vehicleId", selVid);
                vu.put("vehicle", selName);
                vu.put("vehicleLabel", selName);
                vu.put("assignedTo", selVid);
                vu.put("assignedVehicleName", selName);
                vu.put("assignedBy", "native-wartepool-spinner");
                vu.put("acceptedByVehicle", selVid);
                vu.put("assignmentLocked", true);
                vu.put("silentReassign", true);
                if (r.status != null && (r.status.equals("wartepool") || r.status.equals("warteschlange"))) {
                    vu.put("status", "vorbestellt");
                }
            }
            vu.put("updatedAt", System.currentTimeMillis());
            // v6.63.610: Kapazitäts-Schutz — blockiert stilles Überbuchen
            final java.util.Map<String, Object> _vuFinal = vu;
            boolean _capOverflow = !selVid.isEmpty() && sel < _wpVehCaps.length && _wpVehCaps[sel] > 0 && _ridePax > _wpVehCaps[sel];
            Runnable _doWrite = () -> {
                com.google.firebase.database.FirebaseDatabase.getInstance(DB_URL_AD).getReference("rides/" + r.id).updateChildren(_vuFinal)
                    .addOnSuccessListener(_ok -> {
                        Toast.makeText(AdminDashboardActivity.this,
                            "✅ Fahrzeug → " + (selVid.isEmpty() ? "Nicht zugewiesen" : selName), Toast.LENGTH_LONG).show();
                        dlg.dismiss();
                    })
                    .addOnFailureListener(e -> Toast.makeText(AdminDashboardActivity.this,
                        "❌ Fehler: " + e.getMessage(), Toast.LENGTH_LONG).show());
            };
            if (_capOverflow) {
                new androidx.appcompat.app.AlertDialog.Builder(AdminDashboardActivity.this)
                    .setTitle("⚠️ Kapazität überschritten!")
                    .setMessage(selName + " hat nur " + _wpVehCaps[sel] + " Plätze.\nDiese Fahrt hat " + _ridePax + " Personen.\n\nTrotzdem zuweisen?")
                    .setPositiveButton("Ja, trotzdem", (_dd, _ww) -> _doWrite.run())
                    .setNegativeButton("Abbrechen", null)
                    .show();
            } else {
                _doWrite.run();
            }
        });
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

        // 🆕 v6.63.669: ERLEDIGT-Button — prominente Schnell-Aktion für aktive Fahrten
        //   Patrick: "vergangene fahrten nicht als erledigt klicken" — Spinner ist zu versteckt
        if ("accepted".equals(r.status) || "picked_up".equals(r.status) || "on_way".equals(r.status)) {
            com.google.android.material.button.MaterialButton btnDone =
                new com.google.android.material.button.MaterialButton(this);
            btnDone.setText("✅ FAHRT ABSCHLIESSEN (Erledigt)");
            btnDone.setTextSize(16);
            btnDone.setBackgroundColor(android.graphics.Color.parseColor("#1d4ed8"));
            btnDone.setTextColor(android.graphics.Color.WHITE);
            LinearLayout.LayoutParams _doneParams = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
            _doneParams.setMargins(0, 0, 0, pad);
            btnDone.setLayoutParams(_doneParams);
            btnDone.setOnClickListener(_v -> {
                new AlertDialog.Builder(this)
                    .setTitle("✅ Fahrt abschließen")
                    .setMessage((r.customerName != null ? r.customerName : "Fahrt") + " als erledigt markieren?")
                    .setPositiveButton("Ja, erledigt", (_d, _w) -> {
                        java.util.Map<String, Object> upd = new java.util.HashMap<>();
                        upd.put("status", "completed");
                        upd.put("completedAt", System.currentTimeMillis());
                        upd.put("completedBy", "native_admin_dispo");
                        upd.put("updatedAt", System.currentTimeMillis());
                        FirebaseDatabase.getInstance(DB_INSTANCE_URL).getReference("rides/" + r.id)
                            .updateChildren(upd)
                            .addOnSuccessListener(_ok -> {
                                Toast.makeText(this, "✅ " + (r.customerName != null ? r.customerName : "Fahrt") + " abgeschlossen", Toast.LENGTH_SHORT).show();
                                if (_dlgRef.get() != null) _dlgRef.get().dismiss();
                            })
                            .addOnFailureListener(_ex -> Toast.makeText(this, "Fehler: " + _ex.getMessage(), Toast.LENGTH_LONG).show());
                    })
                    .setNegativeButton("Abbrechen", null)
                    .show();
            });
            layout.addView(btnDone);
        }

        // 🆕 v6.63.558: +5/+10 Min Schnell-Verschieben (Patrick 29.06. 19:39 Bridge:
        //   "wenn ich ne Fahrt angenommen hab, die schnell um 5 Minuten verschieben")
        if (r.pickupTimestamp != null && r.pickupTimestamp > 0) {
            LinearLayout _timeShiftRow = new LinearLayout(this);
            _timeShiftRow.setOrientation(LinearLayout.HORIZONTAL);
            LinearLayout.LayoutParams _tsRowParams = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
            _tsRowParams.setMargins(0, 0, 0, pad);
            _timeShiftRow.setLayoutParams(_tsRowParams);
            int _btnWeight = 1;
            for (int _delta : new int[]{5, 10}) {
                com.google.android.material.button.MaterialButton _btnShift =
                    new com.google.android.material.button.MaterialButton(this);
                _btnShift.setText("⏩ +" + _delta + " Min");
                _btnShift.setTextSize(14);
                _btnShift.setBackgroundColor(android.graphics.Color.parseColor("#f59e0b"));
                _btnShift.setTextColor(android.graphics.Color.WHITE);
                LinearLayout.LayoutParams _bsp = new LinearLayout.LayoutParams(
                    0, LinearLayout.LayoutParams.WRAP_CONTENT, _btnWeight);
                if (_delta == 5) _bsp.setMargins(0, 0, padHalf, 0);
                _btnShift.setLayoutParams(_bsp);
                final long _deltaMs = _delta * 60 * 1000L;
                _btnShift.setOnClickListener(_v -> _shiftPickupTime(r.id, r.pickupTimestamp, _deltaMs, _dlgRef));
                _timeShiftRow.addView(_btnShift);
            }
            layout.addView(_timeShiftRow);
        }

        // 🆕 v6.63.622: WhatsApp-Bestätigung — sichtbar wenn Telefonnummer vorhanden
        if (r.customerPhone != null && !r.customerPhone.isEmpty()) {
            com.google.android.material.button.MaterialButton btnWaConfirm =
                new com.google.android.material.button.MaterialButton(this);
            btnWaConfirm.setText("💬 Buchungsbestätigung per WhatsApp");
            btnWaConfirm.setTextSize(15);
            btnWaConfirm.setBackgroundColor(android.graphics.Color.parseColor("#25d366"));
            btnWaConfirm.setTextColor(android.graphics.Color.WHITE);
            LinearLayout.LayoutParams _waParams = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
            _waParams.setMargins(0, 0, 0, pad);
            btnWaConfirm.setLayoutParams(_waParams);
            btnWaConfirm.setOnClickListener(_v -> {
                String _name = r.customerName != null ? r.customerName : "Kunde";
                String _date = r.pickupTime != null ? r.pickupTime : "";
                String _pickup = r.pickup != null ? r.pickup : "?";
                String _dest = r.destination != null ? r.destination : "?";
                String _pax = r.passengers != null ? r.passengers + " Person(en)" : "1 Person";
                String _price = (r.price != null && r.price > 0) ? String.format(java.util.Locale.GERMANY, "%.2f", r.price) + " €" : "";
                String _msg = "Hallo " + _name + ",\n\nIhre Fahrt ist bestätigt:\n" +
                    (_date.isEmpty() ? "" : "🕐 " + _date + "\n") +
                    "📍 " + _pickup + "\n🎯 " + _dest + "\n" +
                    "👥 " + _pax + "\n" +
                    (_price.isEmpty() ? "" : "💰 " + _price + "\n") +
                    "\nVielen Dank für Ihr Vertrauen.\nFunk Taxi Heringsdorf · 038378 / 22022";
                String _ph = r.customerPhone.replaceAll("[\\s\\-\\/\\(\\)\\+]", "");
                if (_ph.startsWith("0")) _ph = "49" + _ph.substring(1);
                android.content.Intent _wi = new android.content.Intent(android.content.Intent.ACTION_VIEW);
                _wi.setData(android.net.Uri.parse("https://wa.me/" + _ph + "?text=" + java.net.URLEncoder.encode(_msg)));
                try { startActivity(_wi); }
                catch (Throwable _t) { android.widget.Toast.makeText(this, "WhatsApp nicht installiert", android.widget.Toast.LENGTH_SHORT).show(); }
            });
            layout.addView(btnWaConfirm);
        }

        // 🆕 v6.63.090 (Patrick 02.06. 18:32): Email-Vorschau-Button als prominente Aktion direkt
        // unter Speichern. Tap → EmailPreviewActivity öffnet sich, Patrick liest durch,
        // toggelt Stripe/Tracking, sendet ab. Nur sichtbar wenn customerEmail vorhanden.
        if (r.customerEmail != null && !r.customerEmail.isEmpty() && r.customerEmail.contains("@")) {
            com.google.android.material.button.MaterialButton btnEmailPreview =
                new com.google.android.material.button.MaterialButton(this);
            btnEmailPreview.setText("📧 Email-Bestätigung (mit Vorschau)");
            btnEmailPreview.setTextSize(15);
            btnEmailPreview.setBackgroundColor(android.graphics.Color.parseColor("#1d4ed8"));
            btnEmailPreview.setTextColor(android.graphics.Color.WHITE);
            LinearLayout.LayoutParams _emailParams = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
            _emailParams.setMargins(0, 0, 0, pad);
            btnEmailPreview.setLayoutParams(_emailParams);
            btnEmailPreview.setOnClickListener(_v -> {
                if (_dlgRef.get() != null) _dlgRef.get().dismiss();
                Intent _emailIntent = new Intent(this, EmailPreviewActivity.class);
                _emailIntent.putExtra(EmailPreviewActivity.EXTRA_RIDE_ID, r.id);
                startActivity(_emailIntent);
            });
            layout.addView(btnEmailPreview);
        }

        // 🔧 v6.63.622: Stripe-Button auch bei reiner Telefonnummer (kein Email nötig)
        {
            boolean _hasEmail = r.customerEmail != null && !r.customerEmail.isEmpty() && r.customerEmail.contains("@");
            boolean _hasPhone = r.customerPhone != null && !r.customerPhone.isEmpty();
            if (r.price != null && r.price > 0 && (_hasEmail || _hasPhone)) {
                com.google.android.material.button.MaterialButton btnStripe =
                    new com.google.android.material.button.MaterialButton(this);
                btnStripe.setText("💳 Stripe-Vorkasse-Link erstellen & senden");
                btnStripe.setTextSize(15);
                btnStripe.setBackgroundColor(android.graphics.Color.parseColor("#7c3aed"));
                btnStripe.setTextColor(android.graphics.Color.WHITE);
                LinearLayout.LayoutParams _stripeParams = new LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
                _stripeParams.setMargins(0, 0, 0, pad);
                btnStripe.setLayoutParams(_stripeParams);
                final boolean _fHasEmail = _hasEmail;
                final boolean _fHasPhone = _hasPhone;
                btnStripe.setOnClickListener(_v -> {
                    if (_dlgRef.get() != null) _dlgRef.get().dismiss();
                    // Stripe-Link via createStripeCheckout generieren (kein Email nötig)
                    String _desc = (r.pickup != null ? r.pickup : "") + " → " + (r.destination != null ? r.destination : "");
                    double _amt = r.price;
                    String _name = r.customerName != null ? r.customerName : "Kunde";
                    String _phone = r.customerPhone;
                    String _email = r.customerEmail;
                    Toast.makeText(this, "⏳ Stripe-Link wird erstellt...", Toast.LENGTH_SHORT).show();
                    new Thread(() -> {
                        try {
                            org.json.JSONObject body = new org.json.JSONObject();
                            body.put("invoiceNumber", "VKAS-" + new java.text.SimpleDateFormat("yyMMdd-HHmmss", java.util.Locale.GERMANY).format(new java.util.Date()));
                            body.put("amount", _amt);
                            body.put("customerName", _name);
                            if (_fHasEmail) body.put("customerEmail", _email);
                            body.put("description", _desc.isEmpty() ? "Vorkasse Funk Taxi Heringsdorf" : _desc);
                            java.net.URL _url = new java.net.URL("https://europe-west1-taxi-heringsdorf.cloudfunctions.net/createStripeCheckout");
                            java.net.HttpURLConnection conn = (java.net.HttpURLConnection) _url.openConnection();
                            conn.setRequestMethod("POST");
                            conn.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                            conn.setDoOutput(true);
                            conn.setConnectTimeout(10000);
                            conn.setReadTimeout(20000);
                            conn.getOutputStream().write(body.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8));
                            int _rc = conn.getResponseCode();
                            java.io.InputStream _is = _rc < 400 ? conn.getInputStream() : conn.getErrorStream();
                            java.util.Scanner _sc = new java.util.Scanner(_is, "UTF-8").useDelimiter("\\A");
                            String _resp = _sc.hasNext() ? _sc.next() : "";
                            conn.disconnect();
                            if (_rc != 200) { runOnUiThread(() -> android.widget.Toast.makeText(this, "❌ Fehler " + _rc + ": " + _resp.substring(0, Math.min(_resp.length(), 120)), android.widget.Toast.LENGTH_LONG).show()); return; }
                            org.json.JSONObject _json = new org.json.JSONObject(_resp);
                            final String _checkoutUrl = _json.optString("checkoutUrl", "");
                            if (_checkoutUrl.isEmpty()) { runOnUiThread(() -> android.widget.Toast.makeText(this, "❌ Kein Link: " + _resp, android.widget.Toast.LENGTH_LONG).show()); return; }
                            // Clipboard
                            runOnUiThread(() -> {
                                android.content.ClipboardManager _cm = (android.content.ClipboardManager) getSystemService(android.content.Context.CLIPBOARD_SERVICE);
                                _cm.setPrimaryClip(android.content.ClipData.newPlainText("Stripe", _checkoutUrl));
                                // Dialog: WhatsApp + Email
                                androidx.appcompat.app.AlertDialog.Builder _b = new androidx.appcompat.app.AlertDialog.Builder(this)
                                    .setTitle("✅ Stripe-Link erstellt")
                                    .setMessage(String.format(java.util.Locale.GERMANY, "%.2f", _amt) + " € — in Zwischenablage.\n\n" + _checkoutUrl);
                                if (_fHasPhone) {
                                    _b.setPositiveButton("💬 WhatsApp senden", (_d2, _w2) -> {
                                        String _wa = "Hallo " + _name + ",\n\nIhr Zahlungslink (" + String.format(java.util.Locale.GERMANY, "%.2f", _amt) + " €):\n" + _checkoutUrl + "\n\nNach Zahlung ist Ihre Buchung bestätigt.\n\nFunk Taxi Heringsdorf";
                                        String _ph = _phone.replaceAll("[\\s\\-\\/\\(\\)\\+]", "");
                                        if (_ph.startsWith("0")) _ph = "49" + _ph.substring(1);
                                        android.content.Intent _wi = new android.content.Intent(android.content.Intent.ACTION_VIEW);
                                        _wi.setData(android.net.Uri.parse("https://wa.me/" + _ph + "?text=" + java.net.URLEncoder.encode(_wa)));
                                        try { startActivity(_wi); } catch (Throwable _t) { android.widget.Toast.makeText(this, "WhatsApp nicht verfügbar", android.widget.Toast.LENGTH_SHORT).show(); }
                                    });
                                }
                                if (_fHasEmail) {
                                    _b.setNeutralButton("📧 Email senden", (_d2, _w2) -> {
                                        String _amtStr = String.format(java.util.Locale.US, "%.2f", _amt);
                                        _sendVorkasseEmail(r.id, _email, _name, _amtStr, r.pickup != null ? r.pickup : "", r.destination != null ? r.destination : "", r.pickupTime != null ? r.pickupTime : "", null);
                                    });
                                }
                                _b.setNegativeButton("Schließen", null).show();
                            });
                        } catch (Throwable _t) {
                            runOnUiThread(() -> android.widget.Toast.makeText(this, "❌ Fehler: " + _t.getMessage(), android.widget.Toast.LENGTH_LONG).show());
                        }
                    }).start();
                });
                layout.addView(btnStripe);
            }
        }

        // 🆕 v6.63.534: Rechnung an Auftraggeber/Hotel — PDF-Vorschau + Email-Compose nativ
        if (r.invoiceNumber != null && !r.invoiceNumber.isEmpty()) {
            com.google.android.material.button.MaterialButton btnInvoiceEmail =
                new com.google.android.material.button.MaterialButton(this);
            btnInvoiceEmail.setText("🧾 Rechnung an Auftraggeber senden");
            btnInvoiceEmail.setTextSize(15);
            btnInvoiceEmail.setBackgroundColor(android.graphics.Color.parseColor("#059669"));
            btnInvoiceEmail.setTextColor(android.graphics.Color.WHITE);
            LinearLayout.LayoutParams _invParams = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
            _invParams.setMargins(0, 0, 0, pad);
            btnInvoiceEmail.setLayoutParams(_invParams);
            btnInvoiceEmail.setOnClickListener(_v -> {
                if (_dlgRef.get() != null) _dlgRef.get().dismiss();
                // v6.63.639: launchInvoiceEmailFromRide — mit Auftraggeber-Email-Lookup
                launchInvoiceEmailFromRide(r);
            });
            layout.addView(btnInvoiceEmail);
        }

        // 🆕 v6.63.572 (Patrick 01.07. 13:38): "Wie erstelle ich eine Quittung auf Namen des Gastes?"
        //   v6.63.573: + Telefon/Email-Felder → SMS/Email-Versand direkt nach Bestätigung.
        //   v6.63.576: Immer anzeigen fuer abgeschlossene Fahrten (auch wenn invoiceNumber gesetzt —
        //   Auftraggeber-Rechnung != Gast-Quittung).
        if ("completed".equals(r.status)) {
            com.google.android.material.button.MaterialButton btnQuittung =
                new com.google.android.material.button.MaterialButton(this);
            boolean _hasInvoice = r.invoiceNumber != null && !r.invoiceNumber.isEmpty();
            btnQuittung.setText(_hasInvoice ? "🧾 Quittung an Gast senden" : "🧾 Quittung / Rechnung erstellen");
            btnQuittung.setTextSize(15);
            btnQuittung.setBackgroundColor(android.graphics.Color.parseColor("#065f46"));
            btnQuittung.setTextColor(android.graphics.Color.WHITE);
            LinearLayout.LayoutParams _qParams = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
            _qParams.setMargins(0, 0, 0, pad);
            btnQuittung.setLayoutParams(_qParams);
            btnQuittung.setOnClickListener(_v -> {
                if (_dlgRef.get() != null) _dlgRef.get().dismiss();
                int _p = (int) (getResources().getDisplayMetrics().density * 16);
                LinearLayout _form = new LinearLayout(this);
                _form.setOrientation(LinearLayout.VERTICAL);
                _form.setPadding(_p, _p / 2, _p, _p / 2);
                // Feld 1: Gastname
                android.widget.EditText etName = new android.widget.EditText(this);
                etName.setHint("Name des Gastes");
                String _prefill = r.guestName != null && !r.guestName.isEmpty()
                    ? r.guestName : (r.customerName != null ? r.customerName : "");
                etName.setText(_prefill);
                etName.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_FLAG_CAP_WORDS);
                _form.addView(etName);
                // Feld 2: Mobilnummer für SMS
                android.widget.EditText etPhone = new android.widget.EditText(this);
                etPhone.setHint("Handy-Nr. (optional, für SMS-Versand)");
                String _phonePrefill = r.customerPhone != null ? r.customerPhone : "";
                etPhone.setText(_phonePrefill);
                etPhone.setInputType(android.text.InputType.TYPE_CLASS_PHONE);
                LinearLayout.LayoutParams _ep = new LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
                _ep.setMargins(0, _p / 2, 0, 0);
                etPhone.setLayoutParams(_ep);
                _form.addView(etPhone);
                // Feld 3: Email
                android.widget.EditText etEmail = new android.widget.EditText(this);
                etEmail.setHint("Email (optional, für Email-Versand)");
                String _emailPrefill = r.customerEmail != null ? r.customerEmail : "";
                etEmail.setText(_emailPrefill);
                etEmail.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS);
                LinearLayout.LayoutParams _ee = new LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
                _ee.setMargins(0, _p / 2, 0, 0);
                etEmail.setLayoutParams(_ee);
                _form.addView(etEmail);

                final String _rideId = r.id;
                final String _trackUrl = "https://umwelt-taxi-insel-usedom.de/Taxi-App/track.html?ride=" + _rideId;
                androidx.appcompat.app.AlertDialog _quittungDlg = new androidx.appcompat.app.AlertDialog.Builder(this)
                    .setTitle("🧾 Quittung erstellen")
                    .setMessage("Name + Kontakt des Gastes. SMS wird sofort verschickt.\n\n'Vorschau' zeigt was der Kunde sieht.")
                    .setView(_form)
                    .setPositiveButton("Quittung + Versand", (_d, _w) -> {
                        String _name  = etName.getText().toString().trim();
                        String _phone = etPhone.getText().toString().trim();
                        String _email = etEmail.getText().toString().trim();
                        java.util.Map<String, Object> _upd = new java.util.HashMap<>();
                        _upd.put("invoiceRequested", true);
                        _upd.put("needsInvoice", true);
                        _upd.put("sendReceiptToGuest", true);
                        if (!_name.isEmpty())  _upd.put("guestName", _name);
                        if (!_phone.isEmpty()) _upd.put("receiptGuestPhone", _phone);
                        if (!_email.isEmpty()) _upd.put("receiptGuestEmail", _email);
                        db.getReference("rides/" + _rideId).updateChildren(_upd);
                        // SMS direkt in Queue schreiben (Cloud Function sendet via seven.io)
                        if (!_phone.isEmpty()) {
                            String _finalName = _name;
                            String _smsText = "Guten Tag" + (_finalName.isEmpty() ? "" : " " + _finalName.split(" ")[_finalName.split(" ").length - 1])
                                + ", vielen Dank fuer Ihre Fahrt mit Funk Taxi Heringsdorf!\nQuittung/Rechnung: " + _trackUrl
                                + "\nBei Fragen: 038378 22022";
                            java.util.Map<String, Object> _sms = new java.util.HashMap<>();
                            _sms.put("phone", _phone);
                            _sms.put("text", _smsText);
                            _sms.put("rideId", _rideId);
                            _sms.put("type", "quittung_an_gast");
                            _sms.put("status", "pending");
                            _sms.put("createdAt", System.currentTimeMillis());
                            db.getReference("smsQueue").push().setValue(_sms);
                        }
                        String _confirm = "🧾 Quittung wird generiert"
                            + (_phone.isEmpty() ? "" : " — SMS an " + _phone)
                            + (_email.isEmpty() ? "" : " — Email folgt");
                        Toast.makeText(this, _confirm, Toast.LENGTH_LONG).show();
                    })
                    .setNeutralButton("👁 Vorschau", null) // OnClick separat gesetzt damit Dialog offen bleibt
                    .setNegativeButton("Abbrechen", null)
                    .create();
                _quittungDlg.setOnShowListener(_ds -> {
                    // Neutral-Button oeffnet track.html ohne Dialog zu schliessen
                    android.widget.Button _btnPrev = _quittungDlg.getButton(androidx.appcompat.app.AlertDialog.BUTTON_NEUTRAL);
                    if (_btnPrev != null) _btnPrev.setOnClickListener(_bv -> {
                        try {
                            androidx.browser.customtabs.CustomTabsIntent _ct =
                                new androidx.browser.customtabs.CustomTabsIntent.Builder()
                                    .setShowTitle(true).build();
                            _ct.launchUrl(this, android.net.Uri.parse(_trackUrl));
                        } catch (Throwable _ex) {
                            startActivity(new android.content.Intent(android.content.Intent.ACTION_VIEW,
                                android.net.Uri.parse(_trackUrl)));
                        }
                    });
                });
                _quittungDlg.show();
            });
            layout.addView(btnQuittung);
        }

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
        // v6.63.610: Kapazitäten parallel zu vehIds
        final int[] vehCaps = {0, 4, 4, 4, 8, 8, 4};
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

        // 🆕 v6.63.503 (Patrick 28.06. Bridge: "Fahrt bearbeiten fehlt halt die Hälfte"):
        //   Fehlende Felder: Gastname, Preis, Notizen.
        TextView tvGuestLabel = new TextView(this);
        tvGuestLabel.setText("👤 Gastname (optional):");
        tvGuestLabel.setTextSize(13);
        tvGuestLabel.setPadding(0, pad, 0, padHalf);
        layout.addView(tvGuestLabel);
        final EditText etGuest = new EditText(this);
        etGuest.setHint("z.B. Herr Müller (wenn Hotel/Firma bucht)");
        etGuest.setText(r.guestName != null ? r.guestName : "");
        layout.addView(etGuest);

        TextView tvPriceLabel = new TextView(this);
        tvPriceLabel.setText("💰 Preis (€):");
        tvPriceLabel.setTextSize(13);
        tvPriceLabel.setPadding(0, pad, 0, padHalf);
        layout.addView(tvPriceLabel);
        final EditText etEditPrice = new EditText(this);
        etEditPrice.setHint("Leer = auto berechnen");
        etEditPrice.setInputType(InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_FLAG_DECIMAL);
        double _prefillP = (r.actualPrice != null && r.actualPrice > 0) ? r.actualPrice
            : (r.price != null && r.price > 0 ? r.price : 0.0);
        if (_prefillP > 0) etEditPrice.setText(String.format(Locale.GERMANY, "%.2f", _prefillP));
        layout.addView(etEditPrice);

        TextView tvNotesLabel = new TextView(this);
        tvNotesLabel.setText("📝 Notizen:");
        tvNotesLabel.setTextSize(13);
        tvNotesLabel.setPadding(0, pad, 0, padHalf);
        layout.addView(tvNotesLabel);
        final EditText etNotes = new EditText(this);
        etNotes.setHint("Interne Bemerkungen");
        etNotes.setMinLines(2);
        etNotes.setGravity(android.view.Gravity.TOP);
        etNotes.setText(r.notes != null ? r.notes : "");
        layout.addView(etNotes);

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
            int _newPax = spnPax.getSelectedItemPosition() + 1;
            // v6.63.610: Kapazitäts-Check — Warnung vor Zuweisung an zu kleines Fahrzeug
            if (vIdx > 0 && vIdx < vehCaps.length && vehCaps[vIdx] > 0 && _newPax > vehCaps[vIdx]) {
                Toast.makeText(this,
                    "⚠️ " + vehNames[vIdx] + " hat nur " + vehCaps[vIdx] + " Plätze — Fahrt hat " + _newPax + " Personen!",
                    Toast.LENGTH_LONG).show();
                // Kein return — Patrick kann trotzdem manuell überschreiben (er sieht die Warnung)
            }
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
            // v6.63.503: neue Felder Gastname, Preis, Notizen speichern
            String _guestVal = etGuest.getText().toString().trim();
            upd.put("guestName", _guestVal.isEmpty() ? null : _guestVal);
            String _notesVal = etNotes.getText().toString().trim();
            upd.put("notes", _notesVal.isEmpty() ? null : _notesVal);
            String _priceStr = etEditPrice.getText().toString().trim().replace(',', '.');
            if (!_priceStr.isEmpty()) {
                try {
                    double _priceVal = Double.parseDouble(_priceStr);
                    if (_priceVal > 0) {
                        upd.put("price", _priceVal);
                        upd.put("actualPrice", _priceVal);
                        upd.put("priceUpdatedAt", System.currentTimeMillis());
                    }
                } catch (NumberFormatException _ignore) {}
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

    // ── v6.63.666: Rückfahrt-Erkennung aus Notizen ──────────────────────────
    static class RueckfahrtHint {
        String dateStr; // z.B. "25.07"
        String timeStr; // z.B. "14:30"
    }

    private RueckfahrtHint _detectRueckfahrt(String notes) {
        if (notes == null) return null;
        String lower = notes.toLowerCase();
        if (!lower.contains("rückfahrt") && !lower.contains("ruckfahrt") && !lower.contains("rückweg")) return null;
        // Suche Datum+Uhrzeit ab dem Schlüsselwort
        int idx = lower.indexOf("rück");
        if (idx < 0) idx = 0;
        String sub = notes.substring(idx);
        java.util.regex.Pattern p = java.util.regex.Pattern.compile(
            "(?:am\\s+)?(\\d{1,2}\\.\\d{1,2}\\.?)\\s+(?:um\\s+)?(\\d{1,2}[.:]\\d{2})",
            java.util.regex.Pattern.CASE_INSENSITIVE);
        java.util.regex.Matcher m = p.matcher(sub);
        if (!m.find()) return null;
        RueckfahrtHint hint = new RueckfahrtHint();
        hint.dateStr = m.group(1).replaceAll("\\.$", "");
        hint.timeStr = m.group(2).replace(".", ":");
        return hint;
    }

    private void _createRueckfahrtRide(Anfrage a, String hinfahrtRideId, RueckfahrtHint hint) {
        // Datum aus hint parsen (DD.MM oder DD.MM.YYYY)
        try {
            String[] dateParts = hint.dateStr.split("\\.");
            int day   = Integer.parseInt(dateParts[0]);
            int month = Integer.parseInt(dateParts[1]) - 1; // Calendar: 0-basiert
            int year  = dateParts.length >= 3 && dateParts[2].length() == 4
                        ? Integer.parseInt(dateParts[2])
                        : java.util.Calendar.getInstance().get(java.util.Calendar.YEAR);
            String[] timeParts = hint.timeStr.split(":");
            int hour = Integer.parseInt(timeParts[0]);
            int min  = Integer.parseInt(timeParts[1]);
            java.util.Calendar cal = java.util.Calendar.getInstance();
            cal.set(year, month, day, hour, min, 0);
            cal.set(java.util.Calendar.MILLISECOND, 0);
            long pickupTs = cal.getTimeInMillis();
            // Rückfahrt = Ziel → Pickup vertauscht
            String rfPickup = a.destination != null ? a.destination : "";
            String rfDest   = a.pickup    != null ? a.pickup    : "";
            String timeStr  = String.format(java.util.Locale.GERMANY, "%02d:%02d", hour, min);
            String dateStr  = String.format(java.util.Locale.GERMANY, "%02d.%02d.%04d", day, month + 1, year);
            String newKey = FirebaseDatabase.getInstance(DB_INSTANCE_URL).getReference("rides").push().getKey();
            if (newKey == null) return;
            Map<String, Object> ride = new HashMap<>();
            ride.put("status",            "vorbestellt");
            ride.put("pickup",            rfPickup);
            ride.put("destination",       rfDest);
            ride.put("pickupTime",        timeStr);
            ride.put("pickupDate",        dateStr);
            ride.put("pickupTimestamp",   pickupTs);
            ride.put("passengers",        a.passengers != null ? a.passengers : 1);
            ride.put("customerName",      a.name);
            ride.put("customerPhone",     a.phone != null ? a.phone : "");
            ride.put("notes",             "Rückfahrt zu Anfrage " + (hinfahrtRideId != null ? hinfahrtRideId : ""));
            ride.put("createdAt",         System.currentTimeMillis());
            ride.put("updatedAt",         System.currentTimeMillis());
            ride.put("source",            "native_admin_rueckfahrt");
            ride.put("linkedHinfahrtId",  hinfahrtRideId);
            FirebaseDatabase.getInstance(DB_INSTANCE_URL).getReference("rides/" + newKey)
                .setValue(ride)
                .addOnSuccessListener(_v -> runOnUiThread(() ->
                    Toast.makeText(this, "✅ Rückfahrt angelegt: " + dateStr + " " + timeStr, Toast.LENGTH_LONG).show()))
                .addOnFailureListener(ex -> runOnUiThread(() ->
                    Toast.makeText(this, "Fehler Rückfahrt: " + ex.getMessage(), Toast.LENGTH_LONG).show()));
        } catch (Exception e) {
            Log.e("AdminDash", "_createRueckfahrtRide: " + e.getMessage(), e);
            Toast.makeText(this, "Fehler beim Parsen des Rückfahrt-Datums", Toast.LENGTH_SHORT).show();
        }
    }
}
