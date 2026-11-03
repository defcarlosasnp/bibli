package com.bibli.app;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.provider.Settings;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Abre los ajustes de "Texto a voz" del sistema, donde se descargan voces mejores.
 * El plugin de TTS solo lanza CHECK_TTS_DATA, que comprueba las voces y se cierra sin mostrar nada.
 */
@CapacitorPlugin(name = "VoiceSettings")
public class VoiceSettingsPlugin extends Plugin {

    @PluginMethod
    public void open(PluginCall call) {
        Intent intent = new Intent("com.android.settings.TTS_SETTINGS");
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getContext().startActivity(intent);
        } catch (ActivityNotFoundException e) {
            // Algunos fabricantes no exponen esa pantalla: ajustes de accesibilidad como alternativa
            Intent fallback = new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS);
            fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(fallback);
        }
        call.resolve();
    }
}
