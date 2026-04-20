package de.taxiheringsdorf.app;

import android.content.Intent;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * v6.40.0: Capacitor-Bridge für den ShiftForegroundService.
 * v6.40.8: Erweitert um vehicleId/userId-Parameter, damit der Service
 *          eigenständig GPS + Akku-Daten in Firebase schreibt.
 *
 * Nutzung aus JS:
 *   Capacitor.Plugins.ShiftForegroundService.start({
 *       text: 'Schicht läuft...',
 *       vehicleId: 'tx12',
 *       vehicleName: 'TX 12',
 *       userId: '<uid>',
 *       userEmail: '<email>'
 *   })
 *   Capacitor.Plugins.ShiftForegroundService.stop()
 *   Capacitor.Plugins.ShiftForegroundService.isRunning()
 */
@CapacitorPlugin(name = "ShiftForegroundService")
public class ShiftForegroundPlugin extends Plugin {

    @PluginMethod
    public void start(PluginCall call) {
        try {
            String text = call.getString("text", null);
            String vehicleId = call.getString("vehicleId", null);
            String vehicleName = call.getString("vehicleName", null);
            String userId = call.getString("userId", null);
            String userEmail = call.getString("userEmail", null);

            Intent svc = new Intent(getContext(), ShiftForegroundService.class);
            svc.setAction(ShiftForegroundService.ACTION_START);
            if (text != null && !text.isEmpty()) {
                svc.putExtra(ShiftForegroundService.EXTRA_CONTENT_TEXT, text);
            }
            if (vehicleId != null && !vehicleId.isEmpty()) {
                svc.putExtra(ShiftForegroundService.EXTRA_VEHICLE_ID, vehicleId);
            }
            if (vehicleName != null && !vehicleName.isEmpty()) {
                svc.putExtra(ShiftForegroundService.EXTRA_VEHICLE_NAME, vehicleName);
            }
            if (userId != null && !userId.isEmpty()) {
                svc.putExtra(ShiftForegroundService.EXTRA_USER_ID, userId);
            }
            if (userEmail != null && !userEmail.isEmpty()) {
                svc.putExtra(ShiftForegroundService.EXTRA_USER_EMAIL, userEmail);
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                getContext().startForegroundService(svc);
            } else {
                getContext().startService(svc);
            }
            JSObject ret = new JSObject();
            ret.put("started", true);
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
}
