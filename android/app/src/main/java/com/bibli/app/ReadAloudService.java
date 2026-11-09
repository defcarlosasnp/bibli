package com.bibli.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.speech.tts.Voice;
import android.util.Base64;
import android.util.Log;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;

/**
 * Servicio en primer plano mientras la app lee en voz alta.
 *
 * Con la app visible, la lectura la dirige el JavaScript y este servicio solo muestra los controles
 * (notificación y pantalla de bloqueo) y evita que Android cierre la app.
 *
 * Con la pantalla bloqueada, Chromium congela el WebView al minuto y el JavaScript deja de avanzar.
 * Por eso, al pasar a segundo plano, el JavaScript entrega aquí las próximas frases ("cola") y el
 * servicio las lee él mismo con el TextToSpeech de Android. Al volver a la app, el JavaScript
 * pregunta por dónde se quedó (takeQueue) y retoma la lectura.
 */
public class ReadAloudService extends Service {

    static final String ACTION_UPDATE = "com.bibli.app.readaloud.UPDATE";
    static final String ACTION_STOP = "com.bibli.app.readaloud.STOP";
    private static final String ACTION_BUTTON = "com.bibli.app.readaloud.BUTTON";
    private static final String EXTRA_BUTTON = "button";

    private static final String CHANNEL_ID = "lectura";
    private static final int NOTIFICATION_ID = 1001;

    /** Instancia viva, para que el plugin pueda entregarle y pedirle la cola. */
    static ReadAloudService instance;

    private MediaSession session;
    private PowerManager.WakeLock wakeLock;
    private String title = "";
    private String author = "";
    private Bitmap cover;
    private boolean playing;

    // ---------- Lectura nativa (pantalla bloqueada) ----------
    private final Handler main = new Handler(Looper.getMainLooper());
    private TextToSpeech tts;
    private boolean ttsReady;
    private List<String> queue = null;
    private int queueIndex;
    private boolean queueFinished;
    private String voiceName;
    private float rate = 1f;
    private boolean usingFallbackVoice;
    private Runnable watchdog;

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "Lectura en voz alta", NotificationManager.IMPORTANCE_LOW);
            channel.setDescription("Controles mientras Lumi te lee un libro");
            channel.setShowBadge(false);
            nm.createNotificationChannel(channel);
        }

        session = new MediaSession(this, "BibliLectura");
        session.setCallback(new MediaSession.Callback() {
            @Override public void onPlay() { onButton("play"); }
            @Override public void onPause() { onButton("pause"); }
            @Override public void onSkipToNext() { onButton("next"); }
            @Override public void onSkipToPrevious() { onButton("previous"); }
            @Override public void onStop() { onButton("stop"); }
        });
        session.setActive(true);

        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Bibli:LecturaEnVozAlta");
        wakeLock.setReferenceCounted(false);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : null;
        if (ACTION_STOP.equals(action)) {
            stopQueue();
            stopSelfCleanly();
            return START_NOT_STICKY;
        }
        if (ACTION_BUTTON.equals(action)) {
            onButton(intent.getStringExtra(EXTRA_BUTTON));
            return START_NOT_STICKY;
        }
        if (ACTION_UPDATE.equals(action)) {
            title = valueOr(intent.getStringExtra("title"), "Bibli");
            author = valueOr(intent.getStringExtra("author"), "");
            // Mientras lee la cola, el estado lo decide el servicio
            if (queue == null) playing = intent.getBooleanExtra("playing", false);
            String coverData = intent.getStringExtra("cover");
            if (coverData != null) cover = decodeDataUrl(coverData);
        }
        updateSessionAndNotification();
        return START_NOT_STICKY;
    }

    /** Botones de la notificación / pantalla de bloqueo / auriculares. */
    private void onButton(String button) {
        if (button == null) return;
        if (queue == null) {
            // La app está visible: decide el JavaScript
            ReadAloudPlugin.emit(button);
            return;
        }
        switch (button) {
            case "play": if (!playing) { playing = true; speakCurrent(); } break;
            case "pause": playing = false; cancelSpeech(); break;
            case "next": queueIndex = Math.min(queueIndex + 1, queue.size() - 1); if (playing) speakCurrent(); break;
            case "previous": queueIndex = Math.max(queueIndex - 1, 0); if (playing) speakCurrent(); break;
            case "stop": playing = false; cancelSpeech(); ReadAloudPlugin.emit("stop"); break;
        }
        updateSessionAndNotification();
    }

    // ---------- Cola nativa ----------

    /** El JavaScript entrega las próximas frases: el servicio sigue leyendo desde la primera. */
    void startQueue(String[] sentences, String voice, float speechRate) {
        queue = new ArrayList<>(Arrays.asList(sentences));
        queueIndex = 0;
        queueFinished = false;
        voiceName = voice;
        rate = speechRate;
        usingFallbackVoice = false;
        playing = true;
        if (tts == null) {
            tts = new TextToSpeech(getApplicationContext(), status -> main.post(() -> {
                ttsReady = status == TextToSpeech.SUCCESS;
                if (ttsReady) {
                    tts.setOnUtteranceProgressListener(progressListener);
                    if (queue != null && playing) speakCurrent();
                }
            }));
        } else if (ttsReady) {
            speakCurrent();
        }
        updateSessionAndNotification();
    }

    /** Devuelve por dónde va la cola y la detiene: el JavaScript retoma la lectura. */
    Bundle takeQueue() {
        Bundle state = new Bundle();
        state.putBoolean("active", queue != null);
        state.putInt("index", queueIndex);
        state.putBoolean("playing", playing);
        state.putBoolean("finished", queueFinished);
        stopQueue();
        return state;
    }

    private void stopQueue() {
        cancelSpeech();
        queue = null;
    }

    private void speakCurrent() {
        if (queue == null || !ttsReady) return;
        if (queueIndex >= queue.size()) {
            queueFinished = true;
            playing = false;
            updateSessionAndNotification();
            return;
        }
        applyVoice();
        tts.setSpeechRate(rate);
        String text = queue.get(queueIndex);
        Log.d("BibliLectura", "Frase " + (queueIndex + 1) + "/" + queue.size() + (usingFallbackVoice ? " (voz local)" : ""));
        tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "bibli-" + queueIndex);
        armWatchdog(text);
    }

    private void applyVoice() {
        Voice target = null;
        if (voiceName != null && tts.getVoices() != null) {
            for (Voice v : tts.getVoices()) if (v.getName().equals(voiceName)) target = v;
        }
        if (target != null && usingFallbackVoice && target.isNetworkConnectionRequired()) target = localVoiceLike(target.getLocale());
        if (target != null) tts.setVoice(target);
        else tts.setLanguage(new Locale("es", "ES"));
    }

    /** Las voces de internet se cuelgan sin conexión: si una frase no termina a tiempo, se usa una local. */
    private void armWatchdog(String text) {
        if (watchdog != null) main.removeCallbacks(watchdog);
        long limitMs = (long) ((8 + text.length() / (15.0 * rate) * 2.5) * 1000);
        final int index = queueIndex;
        watchdog = () -> {
            if (queue == null || !playing || queueIndex != index) return;
            if (!usingFallbackVoice) {
                usingFallbackVoice = true;
                speakCurrent(); // la misma frase, con la voz del dispositivo
            } else {
                queueIndex++;
                speakCurrent();
            }
        };
        main.postDelayed(watchdog, limitMs);
    }

    private Voice localVoiceLike(Locale locale) {
        Voice best = null;
        for (Voice v : tts.getVoices()) {
            if (v.isNetworkConnectionRequired() || v.getFeatures().contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED)) continue;
            if (!v.getLocale().getLanguage().equals(locale.getLanguage())) continue;
            if (best == null || (v.getLocale().equals(locale) && !best.getLocale().equals(locale))) best = v;
        }
        return best;
    }

    private void cancelSpeech() {
        if (watchdog != null) main.removeCallbacks(watchdog);
        if (tts != null) tts.stop();
    }

    private final UtteranceProgressListener progressListener = new UtteranceProgressListener() {
        @Override public void onStart(String utteranceId) {}

        @Override public void onDone(String utteranceId) {
            main.post(() -> {
                if (queue == null || !playing || !("bibli-" + queueIndex).equals(utteranceId)) return;
                queueIndex++;
                speakCurrent();
            });
        }

        @Override public void onError(String utteranceId) {
            onDone(utteranceId);
        }
    };

    // ---------- Notificación y sesión multimedia ----------

    private void updateSessionAndNotification() {
        MediaMetadata.Builder meta = new MediaMetadata.Builder()
            .putString(MediaMetadata.METADATA_KEY_TITLE, title)
            .putString(MediaMetadata.METADATA_KEY_ARTIST, author.isEmpty() ? "Lumi te lee 🦉" : author);
        if (cover != null) meta.putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, cover);
        session.setMetadata(meta.build());
        session.setPlaybackState(new PlaybackState.Builder()
            .setActions(PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE | PlaybackState.ACTION_PLAY_PAUSE
                | PlaybackState.ACTION_SKIP_TO_NEXT | PlaybackState.ACTION_SKIP_TO_PREVIOUS | PlaybackState.ACTION_STOP)
            .setState(playing ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED, PlaybackState.PLAYBACK_POSITION_UNKNOWN, 1f)
            .build());

        Notification notification = buildNotification();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }

        // La CPU solo hace falta despierta mientras suena; en pausa se libera para no gastar batería
        if (playing) wakeLock.acquire(4 * 60 * 60 * 1000L);
        else if (wakeLock.isHeld()) wakeLock.release();
    }

    private Notification buildNotification() {
        Notification.Builder b = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? new Notification.Builder(this, CHANNEL_ID)
            : new Notification.Builder(this);

        Intent open = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent contentIntent = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);

        b.setSmallIcon(R.drawable.ic_stat_lumi)
            .setContentTitle(title)
            .setContentText(author.isEmpty() ? "Lumi te lee 🦉" : author)
            .setContentIntent(contentIntent)
            .setDeleteIntent(buttonIntent("stop", 4))
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setOngoing(playing)
            .setShowWhen(false)
            .addAction(new Notification.Action.Builder(android.R.drawable.ic_media_previous, "Frase anterior", buttonIntent("previous", 1)).build())
            .addAction(playing
                ? new Notification.Action.Builder(android.R.drawable.ic_media_pause, "Pausar", buttonIntent("pause", 2)).build()
                : new Notification.Action.Builder(android.R.drawable.ic_media_play, "Seguir", buttonIntent("play", 2)).build())
            .addAction(new Notification.Action.Builder(android.R.drawable.ic_media_next, "Frase siguiente", buttonIntent("next", 3)).build())
            .setStyle(new Notification.MediaStyle().setMediaSession(session.getSessionToken()).setShowActionsInCompactView(0, 1, 2));
        if (cover != null) b.setLargeIcon(cover);
        return b.build();
    }

    private PendingIntent buttonIntent(String button, int requestCode) {
        Intent i = new Intent(this, ReadAloudService.class).setAction(ACTION_BUTTON).putExtra(EXTRA_BUTTON, button);
        return PendingIntent.getService(this, requestCode, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private void stopSelfCleanly() {
        if (wakeLock.isHeld()) wakeLock.release();
        stopForeground(true);
        stopSelf();
    }

    @Override
    public void onDestroy() {
        if (instance == this) instance = null;
        if (watchdog != null) main.removeCallbacks(watchdog);
        if (tts != null) tts.shutdown();
        if (wakeLock.isHeld()) wakeLock.release();
        session.setActive(false);
        session.release();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private static String valueOr(String s, String fallback) {
        return s == null || s.isEmpty() ? fallback : s;
    }

    /** La portada llega como data URL ("data:image/jpeg;base64,..."). */
    private static Bitmap decodeDataUrl(String dataUrl) {
        try {
            int comma = dataUrl.indexOf(',');
            byte[] bytes = Base64.decode(comma >= 0 ? dataUrl.substring(comma + 1) : dataUrl, Base64.DEFAULT);
            return BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
        } catch (IllegalArgumentException e) {
            return null;
        }
    }
}
