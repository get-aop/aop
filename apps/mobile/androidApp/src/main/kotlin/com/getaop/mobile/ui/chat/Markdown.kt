package com.getaop.mobile.ui.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withLink
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import com.getaop.mobile.ui.theme.AopColors

/**
 * The Markdown agents write, enough for a phone: paragraphs, headings, lists, code blocks,
 * **bold**, *italic*, `code` and links. A coordinator names a thread as `[title](thread:<id>)`;
 * that link opens the thread in the app instead of a browser.
 */
@Composable
fun Markdown(text: String, onThreadLink: (String) -> Unit, modifier: Modifier = Modifier) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        for (block in markdownBlocks(text)) {
            when (block) {
                is MdBlock.Code -> Text(
                    block.text,
                    Modifier
                        .fillMaxWidth()
                        .background(MaterialTheme.colorScheme.surfaceContainerHigh, MaterialTheme.shapes.small)
                        .horizontalScroll(rememberScrollState())
                        .padding(10.dp),
                    style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
                    softWrap = false,
                )
                is MdBlock.Heading -> Text(inline(block.text, onThreadLink), style = MaterialTheme.typography.titleSmall)
                is MdBlock.Bullet -> Row {
                    Text(if (block.ordinal != null) "${block.ordinal}. " else "•  ", style = MaterialTheme.typography.bodyLarge)
                    Text(inline(block.text, onThreadLink), style = MaterialTheme.typography.bodyLarge)
                }
                is MdBlock.Paragraph -> Text(inline(block.text, onThreadLink), style = MaterialTheme.typography.bodyLarge)
            }
        }
    }
}

sealed interface MdBlock {
    data class Paragraph(val text: String) : MdBlock
    data class Heading(val text: String) : MdBlock
    data class Bullet(val text: String, val ordinal: String?) : MdBlock
    data class Code(val text: String) : MdBlock
}

private val BULLET = Regex("^\\s*[-*+]\\s+(.*)$")
private val ORDERED = Regex("^\\s*(\\d+)[.)]\\s+(.*)$")
private val HEADING = Regex("^#{1,6}\\s+(.*)$")

fun markdownBlocks(text: String): List<MdBlock> {
    val blocks = mutableListOf<MdBlock>()
    val paragraph = StringBuilder()
    val code = StringBuilder()
    var inCode = false
    fun flush() {
        if (paragraph.isNotBlank()) blocks += MdBlock.Paragraph(paragraph.toString().trim())
        paragraph.clear()
    }
    for (line in text.lines()) {
        if (line.trimStart().startsWith("```")) {
            if (inCode) {
                blocks += MdBlock.Code(code.toString().trimEnd())
                code.clear()
            } else {
                flush()
            }
            inCode = !inCode
            continue
        }
        if (inCode) {
            code.appendLine(line)
            continue
        }
        val heading = HEADING.find(line)
        val bullet = BULLET.find(line)
        val ordered = ORDERED.find(line)
        when {
            line.isBlank() -> flush()
            heading != null -> { flush(); blocks += MdBlock.Heading(heading.groupValues[1]) }
            bullet != null -> { flush(); blocks += MdBlock.Bullet(bullet.groupValues[1], null) }
            ordered != null -> { flush(); blocks += MdBlock.Bullet(ordered.groupValues[2], ordered.groupValues[1]) }
            else -> { if (paragraph.isNotEmpty()) paragraph.append(' '); paragraph.append(line.trim()) }
        }
    }
    if (inCode && code.isNotEmpty()) blocks += MdBlock.Code(code.toString().trimEnd())
    flush()
    return blocks
}

private val INLINE = Regex("""\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)]\(([^)\s]+)\)|(?<![*\w])\*(?!\s)(.+?)(?<!\s)\*(?!\*)""")

@Composable
private fun inline(text: String, onThreadLink: (String) -> Unit): AnnotatedString {
    val linkStyle = TextLinkStyles(SpanStyle(color = AopColors.Running))
    val codeBackground = MaterialTheme.colorScheme.surfaceContainerHigh
    return buildAnnotatedString {
        var at = 0
        for (match in INLINE.findAll(text)) {
            append(text.substring(at, match.range.first))
            val (bold, code, label, target, italic) = match.destructured
            when {
                bold.isNotEmpty() -> withStyle(SpanStyle(fontWeight = FontWeight.SemiBold)) { append(bold) }
                code.isNotEmpty() -> withStyle(SpanStyle(fontFamily = FontFamily.Monospace, background = codeBackground)) { append(code) }
                label.isNotEmpty() && target.startsWith("thread:") -> {
                    val threadId = target.removePrefix("thread:")
                    withLink(LinkAnnotation.Clickable(threadId, linkStyle) { onThreadLink(threadId) }) { append(label) }
                }
                label.isNotEmpty() && (target.startsWith("https://") || target.startsWith("http://")) ->
                    withLink(LinkAnnotation.Url(target, linkStyle)) { append(label) }
                label.isNotEmpty() -> append(label)
                italic.isNotEmpty() -> withStyle(SpanStyle(fontStyle = FontStyle.Italic)) { append(italic) }
            }
            at = match.range.last + 1
        }
        append(text.substring(at))
    }
}
