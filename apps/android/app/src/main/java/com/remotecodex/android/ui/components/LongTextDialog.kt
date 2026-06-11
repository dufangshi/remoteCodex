package com.remotecodex.android.ui.components

import android.graphics.BitmapFactory
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.remotecodex.android.ui.model.DetailPreview
import com.remotecodex.android.ui.theme.ThreadColors

@Composable
fun LongTextDialog(
    detail: DetailPreview,
    onClose: () -> Unit,
    modifier: Modifier = Modifier,
) {
    GraphDialogOverlay(
        onDismiss = onClose,
        modifier = modifier,
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(max = 620.dp)
                .clip(RoundedCornerShape(24.dp))
                .background(ThreadColors.CodeBackground)
                .border(1.dp, ThreadColors.BorderStrong, RoundedCornerShape(24.dp)),
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(ThreadColors.Surface.copy(alpha = 0.22f))
                    .padding(horizontal = 14.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Text(
                    text = detail.title,
                    modifier = Modifier.weight(1f),
                    color = ThreadColors.CodeForeground,
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                GraphButton(
                    label = "Close",
                    variant = GraphButtonVariant.Ghost,
                    size = GraphButtonSize.Small,
                    onClick = onClose,
                )
            }
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f, fill = false)
                    .verticalScroll(rememberScrollState())
                    .padding(14.dp),
            ) {
                DetailDialogBody(detail = detail)
            }
        }
    }
}

@Composable
private fun DetailDialogBody(detail: DetailPreview) {
    val image = detail.image
    val bitmap = remember(image?.bytes) {
        image?.bytes?.let { bytes ->
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
        }
    }
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        if (image != null && bitmap != null) {
            Image(
                bitmap = bitmap.asImageBitmap(),
                contentDescription = image.filename ?: image.path,
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(max = 420.dp)
                    .clip(RoundedCornerShape(14.dp))
                    .background(ThreadColors.Panel)
                    .border(1.dp, ThreadColors.Border, RoundedCornerShape(14.dp)),
                contentScale = ContentScale.Fit,
            )
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = image.contentType ?: "image",
                    color = ThreadColors.ForegroundMuted,
                    style = MaterialTheme.typography.labelSmall,
                    maxLines = 1,
                )
                Text(
                    text = "${image.bytes.size} bytes",
                    color = ThreadColors.ForegroundMuted,
                    style = MaterialTheme.typography.labelSmall,
                    maxLines = 1,
                )
                Spacer(modifier = Modifier.weight(1f))
            }
        }
        if (image != null && bitmap == null) {
            Text(
                text = "Image bytes could not be decoded.",
                color = ThreadColors.Warning,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.SemiBold,
            )
        }
        Text(
            text = detail.text,
            color = ThreadColors.CodeForeground,
            style = MaterialTheme.typography.bodyMedium,
            fontFamily = FontFamily.Monospace,
        )
    }
}
