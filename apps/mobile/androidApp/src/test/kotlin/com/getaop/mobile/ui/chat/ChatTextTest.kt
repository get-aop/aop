package com.getaop.mobile.ui.chat

import com.getaop.mobile.core.wire.Block
import kotlin.test.Test
import kotlin.test.assertEquals

class MarkdownBlocksTest {
    @Test
    fun splitsParagraphsHeadingsListsAndCode() {
        val blocks = markdownBlocks(
            """
            # Plan
            First line
            continues here.

            - one
            2. two

            ```
            val x = 1
            ```
            """.trimIndent(),
        )
        assertEquals(
            listOf(
                MdBlock.Heading("Plan"),
                MdBlock.Paragraph("First line continues here."),
                MdBlock.Bullet("one", null),
                MdBlock.Bullet("two", "2"),
                MdBlock.Code("val x = 1"),
            ),
            blocks,
        )
    }

    @Test
    fun anUnclosedCodeFenceStillShowsItsCode() {
        assertEquals(listOf(MdBlock.Paragraph("Text"), MdBlock.Code("still code")), markdownBlocks("Text\n```\nstill code"))
    }
}

class GroupToolsTest {
    @Test
    fun consecutiveToolCallsFoldIntoOneGroup() {
        val blocks = listOf(
            Block("text", text = "a"),
            Block("tool", name = "Bash"),
            Block("tool", name = "Read"),
            Block("text", text = "b"),
            Block("tool", name = "Edit"),
        )
        assertEquals(listOf(1, 2, 1, 1), groupTools(blocks).map { it.size })
    }
}
