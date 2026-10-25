package com.roopesh.codeworkspace;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.util.Log;

/**
 * Foreground service that runs while integrated terminals are open. It keeps the app
 * process from being frozen in the background, so the relayed ttyd sockets (TermSocket)
 * keep answering pings and stay connected while the user is in another app.
 */
public class TermService extends Service {
    private static final String CHANNEL = "terminal";
    private static final int NOTIFICATION_ID = 1;

    static void setActive(Context context, boolean on) {
        Intent i = new Intent(context, TermService.class);
        try {
            if (on) context.startForegroundService(i);
            else context.stopService(i);
        } catch (Exception e) {
            Log.w(MainActivity.TAG, "terminal keep-alive service failed", e);
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        nm.createNotificationChannel(new NotificationChannel(CHANNEL, "Terminal sessions", NotificationManager.IMPORTANCE_LOW));
        Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        Notification n = new Notification.Builder(this, CHANNEL)
                .setSmallIcon(R.drawable.ic_launcher_fg)
                .setContentTitle(getString(R.string.app_name))
                .setContentText("Terminal sessions are running")
                .setContentIntent(PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE))
                .setOngoing(true)
                .build();
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        } else {
            startForeground(NOTIFICATION_ID, n);
        }
        return START_NOT_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
