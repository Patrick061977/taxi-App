package de.taxiheringsdorf.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import com.google.firebase.database.DatabaseReference;
import com.google.firebase.database.FirebaseDatabase;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * DriverLogger — Patrick 10.10.2026 09:42 Bridge "Fehler-Log auf App des Fahrers".
 *
 * Performance-safe Logger der kritische Events pro Fahrer in Firebase sammelt.
 *
 * Design-Prinzipien:
 *   - Nur ECHTE Fehler/Warnings loggen (keine normalen Events)
 *   - Batching: Logs lokal sammeln, alle 30s als Batch zu Firebase
 *   - Max 50 Entries pro Fahrzeug — auto-rotation
 *   - Compact Format (~200 Bytes/Entry, keine PII)
 *   - Nur bei vehicleId != null (sonst Floating-Logs)
 *
 * Usage:
 *   DriverLogger.log(ctx, "push_delivery", "warn", "FCM-Push nicht empfangen", "rideId=xyz");
 *   DriverLogger.log(ctx, "firebase_offline", "error", "Firebase disconnected für 2min", null);
 *   DriverLogger.log(ctx, "permission_error", "error", e.getMessage(), null);
 *
 * Admin-UI liest aus /driverLogs/{vehicleId}/ und zeigt die letzten 50.
 */
public class DriverLogger {

    private static final String TAG = "DriverLogger";
    private static final int BATCH_INTERVAL_MS = 30000;  // 30s
    private static final int MAX_ENTRIES_PER_VEHICLE = 50;
    private static final List<Map<String, Object>> _buffer = new ArrayList<>();
    private static Handler _handler = null;
    private static boolean _flushScheduled = false;

    public enum Severity { INFO, WARN, ERROR, CRITICAL }

    private static String getVehicleId(Context ctx) {
        try {
            SharedPreferences prefs = ctx.getSharedPreferences("app", Context.MODE_PRIVATE);
            return prefs.getString("vehicleId", null);
        } catch (Throwable _t) { return null; }
    }

    private static String getDriverName(Context ctx) {
        try {
            SharedPreferences prefs = ctx.getSharedPreferences("app", Context.MODE_PRIVATE);
            return prefs.getString("driverName", null);
        } catch (Throwable _t) { return null; }
    }

    private static String getAppVersion(Context ctx) {
        try {
            return ctx.getPackageManager().getPackageInfo(ctx.getPackageName(), 0).versionName;
        } catch (Throwable _t) { return "?"; }
    }

    /**
     * Logge Event. Severity als String: "info"|"warn"|"error"|"critical".
     * Context-String optional (max 200 Zeichen, keine PII — nur IDs/Nummern).
     */
    public static synchronized void log(Context ctx, String type, String severity, String message, String context) {
        if (ctx == null || type == null) return;
        String vid = getVehicleId(ctx);
        // Floating-Logs ohne vehicleId skippen (sonst Chaos in /driverLogs)
        if (vid == null || vid.isEmpty()) {
            Log.w(TAG, "Skip log — kein vehicleId: " + type + " " + message);
            return;
        }

        Map<String, Object> entry = new HashMap<>();
        entry.put("timestamp", System.currentTimeMillis());
        entry.put("type", type);
        entry.put("severity", severity != null ? severity : "info");
        entry.put("message", message != null ? message.substring(0, Math.min(message.length(), 300)) : "");
        if (context != null && !context.isEmpty()) {
            entry.put("context", context.substring(0, Math.min(context.length(), 200)));
        }
        String driverName = getDriverName(ctx);
        if (driverName != null) entry.put("driver", driverName);
        entry.put("appVersion", getAppVersion(ctx));
        entry.put("_vid", vid);  // interne Markierung für Batch-Write

        _buffer.add(entry);
        Log.i(TAG, "📝 " + type + " [" + severity + "] " + message);

        // Schedule Batch-Flush falls noch nicht aktiv
        if (!_flushScheduled) {
            _flushScheduled = true;
            if (_handler == null) _handler = new Handler(Looper.getMainLooper());
            _handler.postDelayed(() -> flush(ctx), BATCH_INTERVAL_MS);
        }
    }

    /**
     * Batch-Flush: Buffer leeren + zu Firebase schreiben + alte Entries rotieren.
     */
    public static synchronized void flush(Context ctx) {
        _flushScheduled = false;
        if (_buffer.isEmpty()) return;

        // Grupperen nach vehicleId
        Map<String, List<Map<String, Object>>> byVid = new HashMap<>();
        for (Map<String, Object> e : _buffer) {
            String vid = (String) e.remove("_vid");
            if (vid == null) continue;
            byVid.computeIfAbsent(vid, k -> new ArrayList<>()).add(e);
        }
        _buffer.clear();

        for (Map.Entry<String, List<Map<String, Object>>> grp : byVid.entrySet()) {
            final String vid = grp.getKey();
            final List<Map<String, Object>> entries = grp.getValue();
            try {
                DatabaseReference ref = FirebaseDatabase.getInstance().getReference("driverLogs").child(vid);
                // Writes als push() damit auto-generierte IDs
                for (Map<String, Object> e : entries) {
                    ref.push().setValue(e);
                }
                Log.i(TAG, "✅ " + entries.size() + " Logs zu Firebase: " + vid);
                // Auto-Rotation: nach Write die ältesten >50 löschen
                scheduleRotation(ref);
            } catch (Throwable _t) {
                Log.w(TAG, "Firebase-Write fehlgeschlagen: " + _t.getMessage());
            }
        }
    }

    private static void scheduleRotation(DatabaseReference ref) {
        ref.orderByChild("timestamp").addListenerForSingleValueEvent(new com.google.firebase.database.ValueEventListener() {
            @Override public void onDataChange(com.google.firebase.database.DataSnapshot snap) {
                long count = snap.getChildrenCount();
                if (count <= MAX_ENTRIES_PER_VEHICLE) return;
                int toDelete = (int) (count - MAX_ENTRIES_PER_VEHICLE);
                int deleted = 0;
                for (com.google.firebase.database.DataSnapshot child : snap.getChildren()) {
                    if (deleted >= toDelete) break;
                    child.getRef().removeValue();
                    deleted++;
                }
                Log.i(TAG, "🧹 Rotation: " + deleted + " alte Logs gelöscht (behalten: " + MAX_ENTRIES_PER_VEHICLE + ")");
            }
            @Override public void onCancelled(com.google.firebase.database.DatabaseError e) {}
        });
    }

    // Convenience-Shortcuts
    public static void info(Context ctx, String type, String msg) { log(ctx, type, "info", msg, null); }
    public static void warn(Context ctx, String type, String msg) { log(ctx, type, "warn", msg, null); }
    public static void error(Context ctx, String type, String msg) { log(ctx, type, "error", msg, null); }
    public static void error(Context ctx, String type, String msg, String ctxStr) { log(ctx, type, "error", msg, ctxStr); }
    public static void critical(Context ctx, String type, String msg) { log(ctx, type, "critical", msg, null); }
}
