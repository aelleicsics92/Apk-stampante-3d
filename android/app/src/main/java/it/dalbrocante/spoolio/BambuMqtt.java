package it.dalbrocante.spoolio;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.eclipse.paho.client.mqttv3.IMqttDeliveryToken;
import org.eclipse.paho.client.mqttv3.MqttCallbackExtended;
import org.eclipse.paho.client.mqttv3.MqttClient;
import org.eclipse.paho.client.mqttv3.MqttConnectOptions;
import org.eclipse.paho.client.mqttv3.MqttMessage;
import org.eclipse.paho.client.mqttv3.persist.MemoryPersistence;
import javax.net.ssl.SSLSocketFactory;

@CapacitorPlugin(name = "BambuMqtt")
public class BambuMqtt extends Plugin {
    private MqttClient client;

    @PluginMethod
    public void connect(final PluginCall call) {
        final String host = call.getString("host", "us.mqtt.bambulab.com");
        final String user = call.getString("user", "");
        final String pass = call.getString("pass", "");
        final String topic = call.getString("topic", "");
        final String req = call.getString("reqTopic", "");
        final String push = call.getString("push", "");
        new Thread(() -> {
            try {
                closeQuiet();
                client = new MqttClient("ssl://" + host + ":8883", "spoolio" + System.currentTimeMillis(), new MemoryPersistence());
                MqttConnectOptions o = new MqttConnectOptions();
                o.setUserName(user);
                o.setPassword(pass.toCharArray());
                o.setCleanSession(true);
                o.setAutomaticReconnect(true);
                o.setKeepAliveInterval(30);
                o.setConnectionTimeout(15);
                o.setSocketFactory(SSLSocketFactory.getDefault() instanceof SSLSocketFactory ? (SSLSocketFactory) SSLSocketFactory.getDefault() : null);
                client.setCallback(new MqttCallbackExtended() {
                    public void connectComplete(boolean reconnect, String uri) {
                        if (!reconnect) return;
                        try { client.subscribe(topic); if (!req.isEmpty() && !push.isEmpty()) client.publish(req, new MqttMessage(push.getBytes())); } catch (Exception ignored) {}
                    }
                    public void connectionLost(Throwable t) {
                        JSObject r = new JSObject();
                        r.put("error", String.valueOf(t));
                        notifyListeners("lost", r);
                    }
                    public void messageArrived(String tp, MqttMessage m) {
                        JSObject r = new JSObject();
                        r.put("topic", tp);
                        r.put("payload", new String(m.getPayload()));
                        notifyListeners("msg", r);
                    }
                    public void deliveryComplete(IMqttDeliveryToken t) {}
                });
                client.connect(o);
                client.subscribe(topic);
                if (!req.isEmpty() && !push.isEmpty()) client.publish(req, new MqttMessage(push.getBytes()));
                call.resolve();
            } catch (Exception e) {
                call.reject(String.valueOf(e));
            }
        }).start();
    }

    @PluginMethod
    public void publish(final PluginCall call) {
        new Thread(() -> {
            try {
                if (client != null && client.isConnected()) client.publish(call.getString("topic", ""), new MqttMessage(call.getString("payload", "").getBytes()));
                call.resolve();
            } catch (Exception e) {
                call.reject(String.valueOf(e));
            }
        }).start();
    }

    @PluginMethod
    public void disconnect(final PluginCall call) {
        new Thread(() -> { closeQuiet(); call.resolve(); }).start();
    }

    private void closeQuiet() {
        try { if (client != null) { try { client.disconnect(1000); } catch (Exception ignored) {} client.close(); } } catch (Exception ignored) {}
        client = null;
    }
}
