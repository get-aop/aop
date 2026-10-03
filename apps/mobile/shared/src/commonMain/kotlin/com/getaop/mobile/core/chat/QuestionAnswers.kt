package com.getaop.mobile.core.chat

import com.getaop.mobile.core.notify.parseInstantMillis
import com.getaop.mobile.core.wire.Block
import com.getaop.mobile.core.wire.Message
import com.getaop.mobile.core.wire.MessageRole

/** How the person answered a question: by the option whose label they sent, or in words of their own (null). */
data class QuestionAnswer(val choice: String?)

/** The question a coordinator reply asks with ask_person, if it asks one. */
fun questionOf(message: Message): Block? =
    if (message.role == MessageRole.ASSISTANT) message.blocks.firstOrNull { it.type == "question" } else null

/**
 * The dashboard's `answersOf` (apps/dashboard/src/projects/chat/question-answers.ts), so every
 * device reads a question the same way. The host stores no answer: the person's next message is
 * it. A question is answered once the person sends anything after it was asked, by a tap or by
 * typing. A message they sent before it (one that waited while the coordinator worked) and a
 * routine's brief answer nothing. The answer is the option whose label the message says, word for
 * word, or none. Keyed by the id of the message that asks.
 */
fun answersOf(messages: List<Message>): Map<String, QuestionAnswer> {
    val replies = messages.filter(::isThePersons).mapNotNull { reply -> parseInstantMillis(reply.createdAt)?.let { it to reply } }
    val answers = mutableMapOf<String, QuestionAnswer>()
    for (message in messages) {
        val question = questionOf(message) ?: continue
        val askedAt = parseInstantMillis(message.createdAt) ?: continue
        val reply = replies.firstOrNull { (at, _) -> at > askedAt }?.second ?: continue
        val said = reply.text.orEmpty().trim()
        answers[message.id] = QuestionAnswer(question.options.firstOrNull { it.label == said }?.label)
    }
    return answers
}

// A message from a host that recorded no senders was the person's.
private fun isThePersons(message: Message): Boolean =
    message.role == MessageRole.USER && (message.sender ?: "person") == "person"
