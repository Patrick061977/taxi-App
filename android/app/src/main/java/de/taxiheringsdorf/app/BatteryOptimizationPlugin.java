package de.taxiheringsdorf.app;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// v6.41.95: Akku-Optimierung-Status + Whitelist anfordern.
// 4 native App-Crashes in 3 Tagen — Verdacht: Samsung One UI / Android Doze tötet
// die App im Hintergrund obwohl ShiftForegroundService läuft. Lösung: User explizit
// fragen die App vom Akku-Schoner auszunehmen (REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).
@CapacitorPlugin(name = "BatteryOptimization")
public class BatteryOptimizationPlugin extends Plugin {

    @PluginMethod
    public void getStatus(PluginCall call) {
        try {
            Context ctx = getContext();
            String pkg = ctx.getPackageName();
            JSObject ret = new JSObject();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                PowerManager pm = (PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
                boolean ignoring = pm != null && pm.isIgnoringBatteryOptimizations(pkg);
                ret.put("isIgnoringBatteryOptimizations", ignoring);
                ret.put("isPowerSaveMode", pm != null && pm.isPowerSaveMode());
                ret.put("isDeviceIdleMode", pm != null && pm.isDeviceIdleMode());
            } else {
                ret.put("isIgnoringBatteryOptimizations", true); // Pre-M: kein Doze
                ret.put("isPowerSaveMode", false);
                ret.put("isDeviceIdleMode", false);
            }
            ret.put("packageName", pkg);
            ret.put("manufacturer", Build.MANUFACTURER);
            ret.put("model", Build.MODEL);
            ret.put("androidVersion", Build.VERSION.RELEASE);
            ret.put("sdkInt", Build.VERSION.SDK_INT);
            call.resolve(ret);
        } catch (Throwable t) {
            call.reject("getStatus failed: " + t.getMessage());
        }
    }

    @PluginMethod
    public void requestWhitelist(PluginCall call) {
        try {
            Context ctx = getContext();
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
                JSObject ret = new JSObject();
                ret.put("ok", true);
                ret.put("note", "Pre-M Android, kein Doze-Mode");
                call.resolve(ret);
                return;
            }
            String pkg = ctx.getPackageName();
            // System-Dialog 'App vom Akku-Schoner ausschließen?'
            Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
            intent.setData(Uri.parse("package:" + pkg));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(intent);
            JSObject ret = new JSObject();
            ret.put("ok", true);
            call.resolve(ret);
        } catch (Throwable t) {
            call.reject("requestWhitelist failed: " + t.getMessage());
        }
    }

    @PluginMethod
    public void openBatterySettings(PluginCall call) {
        // Fallback: öffnet die Liste aller Apps mit Akku-Optimierung
        try {
            Context ctx = getContext();
            Intent intent = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(intent);
            call.resolve();
        } catch (Throwable t) {
            call.reject("openBatterySettings failed: " + t.getMessage());
        }
    }

    @PluginMethod
    public void openAppInfo(PluginCall call) {
        // Öffnet die App-Info-Seite — von dort Battery-Section direkt erreichbar
        try {
            Context ctx = getContext();
            String pkg = ctx.getPackageName();
            Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
            intent.setData(Uri.parse("package:" + pkg));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(intent);
            call.resolve();
        } catch (Throwable t) {
            call.reject("openAppInfo failed: " + t.getMessage());
        }
    }
}
