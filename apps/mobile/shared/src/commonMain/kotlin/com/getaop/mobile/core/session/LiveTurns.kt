package com.getaop.mobile.core.session

import com.getaop.mobile.core.wire.LiveOp
import com.getaop.mobile.core.wire.MessageDelta

/**
 * Applies one delta to the turn it names (`MessageDelta` in packages/common/src/projects/stream.ts):
 * `reset` replaces the parts, `start` adds one, `append` grows prose, `tool` updates a tool call,
 * `end` drops the turn. Returns null when the turn is over.
 */
fun applyDelta(current: LiveTurn?, delta: MessageDelta): LiveTurn? {
    var turn: LiveTurn? = current ?: LiveTurn(delta.messageId, delta.threadId, delta.inReplyTo, emptyList())
    for (op in delta.ops) {
        turn = turn?.let { applyOp(it, op) } ?: return null
    }
    return turn
}

private fun applyOp(turn: LiveTurn, op: LiveOp): LiveTurn? {
    val parts = turn.parts
    return when (op.op) {
        "reset" -> turn.copy(parts = op.parts)
        "start" -> op.part?.let { part ->
            val index = (op.index ?: parts.size).coerceIn(0, parts.size)
            turn.copy(parts = parts.take(index) + part)
        } ?: turn
        "append" -> update(turn, op.index) { it.copy(text = (it.text ?: "") + (op.text ?: "")) }
        "tool" -> update(turn, op.index) { it.copy(status = op.status ?: it.status, detail = op.detail) }
        "end" -> null
        else -> turn
    }
}

private inline fun update(
    turn: LiveTurn,
    index: Int?,
    change: (com.getaop.mobile.core.wire.Block) -> com.getaop.mobile.core.wire.Block,
): LiveTurn {
    if (index == null || index !in turn.parts.indices) return turn
    return turn.copy(parts = turn.parts.mapIndexed { i, part -> if (i == index) change(part) else part })
}
