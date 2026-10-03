package com.getaop.mobile.core.host

/** Why a call to the host failed, in the terms the app shows the person. */
sealed class HostError(message: String) : Exception(message) {
    /** No answer at all: the phone is offline, Tailscale is off, or the host is down. */
    class Unreachable(cause: Throwable?) : HostError("Can't reach the host") {
        init {
            if (cause != null) initCause(cause)
        }
    }

    /** The host no longer knows this phone: it was removed on the host, or never paired. */
    class Unauthorized : HostError("This phone isn't paired with the host")

    class InvalidPairingCode : HostError("Wrong or expired pairing code")

    class RateLimited(val retryAfterSeconds: Int?) : HostError("Too many wrong pairing codes")

    /** The host answered but isn't an AOP host, or speaks an API version this app can't. */
    class Incompatible(message: String) : HostError(message)

    class Http(val status: Int, message: String) : HostError(message)
}
