package com.bibli.app;

import android.content.Intent;
import android.os.Bundle;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Puente entre la lectura en voz alta (JavaScript) y ReadAloudService.
 * JS → update/stop, y startQueue/takeQueue para leer con la pantalla bloqueada.
 * Servicio → evento "action" (play, pause, next, previous, stop) mientras lee el JavaScript.
 */
@CapacitorPlugin(name = "BackgroundReading")
public class ReadAloudPlugin extends Plugin {

    private static ReadAloudPlugin instance;

    @Override
    public void load() {
        instance = this;
    }

    @Override
    protected void handleOnDestroy() {
        if (instance == this) instance = null;
        getContext().startService(new Intent(getContext(), ReadAloudService.class).setAction(ReadAloudService.ACTION_STOP));
    }

    /** Crea o actualiza la notificación: título, autor, portada (data URL, opcional) y si está sonando. */
    @PluginMethod
    public void update(PluginCall call) {
        Intent intent = new Intent(getContext(), ReadAloudService.class)
            .setAction(ReadAloudService.ACTION_UPDATE)
            .putExtra("title", call.getString("title", ""))
            .putExtra("author", call.getString("author", ""))
            .putExtra("playing", call.getBoolean("playing", false));
        String cover = call.getString("cover");
        if (cover != null) intent.putExtra("cover", cover);
        try {
            ContextCompat.startForegroundService(getContext(), intent);
            call.resolve();
        } catch (Exception e) {
            // Android 12+ no deja iniciar servicios en primer plano desde segundo plano
            call.reject("No se pudo iniciar la lectura en segundo plano: " + e.getMessage());
        }
    }

    /** Entrega al servicio las próximas frases para que siga leyendo con la pantalla bloqueada. */
    @PluginMethod
    public void startQueue(PluginCall call) {
        ReadAloudService service = ReadAloudService.instance;
        if (service == null) {
            call.reject("El servicio de lectura no está activo");
            return;
        }
        try {
            JSArray list = call.getArray("sentences", new JSArray());
            String[] sentences = new String[list.length()];
            for (int i = 0; i < list.length(); i++) sentences[i] = list.getString(i);
            String voice = call.getString("voice");
            float rate = call.getFloat("rate", 1f);
            getActivity().runOnUiThread(() -> {
                service.startQueue(sentences, voice, rate);
                call.resolve();
            });
        } catch (Exception e) {
            call.reject("Cola de lectura no válida: " + e.getMessage());
        }
    }

    /** Detiene la lectura nativa y devuelve por dónde iba: { active, index, playing, finished }. */
    @PluginMethod
    public void takeQueue(PluginCall call) {
        ReadAloudService service = ReadAloudService.instance;
        if (service == null) {
            JSObject none = new JSObject();
            none.put("active", false);
            call.resolve(none);
            return;
        }
        getActivity().runOnUiThread(() -> {
            Bundle state = service.takeQueue();
            JSObject result = new JSObject();
            result.put("active", state.getBoolean("active"));
            result.put("index", state.getInt("index"));
            result.put("playing", state.getBoolean("playing"));
            result.put("finished", state.getBoolean("finished"));
            call.resolve(result);
        });
    }

    @PluginMethod
    public void stop(PluginCall call) {
        getContext().startService(new Intent(getContext(), ReadAloudService.class).setAction(ReadAloudService.ACTION_STOP));
        call.resolve();
    }

    static void emit(String action) {
        if (instance == null || action == null) return;
        JSObject data = new JSObject();
        data.put("action", action);
        instance.notifyListeners("action", data);
    }
}
