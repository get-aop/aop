package com.getaop.mobile.ui.theme

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** The dashboard's palette (apps/dashboard/src/index.css), which is dark only. */
object AopColors {
    val Canvas = Color(0xFF0D0D0E)
    val Surface = Color(0xFF161618)
    val Raised = Color(0xFF1B1B1E)
    val Input = Color(0xFF19191C)
    val Overlay = Color(0xFF1D1D21)
    val Border = Color(0x12FFFFFF)
    val BorderStrong = Color(0x21FFFFFF)
    val Text = Color(0xFFECECEC)
    val TextMuted = Color(0xFF9C9CA3)
    val TextSubtle = Color(0xFF6B6B72)
    val Running = Color(0xFF5B9DFF)
    val Ok = Color(0xFF3FB950)
    val Blocked = Color(0xFFF0574F)
    val Queued = Color(0xFF8A8A92)
    val Waiting = Color(0xFFF2A93B)
    val Merged = Color(0xFFA371F7)
}

private val scheme = darkColorScheme(
    primary = AopColors.Text,
    onPrimary = Color(0xFF111111),
    primaryContainer = AopColors.Raised,
    onPrimaryContainer = AopColors.Text,
    secondary = AopColors.Running,
    onSecondary = Color(0xFF0B1220),
    secondaryContainer = Color(0xFF1E2A3D),
    onSecondaryContainer = AopColors.Text,
    tertiary = AopColors.Waiting,
    onTertiary = Color(0xFF1F1405),
    tertiaryContainer = Color(0xFF3A2A12),
    onTertiaryContainer = Color(0xFFFFDDB0),
    background = AopColors.Canvas,
    onBackground = AopColors.Text,
    surface = AopColors.Canvas,
    onSurface = AopColors.Text,
    surfaceVariant = AopColors.Input,
    onSurfaceVariant = AopColors.TextMuted,
    surfaceContainerLowest = AopColors.Canvas,
    surfaceContainerLow = Color(0xFF121214),
    surfaceContainer = AopColors.Surface,
    surfaceContainerHigh = AopColors.Raised,
    surfaceContainerHighest = AopColors.Overlay,
    outline = Color(0xFF3A3A3F),
    outlineVariant = Color(0xFF242427),
    error = AopColors.Blocked,
    onError = Color(0xFF1A0605),
    errorContainer = Color(0xFF3B1513),
    onErrorContainer = Color(0xFFFFD7D3),
)

/** The dashboard's radii: rows 8, controls 10, cards 12, modals 14. No pill shapes. */
private val shapes = Shapes(
    extraSmall = RoundedCornerShape(6.dp),
    small = RoundedCornerShape(8.dp),
    medium = RoundedCornerShape(10.dp),
    large = RoundedCornerShape(12.dp),
    extraLarge = RoundedCornerShape(14.dp),
)

val ControlShape = RoundedCornerShape(10.dp)
val CardShape = RoundedCornerShape(12.dp)
val ComposerShape = RoundedCornerShape(22.dp)

private val base = Typography()
private val typography = base.copy(
    titleLarge = base.titleLarge.copy(fontWeight = FontWeight.SemiBold, fontSize = 20.sp),
    titleMedium = base.titleMedium.copy(fontWeight = FontWeight.SemiBold, fontSize = 16.sp),
    bodyLarge = base.bodyLarge.copy(fontSize = 15.sp, lineHeight = 22.sp),
    bodyMedium = base.bodyMedium.copy(fontSize = 14.sp, lineHeight = 20.sp),
    labelSmall = TextStyle(fontSize = 11.sp, fontWeight = FontWeight.Medium, letterSpacing = 0.2.sp),
)

@Composable
fun AopTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = scheme, shapes = shapes, typography = typography, content = content)
}
