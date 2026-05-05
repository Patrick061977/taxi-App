package de.taxiheringsdorf.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;
import com.google.firebase.auth.FirebaseAuth;
import com.google.firebase.auth.FirebaseUser;
import com.google.firebase.database.DataSnapshot;
import com.google.firebase.database.DatabaseError;
import com.google.firebase.database.FirebaseDatabase;
import com.google.firebase.database.ValueEventListener;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

// v6.56.0: Permissions-System aus Firebase einbinden.
// Web-App nutzt /users/{uid}/role + /settings/tabPermissions/{role} für Tab-
// Berechtigungen. Native zog bisher Email/Phone gegen hardcoded ADMIN_EMAILS-
// Whitelist. Patrick: 'genau die Rechte die im Web sind sollen auch nativ gelten'.
//
// Ablauf:
// - Beim Login (LoginActivity / VehiclePicker) → loadRoleAsync(ctx, user)
//   schreibt /users/{uid}/role in SharedPrefs("permissions", "role")
// - isAdmin(ctx) prüft SharedPrefs zuerst, dann Fallback auf ADMIN_EMAILS
// - hasTab(ctx, tabId) prüft cached tabPermissions
public final class PermissionsHelper {
    private static final String TAG = "PermissionsHelper";
    private static final String DB_INSTANCE_URL = "https://taxi-heringsdorf-default-rtdb.europe-west1.firebasedatabase.app";
    private static final String PREFS = "permissions";

    // Legacy-Fallback wenn /users/{uid}/role nicht gesetzt ist
    private static final String[] ADMIN_EMAILS = {
        "patrick061977@gmail.com", "admin@taxi-heringsdorf.de", "taxiwydra@googlemail.com"
    };
    private static final String[] ADMIN_PHONES = {
        "+4915127585179"
    };

    private PermissionsHelper() {}

    public static boolean isAdmin(Context ctx) {
        // 1. Cached Firebase-Rolle (Single Source of Truth wenn vorhanden)
        String role = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("role", null);
        if (role != null) {
            return "admin".equalsIgnoreCase(role);
        }
        // 2. Legacy-Fallback bei nicht-gesetzter Rolle (z.B. neue User vor erstem Sync)
        return isLegacyAdmin();
    }

    public static boolean isLegacyAdmin() {
        FirebaseUser u = FirebaseAuth.getInstance().getCurrentUser();
        if (u == null) return false;
        if (u.getEmail() != null) {
            String email = u.getEmail().toLowerCase();
            for (String adm : ADMIN_EMAILS) if (adm.equalsIgnoreCase(email)) return true;
        }
        if (u.getPhoneNumber() != null) {
            for (String adm : ADMIN_PHONES) if (adm.equals(u.getPhoneNumber())) return true;
        }
        return false;
    }

    public static String getRole(Context ctx) {
        String role = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("role", null);
        if (role != null) return role;
        return isLegacyAdmin() ? "admin" : "fahrer";
    }

    // Lädt die Rolle aus /users/{uid}/role + tabPermissions parallel und cached beides.
    public static void loadRoleAsync(Context ctx) {
        FirebaseUser u = FirebaseAuth.getInstance().getCurrentUser();
        if (u == null) return;
        String uid = u.getUid();
        try {
            FirebaseDatabase.getInstance(DB_INSTANCE_URL).getReference("users/" + uid + "/role")
                .addListenerForSingleValueEvent(new ValueEventListener() {
                    @Override public void onDataChange(DataSnapshot s) {
                        String role = s.getValue(String.class);
                        SharedPreferences.Editor e = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit();
                        if (role != null && !role.isEmpty()) {
                            e.putString("role", role.toLowerCase());
                            Log.i(TAG, "✅ Rolle geladen: " + role);
                            e.apply();
                        } else {
                            // v6.62.295: Patrick: 'kann mann auch beien mitarbeiter stammdaten
                            // die login fuer die fahrer app erstellen'. mitarbeiter.html schreibt
                            // /preauthorizedDrivers/{phoneKey} = {staffId, role:'driver', ...}.
                            // Beim ersten SMS-Login uebernehmen wir das hierhin: User-Eintrag
                            // anlegen, Staff verknuepfen, Pre-Auth-Eintrag entfernen.
                            tryMigratePreauthorizedDriver(ctx, uid, () -> {
                                String legacy = isLegacyAdmin() ? "admin" : "fahrer";
                                ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                                    .putString("role", legacy).apply();
                                Log.i(TAG, "⚠️ Keine /users/{uid}/role gesetzt + keine Pre-Auth — Legacy: " + legacy);
                            });
                        }
                    }
                    @Override public void onCancelled(DatabaseError error) {
                        Log.w(TAG, "Role-Load: " + error.getMessage());
                    }
                });
            // Tab-Permissions parallel laden
            FirebaseDatabase.getInstance(DB_INSTANCE_URL).getReference("settings/tabPermissions")
                .addListenerForSingleValueEvent(new ValueEventListener() {
                    @Override public void onDataChange(DataSnapshot s) {
                        try {
                            Set<String> all = new HashSet<>();
                            for (DataSnapshot roleSnap : s.getChildren()) {
                                String roleKey = roleSnap.getKey();
                                StringBuilder tabs = new StringBuilder();
                                for (DataSnapshot tabSnap : roleSnap.getChildren()) {
                                    if (tabs.length() > 0) tabs.append(",");
                                    tabs.append(tabSnap.getValue(String.class));
                                }
                                ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                                    .putString("tabs_" + roleKey, tabs.toString()).apply();
                            }
                            Log.i(TAG, "✅ Tab-Permissions gecached für Rollen: " + s.getChildrenCount());
                        } catch (Throwable t) {
                            Log.w(TAG, "TabPermissions-Parse: " + t.getMessage());
                        }
                    }
                    @Override public void onCancelled(DatabaseError error) {
                        Log.w(TAG, "TabPermissions-Load: " + error.getMessage());
                    }
                });
        } catch (Throwable t) {
            Log.w(TAG, "loadRoleAsync: " + t.getMessage());
        }
    }

    // v6.62.295: Pre-Authorized-Driver-Migration. Wird aufgerufen wenn /users/{uid}/role
    // leer ist. Wenn die Telefon-Nummer des aktuellen Users in /preauthorizedDrivers/
    // {phoneKey} liegt, wird der Eintrag nach /users/{uid} migriert + /staff/{staffId}/
    // linkedDriverId gesetzt + /preauthorizedDrivers/{phoneKey} geloescht.
    private interface OnNotMigrated { void run(); }
    private static void tryMigratePreauthorizedDriver(Context ctx, String uid, OnNotMigrated onNotMigrated) {
        FirebaseUser u = FirebaseAuth.getInstance().getCurrentUser();
        if (u == null || u.getPhoneNumber() == null || u.getPhoneNumber().isEmpty()) {
            onNotMigrated.run();
            return;
        }
        // E.164-Phone → reine Ziffern als Firebase-Key (kein '+')
        final String phoneKey = u.getPhoneNumber().replaceAll("[^0-9]", "");
        final String phoneE164 = u.getPhoneNumber();
        FirebaseDatabase.getInstance(DB_INSTANCE_URL).getReference("preauthorizedDrivers/" + phoneKey)
            .addListenerForSingleValueEvent(new ValueEventListener() {
                @Override public void onDataChange(DataSnapshot s) {
                    if (!s.exists()) {
                        Log.i(TAG, "Keine Pre-Auth fuer Phone " + phoneKey);
                        onNotMigrated.run();
                        return;
                    }
                    String staffId = s.child("staffId").getValue(String.class);
                    String role = s.child("role").getValue(String.class);
                    if (role == null || role.isEmpty()) role = "fahrer"; // 'driver' aus Web wird als 'fahrer' im Native-Permissions-System genutzt
                    final String roleNorm = "driver".equalsIgnoreCase(role) ? "fahrer" : role.toLowerCase();
                    Log.i(TAG, "✅ Pre-Auth gefunden — migriere: phone=" + phoneKey + " staffId=" + staffId + " role=" + roleNorm);

                    java.util.Map<String, Object> userEntry = new java.util.HashMap<>();
                    userEntry.put("phoneNumber", phoneE164);
                    userEntry.put("role", roleNorm);
                    userEntry.put("createdAt", System.currentTimeMillis());
                    userEntry.put("source", "mitarbeiter-pre-auth-migration");
                    if (staffId != null) userEntry.put("linkedStaffId", staffId);

                    FirebaseDatabase.getInstance(DB_INSTANCE_URL).getReference("users/" + uid)
                        .updateChildren(userEntry);
                    if (staffId != null) {
                        FirebaseDatabase.getInstance(DB_INSTANCE_URL)
                            .getReference("staff/" + staffId + "/linkedDriverId").setValue(uid);
                    }
                    FirebaseDatabase.getInstance(DB_INSTANCE_URL)
                        .getReference("preauthorizedDrivers/" + phoneKey).removeValue();

                    ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                        .putString("role", roleNorm).apply();
                }
                @Override public void onCancelled(DatabaseError error) {
                    Log.w(TAG, "Pre-Auth-Lookup: " + error.getMessage());
                    onNotMigrated.run();
                }
            });
    }

    public static boolean hasTab(Context ctx, String tabId) {
        String role = getRole(ctx);
        // Admin sieht alles
        if ("admin".equalsIgnoreCase(role)) return true;
        String tabsCsv = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("tabs_" + role, null);
        if (tabsCsv == null) {
            // Default falls /settings/tabPermissions noch nicht gecached: Fahrer sieht 'driver',
            // Fahrgast sieht 'passenger' + 'history'
            if ("fahrer".equalsIgnoreCase(role)) return "driver".equals(tabId);
            if ("fahrgast".equalsIgnoreCase(role)) return "passenger".equals(tabId) || "history".equals(tabId);
            return false;
        }
        for (String t : tabsCsv.split(",")) {
            if (t.trim().equals(tabId)) return true;
        }
        return false;
    }

    public static void clearCache(Context ctx) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().apply();
    }
}
