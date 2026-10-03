package com.getaop.mobile.ui.chat

import android.app.Application
import androidx.compose.foundation.layout.Column
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsFocused
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertIsNotSelected
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import com.getaop.mobile.core.chat.answersOf
import com.getaop.mobile.core.session.Chat
import com.getaop.mobile.core.session.ChatKey
import com.getaop.mobile.core.session.HostState
import com.getaop.mobile.core.wire.Block
import com.getaop.mobile.core.wire.BlockedOption
import com.getaop.mobile.core.wire.Message
import com.getaop.mobile.ui.main.Detail
import com.getaop.mobile.ui.theme.AopTheme
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import kotlin.test.assertEquals

/**
 * The coordinator's questions in a real conversation and message box: tapping an option or
 * typing a reply closes the question, as the dashboard's does. Sending is faked by adding the
 * person's message to the chat, which is what the host's stream does. SDK 34: Robolectric needs
 * Java 21 for 35 and up, and the app builds with JDK 17.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
class AskedQuestionTest {
    @get:Rule
    val compose = createComposeRule()

    private val detail = Detail("prj_1", null)

    private val question = Block(
        type = "question",
        question = "Merge it by itself, or wait for you?",
        options = listOf(BlockedOption("Merge by itself", recommended = true), BlockedOption("Wait for me")),
        other = true,
    )

    private fun reply(id: String, blocks: List<Block>, at: String) =
        Message(id = id, projectId = "prj_1", createdAt = at, role = "assistant", blocks = blocks)

    private val asks = reply("a1", listOf(Block(type = "text", text = "The thread is done."), question), "2026-10-03T08:00:01Z")

    private fun person(text: String) =
        Message(id = "u-$text", projectId = "prj_1", createdAt = "2026-10-03T08:00:05Z", role = "user", text = text, sender = "person")

    /** The coordinator chat, minus the view model: a conversation, its questions and the message box. */
    @Composable
    private fun CoordinatorChat(
        messages: List<Message>,
        sent: MutableList<String>,
        paused: Boolean = false,
        sendings: Map<String, QuestionSend> = emptyMap(),
    ) {
        var chat by remember { mutableStateOf(messages) }
        val composer = remember { FocusRequester() }
        val say = { text: String ->
            sent += text
            chat = chat + person(text)
        }
        val host = HostState(chats = mapOf(ChatKey("prj_1", null) to Chat(messages = chat, loaded = true)))
        val answering = QuestionAnswering(
            answers = answersOf(chat),
            sends = sendings,
            disabledReason = if (paused) "Paused. Resume the project to talk to the coordinator." else null,
            onAnswer = { _, label -> say(label) },
            onOther = { composer.requestFocus() },
        )
        AopTheme {
            Column {
                CompositionLocalProvider(LocalQuestionAnswering provides answering) {
                    Conversation(host, detail, onOpenThread = {}, modifier = Modifier.weight(1f))
                }
                Composer(initial = "", placeholder = "Message the coordinator", onDraft = {}, onSend = { say(it); null }, focusRequester = composer)
            }
        }
    }

    private fun option(label: String) = compose.onNode(hasTestTag("asked-question-option") and hasText(label, substring = true))

    private fun questionState(state: String) = SemanticsMatcher.expectValue(SemanticsProperties.StateDescription, state)

    @Test
    fun anOpenQuestionShowsItsOptionsWithTheRecommendedOneMarked() {
        compose.setContent { CoordinatorChat(listOf(asks), mutableListOf()) }

        compose.onNodeWithText("Merge it by itself, or wait for you?").assertExists()
        compose.onNodeWithTag("asked-question").assert(questionState("open"))
        option("Merge by itself").assertIsEnabled().assert(questionState("Recommended"))
        compose.onNodeWithText("Recommended").assertExists()
        option("Wait for me").assertIsEnabled()
        compose.onNodeWithTag("asked-question-other").assertIsEnabled()
    }

    @Test
    fun tappingAnOptionSendsItsLabelAndClosesTheQuestionWithACheck() {
        val sent = mutableListOf<String>()
        compose.setContent { CoordinatorChat(listOf(asks), sent) }

        option("Wait for me").performClick()

        assertEquals(listOf("Wait for me"), sent)
        compose.onNodeWithTag("asked-question").assert(questionState("answered"))
        option("Wait for me").assertIsNotEnabled().assertIsSelected()
        option("Merge by itself").assertIsNotEnabled().assertIsNotSelected()
        compose.onNodeWithTag("asked-question-other").assertIsNotEnabled()
        compose.onNodeWithText("You answered in your own words.").assertDoesNotExist()
    }

    @Test
    fun typingAReplyInsteadAlsoClosesIt() {
        val sent = mutableListOf<String>()
        compose.setContent { CoordinatorChat(listOf(asks), sent) }

        compose.onNodeWithTag("composer").performTextInput("Wait, and ping me first")
        compose.onNodeWithContentDescription("Send").performClick()

        assertEquals(listOf("Wait, and ping me first"), sent)
        compose.onNodeWithTag("asked-question").assert(questionState("answered"))
        option("Merge by itself").assertIsNotEnabled().assertIsNotSelected()
        option("Wait for me").assertIsNotEnabled().assertIsNotSelected()
        compose.onNodeWithText("You answered in your own words.").assertExists()
    }

    @Test
    fun otherPutsTheCursorInTheMessageBox() {
        val sent = mutableListOf<String>()
        compose.setContent { CoordinatorChat(listOf(asks), sent) }

        compose.onNodeWithTag("asked-question-other").performClick()

        compose.onNodeWithTag("composer").assertIsFocused()
        assertEquals(emptyList(), sent)
        compose.onNodeWithTag("asked-question").assert(questionState("open"))
    }

    @Test
    fun aTapOnItsWayKeepsEveryButtonBusy() {
        compose.setContent { CoordinatorChat(listOf(asks), mutableListOf(), sendings = mapOf("a1" to QuestionSend("Wait for me"))) }

        compose.onNodeWithTag("asked-question").assert(questionState("sending"))
        option("Wait for me").assertIsNotEnabled()
        option("Merge by itself").assertIsNotEnabled()
    }

    @Test
    fun aFailedTapSaysWhyAndCanBeTriedAgain() {
        val failed = mapOf("a1" to QuestionSend("Wait for me", "Couldn't send: can't reach soulf. Is Tailscale on?"))
        compose.setContent { CoordinatorChat(listOf(asks), mutableListOf(), sendings = failed) }

        compose.onNodeWithText("Couldn't send: can't reach soulf. Is Tailscale on?").assertExists()
        option("Wait for me").assertIsEnabled()
    }

    @Test
    fun aPausedProjectShowsTheQuestionButCannotAnswerIt() {
        compose.setContent { CoordinatorChat(listOf(asks), mutableListOf(), paused = true) }

        option("Merge by itself").assertIsNotEnabled()
        compose.onNodeWithText("Paused. Resume the project to talk to the coordinator.").assertExists()
    }

    @Test
    fun outsideTheCoordinatorChatAQuestionIsOnlyShown() {
        compose.setContent {
            AopTheme { MessageView(asks, HostState(), onOpenThread = {}) }
        }

        compose.onNodeWithTag("asked-question").assert(questionState("shown"))
        option("Merge by itself").assertIsNotEnabled()
    }

    @Test
    fun aBlockThePhoneCannotDrawSaysToOpenTheDesktop() {
        val unknown = reply("a2", listOf(Block(type = "text", text = "Here are two threads."), Block(type = "suggested-threads"), Block(type = "steer", messageId = "u1")), "2026-10-03T08:00:01Z")
        compose.setContent {
            AopTheme { MessageView(unknown, HostState(), onOpenThread = {}) }
        }

        compose.onNodeWithText("Here are two threads.").assertExists()
        // One placeholder: the steer marker is drawn as the person's own message, not here.
        compose.onNodeWithTag("unknown-block").assertExists()
        compose.onNodeWithText("Open on desktop to see this").assertExists()
    }
}
