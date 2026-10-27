package it.dalbrocante.spoolio;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(BambuMqtt.class);
        super.onCreate(savedInstanceState);
    }
}
