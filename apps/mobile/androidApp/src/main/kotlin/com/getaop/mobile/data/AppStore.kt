package com.getaop.mobile.data

import android.content.Context
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.getaop.mobile.core.notify.NotificationPrefs
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map

/** The host this phone is paired with. The token is held decrypted only in memory. */
data class Pairing(val baseUrl: String, val token: String, val deviceName: String)

/** What the person chose on this phone. */
data class PhoneSettings(
    val notifications: NotificationPrefs = NotificationPrefs(),
    /** Keep a connection to the host while the app is closed, so notifications arrive. */
    val stayConnected: Boolean = true,
    /** The last address typed, offered again when pairing anew. */
    val lastHost: String? = null,
)

private val Context.dataStore by preferencesDataStore(name = "aop")

class AppStore(private val context: Context, private val cipher: TokenCipher = TokenCipher()) {
    val settings: Flow<PhoneSettings> = context.dataStore.data.map(::readSettings)

    suspend fun pairing(): Pairing? {
        val prefs = context.dataStore.data.first()
        val baseUrl = prefs[HOST] ?: return null
        val token = prefs[TOKEN]?.let(cipher::decrypt) ?: return null
        return Pairing(baseUrl, token, prefs[DEVICE_NAME] ?: "Phone")
    }

    suspend fun savePairing(pairing: Pairing) {
        val sealed = cipher.encrypt(pairing.token)
        context.dataStore.edit {
            it[HOST] = pairing.baseUrl
            it[LAST_HOST] = pairing.baseUrl
            it[TOKEN] = sealed
            it[DEVICE_NAME] = pairing.deviceName
        }
    }

    suspend fun forgetPairing() {
        context.dataStore.edit {
            it.remove(HOST)
            it.remove(TOKEN)
        }
        cipher.forget()
    }

    suspend fun updateSettings(change: (PhoneSettings) -> PhoneSettings) {
        context.dataStore.edit { prefs ->
            val next = change(readSettings(prefs))
            prefs[NOTIFY_NEEDS_YOU] = next.notifications.needsYou
            prefs[NOTIFY_FAILED] = next.notifications.failed
            prefs[NOTIFY_PRS] = next.notifications.pullRequests
            prefs[NOTIFY_COORDINATOR] = next.notifications.coordinator
            prefs[STAY_CONNECTED] = next.stayConnected
        }
    }

    private fun readSettings(prefs: Preferences): PhoneSettings {
        val defaults = NotificationPrefs()
        return PhoneSettings(
            notifications = NotificationPrefs(
                needsYou = prefs[NOTIFY_NEEDS_YOU] ?: defaults.needsYou,
                failed = prefs[NOTIFY_FAILED] ?: defaults.failed,
                pullRequests = prefs[NOTIFY_PRS] ?: defaults.pullRequests,
                coordinator = prefs[NOTIFY_COORDINATOR] ?: defaults.coordinator,
            ),
            stayConnected = prefs[STAY_CONNECTED] ?: true,
            lastHost = prefs[LAST_HOST],
        )
    }

    private companion object {
        val HOST = stringPreferencesKey("host")
        val LAST_HOST = stringPreferencesKey("last_host")
        val TOKEN = stringPreferencesKey("token_sealed")
        val DEVICE_NAME = stringPreferencesKey("device_name")
        val NOTIFY_NEEDS_YOU = booleanPreferencesKey("notify_needs_you")
        val NOTIFY_FAILED = booleanPreferencesKey("notify_failed")
        val NOTIFY_PRS = booleanPreferencesKey("notify_prs")
        val NOTIFY_COORDINATOR = booleanPreferencesKey("notify_coordinator")
        val STAY_CONNECTED = booleanPreferencesKey("stay_connected")
    }
}
