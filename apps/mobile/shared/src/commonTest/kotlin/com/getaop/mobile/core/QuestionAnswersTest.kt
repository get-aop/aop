package com.getaop.mobile.core

import com.getaop.mobile.core.chat.QuestionAnswer
import com.getaop.mobile.core.chat.answersOf
import com.getaop.mobile.core.chat.questionOf
import com.getaop.mobile.core.wire.Block
import com.getaop.mobile.core.wire.BlockedOption
import com.getaop.mobile.core.wire.Message
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** The same cases as the dashboard's question-answers.test.ts, so both read a conversation alike. */
class QuestionAnswersTest {
    private val question = Block(
        type = "question",
        question = "Merge it by itself, or wait for you?",
        options = listOf(BlockedOption("Merge by itself", recommended = true), BlockedOption("Wait for me")),
        other = true,
    )

    private fun at(seconds: Int) = "2026-10-03T08:00:${seconds.toString().padStart(2, '0')}.000Z"

    private fun asked(id: String, seconds: Int) =
        message(id, "assistant", at = at(seconds)).copy(blocks = listOf(Block(type = "text", text = "The thread is done."), question))

    private fun said(id: String, seconds: Int, text: String = "Hello", sender: String? = null) =
        message(id, "user", text = text, at = at(seconds)).copy(sender = sender)

    private fun report(id: String, seconds: Int): Message =
        message(id, "thread-report", outcome = "finished", text = "Done", reported = "thr_1", at = at(seconds))

    @Test
    fun aQuestionNobodyAnsweredHasNoAnswer() {
        assertEquals(0, answersOf(listOf(said("u1", 1), asked("a1", 2))).size)
    }

    @Test
    fun theNextMessageAnswersWithTheOptionItNamesWordForWord() {
        val answers = answersOf(listOf(said("u1", 1), asked("a1", 2), said("u2", 3, text = "  Wait for me ")))
        assertEquals(QuestionAnswer("Wait for me"), answers["a1"])
    }

    @Test
    fun ownWordsAnswerWithNoOption() {
        val answers = answersOf(listOf(asked("a1", 2), said("u2", 3, text = "wait for me, and ping me", sender = "person")))
        assertEquals(QuestionAnswer(null), answers["a1"])
    }

    @Test
    fun reportsRoutineBriefsAndEarlierMessagesAnswerNothing() {
        val answers = answersOf(
            listOf(
                said("u1", 1),
                // Sent while the coordinator worked: stored before the reply that asks.
                said("u2", 2, text = "Wait for me"),
                asked("a1", 3),
                report("r1", 4),
                said("u3", 5, text = "Wait for me", sender = "routine"),
                said("u4", 6, text = "Wait for me", sender = "coordinator"),
            ),
        )
        assertFalse(answers.containsKey("a1"))
    }

    @Test
    fun oneMessageAnswersEveryQuestionStillOpenBeforeIt() {
        val answers = answersOf(listOf(asked("a1", 1), report("r1", 2), asked("a2", 3), said("u1", 4, text = "Merge by itself"), asked("a3", 5)))
        assertEquals(QuestionAnswer("Merge by itself"), answers["a1"])
        assertEquals(QuestionAnswer("Merge by itself"), answers["a2"])
        assertFalse(answers.containsKey("a3"))
    }

    @Test
    fun aReplyWithoutAQuestionHasNoEntry() {
        assertEquals(0, answersOf(listOf(message("a1", "assistant", at = at(1)), said("u1", 2))).size)
    }

    @Test
    fun onlyAnAssistantReplyAsks() {
        assertTrue(questionOf(asked("a1", 1)) != null)
        assertNull(questionOf(said("u1", 1)))
    }
}
