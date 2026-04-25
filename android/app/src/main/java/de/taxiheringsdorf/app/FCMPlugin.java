package de.taxiheringsdorf.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.firebase.messaging.FirebaseMessaging;

// v6.41.96: Capacitor-Plugin um den FCM-Registrations-Token aus JS zu holen.
// JS speichert ihn in /vehicles/{vid}/fcmToken — Cloud Function nutzt ihn um
// Push-Notifications gezielt an dieses Gerät zu schicken.
@CapacitorPlugin(name = "FCM")
public class FCMPlugin extends Plugin {

    @PluginMethod
    public void getToken(PluginCall call) {
        try {
            FirebaseMessaging.getInstance().getToken().addOnCompleteListener(task -> {
                if (task.isSuccessful()) {
                    JSObject ret = new JSObject();
                    ret.put("token", task.getResult());
                    call.resolve(ret);
                } else {
                    Throwable e = task.getException();
                    call.reject("FCM token failed: " + (e != null ? e.getMessage() : "unknown"));
                }
            });
        } catch (Throwable t) {
            call.reject("FCM getToken exception: " + t.getMessage());
        }
    }

    @PluginMethod
    public void setVehicleId(PluginCall call) {
        // v6.42.0: JS speichert die aktuelle vehicleId in SharedPreferences damit
        // DriverDashboardActivity + RideActionReceiver sie auch ohne JS finden.
        String vehicleId = call.getString("vehicleId");
        if (vehicleId == null || vehicleId.isEmpty()) {
            call.reject("vehicleId required");
            return;
        }
        try {
            getContext().getSharedPreferences("driver", android.content.Context.MODE_PRIVATE).edit()
                .putString("vehicleId", vehicleId).apply();
            getContext().getSharedPreferences("fcm", android.content.Context.MODE_PRIVATE).edit()
                .putString("vehicleId", vehicleId).apply();
            call.resolve();
        } catch (Throwable t) {
            call.reject("setVehicleId failed: " + t.getMessage());
        }
    }

    @PluginMethod
    public void deleteToken(PluginCall call) {
        // Bei Logout — entfernt den Token vom Gerät
        try {
            FirebaseMessaging.getInstance().deleteToken().addOnCompleteListener(task -> {
                if (task.isSuccessful()) call.resolve();
                else call.reject("FCM deleteToken failed: " + task.getException());
            });
        } catch (Throwable t) {
            call.reject("FCM deleteToken exception: " + t.getMessage());
        }
    }
}
