package de.taxiheringsdorf.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.firebase.crashlytics.FirebaseCrashlytics;

// v6.41.91: Brücke von Capacitor (JS) → Firebase Crashlytics (Native).
// Wir registrieren beim App-Start vehicleId + appBuild als Custom Keys, damit jeder
// Native-Crash sofort kontextualisiert ist. window.__reportNativeCrash() in index.html
// kann hier Non-Fatal Errors loggen — Crashlytics packt sie zusammen mit dem Native-State
// (Threads, Memory, Sensors) und zeigt sie in der Firebase Console.
@CapacitorPlugin(name = "Crashlytics")
public class CrashlyticsPlugin extends Plugin {

    @PluginMethod
    public void setKey(PluginCall call) {
        String key = call.getString("key");
        String value = call.getString("value", "");
        if (key == null || key.isEmpty()) {
            call.reject("key required");
            return;
        }
        try {
            FirebaseCrashlytics.getInstance().setCustomKey(key, value);
            call.resolve();
        } catch (Throwable t) {
            call.reject("crashlytics setKey failed: " + t.getMessage());
        }
    }

    @PluginMethod
    public void setUser(PluginCall call) {
        String id = call.getString("id");
        if (id == null || id.isEmpty()) {
            call.reject("id required");
            return;
        }
        try {
            FirebaseCrashlytics.getInstance().setUserId(id);
            call.resolve();
        } catch (Throwable t) {
            call.reject("crashlytics setUser failed: " + t.getMessage());
        }
    }

    @PluginMethod
    public void log(PluginCall call) {
        String msg = call.getString("message", "");
        try {
            FirebaseCrashlytics.getInstance().log(msg != null ? msg : "");
            call.resolve();
        } catch (Throwable t) {
            call.reject("crashlytics log failed: " + t.getMessage());
        }
    }

    @PluginMethod
    public void recordError(PluginCall call) {
        String message = call.getString("message", "JS error");
        String stack = call.getString("stack", "");
        String tag = call.getString("tag", "js");
        try {
            // Non-fatal: zeigt sich in Crashlytics als eigene Issue, ohne die App zu killen
            Throwable t = new Throwable("[" + tag + "] " + (message != null ? message : ""));
            if (stack != null && !stack.isEmpty()) {
                FirebaseCrashlytics.getInstance().log("STACK: " + stack);
            }
            FirebaseCrashlytics.getInstance().recordException(t);
            JSObject ret = new JSObject();
            ret.put("ok", true);
            call.resolve(ret);
        } catch (Throwable err) {
            call.reject("crashlytics recordError failed: " + err.getMessage());
        }
    }

    @PluginMethod
    public void crashTest(PluginCall call) {
        // Nur für Diagnose-Tests — wirft eine echte Exception.
        // Aufruf: window.Capacitor.Plugins.Crashlytics.crashTest({})
        throw new RuntimeException("Crashlytics-Test-Crash (v6.41.91)");
    }
}
