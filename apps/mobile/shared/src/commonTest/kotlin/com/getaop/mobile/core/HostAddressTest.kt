package com.getaop.mobile.core

import com.getaop.mobile.core.host.HostAddress
import com.getaop.mobile.core.host.PairingCode
import com.getaop.mobile.core.host.PairingPayload
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNull

class HostAddressTest {
    private fun valid(input: String) = assertIs<HostAddress.Result.Valid>(HostAddress.parse(input)).baseUrl

    @Test
    fun addsHttpsAndDropsPaths() {
        assertEquals("https://soulf.tailffbdec.ts.net:25650", valid("soulf.tailffbdec.ts.net:25650"))
        assertEquals("https://soulf.tailffbdec.ts.net:25650", valid(" https://soulf.tailffbdec.ts.net:25650/projects/x?y=1 "))
        assertEquals("https://mac.tail1.ts.net", valid("https://mac.tail1.ts.net/api/"))
    }

    @Test
    fun refusesPlainHttpExceptOnThisMachine() {
        assertIs<HostAddress.Result.Invalid>(HostAddress.parse("http://soulf.tailffbdec.ts.net:25650"))
        assertEquals("http://10.0.2.2:4100", valid("http://10.0.2.2:4100"))
        assertEquals("http://127.0.0.1:25650", valid("http://127.0.0.1:25650"))
    }

    @Test
    fun refusesEmptyAndNonsense() {
        assertIs<HostAddress.Result.Invalid>(HostAddress.parse("  "))
        assertIs<HostAddress.Result.Invalid>(HostAddress.parse("ftp://host"))
    }

    @Test
    fun shortNameIsTheFirstLabel() {
        assertEquals("soulf", HostAddress.shortName("https://soulf.tailffbdec.ts.net:25650"))
        assertEquals("10.0.2.2", HostAddress.shortName("http://10.0.2.2:4100"))
    }
}

class PairingTest {
    @Test
    fun normalizesAndFormatsCodes() {
        assertEquals("ABCD-EFGH", PairingCode.format("abcd efgh"))
        assertEquals("ABC", PairingCode.format("abc"))
        assertEquals(true, PairingCode.isComplete("abcd-efgh"))
        assertEquals(false, PairingCode.isComplete("abcd-efg"))
    }

    @Test
    fun readsQrPayloadsWithAndWithoutHost() {
        assertEquals(
            PairingPayload("ABCD-EFGH", "https://soulf.tailffbdec.ts.net:25650"),
            PairingPayload.parse("aop://pair?code=abcdefgh&host=https%3A%2F%2Fsoulf.tailffbdec.ts.net%3A25650"),
        )
        assertEquals(PairingPayload("ABCD-EFGH", null), PairingPayload.parse("aop://pair?code=ABCD-EFGH"))
        assertEquals(PairingPayload("ABCD-EFGH", null), PairingPayload.parse("ABCD-EFGH"))
    }

    @Test
    fun ignoresOtherQrCodes() {
        assertNull(PairingPayload.parse("https://example.com"))
        assertNull(PairingPayload.parse("aop://pair?code=short"))
        // A host that isn't https is dropped, so the person types it instead.
        assertEquals(PairingPayload("ABCD-EFGH", null), PairingPayload.parse("aop://pair?code=ABCDEFGH&host=http://evil.example"))
    }
}
