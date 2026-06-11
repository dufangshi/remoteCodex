package com.remotecodex.android.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
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
import androidx.compose.ui.unit.dp
import com.remotecodex.android.ui.model.PendingRequestPreview
import com.remotecodex.android.ui.presentation.buildPendingRequestCardState
import com.remotecodex.android.ui.theme.ThreadColors

@Composable
fun PendingRequestCard(
    request: PendingRequestPreview,
    modifier: Modifier = Modifier,
) {
    val state = buildPendingRequestCardState(request)
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
            )
        }
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(12.dp))
                .background(ThreadColors.Panel)
                .border(1.dp, ThreadColors.Border, RoundedCornerShape(12.dp))
                .padding(10.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Text(
                text = state.commandLabel,
                color = ThreadColors.ForegroundMuted,
                style = MaterialTheme.typography.labelSmall,
                fontWeight = FontWeight.SemiBold,
            )
            Text(
                text = state.command,
                modifier = Modifier.fillMaxWidth(),
                color = ThreadColors.ForegroundSoft,
                style = MaterialTheme.typography.bodyMedium,
                fontFamily = FontFamily.Monospace,
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
