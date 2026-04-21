package de.taxiheringsdorf.app;

import android.Manifest;
import android.content.pm.PackageManager;
import android.telephony.SmsManager;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.util.ArrayList;

/**
 * v6.40.31: Sendet SMS über die SIM-Karte des Fahrer-Handys.
 *
 * Nutzung aus JS:
 *   await Capacitor.Plugins.SmsSender.send({ number: '+49...', text: '...' })
 *   await Capacitor.Plugins.SmsSender.hasPermission()
 *
 * Der Fahrer muss einmalig die SEND_SMS-Permission gewähren.
 * Lange Texte werden automatisch in Teile zerlegt (divideMessage).
 */
@CapacitorPlugin(
    name = "SmsSender",
    permissions = {
        @Permission(alias = "sms", strings = { Manifest.permission.SEND_SMS })
    }
)
public class SmsSenderPlugin extends Plugin {

    @PluginMethod
    public void hasPermission(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("granted", isSmsGranted());
        call.resolve(ret);
    }

    @PluginMethod
    public void send(PluginCall call) {
        String number = call.getString("number");
        String text   = call.getString("text");

        if (number == null || number.isEmpty() || text == null || text.isEmpty()) {
            call.reject("number und text sind Pflicht");
            return;
        }

        if (!isSmsGranted()) {
            // Permission einmalig anfragen, dann erneut senden
            requestPermissionForAlias("sms", call, "onPermissionResult");
            return;
        }

        doSend(call, number, text);
    }

    @PermissionCallback
    private void onPermissionResult(PluginCall call) {
        if (!isSmsGranted()) {
            call.reject("SEND_SMS-Permission wurde verweigert");
            return;
        }
        String number = call.getString("number");
        String text   = call.getString("text");
        doSend(call, number, text);
    }

    private boolean isSmsGranted() {
        return ContextCompat.checkSelfPermission(getContext(), Manifest.permission.SEND_SMS)
                == PackageManager.PERMISSION_GRANTED;
    }

    private void doSend(PluginCall call, String number, String text) {
        try {
            SmsManager sms = SmsManager.getDefault();
            ArrayList<String> parts = sms.divideMessage(text);
            if (parts.size() == 1) {
                sms.sendTextMessage(number, null, text, null, null);
            } else {
                sms.sendMultipartTextMessage(number, null, parts, null, null);
            }
            JSObject ret = new JSObject();
            ret.put("sent", true);
            ret.put("parts", parts.size());
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("SMS-Versand fehlgeschlagen: " + e.getMessage(), e);
        }
    }
}
