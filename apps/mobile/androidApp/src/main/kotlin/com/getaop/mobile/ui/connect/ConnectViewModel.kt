package com.getaop.mobile.ui.connect

import android.app.Application
import android.os.Build
import android.provider.Settings
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.viewModelScope
import com.getaop.mobile.aop
import com.getaop.mobile.core.host.HostAddress
import com.getaop.mobile.core.host.HostError
import com.getaop.mobile.core.host.PairingCode
import com.getaop.mobile.core.host.PairingPayload
import com.getaop.mobile.notify.ConnectionService
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class ConnectForm(
    val address: String = "",
    val code: String = "",
    val deviceName: String = "",
    val busy: Boolean = false,
    val error: String? = null,
) {
    val canSubmit: Boolean get() = !busy && address.isNotBlank() && PairingCode.isComplete(code) && deviceName.isNotBlank()
}

/** Pairs this phone with a host: the address, a one-time code from the host, and a name for the phone. */
class ConnectViewModel(application: Application, private val saved: SavedStateHandle) : AndroidViewModel(application) {
    private val app = application.aop
    private val mutable = MutableStateFlow(
        ConnectForm(
            address = saved["address"] ?: "",
            code = saved["code"] ?: "",
            deviceName = saved["deviceName"] ?: defaultDeviceName(application),
        ),
    )
    val form: StateFlow<ConnectForm> = mutable.asStateFlow()

    init {
        viewModelScope.launch {
            if (form.value.address.isBlank()) app.store.settings.first().lastHost?.let(::setAddress)
        }
    }

    fun setAddress(value: String) = edit { it.copy(address = value.trim(), error = null) }

    fun setCode(value: String) = edit { it.copy(code = PairingCode.format(value), error = null) }

    fun setDeviceName(value: String) = edit { it.copy(deviceName = value.take(100), error = null) }

    /** A scanned or opened `aop://pair` link: fills what it carries. */
    fun usePayload(payload: PairingPayload) = edit {
        it.copy(code = payload.code, address = payload.host ?: it.address, error = null)
    }

    fun submit() {
        val current = form.value
        if (!current.canSubmit) return
        val address = when (val parsed = HostAddress.parse(current.address)) {
            is HostAddress.Result.Invalid -> return edit { it.copy(error = parsed.reason) }
            is HostAddress.Result.Valid -> parsed.baseUrl
        }
        edit { it.copy(busy = true, error = null, address = address) }
        viewModelScope.launch {
            try {
                app.sessions.pair(address, current.code, current.deviceName.trim())
                app.sessions.session?.goLive()
                ConnectionService.sync(app)
                edit { it.copy(busy = false, code = "") }
            } catch (error: HostError) {
                edit { it.copy(busy = false, error = describe(error, address)) }
            }
        }
    }

    private fun describe(error: HostError, address: String): String {
        val host = HostAddress.shortName(address)
        return when (error) {
            is HostError.Unreachable -> "Can't reach $host. Is Tailscale on, and is the address right?"
            is HostError.InvalidPairingCode -> "That code is wrong or has expired. Make a new one on the host."
            is HostError.RateLimited ->
                "Too many wrong codes. Try again in ${error.retryAfterSeconds ?: 60} seconds."
            else -> error.message ?: "Pairing failed."
        }
    }

    private fun edit(change: (ConnectForm) -> ConnectForm) {
        mutable.update(change)
        saved["address"] = mutable.value.address
        saved["code"] = mutable.value.code
        saved["deviceName"] = mutable.value.deviceName
    }

    private companion object {
        /** The name the person gave the phone ("Galaxy Z Fold8"), else its model. */
        fun defaultDeviceName(application: Application): String =
            Settings.Global.getString(application.contentResolver, Settings.Global.DEVICE_NAME)?.takeIf { it.isNotBlank() }
                ?: listOf(Build.MANUFACTURER.replaceFirstChar { it.uppercase() }, Build.MODEL).joinToString(" ")
    }
}
