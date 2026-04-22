package de.taxiheringsdorf.app;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * v6.40.0: Capacitor-Bridge für den ShiftForegroundService.
 * v6.41.21: Aktive Permission-Anfrage für ACCESS_BACKGROUND_LOCATION.
 *
 * Nutzung aus JS:
 *   Capacitor.Plugins.ShiftForegroundService.start({ text, vehicleId })
 *   Capacitor.Plugins.ShiftForegroundService.stop()
 *   Capacitor.Plugins.ShiftForegroundService.isRunning()
 *   Capacitor.Plugins.ShiftForegroundService.checkPermissions()
 *   Capacitor.Plugins.ShiftForegroundService.requestBackgroundPermission()
 */
@CapacitorPlugin(name = "ShiftForegroundService")
public class ShiftForegroundPlugin extends Plugin {

    private static final int REQ_BG_LOCATION = 9001;

    @PluginMethod
    public void start(PluginCall call) {
        try {
            String text = call.getString("text", null);
            String vehicleId = call.getString("vehicleId", null);
            Intent svc = new Intent(getContext(), ShiftForegroundService.class);
            svc.setAction(ShiftForegroundService.ACTION_START);
            if (text != null && !text.isEmpty()) {
                svc.putExtra(ShiftForegroundService.EXTRA_CONTENT_TEXT, text);
            }
            if (vehicleId != null && !vehicleId.isEmpty()) {
                svc.putExtra(ShiftForegroundService.EXTRA_VEHICLE_ID, vehicleId);
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                getContext().startForegroundService(svc);
            } else {
                getContext().startService(svc);
            }
            JSObject ret = new JSObject();
            ret.put("started", true);
            ret.put("vehicleId", vehicleId != null ? vehicleId : "");
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Foreground-Service konnte nicht gestartet werden: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        try {
            Intent svc = new Intent(getContext(), ShiftForegroundService.class);
            svc.setAction(ShiftForegroundService.ACTION_STOP);
            getContext().startService(svc);
            JSObject ret = new JSObject();
            ret.put("stopped", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Foreground-Service konnte nicht gestoppt werden: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void isRunning(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("running", ShiftForegroundService.isRunning());
        call.resolve(ret);
    }

    /**
     * v6.41.21: Prüft Status aller Standort-Permissions.
     * Antwort: { fineLocation, coarseLocation, backgroundLocation, sdk }
     */
    @PluginMethod
    public void checkPermissions(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("fineLocation", isGranted(Manifest.permission.ACCESS_FINE_LOCATION));
        ret.put("coarseLocation", isGranted(Manifest.permission.ACCESS_COARSE_LOCATION));
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ret.put("backgroundLocation", isGranted(Manifest.permission.ACCESS_BACKGROUND_LOCATION));
        } else {
            // Vor Android 10 reicht FINE_LOCATION für Hintergrund
            ret.put("backgroundLocation", isGranted(Manifest.permission.ACCESS_FINE_LOCATION));
        }
        ret.put("sdk", Build.VERSION.SDK_INT);
        call.resolve(ret);
    }

    /**
     * v6.41.21: Fragt aktiv nach ACCESS_BACKGROUND_LOCATION.
     * Android 10: System-Dialog mit "Allow all the time" Option.
     * Android 11+: Dialog "App settings" → User muss in Einstellungen "Immer zulassen" wählen.
     * Bei < Android 10 ist nur FINE_LOCATION nötig.
     */
    @PluginMethod
    public void requestBackgroundPermission(PluginCall call) {
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("Activity nicht verfügbar");
            return;
        }
        try {
            // Foreground-Permission muss zuerst da sein
            if (!isGranted(Manifest.permission.ACCESS_FINE_LOCATION)) {
                ActivityCompat.requestPermissions(activity,
                    new String[] { Manifest.permission.ACCESS_FINE_LOCATION,
                                   Manifest.permission.ACCESS_COARSE_LOCATION },
                    REQ_BG_LOCATION);
                JSObject ret = new JSObject();
                ret.put("requested", "fine");
                call.resolve(ret);
                return;
            }
            // Background-Permission (Android 10+)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                if (!isGranted(Manifest.permission.ACCESS_BACKGROUND_LOCATION)) {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                        // Android 11+: System öffnet App-Settings statt Dialog
                        // → User muss dort "Standort: Immer zulassen" wählen
                        Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                        intent.setData(Uri.fromParts("package", getContext().getPackageName(), null));
                        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        getContext().startActivity(intent);
                        JSObject ret = new JSObject();
                        ret.put("requested", "background-via-settings");
                        ret.put("hint", "Bitte in App-Einstellungen 'Standort: Immer zulassen' wählen");
                        call.resolve(ret);
                    } else {
                        // Android 10: System-Dialog mit "Allow all the time"
                        ActivityCompat.requestPermissions(activity,
                            new String[] { Manifest.permission.ACCESS_BACKGROUND_LOCATION },
                            REQ_BG_LOCATION);
                        JSObject ret = new JSObject();
                        ret.put("requested", "background-dialog");
                        call.resolve(ret);
                    }
                    return;
                }
            }
            JSObject ret = new JSObject();
            ret.put("requested", "none");
            ret.put("alreadyGranted", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Permission-Anfrage fehlgeschlagen: " + e.getMessage(), e);
        }
    }

    private boolean isGranted(String perm) {
        return ContextCompat.checkSelfPermission(getContext(), perm) == PackageManager.PERMISSION_GRANTED;
    }
}
