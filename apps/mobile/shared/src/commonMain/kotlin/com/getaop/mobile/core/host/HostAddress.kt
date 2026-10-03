package com.getaop.mobile.core.host

import io.ktor.http.URLBuilder
import io.ktor.http.URLProtocol
import io.ktor.http.Url

/**
 * Turns what the person typed into the host's base URL, or says why it can't. The host's
 * pages and token travel only over HTTPS (`tailscale serve` gives the address a real
 * certificate); plain HTTP is accepted only for a host on this device or the emulator's
 * alias for the computer it runs on, which never leave the machine.
 */
object HostAddress {
    sealed interface Result {
        data class Valid(val baseUrl: String) : Result
        data class Invalid(val reason: String) : Result
    }

    private val LOCAL_HOSTS = setOf("localhost", "127.0.0.1", "10.0.2.2")

    fun parse(input: String): Result {
        val trimmed = input.trim().trimEnd('/')
        if (trimmed.isEmpty()) return Result.Invalid("Enter the host's address.")
        val withScheme = if ("://" in trimmed) trimmed else "https://$trimmed"
        val url = runCatching { Url(withScheme) }.getOrNull()
            ?: return Result.Invalid("That doesn't look like an address.")
        if (url.host.isBlank() || ' ' in url.host) {
            return Result.Invalid("That doesn't look like an address.")
        }
        val secure = url.protocol == URLProtocol.HTTPS
        val localPlain = url.protocol == URLProtocol.HTTP && url.host in LOCAL_HOSTS
        if (!secure && !localPlain) {
            return Result.Invalid("Use the host's https:// address, such as its Tailscale one.")
        }
        val base = URLBuilder(url).apply {
            // A pasted dashboard or API address still means the host itself.
            pathSegments = emptyList()
            parameters.clear()
            fragment = ""
        }.buildString().trimEnd('/')
        return Result.Valid(base)
    }

    /**
     * "soulf" for https://soulf.tailffbdec.ts.net:25650: the name the person knows the host by.
     * An IP address has no such name, so it stays whole.
     */
    fun shortName(baseUrl: String): String {
        val host = runCatching { Url(baseUrl).host }.getOrNull()?.ifBlank { null } ?: return baseUrl
        return if (host.all { it.isDigit() || it == '.' || it == ':' }) host else host.substringBefore('.')
    }
}
