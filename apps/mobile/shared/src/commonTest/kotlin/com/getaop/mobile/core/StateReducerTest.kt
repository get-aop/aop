package com.getaop.mobile.core

import com.getaop.mobile.core.session.ChatKey
import com.getaop.mobile.core.session.HostChange
import com.getaop.mobile.core.session.HostState
import com.getaop.mobile.core.session.StateReducer
import com.getaop.mobile.core.wire.Block
import com.getaop.mobile.core.wire.EntryPayload
import com.getaop.mobile.core.wire.LiveOp
import com.getaop.mobile.core.wire.MessageDelta
import com.getaop.mobile.core.wire.MessagePage
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

class StateReducerTest {
    private val key = ChatKey("prj_1", null)
    private val base = StateReducer.withProjects(HostState(), listOf(project()))

    @Test
    fun projectsHideArchivedAndSortNewestFirst() {
        val state = StateReducer.withProjects(
            HostState(),
            listOf(project("a", updatedAt = "2026-10-01T00:00:00Z"), project("b"), project("c", status = "archived")),
        )
        assertEquals(listOf("b", "a"), state.projects.map { it.id })
    }

    @Test
    fun threadsPutWhatNeedsYouFirstAndCountBadges() {
        val state = StateReducer.withThreads(
            base,
            "prj_1",
            listOf(thread("w"), thread("q", status = "waiting-on-you", question = "Q?", at = "2026-10-01T00:00:00Z", unread = true)),
        )
        assertEquals(listOf("q", "w"), state.threads["prj_1"]!!.map { it.id })
        val badges = state.badges("prj_1")
        assertEquals(1, badges.needsYou)
        assertEquals(1, badges.working)
        assertEquals(1, badges.unread)
    }

    @Test
    fun anUpsertReportsWhatChangedWithThePreviousThread() {
        val before = StateReducer.withThreads(base, "prj_1", listOf(thread()))
        val (after, change) = StateReducer.apply(before, "prj_1", EntryPayload.ThreadUpserted(thread(status = "idle")))
        assertEquals("idle", after.thread("prj_1", "thr_1")!!.status)
        val changed = assertIs<HostChange.ThreadChanged>(change)
        assertEquals("working", changed.previous!!.status)
    }

    @Test
    fun replayingAnEntryChangesNothingMore() {
        val loaded = StateReducer.withChat(base, key, MessagePage(listOf(message("m1", "user", text = "hi"))))
        val created = EntryPayload.MessageCreated(message("m2", "assistant", text = "yo"))
        val (once, _) = StateReducer.apply(loaded, "prj_1", created)
        val (twice, _) = StateReducer.apply(once, "prj_1", created)
        assertEquals(once.chats[key], twice.chats[key])
        assertEquals(listOf("m1", "m2"), twice.chats[key]!!.messages.map { it.id })
    }

    @Test
    fun liveTextGrowsAndGoesWhenTheMessageArrives() {
        val loaded = StateReducer.withChat(base, key, MessagePage(emptyList()))
        val delta = MessageDelta(
            "prj_1", null, "m9", null,
            listOf(
                LiveOp("start", index = 0, part = Block("text", text = "Hel")),
                LiveOp("append", index = 0, text = "lo"),
                LiveOp("start", index = 1, part = Block("tool", name = "Bash", status = "running")),
                LiveOp("tool", index = 1, status = "done", detail = "ls"),
            ),
        )
        val live = StateReducer.applyDelta(loaded, delta)
        val parts = live.chats[key]!!.live.single().parts
        assertEquals("Hello", parts[0].text)
        assertEquals("done", parts[1].status)
        val (done, _) = StateReducer.apply(live, "prj_1", EntryPayload.MessageCreated(message("m9", "assistant", text = "Hello")))
        assertTrue(done.chats[key]!!.live.isEmpty())
        // A late delta for a message already held is dropped.
        assertEquals(done, StateReducer.applyDelta(done, delta))
    }

    @Test
    fun endDropsTheTurnAndASnapshotReplacesTheProjectsTurns() {
        val loaded = StateReducer.withChat(base, key, MessagePage(emptyList()))
        val started = StateReducer.applyDelta(loaded, MessageDelta("prj_1", null, "m1", null, listOf(LiveOp("reset", parts = listOf(Block("text", text = "a"))))))
        val ended = StateReducer.applyDelta(started, MessageDelta("prj_1", null, "m1", null, listOf(LiveOp("end"))))
        assertTrue(ended.chats[key]!!.live.isEmpty())
        val snap = StateReducer.withLiveSnapshot(
            started, "prj_1",
            listOf(MessageDelta("prj_1", null, "m2", null, listOf(LiveOp("reset", parts = listOf(Block("text", text = "b")))))),
        )
        assertEquals(listOf("m2"), snap.chats[key]!!.live.map { it.messageId })
    }

    @Test
    fun messagesForAChatNotOpenAreStillNews() {
        val (state, change) = StateReducer.apply(base, "prj_1", EntryPayload.MessageCreated(message("m1", "assistant")))
        assertNull(state.chats[key])
        assertIs<HostChange.MessageArrived>(change)
    }
}
