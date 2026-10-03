package com.getaop.mobile.data

import com.getaop.mobile.core.host.HostClient
import com.getaop.mobile.core.host.HostError
import com.getaop.mobile.core.session.HostSession
import io.ktor.client.HttpClient
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/** Where the app is with its host: still reading storage, not paired, or paired with a live session. */
sealed interface PairState {
    data object Loading : PairState
    data object Unpaired : PairState
    data class Paired(val pairing: Pairing, val session: HostSession) : PairState
}

/**
 * Owns the one [HostSession] the screens, the notification service and the boot receiver share,
 * so a phone never holds two connections to its host.
 */
class SessionHolder(
    private val store: AppStore,
    private val http: HttpClient,
    private val scope: CoroutineScope,
) {
    private val mutable = MutableStateFlow<PairState>(PairState.Loading)
    val state: StateFlow<PairState> = mutable.asStateFlow()

    val session: HostSession? get() = (state.value as? PairState.Paired)?.session

    suspend fun restore() {
        if (state.value != PairState.Loading) return
        val pairing = store.pairing()
        mutable.value = if (pairing == null) PairState.Unpaired else PairState.Paired(pairing, open(pairing))
    }

    /** Checks the address, trades the code for a token and keeps it. Throws [HostError]. */
    suspend fun pair(baseUrl: String, code: String, deviceName: String) {
        val anonymous = HostClient(baseUrl, token = null, http = http)
        anonymous.health()
        val paired = anonymous.pair(code, deviceName)
        val pairing = Pairing(baseUrl, paired.token, deviceName)
        store.savePairing(pairing)
        replace(PairState.Paired(pairing, open(pairing)))
    }

    /** Removes this phone from the host when it can, and forgets the token either way. */
    suspend fun disconnect() {
        val current = state.value as? PairState.Paired
        runCatching { current?.session?.client?.signOut() }
        forget()
    }

    /** The host already removed this phone: forget the token without asking it. */
    suspend fun forget() {
        store.forgetPairing()
        replace(PairState.Unpaired)
    }

    fun hostReachable(baseUrl: String): HostClient = HostClient(baseUrl, token = null, http = http)

    private fun open(pairing: Pairing): HostSession =
        HostSession(HostClient(pairing.baseUrl, pairing.token, http), http, scope, clock = System::currentTimeMillis)

    private fun replace(next: PairState) {
        (state.value as? PairState.Paired)?.session?.pause()
        mutable.value = next
    }
}
