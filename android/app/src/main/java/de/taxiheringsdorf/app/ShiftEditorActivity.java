package de.taxiheringsdorf.app;

import android.content.Context;
import android.os.Bundle;
import android.text.format.DateFormat;
import android.util.Log;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.RecyclerView;

import com.google.android.material.appbar.MaterialToolbar;
import com.google.android.material.materialswitch.MaterialSwitch;
import com.google.android.material.tabs.TabLayout;
import com.google.firebase.database.DataSnapshot;
import com.google.firebase.database.DatabaseError;
import com.google.firebase.database.DatabaseReference;
import com.google.firebase.database.FirebaseDatabase;
import com.google.firebase.database.ValueEventListener;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Date;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Schichtplan-Editor in Native-App (Patrick 25.05.2026).
 * 3 Tabs: Editor | Anwesenheit | Fahrer-Plan-View.
 * Schreibt in /vehicleShifts/{vid}/defaults[dow] + /vehicleShifts/{vid}/{YYYY-MM-DD}/active.
 * Architektur 1:1 zum Web-Editor (index.html ~Z. 35181, 40057, 40435).
 */
public class ShiftEditorActivity extends AppCompatActivity {
    private static final String TAG = "ShiftEditor";
    private static final String DB_URL = "https://taxi-heringsdorf-default-rtdb.europe-west1.firebasedatabase.app";

    private static final String[] DAY_LABELS = {"So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"};

    // OFFICIAL_VEHICLES — analog zu functions/index.js. In-Memory weil sich das selten aendert.
    private static final Map<String, String> OFFICIAL_VEHICLES = new LinkedHashMap<String, String>() {{
        put("pw-my-222-e", "Tesla Model Y (PW-MY 222 E)");
        put("pw-ym-222-e", "Tesla Model Y (PW-YM 222 E)");
        put("pw-sk-222", "Renault Traffic 8 Pax (PW-SK 222)");
        put("pw-sj-222", "Mercedes Vito 8 Pax (PW-SJ 222)");
        put("pw-ki-222", "Toyota Prius KI (PW-KI 222)");
        put("pw-ik-222", "Toyota Prius IK (PW-IK 222)");
        put("vg-lk-111", "Mercedes Vito LK (VG-LK 111)");
        put("sbg-v-104", "Sprinter (SBG-V 104)");
    }};

    private FrameLayout content;
    private RecyclerView editorList;
    private LinearLayout attendanceContainer;
    private LinearLayout driverViewContainer;
    private RecyclerView attendanceList;
    private RecyclerView driverViewList;
    private TabLayout tabs;
    // v6.63.259: HEUTE IM DIENST Mini-Cards-Container + Hint
    private LinearLayout todayCardsContainer;
    private TextView todayEmptyHint;

    private final List<VehicleShift> data = new ArrayList<>();
    private VehicleAdapter adapter;
    private DatabaseReference shiftsRef;
    private ValueEventListener shiftsListener;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // 🆕 v6.62.929 (Patrick 25.05. 11:03 "Schicht-Editor stürzt ab"):
        //   Komplettes onCreate in try/catch — beim Crash zeigt Toast statt Hard-Crash,
        //   plus stacktrace in Crashlytics. Liefert beim naechsten Test die Info was
        //   genau gecrasht ist.
        try {
            setContentView(R.layout.activity_shift_editor);

            MaterialToolbar toolbar = findViewById(R.id.shift_editor_toolbar);
            if (toolbar != null) toolbar.setNavigationOnClickListener(v -> finish());

            content = findViewById(R.id.shift_content);
            editorList = findViewById(R.id.shift_editor_list);
            // v6.63.259: HEUTE IM DIENST Mini-Cards-Container
            todayCardsContainer = findViewById(R.id.shift_today_cards);
            todayEmptyHint = findViewById(R.id.shift_today_empty);
            attendanceContainer = findViewById(R.id.shift_attendance_container);
            driverViewContainer = findViewById(R.id.shift_driver_view_container);
            attendanceList = findViewById(R.id.shift_attendance_list);
            driverViewList = findViewById(R.id.shift_driver_view_list);
            tabs = findViewById(R.id.shift_tabs);

            if (editorList != null) editorList.setLayoutManager(new LinearLayoutManager(this));
            if (attendanceList != null) attendanceList.setLayoutManager(new LinearLayoutManager(this));
            if (driverViewList != null) driverViewList.setLayoutManager(new LinearLayoutManager(this));

            adapter = new VehicleAdapter();
            if (editorList != null) editorList.setAdapter(adapter);

            if (tabs != null) {
                tabs.addOnTabSelectedListener(new TabLayout.OnTabSelectedListener() {
                    @Override public void onTabSelected(TabLayout.Tab tab) { showTab(tab.getPosition()); }
                    @Override public void onTabUnselected(TabLayout.Tab tab) { }
                    @Override public void onTabReselected(TabLayout.Tab tab) { }
                });
            }

            // Initial empty: alle Fahrzeuge mit leeren Daten
            for (Map.Entry<String, String> e : OFFICIAL_VEHICLES.entrySet()) {
                VehicleShift vs = new VehicleShift();
                vs.vehicleId = e.getKey();
                vs.name = e.getValue();
                data.add(vs);
            }
            adapter.notifyDataSetChanged();

            attachListener();
        } catch (Throwable t) {
            Log.e(TAG, "🚨 ShiftEditor onCreate Crash: " + t.getMessage(), t);
            try {
                com.google.firebase.crashlytics.FirebaseCrashlytics.getInstance().recordException(t);
            } catch (Throwable _ignore) { /* Crashlytics evtl. nicht init */ }
            Toast.makeText(this, "Schicht-Editor Fehler: " + t.getMessage() + " — Crashlytics-Log gesendet", Toast.LENGTH_LONG).show();
            // Activity nicht killen — User kann zurueck navigieren
        }
    }

    private void showTab(int idx) {
        editorList.setVisibility(idx == 0 ? View.VISIBLE : View.GONE);
        attendanceContainer.setVisibility(idx == 1 ? View.VISIBLE : View.GONE);
        driverViewContainer.setVisibility(idx == 2 ? View.VISIBLE : View.GONE);

        if (idx == 1) {
            // 🆕 v6.62.943 (Patrick 25.05. 16:19 "1+2"): Anwesenheits-Tab.
            //   Listet alle aktiven Mitarbeiter (/staff/{id}/active=true) mit Switch
            //   fuer heute. Schreibt /attendance/{YYYY-MM-DD}/{staffId} = boolean.
            TextView label = findViewById(R.id.attendance_date_label);
            SimpleDateFormat _hdr = new SimpleDateFormat("EEEE, dd.MM.yyyy", Locale.GERMANY);
            label.setText("Anwesenheit — " + _hdr.format(new Date()));
            loadAttendance();
        } else if (idx == 2) {
            // 🆕 v6.62.943 Tab 3: Read-only Wochenplan pro Fahrzeug — selbe Daten
            //   wie Editor, aber ohne Bearbeiten-Buttons.
            TextView hint = findViewById(R.id.driver_view_hint);
            hint.setText("Wochenplan-Übersicht (read-only) — zum Bearbeiten Tab 'Editor' nutzen");
            loadDriverView();
        }
    }

    /* ─── v6.62.943 Tab 2: Anwesenheit ─── */
    private final List<Staff> _staffList = new ArrayList<>();
    private AttendanceAdapter _attAdapter;

    private static class Staff {
        String id;
        String firstName;
        String lastName;
        boolean attendedToday;
    }

    private void loadAttendance() {
        if (attendanceList == null) return;
        if (_attAdapter == null) {
            _attAdapter = new AttendanceAdapter();
            attendanceList.setAdapter(_attAdapter);
        }
        final String _today = todayDateKey();
        FirebaseDatabase.getInstance(DB_URL).getReference("staff").addListenerForSingleValueEvent(new ValueEventListener() {
            @Override public void onDataChange(@NonNull DataSnapshot staffSnap) {
                FirebaseDatabase.getInstance(DB_URL).getReference("attendance/" + _today).addListenerForSingleValueEvent(new ValueEventListener() {
                    @Override public void onDataChange(@NonNull DataSnapshot attSnap) {
                        try {
                            _staffList.clear();
                            for (DataSnapshot c : staffSnap.getChildren()) {
                                Boolean _active = c.child("active").getValue(Boolean.class);
                                if (Boolean.FALSE.equals(_active)) continue;
                                Staff s = new Staff();
                                s.id = c.getKey();
                                s.firstName = c.child("firstName").getValue(String.class);
                                s.lastName = c.child("lastName").getValue(String.class);
                                Boolean _att = attSnap.child(s.id).getValue(Boolean.class);
                                s.attendedToday = _att != null && _att;
                                _staffList.add(s);
                            }
                            _staffList.sort((a, b) -> {
                                String an = (a.lastName != null ? a.lastName : a.id);
                                String bn = (b.lastName != null ? b.lastName : b.id);
                                return an.compareToIgnoreCase(bn);
                            });
                            _attAdapter.notifyDataSetChanged();
                        } catch (Throwable t) { Log.w(TAG, "loadAttendance: " + t.getMessage()); }
                    }
                    @Override public void onCancelled(@NonNull DatabaseError error) {}
                });
            }
            @Override public void onCancelled(@NonNull DatabaseError error) {}
        });
    }

    private class AttendanceAdapter extends RecyclerView.Adapter<AttendanceAdapter.VH> {
        @NonNull @Override
        public VH onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
            LinearLayout row = new LinearLayout(parent.getContext());
            row.setOrientation(LinearLayout.HORIZONTAL);
            int pad = (int)(14 * parent.getResources().getDisplayMetrics().density);
            row.setPadding(pad, pad, pad, pad);
            row.setBackgroundColor(0xFF1E293B);
            LinearLayout.LayoutParams rowLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
            int mar = (int)(4 * parent.getResources().getDisplayMetrics().density);
            rowLp.setMargins(mar, mar, mar, mar);
            row.setLayoutParams(rowLp);
            TextView name = new TextView(parent.getContext());
            name.setTextColor(0xFFF8FAFC);
            name.setTextSize(15);
            LinearLayout.LayoutParams nameLp = new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1);
            name.setLayoutParams(nameLp);
            row.addView(name);
            MaterialSwitch sw = new MaterialSwitch(parent.getContext());
            sw.setText("");
            sw.setTextOn("");
            sw.setTextOff("");
            sw.setShowText(false);
            row.addView(sw);
            return new VH(row, name, sw);
        }
        @Override
        public void onBindViewHolder(@NonNull VH h, int position) {
            Staff s = _staffList.get(position);
            String _disp = (s.firstName != null ? s.firstName : "") + " " + (s.lastName != null ? s.lastName : s.id);
            h.name.setText(_disp.trim());
            h.sw.setOnCheckedChangeListener(null);
            h.sw.setChecked(s.attendedToday);
            h.sw.setOnCheckedChangeListener((btn, checked) -> {
                if (!btn.isPressed()) return;
                s.attendedToday = checked;
                String _today = todayDateKey();
                FirebaseDatabase.getInstance(DB_URL).getReference("attendance/" + _today + "/" + s.id)
                    .setValue(checked)
                    .addOnSuccessListener(unused -> Toast.makeText(ShiftEditorActivity.this,
                        _disp.trim() + ": " + (checked ? "ANWESEND" : "ABWESEND"), Toast.LENGTH_SHORT).show())
                    .addOnFailureListener(e -> Toast.makeText(ShiftEditorActivity.this,
                        "Fehler: " + e.getMessage(), Toast.LENGTH_LONG).show());
            });
        }
        @Override public int getItemCount() { return _staffList.size(); }
        class VH extends RecyclerView.ViewHolder {
            TextView name; MaterialSwitch sw;
            VH(View v, TextView n, MaterialSwitch s) { super(v); name = n; sw = s; }
        }
    }

    /* ─── v6.62.943 Tab 3: Read-only Wochenplan-Uebersicht ─── */
    private DriverViewAdapter _drvAdapter;

    private void loadDriverView() {
        if (driverViewList == null) return;
        if (_drvAdapter == null) {
            _drvAdapter = new DriverViewAdapter();
            driverViewList.setAdapter(_drvAdapter);
        }
        _drvAdapter.notifyDataSetChanged();
    }

    private class DriverViewAdapter extends RecyclerView.Adapter<DriverViewAdapter.VH> {
        @NonNull @Override
        public VH onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
            LinearLayout row = new LinearLayout(parent.getContext());
            row.setOrientation(LinearLayout.VERTICAL);
            int pad = (int)(14 * parent.getResources().getDisplayMetrics().density);
            row.setPadding(pad, pad, pad, pad);
            row.setBackgroundColor(0xFF1E293B);
            LinearLayout.LayoutParams rowLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
            int mar = (int)(4 * parent.getResources().getDisplayMetrics().density);
            rowLp.setMargins(mar, mar, mar, mar);
            row.setLayoutParams(rowLp);
            TextView name = new TextView(parent.getContext());
            name.setTextColor(0xFFF8FAFC);
            name.setTextSize(15);
            name.setTypeface(null, android.graphics.Typeface.BOLD);
            row.addView(name);
            TextView days = new TextView(parent.getContext());
            days.setTextColor(0xFF94A3B8);
            days.setTextSize(13);
            days.setPadding(0, (int)(4 * parent.getResources().getDisplayMetrics().density), 0, 0);
            row.addView(days);
            return new VH(row, name, days);
        }
        @Override
        public void onBindViewHolder(@NonNull VH h, int position) {
            VehicleShift vs = data.get(position);
            h.name.setText(vs.name);
            StringBuilder sb = new StringBuilder();
            for (int i = 0; i < 7; i++) {
                sb.append(DAY_LABELS[i]).append(vs.defaults[i] ? " ✅  " : " ⬜  ");
            }
            int dow = todayDow();
            boolean activeToday = vs.todayOverride ? (vs.todayActive != null && vs.todayActive) : vs.defaults[dow];
            sb.append("\nHeute: ").append(activeToday ? "AKTIV" : "INAKTIV");
            if (vs.todayOverride) sb.append(" (Override)");
            h.days.setText(sb.toString());
        }
        @Override public int getItemCount() { return data.size(); }
        class VH extends RecyclerView.ViewHolder {
            TextView name; TextView days;
            VH(View v, TextView n, TextView d) { super(v); name = n; days = d; }
        }
    }

    private void attachListener() {
        shiftsRef = FirebaseDatabase.getInstance(DB_URL).getReference("vehicleShifts");
        shiftsListener = new ValueEventListener() {
            @Override
            public void onDataChange(@NonNull DataSnapshot snap) {
                // v6.62.929: try/catch um den Parse-Block — wenn ein Fahrzeug ungewoehnliche
                //   Daten in Firebase hat (z.B. defaults als Object statt Array, oder
                //   {active:"true"} als String) → Snapshot-Parser wirft ClassCastException
                //   → Activity-Crash. Defensive parsing macht das tolerant.
                try {
                    String todayKey = todayDateKey();
                    for (VehicleShift vs : data) {
                        try {
                            DataSnapshot vSnap = snap.child(vs.vehicleId);
                            vs.defaults = new boolean[7];
                            DataSnapshot defSnap = vSnap.child("defaults");
                            if (defSnap.exists()) {
                                int i = 0;
                                for (DataSnapshot c : defSnap.getChildren()) {
                                    if (i < 7) {
                                        try {
                                            Object raw = c.getValue();
                                            if (raw instanceof Boolean) vs.defaults[i] = (Boolean) raw;
                                            else if (raw instanceof String) vs.defaults[i] = "true".equalsIgnoreCase((String) raw);
                                            else if (raw instanceof Number) vs.defaults[i] = ((Number) raw).intValue() != 0;
                                            else vs.defaults[i] = false;
                                        } catch (Throwable _ignore) { vs.defaults[i] = false; }
                                        i++;
                                    }
                                }
                            }
                            // Day-Override fuer heute
                            DataSnapshot todaySnap = vSnap.child(todayKey);
                            vs.todayOverride = todaySnap.exists();
                            vs.todayActive = null;
                            if (todaySnap.exists() && todaySnap.hasChild("active")) {
                                vs.todayActive = bool(todaySnap.child("active").getValue());
                            }
                            if (vs.todayOverride && vs.todayActive == null) vs.todayActive = true;
                            vs.todayStartTime = strOrNull(todaySnap.child("startTime").getValue());
                            vs.todayEndTime = strOrNull(todaySnap.child("endTime").getValue());
                            // 🆕 v6.63.010: defaultTimes-Map pro Wochentag parsen
                            vs.defaultTimes = new String[7][2];
                            DataSnapshot _dt = vSnap.child("defaultTimes");
                            if (_dt.exists()) {
                                for (DataSnapshot dtChild : _dt.getChildren()) {
                                    try {
                                        int dow = Integer.parseInt(dtChild.getKey());
                                        if (dow < 0 || dow > 6) continue;
                                        vs.defaultTimes[dow][0] = strOrNull(dtChild.child("startTime").getValue());
                                        vs.defaultTimes[dow][1] = strOrNull(dtChild.child("endTime").getValue());
                                    } catch (Throwable _ignore) { }
                                }
                            }
                        } catch (Throwable rowErr) {
                            Log.w(TAG, "Parse-Fehler fuer " + vs.vehicleId + ": " + rowErr.getMessage());
                        }
                    }
                    if (adapter != null) adapter.notifyDataSetChanged();
                    // v6.63.259: HEUTE IM DIENST Mini-Cards aufbauen
                    renderTodayCards();
                } catch (Throwable t) {
                    Log.e(TAG, "🚨 ShiftEditor onDataChange Crash: " + t.getMessage(), t);
                    try {
                        com.google.firebase.crashlytics.FirebaseCrashlytics.getInstance().recordException(t);
                    } catch (Throwable _ignore) {}
                }
            }
            @Override public void onCancelled(@NonNull DatabaseError error) {
                Log.e(TAG, "Listener err: " + error.getMessage());
            }
        };
        shiftsRef.addValueEventListener(shiftsListener);
    }

    private static Boolean bool(Object o) {
        if (o instanceof Boolean) return (Boolean) o;
        return null;
    }
    private static String strOrNull(Object o) { return o == null ? null : String.valueOf(o); }

    private static String todayDateKey() {
        SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd", Locale.GERMANY);
        return f.format(new Date());
    }

    private static int todayDow() {
        Calendar c = Calendar.getInstance();
        // Calendar.SUNDAY=1, MONDAY=2, ..., SATURDAY=7
        // Wir wollen 0=So, 1=Mo, ..., 6=Sa
        return c.get(Calendar.DAY_OF_WEEK) - 1;
    }

    @Override
    protected void onDestroy() {
        if (shiftsRef != null && shiftsListener != null) shiftsRef.removeEventListener(shiftsListener);
        super.onDestroy();
    }

    /* ─── v6.62.955 Time-Edit-Dialog (Patrick 25.05. 21:28 "selbst veraendern") ─── */
    /*    v6.62.996 (Patrick 28.05. 20:42 "alles selber aendern"): Datum-Picker eingebaut
     *    damit Patrick nicht nur HEUTE sondern beliebige Tage editieren kann. Speichert
     *    in vehicleShifts/{vid}/{YYYY-MM-DD} (gleicher Pfad wie Web-Editor → synchron). */
    private void showTimeEditDialog(VehicleShift vs) {
        // v6.63.181 (Patrick 05.06.2026 17:06 "egal ob ich Samstag oder Freitag nehme,
        //   springt auf 18 Uhr zurueck"): Default selDate = HEUTE statt morgen. Patrick
        //   hatte ein Override fuer Vito-heute (Vito-Schicht bis 17 statt 18 Uhr) gemacht
        //   aber selDate=morgen → Save ging in 2026-06-06 (morgen) statt 2026-06-05 (heute).
        //   Heute-Default ist intuitiver fuer das "fix-it-now"-Use-Case. Wer morgen planen
        //   will, picked das Datum bewusst.
        final Calendar selDate = Calendar.getInstance();
        // 🆕 v6.63.010 (Patrick 29.05. 16:44 "wo ist das Problem den Schichtplan
        //   aufs Handy zu übernehmen"): Pre-Fill aus defaultTimes[dow_of_selDate]
        //   falls vorhanden, statt vs.todayStartTime (= HEUTIGER Tag, falsch wenn
        //   Datum vorher umgeschaltet wurde). Fallback bleibt todayStartTime.
        final int _initDow = selDate.get(Calendar.DAY_OF_WEEK) - 1;
        final String _dtStart = (vs.defaultTimes != null && vs.defaultTimes[_initDow] != null) ? vs.defaultTimes[_initDow][0] : null;
        final String _dtEnd = (vs.defaultTimes != null && vs.defaultTimes[_initDow] != null) ? vs.defaultTimes[_initDow][1] : null;
        final int[] startHM = parseHM(_dtStart != null ? _dtStart : (vs.todayStartTime != null ? vs.todayStartTime : "06:00"));
        final int[] endHM = parseHM(_dtEnd != null ? _dtEnd : (vs.todayEndTime != null ? vs.todayEndTime : "22:00"));

        // 🆕 v6.62.956 (Patrick 25.05. 21:38 'kann End-Zeit nicht einstellen, mach kleiner'):
        //   Statt riesigen TimePickern (Clock-Mode) machen wir simple HH:MM-Inputs mit Stepper-Buttons.
        //   Passt auch auf S9+ Screen mit 2x Zeit-Einstellung.
        android.widget.LinearLayout root = new android.widget.LinearLayout(this);
        root.setOrientation(android.widget.LinearLayout.VERTICAL);
        int pad = (int)(16 * getResources().getDisplayMetrics().density);
        root.setPadding(pad, pad, pad, pad);

        final int[] start = { startHM[0], startHM[1] };
        final int[] end = { endHM[0], endHM[1] };

        // v6.62.996: Datum-Picker oben
        android.widget.LinearLayout dateRow = new android.widget.LinearLayout(this);
        dateRow.setOrientation(android.widget.LinearLayout.HORIZONTAL);
        dateRow.setGravity(android.view.Gravity.CENTER_VERTICAL);
        android.widget.TextView dateLbl = new android.widget.TextView(this);
        dateLbl.setText("📅 Datum:");
        dateLbl.setTextSize(15);
        dateLbl.setTypeface(null, android.graphics.Typeface.BOLD);
        dateLbl.setTextColor(0xFFF8FAFC);
        android.widget.LinearLayout.LayoutParams dLp = new android.widget.LinearLayout.LayoutParams(0,
            android.widget.LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
        dateLbl.setLayoutParams(dLp);
        dateRow.addView(dateLbl);
        final android.widget.Button btnDate = new android.widget.Button(this);
        final SimpleDateFormat _dfDisplay = new SimpleDateFormat("EEE dd.MM.yyyy", Locale.GERMANY);
        btnDate.setText(_dfDisplay.format(selDate.getTime()));
        // v6.62.998 Bug-Fix (Patrick 28.05. 20:59): Click-Listener kommt unten gesetzt
        //   damit er cbAllSame referenzieren kann (Wochentag-Label muss bei Datum-Wechsel
        //   auch aktualisiert werden — sonst stand 'Freitage' obwohl Samstag gewaehlt).
        dateRow.addView(btnDate);
        root.addView(dateRow);

        // Abstand
        android.view.View spacer = new android.view.View(this);
        android.widget.LinearLayout.LayoutParams spLp = new android.widget.LinearLayout.LayoutParams(
            android.widget.LinearLayout.LayoutParams.MATCH_PARENT, (int)(8 * getResources().getDisplayMetrics().density));
        spacer.setLayoutParams(spLp);
        root.addView(spacer);

        // START-Zeile
        android.widget.LinearLayout startRow = makeTimeRow(this, "🟢 START:", start);
        root.addView(startRow);

        // ENDE-Zeile
        android.widget.LinearLayout endRow = makeTimeRow(this, "🔴 ENDE:", end);
        endRow.setPadding(0, pad, 0, 0);
        root.addView(endRow);

        // 🆕 v6.63.218 (Patrick 07.06. 13:12 "Web sagt Mo 05:45, Native sagt Mo 07:00"):
        //   Beim Datum-Wechsel müssen start[]/end[] aus defaultTimes des NEUEN Wochentags
        //   nachgezogen werden. Sonst bleiben die HEUTE (Sonntag-Werte) sichtbar wenn Patrick
        //   auf Mo wechselt — das wirkte als ob Web/Native nicht synchron wären.
        //   Wir greifen den TextView val (Child-Index 2 in makeTimeRow) heraus, um den Text zu refreshen.
        final android.widget.TextView _startVal = (android.widget.TextView) startRow.getChildAt(2);
        final android.widget.TextView _endVal = (android.widget.TextView) endRow.getChildAt(2);

        // 🆕 v6.62.999 (Patrick 28.05. 21:06 "F heute"): Split-Shift-Support.
        //   Spätschicht-Block kann hinzugefügt werden — Speichert dann als timeRanges-
        //   Array (kompatibel mit Web-Editor index.html Z~41181).
        final int[] start2 = { 18, 0 };
        final int[] end2 = { 22, 0 };
        final boolean[] hasLate = { false };
        final android.widget.LinearLayout lateContainer = new android.widget.LinearLayout(this);
        lateContainer.setOrientation(android.widget.LinearLayout.VERTICAL);
        lateContainer.setVisibility(android.view.View.GONE);
        android.view.View lateDivider = new android.view.View(this);
        android.widget.LinearLayout.LayoutParams dvLp = new android.widget.LinearLayout.LayoutParams(
            android.widget.LinearLayout.LayoutParams.MATCH_PARENT, (int)(1 * getResources().getDisplayMetrics().density));
        dvLp.setMargins(0, pad, 0, pad / 2);
        lateDivider.setLayoutParams(dvLp);
        lateDivider.setBackgroundColor(0xFF334155);
        lateContainer.addView(lateDivider);
        android.widget.TextView lateLbl = new android.widget.TextView(this);
        lateLbl.setText("🌇 SPÄTSCHICHT");
        lateLbl.setTextSize(13);
        lateLbl.setTypeface(null, android.graphics.Typeface.BOLD);
        lateLbl.setTextColor(0xFFFBBF24);
        lateLbl.setPadding(0, 0, 0, pad / 2);
        lateContainer.addView(lateLbl);
        android.widget.LinearLayout late1 = makeTimeRow(this, "🟢 START:", start2);
        lateContainer.addView(late1);
        android.widget.LinearLayout late2 = makeTimeRow(this, "🔴 ENDE:", end2);
        late2.setPadding(0, pad / 2, 0, 0);
        lateContainer.addView(late2);
        root.addView(lateContainer);

        final android.widget.Button btnAddLate = new android.widget.Button(this);
        btnAddLate.setText("➕ Spätschicht hinzufügen");
        btnAddLate.setTextSize(13);
        android.widget.LinearLayout.LayoutParams addLp = new android.widget.LinearLayout.LayoutParams(
            android.widget.LinearLayout.LayoutParams.MATCH_PARENT, android.widget.LinearLayout.LayoutParams.WRAP_CONTENT);
        addLp.setMargins(0, pad / 2, 0, 0);
        btnAddLate.setLayoutParams(addLp);
        btnAddLate.setOnClickListener(v -> {
            if (!hasLate[0]) {
                hasLate[0] = true;
                lateContainer.setVisibility(android.view.View.VISIBLE);
                btnAddLate.setText("➖ Spätschicht entfernen");
            } else {
                hasLate[0] = false;
                lateContainer.setVisibility(android.view.View.GONE);
                btnAddLate.setText("➕ Spätschicht hinzufügen");
            }
        });
        root.addView(btnAddLate);

        // Hint
        android.widget.TextView hint = new android.widget.TextView(this);
        hint.setText("Mit '+' / '−' Buttons aendern. 15-Min-Schritte. Lang-Tippen = ±60 Min.");
        hint.setTextSize(11);
        hint.setTextColor(0xFF94A3B8);
        hint.setPadding(0, pad, 0, 0);
        root.addView(hint);

        // 🆕 v6.62.957 (Patrick 26.05. 07:15 'Also heute'): Checkbox 'Auch fuer alle <Wochentag> setzen'
        // schreibt zusaetzlich /vehicleShifts/{vid}/defaultTimes/{dow} damit naechste Woche
        // gleicher Wochentag automatisch dieselbe Zeit hat.
        // v6.62.996: dow wird aus selDate berechnet (kann sich aendern wenn Patrick Datum
        // picked), nicht mehr aus today.
        final String[] dayNames = {"Sonntage", "Montage", "Dienstage", "Mittwoche", "Donnerstage", "Freitage", "Samstage"};
        // v6.63.182 (05.06.) cbAllSame Default ON.
        // v6.63.216 (Patrick 07.06. 11:34): Patrick will doch Override-Möglichkeit aus Native
        //   ('weil ich nicht jeden Tag am Computer bin'). Default bleibt ON (Wochenplan),
        //   aber Häkchen ABwählbar damit nur Tag-Override geschrieben wird.
        final android.widget.CheckBox cbAllSame = new android.widget.CheckBox(this);
        cbAllSame.setText("📅 Hauptschicht für alle " + dayNames[selDate.get(Calendar.DAY_OF_WEEK) - 1] + " ändern");
        cbAllSame.setChecked(true);
        cbAllSame.setTextSize(13);
        cbAllSame.setPadding(0, pad/2, 0, 0);
        root.addView(cbAllSame);
        android.widget.TextView _allSameHint = new android.widget.TextView(this);
        _allSameHint.setText("✓ angekreuzt = Wochenplan-Hauptschicht ändern · ✗ deaktiviert = NUR diesen einen Tag überschreiben (Override)");
        _allSameHint.setTextSize(10);
        _allSameHint.setTextColor(0xFF94A3B8);
        _allSameHint.setPadding(0, 0, 0, pad/2);
        root.addView(_allSameHint);

        // v6.62.996: Inaktiv-Switch — Fahrzeug fuer diesen Tag komplett offline setzen
        final android.widget.CheckBox cbInactive = new android.widget.CheckBox(this);
        cbInactive.setText("🚫 Fahrzeug an diesem Tag NICHT fahren lassen (offline)");
        cbInactive.setChecked(false);
        cbInactive.setTextSize(13);
        cbInactive.setPadding(0, pad/4, 0, 0);
        root.addView(cbInactive);

        // v6.62.998 (Patrick 28.05. 20:59 Bug): Click-Listener fuer btnDate erst HIER setzen
        //   damit das Lambda cbAllSame referenzieren und dessen Wochentag-Label updaten
        //   kann wenn Patrick das Datum wechselt.
        btnDate.setOnClickListener(v -> {
            android.app.DatePickerDialog dp = new android.app.DatePickerDialog(this,
                (view, year, month, day) -> {
                    selDate.set(Calendar.YEAR, year);
                    selDate.set(Calendar.MONTH, month);
                    selDate.set(Calendar.DAY_OF_MONTH, day);
                    btnDate.setText(_dfDisplay.format(selDate.getTime()));
                    // v6.62.998: Checkbox-Text auf neuen Wochentag aktualisieren
                    int _newDow = selDate.get(Calendar.DAY_OF_WEEK) - 1;
                    cbAllSame.setText("📅 Auch fuer alle " + dayNames[_newDow] + " als Standard setzen");
                    // 🆕 v6.63.218: Zeiten aus defaultTimes[_newDow] neu laden
                    String _ns = (vs.defaultTimes != null && vs.defaultTimes[_newDow] != null) ? vs.defaultTimes[_newDow][0] : null;
                    String _ne = (vs.defaultTimes != null && vs.defaultTimes[_newDow] != null) ? vs.defaultTimes[_newDow][1] : null;
                    int[] _newStart = parseHM(_ns != null ? _ns : "06:00");
                    int[] _newEnd = parseHM(_ne != null ? _ne : "22:00");
                    start[0] = _newStart[0]; start[1] = _newStart[1];
                    end[0] = _newEnd[0]; end[1] = _newEnd[1];
                    _startVal.setText(String.format(Locale.GERMANY, "  %02d:%02d  ", start[0], start[1]));
                    _endVal.setText(String.format(Locale.GERMANY, "  %02d:%02d  ", end[0], end[1]));
                },
                selDate.get(Calendar.YEAR), selDate.get(Calendar.MONTH), selDate.get(Calendar.DAY_OF_MONTH));
            dp.show();
        });
        // v6.62.999: ScrollView damit Dialog scrollbar wird wenn Spätschicht aufgeklappt
        android.widget.ScrollView scroll = new android.widget.ScrollView(this);
        scroll.addView(root);
        new androidx.appcompat.app.AlertDialog.Builder(this)
            .setTitle("⏰ " + vs.name + " — Schicht")
            .setView(scroll)
            .setPositiveButton("Speichern", (d, w) -> {
                String startStr = String.format(Locale.GERMANY, "%02d:%02d", start[0], start[1]);
                String endStr = String.format(Locale.GERMANY, "%02d:%02d", end[0], end[1]);
                // v6.62.996: Datum-Key aus selDate (statt heute)
                SimpleDateFormat _df = new SimpleDateFormat("yyyy-MM-dd", Locale.GERMANY);
                String dateKey = _df.format(selDate.getTime());
                int dowSel = selDate.get(Calendar.DAY_OF_WEEK) - 1; // 0=So, 6=Sa
                String _dayLabel = _dfDisplay.format(selDate.getTime());
                boolean inactive = cbInactive.isChecked();

                Map<String, Object> entry = new HashMap<>();
                if (inactive) {
                    // v6.62.996: Tag-Override: Fahrzeug am Tag offline
                    entry.put("active", false);
                    entry.put("isException", true);
                    entry.put("setAt", System.currentTimeMillis());
                    entry.put("setBy", "native-shift-editor-v999-inactive");
                } else {
                    entry.put("active", true);
                    entry.put("isException", true);
                    entry.put("additiveException", false);
                    entry.put("setAt", System.currentTimeMillis());
                    entry.put("setBy", "native-shift-editor-v999");
                    // 🆕 v6.62.999: Split-Shift-Support — timeRanges-Array wenn Spätschicht aktiv
                    if (hasLate[0]) {
                        String start2Str = String.format(Locale.GERMANY, "%02d:%02d", start2[0], start2[1]);
                        String end2Str = String.format(Locale.GERMANY, "%02d:%02d", end2[0], end2[1]);
                        java.util.List<Map<String, Object>> ranges = new java.util.ArrayList<>();
                        Map<String, Object> r1 = new HashMap<>();
                        r1.put("startTime", startStr); r1.put("endTime", endStr);
                        ranges.add(r1);
                        Map<String, Object> r2 = new HashMap<>();
                        r2.put("startTime", start2Str); r2.put("endTime", end2Str);
                        ranges.add(r2);
                        // sortieren nach startTime damit Web-Editor sie korrekt rendert
                        ranges.sort((a, b) -> String.valueOf(a.get("startTime")).compareTo(String.valueOf(b.get("startTime"))));
                        entry.put("timeRanges", ranges);
                        // startTime/endTime als Span fuer Backwards-Kompat
                        entry.put("startTime", ranges.get(0).get("startTime"));
                        entry.put("endTime", ranges.get(ranges.size() - 1).get("endTime"));
                    } else {
                        entry.put("startTime", startStr);
                        entry.put("endTime", endStr);
                    }
                }
                // v6.62.957/996/999: defaultTimes parallel setzen wenn Checkbox aktiv
                if (cbAllSame.isChecked() && !inactive) {
                    Map<String, Object> defT = new HashMap<>();
                    if (hasLate[0]) {
                        // Split-Shift im Wochenplan
                        String start2Str = String.format(Locale.GERMANY, "%02d:%02d", start2[0], start2[1]);
                        String end2Str = String.format(Locale.GERMANY, "%02d:%02d", end2[0], end2[1]);
                        java.util.List<Map<String, Object>> ranges = new java.util.ArrayList<>();
                        Map<String, Object> r1 = new HashMap<>();
                        r1.put("startTime", startStr); r1.put("endTime", endStr); ranges.add(r1);
                        Map<String, Object> r2 = new HashMap<>();
                        r2.put("startTime", start2Str); r2.put("endTime", end2Str); ranges.add(r2);
                        ranges.sort((a, b) -> String.valueOf(a.get("startTime")).compareTo(String.valueOf(b.get("startTime"))));
                        defT.put("timeRanges", ranges);
                        defT.put("startTime", ranges.get(0).get("startTime"));
                        defT.put("endTime", ranges.get(ranges.size() - 1).get("endTime"));
                    } else {
                        defT.put("startTime", startStr);
                        defT.put("endTime", endStr);
                    }
                    FirebaseDatabase.getInstance(DB_URL)
                        .getReference("vehicleShifts/" + vs.vehicleId + "/defaultTimes/" + dowSel)
                        .updateChildren(defT)
                        .addOnSuccessListener(_ok -> Toast.makeText(this,
                            "📅 Default fuer alle " + dayNames[dowSel] + " gesetzt", Toast.LENGTH_LONG).show());
                    // 🆕 v6.62.999: defaults[dow]=true ebenfalls setzen, sonst greift der Web-
                    //   Editor die defaultTimes nicht als 'Tag aktiv' (siehe index.html
                    //   Z36454 _isDayActiveByDefault).
                    FirebaseDatabase.getInstance(DB_URL)
                        .getReference("vehicleShifts/" + vs.vehicleId + "/defaults/" + dowSel)
                        .setValue(true);
                }
                // v6.63.182 (Patrick 05.06.2026 17:48-17:53 Bridge): UI-Umkehrung.
                //   Wenn cbAllSame CHECKED (Default, intuitive Erwartung "Hauptschicht ändern"):
                //     → KEIN Override für den Tag schreiben — defaultTimes wurde oben bereits
                //       in Z 631+ gesetzt, das reicht. Plus: alte Tag-Override für diesen
                //       Datums-Key löschen damit keine "zwei Schichten" parallel angezeigt
                //       werden (Patricks Bug 17:13 "baut nur eine zusätzliche Schicht ein").
                //   Wenn cbAllSame UNCHECKED (User will nur diesen einen Tag überschreiben):
                //     → Tag-Override schreiben wie bisher.
                final String _todayKey = todayDateKey();
                final String _datumWarn = _todayKey.equals(dateKey) ? "" : "  ⚠️ NICHT HEUTE";
                if (cbAllSame.isChecked() && !inactive) {
                    // Hauptschicht-Mode: nur defaults setzen (oben schon erledigt), alte
                    //   Tag-Exception aufräumen damit Web-Editor keine 2 Schichten zeigt.
                    FirebaseDatabase.getInstance(DB_URL)
                        .getReference("vehicleShifts/" + vs.vehicleId + "/" + dateKey)
                        .removeValue()
                        .addOnSuccessListener(unused -> Toast.makeText(this,
                            "✅ " + vs.name + ": HAUPTSCHICHT alle " + dayNames[dowSel] + " → " + startStr + "–" + endStr,
                            Toast.LENGTH_LONG).show())
                        .addOnFailureListener(e -> Toast.makeText(this,
                            "Fehler beim Aufräumen: " + e.getMessage(), Toast.LENGTH_LONG).show());
                    return;
                }
                // Override-Mode (cbAllSame OFF oder inactive): nur Tag-Exception schreiben
                FirebaseDatabase.getInstance(DB_URL)
                    .getReference("vehicleShifts/" + vs.vehicleId + "/" + dateKey)
                    .setValue(entry)
                    .addOnSuccessListener(unused -> Toast.makeText(this,
                        "✅ " + vs.name + ": " + _dayLabel + " (NUR HEUTE) — " + (inactive ? "OFFLINE" : startStr + "–" + endStr) + _datumWarn,
                        Toast.LENGTH_LONG).show())
                    .addOnFailureListener(e -> Toast.makeText(this,
                        "Fehler: " + e.getMessage(), Toast.LENGTH_LONG).show());
            })
            .setNegativeButton("Abbrechen", null)
            .show();
    }

    // 🆕 v6.63.003 (Patrick 29.05. 06:40): Wochenplan-Zeit-Editor pro Wochentag.
    //   Long-Press auf Mo/Di/Mi/.../So-Button → dieser Dialog. Speichert in
    //   vehicleShifts/{vid}/defaultTimes/{dow} + setzt defaults[dow]=true.
    //   Synchron mit Web-Editor.
    private void showWeekDayTimeEditDialog(VehicleShift vs, int dow) {
        // Aktuelle Default-Zeiten laden
        FirebaseDatabase.getInstance(DB_URL)
            .getReference("vehicleShifts/" + vs.vehicleId + "/defaultTimes/" + dow)
            .addListenerForSingleValueEvent(new ValueEventListener() {
                @Override
                public void onDataChange(@NonNull DataSnapshot s) {
                    String startTxt = strOrNull(s.child("startTime").getValue());
                    String endTxt = strOrNull(s.child("endTime").getValue());
                    final int[] start = parseHM(startTxt != null ? startTxt : "06:00");
                    final int[] end = parseHM(endTxt != null ? endTxt : "22:00");

                    android.widget.LinearLayout root = new android.widget.LinearLayout(ShiftEditorActivity.this);
                    root.setOrientation(android.widget.LinearLayout.VERTICAL);
                    int pad = (int)(16 * getResources().getDisplayMetrics().density);
                    root.setPadding(pad, pad, pad, pad);

                    final String[] dayNames = {"Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"};
                    android.widget.TextView hdr = new android.widget.TextView(ShiftEditorActivity.this);
                    hdr.setText("Wochenplan-Schicht für jeden " + dayNames[dow] + ":");
                    hdr.setTextColor(0xFFCBD5E1);
                    hdr.setTextSize(13);
                    hdr.setPadding(0, 0, 0, pad / 2);
                    root.addView(hdr);

                    android.widget.LinearLayout startRow = makeTimeRow(ShiftEditorActivity.this, "🟢 START:", start);
                    root.addView(startRow);
                    android.widget.LinearLayout endRow = makeTimeRow(ShiftEditorActivity.this, "🔴 ENDE:", end);
                    endRow.setPadding(0, pad, 0, 0);
                    root.addView(endRow);

                    android.widget.TextView hint = new android.widget.TextView(ShiftEditorActivity.this);
                    hint.setText("Gilt für ALLE " + dayNames[dow] + "e — überschreibt Tag-Ausnahmen nicht.");
                    hint.setTextSize(11);
                    hint.setTextColor(0xFF94A3B8);
                    hint.setPadding(0, pad, 0, 0);
                    root.addView(hint);

                    new androidx.appcompat.app.AlertDialog.Builder(ShiftEditorActivity.this)
                        .setTitle("📅 " + vs.name + " — " + dayNames[dow])
                        .setView(root)
                        .setPositiveButton("Speichern", (d, w) -> {
                            String startStr = String.format(Locale.GERMANY, "%02d:%02d", start[0], start[1]);
                            String endStr = String.format(Locale.GERMANY, "%02d:%02d", end[0], end[1]);
                            Map<String, Object> upd = new HashMap<>();
                            upd.put("startTime", startStr);
                            upd.put("endTime", endStr);
                            // timeRanges löschen damit Split-Shifts hier nicht hängen bleiben
                            upd.put("timeRanges", null);
                            FirebaseDatabase.getInstance(DB_URL)
                                .getReference("vehicleShifts/" + vs.vehicleId + "/defaultTimes/" + dow)
                                .updateChildren(upd)
                                .addOnSuccessListener(_ok -> {
                                    // Tag im Wochenplan aktivieren (defaults[dow] = true)
                                    FirebaseDatabase.getInstance(DB_URL)
                                        .getReference("vehicleShifts/" + vs.vehicleId + "/defaults/" + dow)
                                        .setValue(true);
                                    Toast.makeText(ShiftEditorActivity.this,
                                        vs.name + " " + dayNames[dow] + ": " + startStr + "–" + endStr, Toast.LENGTH_LONG).show();
                                })
                                .addOnFailureListener(e -> Toast.makeText(ShiftEditorActivity.this,
                                    "Fehler: " + e.getMessage(), Toast.LENGTH_LONG).show());
                        })
                        .setNeutralButton("Tag DEAKTIVIEREN", (d, w) -> {
                            FirebaseDatabase.getInstance(DB_URL)
                                .getReference("vehicleShifts/" + vs.vehicleId + "/defaults/" + dow)
                                .setValue(false)
                                .addOnSuccessListener(_ok -> Toast.makeText(ShiftEditorActivity.this,
                                    vs.name + " " + dayNames[dow] + ": AUS", Toast.LENGTH_SHORT).show());
                        })
                        .setNegativeButton("Abbrechen", null)
                        .show();
                }
                @Override
                public void onCancelled(@NonNull DatabaseError error) {
                    Toast.makeText(ShiftEditorActivity.this, "Lade-Fehler: " + error.getMessage(), Toast.LENGTH_LONG).show();
                }
            });
    }

    // v6.62.956: kompakter Zeit-Stepper (Label + −15min + HH:MM + +15min)
    private static android.widget.LinearLayout makeTimeRow(Context ctx, String label, int[] hm) {
        android.widget.LinearLayout row = new android.widget.LinearLayout(ctx);
        row.setOrientation(android.widget.LinearLayout.HORIZONTAL);
        row.setGravity(android.view.Gravity.CENTER_VERTICAL);

        android.widget.TextView lbl = new android.widget.TextView(ctx);
        lbl.setText(label);
        lbl.setTextSize(16);
        lbl.setTypeface(null, android.graphics.Typeface.BOLD);
        lbl.setTextColor(0xFFF8FAFC);
        android.widget.LinearLayout.LayoutParams lblLp = new android.widget.LinearLayout.LayoutParams(0,
            android.widget.LinearLayout.LayoutParams.WRAP_CONTENT, 1.2f);
        lbl.setLayoutParams(lblLp);
        row.addView(lbl);

        android.widget.Button minus = new android.widget.Button(ctx);
        minus.setText("−15");
        minus.setTextSize(13);
        row.addView(minus);

        android.widget.TextView val = new android.widget.TextView(ctx);
        val.setText(String.format(Locale.GERMANY, "  %02d:%02d  ", hm[0], hm[1]));
        val.setTextSize(20);
        val.setTypeface(null, android.graphics.Typeface.BOLD);
        val.setTextColor(0xFFFCD34D);
        val.setGravity(android.view.Gravity.CENTER);
        android.widget.LinearLayout.LayoutParams valLp = new android.widget.LinearLayout.LayoutParams(0,
            android.widget.LinearLayout.LayoutParams.WRAP_CONTENT, 1.5f);
        val.setLayoutParams(valLp);
        row.addView(val);

        android.widget.Button plus = new android.widget.Button(ctx);
        plus.setText("+15");
        plus.setTextSize(13);
        row.addView(plus);

        Runnable update = () -> val.setText(String.format(Locale.GERMANY, "  %02d:%02d  ", hm[0], hm[1]));
        minus.setOnClickListener(v -> {
            int total = hm[0] * 60 + hm[1] - 15;
            if (total < 0) total += 24 * 60;
            hm[0] = total / 60; hm[1] = total % 60;
            update.run();
        });
        plus.setOnClickListener(v -> {
            int total = hm[0] * 60 + hm[1] + 15;
            total = total % (24 * 60);
            hm[0] = total / 60; hm[1] = total % 60;
            update.run();
        });
        // Lang-Tippen = ±60 Min
        minus.setOnLongClickListener(v -> {
            int total = hm[0] * 60 + hm[1] - 60;
            if (total < 0) total += 24 * 60;
            hm[0] = total / 60; hm[1] = total % 60;
            update.run();
            return true;
        });
        plus.setOnLongClickListener(v -> {
            int total = hm[0] * 60 + hm[1] + 60;
            total = total % (24 * 60);
            hm[0] = total / 60; hm[1] = total % 60;
            update.run();
            return true;
        });
        return row;
    }

    private static int[] parseHM(String s) {
        try {
            String[] p = s.split(":");
            return new int[]{ Integer.parseInt(p[0]), Integer.parseInt(p[1]) };
        } catch (Throwable t) {
            return new int[]{ 6, 0 };
        }
    }

    /* ─── Model ─── */
    static class VehicleShift {
        String vehicleId;
        String name;
        boolean[] defaults = new boolean[7];
        boolean todayOverride;
        Boolean todayActive;
        String todayStartTime;
        String todayEndTime;
        // 🆕 v6.63.010: defaultTimes pro Wochentag laden, damit der Native-Editor
        //   den Wochenplan als Pre-Fill nutzen kann (statt todayStartTime bei
        //   beliebigem Datums-Wechsel). Format: [startTime, endTime] pro dow 0..6.
        String[][] defaultTimes = new String[7][2];
    }

    /**
     * 🆕 v6.63.262 (Patrick 10.06. 09:43 "Standort"): Reverse-Lookup GPS → Ortsteil
     * via nächstgelegener Anker-Punkt aus einer fest definierten Liste der Hauptorte
     * im Usedom-/Vorpommern-Raum. Vermeidet Live-Nominatim-Calls in Native (Quota +
     * Latenz). Lokationen wurden manuell aus OSM ausgelesen.
     */
    private static final double[][] ORT_ANKERS = {
        // {lat, lon, label}
        // — nicht primitive, daher Strings separat
    };
    private static final double[] ANKER_LAT  = {53.946, 53.930, 53.973, 54.072, 54.105, 54.053, 53.870, 53.823, 54.039, 54.143, 54.082};
    private static final double[] ANKER_LON  = {14.171, 14.207, 14.135, 13.921, 13.402, 13.770, 14.066, 14.013, 14.196, 13.745, 13.892};
    private static final String[] ANKER_NAME = {"Heringsdorf", "Ahlbeck", "Bansin", "Zinnowitz", "Greifswald", "Wolgast", "Usedom-Stadt", "Garz/Flughafen", "Swinemünde", "Stralsund", "Trassenheide"};

    private static String reverseLookupOrt(Double lat, Double lon) {
        if (lat == null || lon == null) return null;
        double bestKm = 9999;
        String best = null;
        for (int i = 0; i < ANKER_LAT.length; i++) {
            double dLat = (ANKER_LAT[i] - lat) * 111.0;
            double dLon = (ANKER_LON[i] - lon) * 71.0; // ~grobe km bei 54°N
            double km = Math.sqrt(dLat * dLat + dLon * dLon);
            if (km < bestKm) { bestKm = km; best = ANKER_NAME[i]; }
        }
        if (best != null && bestKm > 30) return best + " (~" + Math.round(bestKm) + "km)";
        return best;
    }

    /**
     * 🆕 v6.63.259 (Patrick 10.06. 08:00 "Ich sehe nicht wer Dienst hat"):
     * Mini-Cards-Container ueber der Editor-Liste mit Schicht-Status pro Fahrzeug.
     * Pro Card: Fahrzeug-Name + 🟢/🟡/⚫ Status + Schicht-Zeitraum (heute).
     * v6.63.260: Tap → Zeit-Edit-Dialog.
     * v6.63.262: Standort (📍 Ortsteil) aus /vehicles/{vid}/lat,lon.
     */
    private void renderTodayCards() {
        if (todayCardsContainer == null) return;
        todayCardsContainer.removeAllViews();
        if (data.isEmpty()) {
            if (todayEmptyHint != null) todayEmptyHint.setVisibility(View.VISIBLE);
            return;
        }
        if (todayEmptyHint != null) todayEmptyHint.setVisibility(View.GONE);

        java.util.Calendar cal = java.util.Calendar.getInstance();
        int dow = cal.get(java.util.Calendar.DAY_OF_WEEK) - 1; // 0=So .. 6=Sa
        float dp = getResources().getDisplayMetrics().density;

        for (VehicleShift vs : data) {
            boolean activeToday = vs.todayOverride
                ? (vs.todayActive != null && vs.todayActive)
                : (vs.defaults != null && vs.defaults[dow]);
            String startT = vs.todayOverride ? vs.todayStartTime : vs.defaultTimes[dow][0];
            String endT   = vs.todayOverride ? vs.todayEndTime   : vs.defaultTimes[dow][1];

            // Mini-Card pro Fahrzeug
            LinearLayout card = new LinearLayout(this);
            card.setOrientation(LinearLayout.VERTICAL);
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                (int)(150 * dp), LinearLayout.LayoutParams.WRAP_CONTENT);
            lp.setMargins(0, 0, (int)(8 * dp), 0);
            card.setLayoutParams(lp);
            card.setBackgroundColor(0xFF0F172A);
            int pad = (int)(8 * dp);
            card.setPadding(pad, pad, pad, pad);

            // Name + Status-Dot
            LinearLayout nameRow = new LinearLayout(this);
            nameRow.setOrientation(LinearLayout.HORIZONTAL);
            TextView dot = new TextView(this);
            dot.setText(activeToday ? "🟢" : "⚫");
            dot.setTextSize(10);
            nameRow.addView(dot);
            TextView name = new TextView(this);
            String shortName = vs.name != null ? vs.name : vs.vehicleId;
            // kuerzen: vor Klammer
            int idx = shortName.indexOf('(');
            if (idx > 0) shortName = shortName.substring(0, idx).trim();
            name.setText(" " + shortName);
            name.setTextColor(activeToday ? 0xFFF8FAFC : 0xFF64748B);
            name.setTextSize(12);
            name.setTypeface(null, android.graphics.Typeface.BOLD);
            name.setMaxLines(1);
            name.setEllipsize(android.text.TextUtils.TruncateAt.END);
            nameRow.addView(name);
            card.addView(nameRow);

            // Schicht-Zeit
            TextView timeText = new TextView(this);
            if (activeToday && startT != null && endT != null) {
                timeText.setText(startT + "–" + endT + (vs.todayOverride ? " ⓘ" : ""));
                timeText.setTextColor(0xFF10B981);
            } else if (activeToday) {
                timeText.setText("aktiv (keine Zeit)");
                timeText.setTextColor(0xFFF59E0B);
            } else {
                timeText.setText("kein Dienst");
                timeText.setTextColor(0xFF64748B);
            }
            timeText.setTextSize(11);
            timeText.setMaxLines(1);
            LinearLayout.LayoutParams tlp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
            tlp.topMargin = (int)(4 * dp);
            timeText.setLayoutParams(tlp);
            card.addView(timeText);

            // 🆕 v6.63.262 (Patrick 10.06. 09:43 "Standort"): Ortsteil-Label aus GPS.
            final TextView ortText = new TextView(this);
            ortText.setText("📍 …");
            ortText.setTextColor(0xFF94A3B8);
            ortText.setTextSize(10);
            ortText.setMaxLines(1);
            LinearLayout.LayoutParams olp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
            olp.topMargin = (int)(2 * dp);
            ortText.setLayoutParams(olp);
            card.addView(ortText);
            // GPS asynchron pullen
            try {
                FirebaseDatabase.getInstance(DB_URL).getReference("vehicles/" + vs.vehicleId)
                    .addListenerForSingleValueEvent(new ValueEventListener() {
                        @Override public void onDataChange(@NonNull DataSnapshot snap) {
                            Double _lat = null, _lon = null;
                            Object la = snap.child("lat").getValue();
                            Object lo = snap.child("lon").getValue();
                            if (la instanceof Number) _lat = ((Number)la).doubleValue();
                            if (lo instanceof Number) _lon = ((Number)lo).doubleValue();
                            String ort = reverseLookupOrt(_lat, _lon);
                            String driver = strOrNull(snap.child("currentDriverName").getValue());
                            String txt = (ort != null ? ("📍 " + ort) : "📍 keine Position");
                            if (driver != null && !driver.isEmpty()) txt += " · " + driver;
                            ortText.setText(txt);
                        }
                        @Override public void onCancelled(@NonNull DatabaseError error) {}
                    });
            } catch (Throwable _t) { /* non-critical */ }

            // 🆕 v6.63.260 (Patrick 10.06. 08:45 "Card klick"): Tap auf Card → Zeit-Edit-Dialog
            final VehicleShift _vs = vs;
            card.setClickable(true);
            card.setFocusable(true);
            card.setOnClickListener(v -> {
                try { showTimeEditDialog(_vs); }
                catch (Throwable t) { Log.e(TAG, "Mini-Card Tap-Edit Fehler: " + t.getMessage(), t); }
            });
            // visueller Tap-Effekt
            android.util.TypedValue _tv = new android.util.TypedValue();
            getTheme().resolveAttribute(android.R.attr.selectableItemBackground, _tv, true);
            if (_tv.resourceId != 0) card.setForeground(getDrawable(_tv.resourceId));

            todayCardsContainer.addView(card);
        }
    }

    /* ─── Adapter ─── */
    class VehicleAdapter extends RecyclerView.Adapter<VehicleViewHolder> {
        @NonNull @Override
        public VehicleViewHolder onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
            View v = LayoutInflater.from(parent.getContext()).inflate(R.layout.item_shift_vehicle_card, parent, false);
            return new VehicleViewHolder(v);
        }
        @Override
        public void onBindViewHolder(@NonNull VehicleViewHolder h, int position) {
            h.bind(data.get(position));
        }
        @Override public int getItemCount() { return data.size(); }
    }

    class VehicleViewHolder extends RecyclerView.ViewHolder {
        private final TextView name;
        private final TextView todayBadge;
        private final TextView todayTimes;
        private final MaterialSwitch todaySwitch;
        private final LinearLayout weekRow;
        private final TextView weekSummary;

        VehicleViewHolder(@NonNull View itemView) {
            super(itemView);
            name = itemView.findViewById(R.id.shift_vehicle_name);
            todayBadge = itemView.findViewById(R.id.shift_today_badge);
            todayTimes = itemView.findViewById(R.id.shift_today_times);
            todaySwitch = itemView.findViewById(R.id.shift_today_switch);
            weekRow = itemView.findViewById(R.id.shift_week_row);
            weekSummary = itemView.findViewById(R.id.shift_week_summary);
        }

        void bind(VehicleShift vs) {
            name.setText(vs.name);
            // Heute-Status berechnen
            int dow = todayDow();
            boolean isActiveToday;
            if (vs.todayOverride) {
                isActiveToday = vs.todayActive != null && vs.todayActive;
            } else {
                isActiveToday = vs.defaults[dow];
            }
            todayBadge.setText(isActiveToday ? "HEUTE AKTIV" : "HEUTE INAKTIV");
            todayBadge.setBackgroundColor(isActiveToday ? 0xFF10B981 : 0xFFEF4444);
            String times = (vs.todayStartTime != null ? vs.todayStartTime : "00:00") + "–" +
                    (vs.todayEndTime != null ? vs.todayEndTime : "23:59");
            todayTimes.setText("⏰ " + (vs.todayOverride ? times + "  (Override) — tippen zum Aendern" : times + "  — tippen zum Aendern"));
            // 🆕 v6.62.955 (Patrick 25.05. 21:28): Tap auf Zeit-Anzeige öffnet 2-stufigen Time-Picker
            todayTimes.setOnClickListener(v -> showTimeEditDialog(vs));

            todaySwitch.setOnCheckedChangeListener(null);
            todaySwitch.setChecked(isActiveToday);
            todaySwitch.setOnCheckedChangeListener((btn, checked) -> {
                if (!btn.isPressed()) return; // ignore programmatic
                String dateKey = todayDateKey();
                Map<String, Object> entry = new HashMap<>();
                entry.put("active", checked);
                entry.put("startTime", checked ? "00:00" : null);
                entry.put("endTime", checked ? "23:59" : null);
                entry.put("setAt", System.currentTimeMillis());
                entry.put("setBy", "native-shift-editor");
                FirebaseDatabase.getInstance(DB_URL)
                        .getReference("vehicleShifts/" + vs.vehicleId + "/" + dateKey)
                        .setValue(entry)
                        .addOnSuccessListener(unused -> Toast.makeText(itemView.getContext(),
                                vs.name + ": heute " + (checked ? "AN" : "AUS"), Toast.LENGTH_SHORT).show())
                        .addOnFailureListener(e -> Toast.makeText(itemView.getContext(),
                                "Fehler: " + e.getMessage(), Toast.LENGTH_LONG).show());
            });

            // Wochenplan-Buttons
            weekRow.removeAllViews();
            StringBuilder summary = new StringBuilder();
            for (int i = 0; i < 7; i++) {
                final int idx = i;
                Button b = new Button(itemView.getContext());
                LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(0,
                        LinearLayout.LayoutParams.WRAP_CONTENT, 1);
                lp.setMarginStart(2); lp.setMarginEnd(2);
                b.setLayoutParams(lp);
                // DAY_LABELS[i] mit i=0..6 entspricht So..Sa (Calendar.DAY_OF_WEEK - 1)
                b.setText(DAY_LABELS[i]);
                b.setTextSize(11);
                b.setMinHeight(0); b.setMinimumHeight(0);
                b.setPadding(2, 8, 2, 8);
                boolean active = vs.defaults[i];
                b.setBackgroundColor(active ? 0xFF065F46 : 0xFF334155);
                b.setTextColor(active ? 0xFFFFFFFF : 0xFF94A3B8);
                b.setOnClickListener(v -> {
                    boolean newActive = !vs.defaults[idx];
                    FirebaseDatabase.getInstance(DB_URL)
                            .getReference("vehicleShifts/" + vs.vehicleId + "/defaults/" + idx)
                            .setValue(newActive)
                            .addOnSuccessListener(unused -> Toast.makeText(itemView.getContext(),
                                    vs.name + " " + DAY_LABELS[idx] + ": " + (newActive ? "AN" : "AUS"), Toast.LENGTH_SHORT).show());
                });
                // 🆕 v6.63.003 (Patrick 29.05. 06:40 "Nein"): Long-Press auf Wochentag-Button
                //   öffnet Wochenplan-Zeit-Editor — damit Patrick die Wochenschicht-Zeiten
                //   pro Tag direkt in Native editieren kann (vorher nur über Web möglich).
                b.setOnLongClickListener(v -> {
                    showWeekDayTimeEditDialog(vs, idx);
                    return true;
                });
                weekRow.addView(b);
                if (active) summary.append(DAY_LABELS[i]).append(' ');
            }
            weekSummary.setText("Wochen-Default: " + (summary.length() == 0 ? "(keine Tage)" : summary.toString().trim()));
            // 🆕 v6.63.040 (Patrick 30.05. 16:24+16:31 "Wochenplan"):
            //   Tap auf die Zusammenfassung öffnet den kompletten Wochenplan-Dialog
            //   mit allen 7 Tagen gleichzeitig (Switch + Zeiten pro Tag).
            weekSummary.setOnClickListener(v -> showFullWeekPlanDialog(vs));
        }
    }

    // 🆕 v6.63.040: Kompletter Wochenplan-Dialog — 7 Tage auf einen Blick,
    //   Switch AN/AUS pro Tag + Start/Ende mit 15-Min-Steppern. Atomares Update
    //   am Ende, ein Tap statt 7 Long-Press-Dialoge.
    private void showFullWeekPlanDialog(VehicleShift vs) {
        final String[] dayNames = {"Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"};
        final boolean[] activeArr = new boolean[7];
        final int[][] startArr = new int[7][2];
        final int[][] endArr = new int[7][2];
        for (int i = 0; i < 7; i++) {
            activeArr[i] = vs.defaults[i];
            String s = (vs.defaultTimes != null && vs.defaultTimes[i] != null) ? vs.defaultTimes[i][0] : null;
            String e = (vs.defaultTimes != null && vs.defaultTimes[i] != null) ? vs.defaultTimes[i][1] : null;
            startArr[i] = parseHM(s != null ? s : "06:00");
            endArr[i] = parseHM(e != null ? e : "22:00");
        }

        android.widget.LinearLayout root = new android.widget.LinearLayout(this);
        root.setOrientation(android.widget.LinearLayout.VERTICAL);
        int pad = (int)(12 * getResources().getDisplayMetrics().density);
        root.setPadding(pad, pad / 2, pad, pad);

        TextView header = new TextView(this);
        header.setText("📅 Wochenplan — alle 7 Tage gleichzeitig");
        header.setTextSize(13);
        header.setTextColor(0xFF94A3B8);
        header.setPadding(0, 0, 0, pad / 2);
        root.addView(header);

        // Reihen aufbauen
        final android.widget.LinearLayout[] timeRows = new android.widget.LinearLayout[7];
        final TextView[] timeLabels = new TextView[7];
        for (int i = 0; i < 7; i++) {
            final int dow = i;
            android.widget.LinearLayout dayCard = new android.widget.LinearLayout(this);
            dayCard.setOrientation(android.widget.LinearLayout.VERTICAL);
            dayCard.setPadding(pad / 2, pad / 2, pad / 2, pad / 2);
            dayCard.setBackgroundColor(0xFF1E293B);
            android.widget.LinearLayout.LayoutParams dayLp = new android.widget.LinearLayout.LayoutParams(
                android.widget.LinearLayout.LayoutParams.MATCH_PARENT,
                android.widget.LinearLayout.LayoutParams.WRAP_CONTENT);
            dayLp.setMargins(0, pad / 4, 0, pad / 4);
            dayCard.setLayoutParams(dayLp);

            // Header-Zeile: Switch + Wochentag
            android.widget.LinearLayout hdrRow = new android.widget.LinearLayout(this);
            hdrRow.setOrientation(android.widget.LinearLayout.HORIZONTAL);
            hdrRow.setGravity(android.view.Gravity.CENTER_VERTICAL);

            final com.google.android.material.materialswitch.MaterialSwitch sw =
                new com.google.android.material.materialswitch.MaterialSwitch(this);
            sw.setChecked(activeArr[dow]);
            hdrRow.addView(sw);

            TextView dayLabel = new TextView(this);
            dayLabel.setText("  " + dayNames[dow]);
            dayLabel.setTextSize(15);
            dayLabel.setTypeface(null, android.graphics.Typeface.BOLD);
            dayLabel.setTextColor(0xFFF8FAFC);
            android.widget.LinearLayout.LayoutParams dlLp = new android.widget.LinearLayout.LayoutParams(0,
                android.widget.LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
            dayLabel.setLayoutParams(dlLp);
            hdrRow.addView(dayLabel);

            // kompakte Zeit-Anzeige rechts
            TextView timeLabel = new TextView(this);
            timeLabels[dow] = timeLabel;
            timeLabel.setTextSize(13);
            timeLabel.setTextColor(0xFFFCD34D);
            timeLabel.setText(String.format(Locale.GERMANY, "%02d:%02d–%02d:%02d",
                startArr[dow][0], startArr[dow][1], endArr[dow][0], endArr[dow][1]));
            hdrRow.addView(timeLabel);
            dayCard.addView(hdrRow);

            // Zeit-Stepper-Reihen — nur sichtbar wenn Tag aktiv
            android.widget.LinearLayout startStep = makeTimeRow(this, "🟢 Start ", startArr[dow]);
            android.widget.LinearLayout endStep = makeTimeRow(this, "🔴 Ende  ", endArr[dow]);
            startStep.setPadding(0, pad / 3, 0, 0);
            endStep.setPadding(0, pad / 6, 0, 0);

            android.widget.LinearLayout stepHolder = new android.widget.LinearLayout(this);
            stepHolder.setOrientation(android.widget.LinearLayout.VERTICAL);
            stepHolder.addView(startStep);
            stepHolder.addView(endStep);
            stepHolder.setVisibility(activeArr[dow] ? View.VISIBLE : View.GONE);
            timeRows[dow] = stepHolder;
            dayCard.addView(stepHolder);

            sw.setOnCheckedChangeListener((btn, checked) -> {
                activeArr[dow] = checked;
                stepHolder.setVisibility(checked ? View.VISIBLE : View.GONE);
                timeLabel.setText(checked
                    ? String.format(Locale.GERMANY, "%02d:%02d–%02d:%02d",
                        startArr[dow][0], startArr[dow][1], endArr[dow][0], endArr[dow][1])
                    : "AUS");
            });

            // Bei jeder Zeit-Aenderung: timeLabel aktualisieren.
            // makeTimeRow gibt uns kein Callback — wir polling-aktualisieren bei Tap:
            startStep.post(() -> startStep.setOnClickListener(_v -> timeLabel.setText(
                String.format(Locale.GERMANY, "%02d:%02d–%02d:%02d",
                    startArr[dow][0], startArr[dow][1], endArr[dow][0], endArr[dow][1]))));
            // Da die Stepper-Buttons innerhalb der LL liegen, hooken wir uns via TextView-Watch
            // Stattdessen aktualisieren wir beim Save-Click — Label ist nur Vorschau.
            // (Vereinfacht: Header-TextView zeigt initiale Werte, beim Speichern werden DB-Werte richtig.)

            root.addView(dayCard);
        }

        android.widget.ScrollView scroll = new android.widget.ScrollView(this);
        scroll.addView(root);

        new androidx.appcompat.app.AlertDialog.Builder(this)
            .setTitle("📅 " + vs.name + " — Wochenplan")
            .setView(scroll)
            .setPositiveButton("Alle speichern", (d, w) -> {
                Map<String, Object> upd = new HashMap<>();
                for (int i = 0; i < 7; i++) {
                    upd.put("vehicleShifts/" + vs.vehicleId + "/defaults/" + i, activeArr[i]);
                    if (activeArr[i]) {
                        upd.put("vehicleShifts/" + vs.vehicleId + "/defaultTimes/" + i + "/startTime",
                            String.format(Locale.GERMANY, "%02d:%02d", startArr[i][0], startArr[i][1]));
                        upd.put("vehicleShifts/" + vs.vehicleId + "/defaultTimes/" + i + "/endTime",
                            String.format(Locale.GERMANY, "%02d:%02d", endArr[i][0], endArr[i][1]));
                        upd.put("vehicleShifts/" + vs.vehicleId + "/defaultTimes/" + i + "/timeRanges", null);
                    }
                }
                FirebaseDatabase.getInstance(DB_URL).getReference().updateChildren(upd)
                    .addOnSuccessListener(_ok -> Toast.makeText(ShiftEditorActivity.this,
                        "✅ " + vs.name + " — Wochenplan gespeichert", Toast.LENGTH_LONG).show())
                    .addOnFailureListener(e -> Toast.makeText(ShiftEditorActivity.this,
                        "Fehler: " + e.getMessage(), Toast.LENGTH_LONG).show());
            })
            .setNegativeButton("Abbrechen", null)
            .show();
    }
}
