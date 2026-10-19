package com.stormglide.susu.agent.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.shape.RoundedCornerShape
import com.stormglide.susu.agent.R

/** Same palette as the portal. High contrast throughout: agents work outdoors in bright sun. */
object SusuColors {
    val Primary = Color(0xFF0D7A5F)
    val PrimarySoft = Color(0xFFE3F3ED)
    val Ink = Color(0xFF0F1D18)
    val Muted = Color(0xFF4A5952)
    val Background = Color(0xFFF7F8F6)
    val Surface = Color(0xFFFFFFFF)
    val Border = Color(0xFFD5DCD7)
    val Accent = Color(0xFFE9A90C)

    val Success = Color(0xFF0E6B49)
    val SuccessSoft = Color(0xFFE0F2E9)
    val Warning = Color(0xFF7A4D00)
    val WarningSoft = Color(0xFFFCEFD2)
    val Danger = Color(0xFFB42323)
    val DangerSoft = Color(0xFFFBE6E6)
}

private val colors = lightColorScheme(
    primary = SusuColors.Primary,
    onPrimary = Color.White,
    primaryContainer = SusuColors.PrimarySoft,
    onPrimaryContainer = SusuColors.Ink,
    secondary = SusuColors.Accent,
    background = SusuColors.Background,
    onBackground = SusuColors.Ink,
    surface = SusuColors.Surface,
    onSurface = SusuColors.Ink,
    onSurfaceVariant = SusuColors.Muted,
    outline = SusuColors.Border,
    error = SusuColors.Danger,
)

/** Satoshi (ITF Free Font License, licenses/Satoshi-ITF-FFL.txt) for headings. */
private val heading = FontFamily(
    Font(R.font.satoshi_medium, FontWeight.Medium),
    Font(R.font.satoshi_bold, FontWeight.Bold),
    Font(R.font.satoshi_black, FontWeight.Black),
)

/** Inter (SIL OFL 1.1, licenses/Inter-OFL.txt) for everything else. */
private val body = FontFamily(
    Font(R.font.inter_regular, FontWeight.Normal),
    Font(R.font.inter_medium, FontWeight.Medium),
    Font(R.font.inter_semibold, FontWeight.SemiBold),
    Font(R.font.inter_bold, FontWeight.Bold),
)

// Start from Material's scale with Inter everywhere, so styles the screens don't override still use the brand font.
private val base = Typography().let { t ->
    t.copy(
        displayLarge = t.displayLarge.copy(fontFamily = heading),
        displayMedium = t.displayMedium.copy(fontFamily = heading),
        headlineLarge = t.headlineLarge.copy(fontFamily = heading),
        headlineMedium = t.headlineMedium.copy(fontFamily = heading),
        titleSmall = t.titleSmall.copy(fontFamily = body),
        bodySmall = t.bodySmall.copy(fontFamily = body),
        labelSmall = t.labelSmall.copy(fontFamily = body),
    )
}

private val typography = base.copy(
    displaySmall = TextStyle(fontFamily = heading, fontWeight = FontWeight.Black, fontSize = 40.sp, lineHeight = 46.sp),
    headlineSmall = TextStyle(fontFamily = heading, fontWeight = FontWeight.Bold, fontSize = 24.sp, lineHeight = 30.sp),
    titleLarge = TextStyle(fontFamily = heading, fontWeight = FontWeight.Bold, fontSize = 20.sp, lineHeight = 26.sp),
    titleMedium = TextStyle(fontFamily = body, fontWeight = FontWeight.SemiBold, fontSize = 17.sp, lineHeight = 22.sp),
    bodyLarge = TextStyle(fontFamily = body, fontSize = 17.sp, lineHeight = 24.sp),
    bodyMedium = TextStyle(fontFamily = body, fontSize = 15.sp, lineHeight = 21.sp),
    labelLarge = TextStyle(fontFamily = body, fontWeight = FontWeight.SemiBold, fontSize = 16.sp),
    labelMedium = TextStyle(fontFamily = body, fontWeight = FontWeight.Medium, fontSize = 13.sp),
)

private val shapes = Shapes(
    small = RoundedCornerShape(8.dp),
    medium = RoundedCornerShape(14.dp),
    large = RoundedCornerShape(20.dp),
)

@Composable
fun SusuTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = colors, typography = typography, shapes = shapes, content = content)
}
