package com.getaop.mobile.core

import com.getaop.mobile.core.notify.NotificationKind
import com.getaop.mobile.core.notify.NotificationPolicy
import com.getaop.mobile.core.notify.NotificationPrefs
import com.getaop.mobile.core.session.HostChange
import com.getaop.mobile.core.wire.Block
import com.getaop.mobile.core.wire.BlockedOption
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class NotificationPolicyTest {
    private val policy = NotificationPolicy()
    private val prefs = NotificationPrefs()

    private fun threadChange(previous: com.getaop.mobile.core.wire.Thread?, next: com.getaop.mobile.core.wire.Thread, level: String = "coordinator") =
        policy.decide(HostChange.ThreadChanged(project(level = level), previous, next), prefs, NOW)

    @Test
    fun aNewQuestionNeedsYouOnce() {
        val asked = thread(status = "waiting-on-you", question = "Native or PWA?")
        val intent = threadChange(thread(), asked)!!
        assertEquals(NotificationKind.NEEDS_YOU, intent.kind)
        assertEquals("Thread thr_1 · Native or PWA?", intent.body)
        assertEquals("thr_1", intent.threadId)
        assertNull(threadChange(asked, asked))
    }

    @Test
    fun aWaitOutsideAopNeedsYou() {
        val intent = threadChange(thread(), thread(wait = "Approve the deploy"))!!
        assertEquals(NotificationKind.NEEDS_YOU, intent.kind)
        assertNull(threadChange(thread(wait = "Approve the deploy"), thread(wait = "Approve the deploy")))
    }

    @Test
    fun pullRequestsThatBecomeReadyMergeOrClose() {
        val ready = threadChange(thread(pr = "open"), thread(status = "ready-for-review", pr = "open"))!!
        assertEquals(NotificationKind.PULL_REQUEST, ready.kind)
        assertEquals("PR #7 is ready for review · Thread thr_1", ready.body)
        assertEquals("PR #7 merged · Thread thr_1", threadChange(thread(pr = "open"), thread(status = "idle", pr = "merged"))!!.body)
        // First seen already merged is not news.
        assertNull(threadChange(null, thread(status = "idle", pr = "merged")))
    }

    @Test
    fun failedRunsNotify() {
        val report = message("m1", "thread-report", outcome = "failed", text = "Gradle failed", reported = "thr_1")
        val intent = policy.decide(HostChange.MessageArrived(project(), report, "Build"), prefs, NOW)!!
        assertEquals(NotificationKind.FAILED, intent.kind)
        assertEquals("Build failed: Gradle failed", intent.body)
    }

    @Test
    fun coordinatorPostsOnlyWhenSwitchedOn() {
        val post = HostChange.MessageArrived(project(), message("m1", "assistant", text = "Done"), null)
        assertNull(policy.decide(post, prefs, NOW))
        val intent = policy.decide(post, prefs.copy(coordinator = true), NOW)!!
        assertEquals(NotificationKind.COORDINATOR, intent.kind)
        assertNull(intent.threadId)
    }

    @Test
    fun aCoordinatorQuestionNeedsYouAndShowsTheQuestion() {
        val question = Block(type = "question", question = "Merge it by itself, or wait for you?", options = listOf(BlockedOption("Merge"), BlockedOption("Wait")))
        val asks = message("m1", "assistant", text = "The thread is done.").let { it.copy(blocks = it.blocks + question) }
        val intent = policy.decide(HostChange.MessageArrived(project(), asks, null), prefs, NOW)!!
        assertEquals(NotificationKind.NEEDS_YOU, intent.kind)
        assertEquals("Merge it by itself, or wait for you?", intent.body)
        assertNull(intent.threadId)
        assertNull(policy.decide(HostChange.MessageArrived(project(), asks, null), prefs.copy(needsYou = false), NOW))
    }

    @Test
    fun thePersonsReplyToTheCoordinatorSettlesItsChat() {
        assertTrue(policy.settlesChat(message("u1", "user", text = "Merge")))
        assertFalse(policy.settlesChat(message("u1", "user", text = "Brief").copy(sender = "routine")))
        assertFalse(policy.settlesChat(message("u1", "user", threadId = "thr_1", text = "Merge")))
        assertFalse(policy.settlesChat(message("a1", "assistant", text = "Done")))
    }

    @Test
    fun finishedTurnsOnlyOnEveryTurn() {
        val report = message("m1", "thread-report", outcome = "finished", text = "ok", reported = "thr_1")
        assertNull(policy.decide(HostChange.MessageArrived(project(), report, "T"), prefs, NOW))
        assertEquals(
            NotificationKind.TURN_FINISHED,
            policy.decide(HostChange.MessageArrived(project(level = "every-turn"), report, "T"), prefs, NOW)!!.kind,
        )
    }

    @Test
    fun silentWhenOffPausedStaleOrSwitchedOff() {
        val asked = thread(status = "waiting-on-you", question = "Q?")
        assertNull(threadChange(thread(), asked, level = "off"))
        assertNull(policy.decide(HostChange.ThreadChanged(project(status = "paused"), thread(), asked), prefs, NOW))
        assertNull(threadChange(thread(), thread(status = "waiting-on-you", question = "Q?", at = "2026-10-03T06:00:00Z")))
        assertNull(policy.decide(HostChange.ThreadChanged(project(), thread(), asked), prefs.copy(needsYou = false), NOW))
    }

    @Test
    fun aThreadDealtWithElsewhereIsSettled() {
        assertEquals(true, policy.isSettled(thread(status = "working")))
        assertEquals(false, policy.isSettled(thread(status = "waiting-on-you", question = "Q?")))
        assertEquals(false, policy.isSettled(thread(unread = true)))
    }

    @Test
    fun longBodiesAreClipped() {
        val long = "x".repeat(400)
        val intent = threadChange(thread(), thread(status = "waiting-on-you", question = long))!!
        assertEquals(180, intent.body.length)
    }
}
