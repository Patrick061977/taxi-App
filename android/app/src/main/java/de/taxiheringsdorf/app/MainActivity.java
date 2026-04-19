package de.taxiheringsdorf.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // v6.40.0: eigenes Plugin für Foreground-Service registrieren
        registerPlugin(ShiftForegroundPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
