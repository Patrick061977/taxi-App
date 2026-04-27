package de.taxiheringsdorf.app;

import android.content.Context;
import android.content.SharedPreferences;
import java.util.UUID;

// v6.60.0: Per-Installation UUID — unabhängig von Firebase-UID. Patrick hat 2 Auth-Identitäten
// (Email + Phone) für dieselbe Person. UID-basierter Vehicle-Lock hat sich gegenseitig
// rausgeschmissen. DeviceID ist pro APK-Install eindeutig — wenn S20 sich anmeldet, sieht
// S9+ in /vehicles/{id}/activeDevice/deviceId einen fremden Wert und meldet sich sauber ab,
// ohne sich automatisch zurückzuholen (Loop-frei).
public final class DeviceIdHelper {
    private static final String PREFS = "device";
    private static final String KEY = "deviceId";

    private DeviceIdHelper() {}

    public static String getOrCreate(Context ctx) {
        SharedPreferences sp = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String id = sp.getString(KEY, null);
        if (id == null || id.isEmpty()) {
            id = UUID.randomUUID().toString();
            sp.edit().putString(KEY, id).apply();
        }
        return id;
    }
}
