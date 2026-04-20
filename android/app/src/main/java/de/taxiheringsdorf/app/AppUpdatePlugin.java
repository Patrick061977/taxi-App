package de.taxiheringsdorf.app;

import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.Uri;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * v6.40.1: Liefert APK-Versionsinfo an die Web-App und öffnet Downloads
 * (APK-Datei aus GitHub Releases) im System-Browser.
 *
 * Aufruf aus JS:
 *   Capacitor.Plugins.AppUpdate.getAppInfo()     → { versionName, versionCode, packageName }
 *   Capacitor.Plugins.AppUpdate.openExternal({ url })
 */
@CapacitorPlugin(name = "AppUpdate")
public class AppUpdatePlugin extends Plugin {

    @PluginMethod
    public void getAppInfo(PluginCall call) {
        try {
            PackageManager pm = getContext().getPackageManager();
            String pkg = getContext().getPackageName();
            PackageInfo info = pm.getPackageInfo(pkg, 0);

            JSObject ret = new JSObject();
            ret.put("versionName", info.versionName != null ? info.versionName : "");
            long code;
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.P) {
                code = info.getLongVersionCode();
            } else {
                code = (long) info.versionCode;
            }
            ret.put("versionCode", code);
            ret.put("packageName", pkg);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("App-Info konnte nicht gelesen werden: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void openExternal(PluginCall call) {
        try {
            String url = call.getString("url", null);
            if (url == null || url.isEmpty()) {
                call.reject("url fehlt");
                return;
            }
            Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            JSObject ret = new JSObject();
            ret.put("opened", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Link konnte nicht geöffnet werden: " + e.getMessage(), e);
        }
    }
}
