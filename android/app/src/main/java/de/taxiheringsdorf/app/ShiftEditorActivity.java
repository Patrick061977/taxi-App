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
                        } catch (Throwable rowErr) {
                            Log.w(TAG, "Parse-Fehler fuer " + vs.vehicleId + ": " + rowErr.getMessage());
                        }
                    }
                    if (adapter != null) adapter.notifyDataSetChanged();
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
        // Default: morgen (Patrick will fast immer den naechsten Tag planen)
        final Calendar selDate = Calendar.getInstance();
        selDate.add(Calendar.DAY_OF_YEAR, 1);
        // Aktuelle Werte parsen
        final int[] startHM = parseHM(vs.todayStartTime != null ? vs.todayStartTime : "06:00");
        final int[] endHM = parseHM(vs.todayEndTime != null ? vs.todayEndTime : "22:00");

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
        btnDate.setOnClickListener(v -> {
            android.app.DatePickerDialog dp = new android.app.DatePickerDialog(this,
                (view, year, month, day) -> {
                    selDate.set(Calendar.YEAR, year);
                    selDate.set(Calendar.MONTH, month);
                    selDate.set(Calendar.DAY_OF_MONTH, day);
                    btnDate.setText(_dfDisplay.format(selDate.getTime()));
                },
                selDate.get(Calendar.YEAR), selDate.get(Calendar.MONTH), selDate.get(Calendar.DAY_OF_MONTH));
            dp.show();
        });
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
        final android.widget.CheckBox cbAllSame = new android.widget.CheckBox(this);
        cbAllSame.setText("📅 Auch fuer alle " + dayNames[selDate.get(Calendar.DAY_OF_WEEK) - 1] + " als Standard setzen");
        cbAllSame.setChecked(false); // v6.62.996: Default OFF — Patrick will i.d.R. nur den einen Tag aendern
        cbAllSame.setTextSize(13);
        cbAllSame.setPadding(0, pad/2, 0, 0);
        root.addView(cbAllSame);

        // v6.62.996: Inaktiv-Switch — Fahrzeug fuer diesen Tag komplett offline setzen
        final android.widget.CheckBox cbInactive = new android.widget.CheckBox(this);
        cbInactive.setText("🚫 Fahrzeug an diesem Tag NICHT fahren lassen (offline)");
        cbInactive.setChecked(false);
        cbInactive.setTextSize(13);
        cbInactive.setPadding(0, pad/4, 0, 0);
        root.addView(cbInactive);
        new androidx.appcompat.app.AlertDialog.Builder(this)
            .setTitle("⏰ " + vs.name + " — Schicht")
            .setView(root)
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
                    entry.put("setBy", "native-shift-editor-v996-inactive");
                } else {
                    entry.put("active", true);
                    entry.put("startTime", startStr);
                    entry.put("endTime", endStr);
                    entry.put("isException", true);
                    entry.put("additiveException", false); // v6.62.996: Tag-Override, kein additiv
                    entry.put("setAt", System.currentTimeMillis());
                    entry.put("setBy", "native-shift-editor-v996");
                }
                // v6.62.957/996: defaultTimes parallel setzen wenn Checkbox aktiv
                if (cbAllSame.isChecked() && !inactive) {
                    Map<String, Object> defT = new HashMap<>();
                    defT.put("startTime", startStr);
                    defT.put("endTime", endStr);
                    FirebaseDatabase.getInstance(DB_URL)
                        .getReference("vehicleShifts/" + vs.vehicleId + "/defaultTimes/" + dowSel)
                        .updateChildren(defT)
                        .addOnSuccessListener(_ok -> Toast.makeText(this,
                            "📅 Default fuer alle " + dayNames[dowSel] + " auf " + startStr + "–" + endStr + " gesetzt", Toast.LENGTH_LONG).show());
                }
                FirebaseDatabase.getInstance(DB_URL)
                    .getReference("vehicleShifts/" + vs.vehicleId + "/" + dateKey)
                    .setValue(entry)
                    .addOnSuccessListener(unused -> Toast.makeText(this,
                        vs.name + ": " + _dayLabel + " — " + (inactive ? "OFFLINE" : startStr + "–" + endStr),
                        Toast.LENGTH_LONG).show())
                    .addOnFailureListener(e -> Toast.makeText(this,
                        "Fehler: " + e.getMessage(), Toast.LENGTH_LONG).show());
            })
            .setNegativeButton("Abbrechen", null)
            .show();
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
                weekRow.addView(b);
                if (active) summary.append(DAY_LABELS[i]).append(' ');
            }
            weekSummary.setText("Wochen-Default: " + (summary.length() == 0 ? "(keine Tage)" : summary.toString().trim()));
        }
    }
}
