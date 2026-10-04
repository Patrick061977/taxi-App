package de.taxiheringsdorf.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.Environment;
import android.os.FileObserver;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.util.Log;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

import com.google.firebase.database.FirebaseDatabase;
import com.google.firebase.storage.FirebaseStorage;
import com.google.firebase.storage.StorageReference;
import com.google.firebase.storage.UploadTask;

import java.io.File;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * v6.66.240 (Patrick 04.10.2026 18:29 Bridge): "Ich will dass das alles automatisch funktioniert.
 * Irgendwie. Die Daten sind doch auf dem Handy bei Anruf-Aufnahme."
 *
 * Auto-Upload von ACR-m4a-Dateien nach Firebase Storage. Pfade:
 *   /sdcard/ACRCalls/ACRPhone/{YYYY}/{MM}/{DD}/+phone/+phone-DIR-ts.m4a
 *   /sdcard/Acr/ACRPhone/...     (S20 FE, neuere ACR-Versionen)
 *   /sdcard/Recordings/ACRPhone/ (Android 14 System-Ordner)
 *   /sdcard/FunktaxiCalls/{YYYY}/{MM}/{DD}/+phone-DIR-ts.m4a (In-App-Recorder)
 *
 * Jede neue m4a wird:
 *  1. hochgeladen nach Firebase Storage: callRecordings/{YYYY}/{MM}/{DD}/{+phone}-{dir}-{ts}.m4a
 *  2. Metadata in /callRecordings/{autoId} geschrieben
 *     ({phone, direction, timestamp, storagePath, audioUrl, fileSize, source})
 *  3. Cloud-Function onCallRecordingCreated holt Transkript + extractAudioBookingData,
 *     schreibt Vorschlag nach /dispoVorschlaege → Native-App Admin-Dashboard-Card.
 *
 * Dedupe: lokaler SharedPreferences-Set der bereits hochgeladenen Dateipfade.
 *
 * Patrick 22.05. 14:48 hatte "KEIN Upload" gesagt — am 04.10.2026 explizit zurückgenommen
 * weil er Call-zu-Fahrt-Automatik haben will. Opt-In via settings/callUpload/enabled=true.
 */
public class AcrUploadService extends Service {
    private static final String TAG = "AcrUploadService";
    private static final String CHANNEL_ID = "acr_upload_service";
    private static final int NOTIF_ID = 9113;

    private static final File ACR_ROOT = new File(Environment.getExternalStorageDirectory(), "ACRCalls/ACRPhone");
    private static final File ACR_ROOT_ALT1 = new File(Environment.getExternalStorageDirectory(), "Acr/ACRPhone");
    private static final File ACR_ROOT_ALT2 = new File(Environment.getExternalStorageDirectory(), "Recordings/ACRPhone");
    private static final File FUNKTAXI_ROOT = new File(Environment.getExternalStorageDirectory(), "FunktaxiCalls");

    private static final String PREFS_NAME = "acr_upload";
    private static final String PREFS_UPLOADED_SET = "uploaded_paths";

    private final List<FileObserver> observers = new ArrayList<>();
    private final Handler scanHandler = new Handler(Looper.getMainLooper());
    private final Set<String> inFlight = new HashSet<>();

    @Override
    public void onCreate() {
        super.onCreate();
        createNotifChannel();
        startForeground(NOTIF_ID, buildNotification("ACR-Upload aktiv"));
        Log.i(TAG, "Service gestartet");

        // 1) Initial-Scan: alle vorhandenen Dateien pruefen die noch nicht hochgeladen sind
        scanHandler.postDelayed(this::initialScan, 2000);
        // 2) Rescans alle 60s als Safety-Net falls FileObserver was verpasst
        scanHandler.postDelayed(periodicRescan, 60_000);

        // 3) FileObserver auf alle Root-Dirs einrichten
        setupObservers();
    }

    private final Runnable periodicRescan = new Runnable() {
        @Override public void run() {
            try { initialScan(); } catch (Throwable t) { Log.w(TAG, "rescan: " + t.getMessage()); }
            scanHandler.postDelayed(this, 60_000);
        }
    };

    private void setupObservers() {
        File[] roots = { ACR_ROOT, ACR_ROOT_ALT1, ACR_ROOT_ALT2, FUNKTAXI_ROOT };
        for (File root : roots) {
            if (!root.exists() || !root.isDirectory()) continue;
            observeRecursive(root);
        }
        Log.i(TAG, "FileObserver aktiv auf " + observers.size() + " Pfaden");
    }

    private void observeRecursive(File dir) {
        if (dir == null || !dir.isDirectory()) return;
        try {
            FileObserver obs = new FileObserver(dir.getAbsolutePath(), FileObserver.CREATE | FileObserver.CLOSE_WRITE | FileObserver.MOVED_TO) {
                @Override
                public void onEvent(int event, @Nullable String path) {
                    if (path == null) return;
                    File f = new File(dir, path);
                    if (f.isDirectory()) {
                        // Neuer Datums-Unterordner → auch beobachten
                        scanHandler.postDelayed(() -> observeRecursive(f), 500);
                    } else if (path.toLowerCase().endsWith(".m4a")) {
                        // Kleine Verzoegerung damit Datei fertig geschrieben ist
                        scanHandler.postDelayed(() -> uploadIfNew(f), 2000);
                    }
                }
            };
            obs.startWatching();
            observers.add(obs);
            File[] subs = dir.listFiles();
            if (subs != null) for (File s : subs) if (s.isDirectory()) observeRecursive(s);
        } catch (Throwable t) {
            Log.w(TAG, "observe " + dir + ": " + t.getMessage());
        }
    }

    private void initialScan() {
        File[] roots = { ACR_ROOT, ACR_ROOT_ALT1, ACR_ROOT_ALT2, FUNKTAXI_ROOT };
        int count = 0;
        for (File root : roots) {
            if (!root.exists()) continue;
            count += scanDir(root);
        }
        if (count > 0) Log.i(TAG, "Initial-Scan: " + count + " Kandidaten gefunden");
    }

    private int scanDir(File dir) {
        int c = 0;
        File[] list = dir.listFiles();
        if (list == null) return 0;
        for (File f : list) {
            if (f.isDirectory()) c += scanDir(f);
            else if (f.getName().toLowerCase().endsWith(".m4a")) { uploadIfNew(f); c++; }
        }
        return c;
    }

    private void uploadIfNew(File f) {
        if (!f.exists() || f.length() < 1000) return;
        String abs = f.getAbsolutePath();
        synchronized (inFlight) {
            if (inFlight.contains(abs)) return;
        }
        SharedPreferences sp = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        Set<String> done = sp.getStringSet(PREFS_UPLOADED_SET, new HashSet<>());
        if (done.contains(abs)) return;

        // Parse Metadaten aus Pfad: .../ACRPhone/YYYY/MM/DD/+phone/+phone-DIR-ts.m4a
        String[] parts = abs.replace('\\', '/').split("/");
        String phone = null, dir = null, yyyy = null, mm = null, dd = null;
        long ts = 0;
        Pattern p = Pattern.compile("(\\+?\\d[\\d-]*)-(\\d)-(\\d{10,13})\\.m4a", Pattern.CASE_INSENSITIVE);
        Matcher m = p.matcher(f.getName());
        if (m.find()) {
            phone = m.group(1);
            dir = "0".equals(m.group(2)) ? "incoming" : "outgoing";
            try { ts = Long.parseLong(m.group(3)); } catch (Exception _ignore) {}
            if (String.valueOf(ts).length() == 10) ts *= 1000L;
        }
        if (ts == 0) ts = f.lastModified();
        if (parts.length >= 4) {
            yyyy = parts[parts.length - 5];
            mm = parts[parts.length - 4];
            dd = parts[parts.length - 3];
        }
        if (yyyy == null || !yyyy.matches("\\d{4}")) {
            java.util.Calendar cal = java.util.Calendar.getInstance();
            cal.setTimeInMillis(ts);
            yyyy = String.format("%04d", cal.get(java.util.Calendar.YEAR));
            mm = String.format("%02d", cal.get(java.util.Calendar.MONTH) + 1);
            dd = String.format("%02d", cal.get(java.util.Calendar.DAY_OF_MONTH));
        }
        if (phone == null) phone = "unknown";

        final String storagePath = "callRecordings/" + yyyy + "/" + mm + "/" + dd + "/" + f.getName();
        final String phoneF = phone;
        final String dirF = dir != null ? dir : "incoming";
        final long tsF = ts;

        synchronized (inFlight) { inFlight.add(abs); }
        Log.i(TAG, "Upload " + abs + " -> " + storagePath);

        try {
            FirebaseStorage storage = FirebaseStorage.getInstance();
            StorageReference ref = storage.getReference().child(storagePath);
            android.net.Uri fileUri = android.net.Uri.fromFile(f);
            UploadTask task = ref.putFile(fileUri);
            task.addOnSuccessListener(taskSnap -> {
                ref.getDownloadUrl().addOnSuccessListener(url -> {
                    Map<String, Object> entry = new HashMap<>();
                    entry.put("phone", phoneF);
                    entry.put("direction", dirF);
                    entry.put("timestamp", tsF);
                    entry.put("storagePath", storagePath);
                    entry.put("audioUrl", url.toString());
                    entry.put("fileSize", f.length());
                    entry.put("source", "acr-native-auto-v6.66.240");
                    entry.put("createdAt", System.currentTimeMillis());
                    FirebaseDatabase.getInstance("https://taxi-heringsdorf-default-rtdb.europe-west1.firebasedatabase.app")
                        .getReference("callRecordings").push().setValue(entry);
                    // in SharedPreferences markieren
                    Set<String> cur = new HashSet<>(sp.getStringSet(PREFS_UPLOADED_SET, new HashSet<>()));
                    cur.add(abs);
                    sp.edit().putStringSet(PREFS_UPLOADED_SET, cur).apply();
                    synchronized (inFlight) { inFlight.remove(abs); }
                    Log.i(TAG, "Upload OK " + f.getName());
                });
            }).addOnFailureListener(err -> {
                Log.e(TAG, "Upload FAIL " + f.getName() + ": " + err.getMessage());
                synchronized (inFlight) { inFlight.remove(abs); }
            });
        } catch (Throwable t) {
            Log.e(TAG, "Upload setup fail: " + t.getMessage(), t);
            synchronized (inFlight) { inFlight.remove(abs); }
        }
    }

    private void createNotifChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            if (nm != null && nm.getNotificationChannel(CHANNEL_ID) == null) {
                NotificationChannel ch = new NotificationChannel(CHANNEL_ID, "Call-Upload", NotificationManager.IMPORTANCE_LOW);
                ch.setDescription("ACR-Aufnahmen Auto-Upload");
                ch.setShowBadge(false);
                nm.createNotificationChannel(ch);
            }
        }
    }

    private Notification buildNotification(String text) {
        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Call-Upload")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.stat_sys_upload)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOngoing(false)
            .build();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        scanHandler.removeCallbacksAndMessages(null);
        for (FileObserver o : observers) { try { o.stopWatching(); } catch (Throwable _i) {} }
        observers.clear();
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) { return null; }

    public static void startIfEnabled(Context ctx) {
        try {
            Intent i = new Intent(ctx, AcrUploadService.class);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ctx.startForegroundService(i);
            else ctx.startService(i);
        } catch (Throwable t) {
            Log.w(TAG, "startIfEnabled: " + t.getMessage());
        }
    }
}
