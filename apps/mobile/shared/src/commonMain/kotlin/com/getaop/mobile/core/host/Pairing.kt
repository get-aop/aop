package com.getaop.mobile.core.host

import io.ktor.http.Url

/** Pairing codes as the host issues them: 8 characters, shown as `XXXX-XXXX`. */
object PairingCode {
    const val LENGTH = 8

    /** The host's own normalisation: case and separators don't matter. */
    fun normalize(input: String): String = input.uppercase().filter { it.isLetterOrDigit() }

    fun isComplete(input: String): Boolean = normalize(input).length == LENGTH

    /** What the field shows while the person types: `ABCD-EFGH`. */
    fun format(input: String): String {
        val code = normalize(input).take(LENGTH)
        return if (code.length <= 4) code else "${code.take(4)}-${code.drop(4)}"
    }
}

/**
 * What a pairing QR code holds: `aop://pair?code=ABCD-EFGH&host=https://…`. `host` is left out
 * when the screen showing the code is the host's own (its address there is loopback, which
 * means nothing to a phone); the app then asks for the address.
 */
data class PairingPayload(val code: String, val host: String?) {
    companion object {
        fun parse(text: String): PairingPayload? {
            val trimmed = text.trim()
            if (!trimmed.startsWith("aop://pair")) {
                return if (PairingCode.isComplete(trimmed) && trimmed.length <= 12) {
                    PairingPayload(PairingCode.format(trimmed), null)
                } else {
                    null
                }
            }
            val url = runCatching { Url(trimmed) }.getOrNull() ?: return null
            val code = url.parameters["code"]?.takeIf(PairingCode::isComplete) ?: return null
            val host = url.parameters["host"]?.let { HostAddress.parse(it) }
            return PairingPayload(
                code = PairingCode.format(code),
                host = (host as? HostAddress.Result.Valid)?.baseUrl,
            )
        }
    }
}
