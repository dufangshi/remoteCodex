package com.remotecodex.android.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.remotecodex.android.ui.model.PendingRequestPreview
import com.remotecodex.android.ui.presentation.PendingRequestOptionState
import com.remotecodex.android.ui.presentation.PendingRequestQuestionState
import com.remotecodex.android.ui.presentation.buildPendingRequestCardState
import com.remotecodex.android.ui.theme.ThreadColors

@Composable
@OptIn(ExperimentalLayoutApi::class)
fun PendingRequestCard(
    request: PendingRequestPreview,
    modifier: Modifier = Modifier,
) {
    val state = buildPendingRequestCardState(request)
    val questionMode = state.questions.isNotEmpty()
    Column(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(ThreadColors.Surface)
            .border(1.dp, ThreadColors.Warning.copy(alpha = 0.28f), RoundedCornerShape(16.dp))
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                text = state.title,
                color = ThreadColors.Foreground,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
            )
            Spacer(modifier = Modifier.weight(1f))
            Text(
                text = state.riskLabel,
                modifier = Modifier
                    .clip(RoundedCornerShape(999.dp))
                    .background(ThreadColors.WarningSoft)
                    .border(1.dp, ThreadColors.Warning.copy(alpha = 0.22f), RoundedCornerShape(999.dp))
                    .padding(horizontal = 9.dp, vertical = 4.dp),
                color = ThreadColors.Warning,
                style = MaterialTheme.typography.labelSmall,
            )
        }
        if (state.description.isNotEmpty()) {
            Text(
                text = state.description,
                color = ThreadColors.ForegroundSoft,
                style = MaterialTheme.typography.bodyMedium,
                maxLines = if (questionMode) 1 else Int.MAX_VALUE,
                overflow = TextOverflow.Ellipsis,
            )
        }
        if (questionMode) {
            state.questions.forEach { question ->
                PendingRequestQuestionSection(question = question)
            }
            PendingRequestCommandBlock(
                label = state.commandLabel,
                command = state.command,
                compact = true,
            )
        } else {
            PendingRequestCommandBlock(
                label = state.commandLabel,
                command = state.command,
            )
        }
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.End,
        ) {
            Text(
                text = state.denyLabel,
                modifier = Modifier
                    .clip(RoundedCornerShape(999.dp))
                    .border(1.dp, ThreadColors.BorderStrong, RoundedCornerShape(999.dp))
                    .semantics { contentDescription = state.denyAccessibilityLabel }
                    .padding(horizontal = 14.dp, vertical = 8.dp),
                color = ThreadColors.ForegroundSoft,
                style = MaterialTheme.typography.labelMedium,
                fontWeight = FontWeight.SemiBold,
            )
            Text(
                text = state.approveLabel,
                modifier = Modifier
                    .padding(start = 8.dp)
                    .clip(RoundedCornerShape(999.dp))
                    .background(ThreadColors.Primary)
                    .semantics { contentDescription = state.approveAccessibilityLabel }
                    .padding(horizontal = 14.dp, vertical = 8.dp),
                color = ThreadColors.PrimaryForeground,
                style = MaterialTheme.typography.labelMedium,
                fontWeight = FontWeight.SemiBold,
            )
        }
    }
}

@Composable
private fun PendingRequestCommandBlock(
    label: String,
    command: String,
    compact: Boolean = false,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(ThreadColors.Panel)
            .border(1.dp, ThreadColors.Border, RoundedCornerShape(12.dp))
            .padding(if (compact) 8.dp else 10.dp),
        verticalArrangement = Arrangement.spacedBy(if (compact) 4.dp else 6.dp),
    ) {
        Text(
            text = label,
            color = ThreadColors.ForegroundMuted,
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.SemiBold,
        )
        Text(
            text = command,
            modifier = Modifier.fillMaxWidth(),
            color = ThreadColors.ForegroundSoft,
            style = if (compact) {
                MaterialTheme.typography.labelMedium
            } else {
                MaterialTheme.typography.bodyMedium
            },
            fontFamily = FontFamily.Monospace,
        )
    }
}

@Composable
@OptIn(ExperimentalLayoutApi::class)
private fun PendingRequestQuestionSection(
    question: PendingRequestQuestionState,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(ThreadColors.Panel)
            .border(1.dp, ThreadColors.Border, RoundedCornerShape(12.dp))
            .padding(8.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text(
            text = question.header,
            color = ThreadColors.ForegroundMuted,
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.SemiBold,
        )
        if (question.question.isNotEmpty()) {
            Text(
                text = question.question,
                color = ThreadColors.Foreground,
                style = MaterialTheme.typography.labelMedium,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
        }
        if (question.options.isNotEmpty() || question.otherLabel != null) {
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(7.dp),
                verticalArrangement = Arrangement.spacedBy(7.dp),
            ) {
                question.options.forEachIndexed { index, option ->
                    PendingRequestOptionChip(
                        option = option,
                        highlighted = index == 0 || option.recommended,
                    )
                }
                question.otherLabel?.let { otherLabel ->
                    PendingRequestOtherChip(label = otherLabel)
                }
            }
        } else {
            Text(
                text = if (question.multiSelect) "Select one or more answers" else "Enter an answer",
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(10.dp))
                    .background(ThreadColors.SurfaceStrong)
                    .border(1.dp, ThreadColors.Border, RoundedCornerShape(10.dp))
                    .padding(horizontal = 10.dp, vertical = 8.dp),
                color = ThreadColors.ForegroundMuted,
                style = MaterialTheme.typography.bodyMedium,
            )
        }
    }
}

@Composable
private fun PendingRequestOptionChip(
    option: PendingRequestOptionState,
    highlighted: Boolean,
) {
    val background = if (highlighted) ThreadColors.InfoSoft else ThreadColors.SurfaceStrong
    val border = if (highlighted) ThreadColors.Info.copy(alpha = 0.34f) else ThreadColors.Border
    val foreground = if (highlighted) ThreadColors.Info else ThreadColors.ForegroundSoft
    Row(
        modifier = Modifier
            .clip(RoundedCornerShape(999.dp))
            .background(background)
            .border(1.dp, border, RoundedCornerShape(999.dp))
            .semantics {
                contentDescription = if (option.recommended) {
                    "${option.displayLabel}, recommended"
                } else {
                    option.displayLabel
                }
            }
            .padding(horizontal = 8.dp, vertical = 5.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        Text(
            text = option.displayLabel,
            color = foreground,
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.SemiBold,
            maxLines = 1,
        )
        if (option.recommended) {
            Text(
                text = "*",
                color = foreground,
                style = MaterialTheme.typography.labelSmall,
                fontWeight = FontWeight.Bold,
                maxLines = 1,
            )
        }
    }
}

@Composable
private fun PendingRequestOtherChip(label: String) {
    Text(
        text = label,
        modifier = Modifier
            .clip(RoundedCornerShape(999.dp))
            .background(ThreadColors.SurfaceStrong)
            .border(1.dp, ThreadColors.Border, RoundedCornerShape(999.dp))
            .padding(horizontal = 8.dp, vertical = 5.dp),
        color = ThreadColors.ForegroundSoft,
        style = MaterialTheme.typography.labelSmall,
        fontWeight = FontWeight.SemiBold,
        maxLines = 1,
    )
}
