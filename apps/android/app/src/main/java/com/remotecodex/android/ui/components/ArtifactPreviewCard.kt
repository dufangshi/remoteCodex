package com.remotecodex.android.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.remotecodex.android.ui.model.ArtifactPreview
import com.remotecodex.android.ui.presentation.MoleculeAtomPreview
import com.remotecodex.android.ui.presentation.normalizeMoleculeFormat
import com.remotecodex.android.ui.presentation.parseXyzAtoms
import com.remotecodex.android.ui.presentation.readGraphMoleculeViewerData
import com.remotecodex.android.ui.theme.ThreadColors
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ArtifactPreviewCard(
    artifact: ArtifactPreview,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(ThreadColors.Panel)
            .border(1.dp, ThreadColors.Border, RoundedCornerShape(12.dp)),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = artifact.title,
                    color = ThreadColors.Foreground,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    text = artifact.summary,
                    color = ThreadColors.ForegroundMuted,
                    style = MaterialTheme.typography.labelSmall,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            Text(
                text = "Open",
                modifier = Modifier
                    .clip(RoundedCornerShape(999.dp))
                    .border(1.dp, ThreadColors.Border, RoundedCornerShape(999.dp))
                    .padding(horizontal = 11.dp, vertical = 6.dp),
                color = ThreadColors.ForegroundSoft,
                style = MaterialTheme.typography.labelSmall,
                fontWeight = FontWeight.SemiBold,
            )
        }

        MoleculeFallbackPreview(artifact = artifact)

        Text(
            text = artifact.sourcePreview,
            modifier = Modifier
                .fillMaxWidth()
                .horizontalScroll(rememberScrollState())
                .background(ThreadColors.SurfaceStrong)
                .padding(12.dp),
            color = ThreadColors.ForegroundSoft,
            style = MaterialTheme.typography.bodyMedium,
            fontFamily = FontFamily.Monospace,
        )
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun InlineMoleculePreviewCard(
    code: String,
    language: String,
    modifier: Modifier = Modifier,
) {
    var expanded by rememberSaveable(code, language) { mutableStateOf(true) }
    var sourceOpen by rememberSaveable(code, language) { mutableStateOf(false) }
    val normalizedFormat = remember(language) { normalizeMoleculeFormat(language) }
    val moleculeData = remember(code, normalizedFormat) {
        readGraphMoleculeViewerData(
            source = code.trimEnd() + "\n",
            format = normalizedFormat,
        )
    }
    val atoms = remember(moleculeData.frames) {
        moleculeData.frames.firstOrNull()?.let(::parseXyzAtoms).orEmpty()
    }
    val sourcePreview = remember(code) {
        code.trimEnd().lineSequence().take(10).joinToString("\n")
    }

    Column(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(ThreadColors.Surface)
            .border(1.dp, ThreadColors.BorderStrong, RoundedCornerShape(12.dp)),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .background(ThreadColors.Panel)
                .padding(horizontal = 12.dp, vertical = 9.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Column(modifier = Modifier.fillMaxWidth()) {
                Text(
                    text = "${normalizedFormat.uppercase()} molecule",
                    color = ThreadColors.Foreground,
                    style = MaterialTheme.typography.labelMedium,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    text = "Rendered from message source",
                    color = ThreadColors.ForegroundMuted,
                    style = MaterialTheme.typography.labelSmall,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            FlowRow(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(7.dp),
                verticalArrangement = Arrangement.spacedBy(7.dp),
            ) {
                GraphBadge(
                    label = if (moleculeData.frames.size == 1) {
                        "1 frame"
                    } else {
                        "${moleculeData.frames.size} frames"
                    },
                    variant = GraphBadgeVariant.Outline,
                )
                atoms.size.takeIf { it > 0 }?.let { atomCount ->
                    GraphBadge(label = "$atomCount atoms", variant = GraphBadgeVariant.Secondary)
                }
                GraphButton(
                    label = if (sourceOpen) "Hide source" else "Source",
                    variant = if (sourceOpen) GraphButtonVariant.Secondary else GraphButtonVariant.Ghost,
                    contentDescription = if (sourceOpen) {
                        "Hide molecule source"
                    } else {
                        "Show molecule source"
                    },
                    onClick = { sourceOpen = !sourceOpen },
                )
                GraphButton(
                    label = if (expanded) "Collapse" else "Open",
                    variant = GraphButtonVariant.Ghost,
                    contentDescription = if (expanded) {
                        "Collapse molecule preview"
                    } else {
                        "Open molecule preview"
                    },
                    onClick = { expanded = !expanded },
                )
            }
        }
        if (expanded || sourceOpen) {
            Column(
                modifier = Modifier.padding(12.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                if (expanded) {
                    MoleculeSchematicCanvas(atoms = atoms)
                }
                if (sourceOpen) {
                    Text(
                        text = sourcePreview,
                        modifier = Modifier
                            .fillMaxWidth()
                            .horizontalScroll(rememberScrollState())
                            .clip(RoundedCornerShape(8.dp))
                            .background(ThreadColors.CodeBackground)
                            .padding(10.dp),
                        color = ThreadColors.CodeForeground,
                        style = MaterialTheme.typography.labelSmall,
                        fontFamily = FontFamily.Monospace,
                    )
                }
            }
        }
        if (!expanded && !sourceOpen) {
            Text(
                text = "Preview collapsed",
                modifier = Modifier
                    .fillMaxWidth()
                    .background(ThreadColors.SurfaceStrong.copy(alpha = 0.58f))
                    .padding(horizontal = 12.dp, vertical = 9.dp),
                color = ThreadColors.ForegroundMuted,
                style = MaterialTheme.typography.labelSmall,
            )
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun MoleculeFallbackPreview(artifact: ArtifactPreview) {
    val moleculeData = remember(artifact.sourcePreview, artifact.format) {
        readGraphMoleculeViewerData(
            source = artifact.sourcePreview,
            format = artifact.format,
        )
    }
    val atoms = remember(moleculeData.frames) {
        moleculeData.frames.firstOrNull()?.let(::parseXyzAtoms).orEmpty()
    }
    val atomCount = artifact.atomCount ?: atoms.size.takeIf { it > 0 }
    val frameCount = artifact.frameCount ?: moleculeData.frames.size

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(ThreadColors.Surface)
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                text = "${moleculeData.format.uppercase()} molecule",
                color = ThreadColors.Foreground,
                style = MaterialTheme.typography.labelMedium,
                fontWeight = FontWeight.SemiBold,
            )
            atomCount?.let {
                GraphBadge(label = "$it atoms", variant = GraphBadgeVariant.Outline)
            }
            GraphBadge(
                label = if (frameCount == 1) "1 frame" else "$frameCount frames",
                variant = GraphBadgeVariant.Outline,
            )
            if (atoms.isEmpty()) {
                GraphBadge(label = "source only", variant = GraphBadgeVariant.Secondary)
            }
            Spacer(modifier = Modifier.weight(1f))
            Text(
                text = "Schematic",
                color = ThreadColors.ForegroundMuted,
                style = MaterialTheme.typography.labelSmall,
            )
        }
        MoleculeUpperControls(frameCount = frameCount)
        MoleculeSchematicCanvas(atoms = atoms)
        MoleculeLowerControls()
        MoleculeCameraStatus(artifact = artifact)
    }
}

@Composable
private fun MoleculeSchematicCanvas(atoms: List<MoleculeAtomPreview>) {
    val bondColor = ThreadColors.Border.copy(alpha = 0.82f)
    val atomRingColor = Color(0xFFF8FAFC).copy(alpha = 0.32f)

    Canvas(
        modifier = Modifier
            .fillMaxWidth()
            .height(170.dp)
            .clip(RoundedCornerShape(10.dp))
            .background(ThreadColors.CodeBackground),
    ) {
        val contentPadding = 24f
        val projectedAtoms = projectMoleculeAtoms(
            atoms = atoms,
            width = size.width,
            height = size.height,
            padding = contentPadding,
        )
        val points = projectedAtoms.ifEmpty {
            listOf(
                Offset(size.width * 0.34f, size.height * 0.50f),
                Offset(size.width * 0.50f, size.height * 0.42f),
                Offset(size.width * 0.66f, size.height * 0.56f),
            ).mapIndexed { index, offset ->
                MoleculeCanvasAtom(
                    element = if (index == 2) "O" else "C",
                    point = offset,
                    depth = index.toFloat(),
                )
            }
        }
        val bonds = estimateMoleculeBonds(points)

        bonds.forEach { (startIndex, endIndex) ->
            drawLine(
                color = bondColor,
                start = points[startIndex].point,
                end = points[endIndex].point,
                strokeWidth = 4.2f,
                cap = StrokeCap.Round,
            )
        }

        points
            .sortedBy { it.depth }
            .forEach { atom ->
                val radius = moleculeElementRadius(atom.element)
                drawCircle(
                    color = moleculeElementColor(atom.element),
                    radius = radius,
                    center = atom.point,
                )
                drawCircle(
                    color = atomRingColor,
                    radius = radius,
                    center = atom.point,
                    style = Stroke(width = 1.2f),
                )
            }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun MoleculeUpperControls(frameCount: Int) {
    GraphButtonGroup(modifier = Modifier.fillMaxWidth()) {
        GraphTooltipAnchor(description = "Copy molecule source") {
            GraphButton(label = "Copy")
        }
        GraphTooltipAnchor(description = "Download artifact file") {
            GraphButton(label = "Download")
        }
        GraphTooltipAnchor(description = "Open trajectory controls") {
            GraphButton(label = "Trajectory", enabled = frameCount > 1)
        }
        GraphTooltipAnchor(description = "Capture molecule preview") {
            GraphButton(label = "Screenshot")
        }
        GraphButtonGroupSeparator()
        GraphButton(label = "Zoom +")
        GraphButton(label = "Zoom -")
        GraphButton(label = "Reset", variant = GraphButtonVariant.Secondary)
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun MoleculeLowerControls() {
    Column(verticalArrangement = Arrangement.spacedBy(7.dp)) {
        FlowRow(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(7.dp),
            verticalArrangement = Arrangement.spacedBy(7.dp),
        ) {
            listOf("Distance", "Connectivity", "Angle", "Dihedral", "Dummy", "Delete", "Rotate").forEach { label ->
                GraphButton(
                    label = label,
                    variant = if (label == "Delete") GraphButtonVariant.Destructive else GraphButtonVariant.Outline,
                )
            }
        }
        FlowRow(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(7.dp),
            verticalArrangement = Arrangement.spacedBy(7.dp),
        ) {
            GraphButton(label = "Unit cell", enabled = false)
            GraphButton(label = "Clear sel", enabled = false)
            GraphButton(label = "Send sel", enabled = false)
            GraphButton(label = "Stage sel", enabled = false)
            GraphButton(label = "Clear staged", enabled = false)
            GraphButton(label = "Send staged", enabled = false)
        }
    }
}

@Composable
private fun MoleculeCameraStatus(artifact: ArtifactPreview) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .background(ThreadColors.CodeBackground)
            .border(1.dp, ThreadColors.Border, RoundedCornerShape(10.dp))
            .padding(10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(
                text = "Camera x=0.0 y=0.0 z=0.0 / zoom 1.0x",
                color = ThreadColors.CodeForeground,
                style = MaterialTheme.typography.labelSmall,
                fontFamily = FontFamily.Monospace,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                text = "Selected atoms: none / Staged: 0 molecule, 0 atom",
                color = ThreadColors.ForegroundMuted,
                style = MaterialTheme.typography.labelSmall,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        Text(
            text = artifact.id,
            color = ThreadColors.ForegroundMuted,
            style = MaterialTheme.typography.labelSmall,
            fontFamily = FontFamily.Monospace,
            maxLines = 1,
        )
    }
}

private data class MoleculeCanvasAtom(
    val element: String,
    val point: Offset,
    val depth: Float,
)

private fun projectMoleculeAtoms(
    atoms: List<MoleculeAtomPreview>,
    width: Float,
    height: Float,
    padding: Float,
): List<MoleculeCanvasAtom> {
    if (atoms.isEmpty()) return emptyList()

    val minX = atoms.minOf { it.x }
    val maxX = atoms.maxOf { it.x }
    val minY = atoms.minOf { it.y }
    val maxY = atoms.maxOf { it.y }
    val xRange = max(0.001f, maxX - minX)
    val yRange = max(0.001f, maxY - minY)
    val drawableWidth = max(1f, width - padding * 2f)
    val drawableHeight = max(1f, height - padding * 2f)
    val scale = min(drawableWidth / xRange, drawableHeight / yRange)
    val moleculeWidth = xRange * scale
    val moleculeHeight = yRange * scale
    val offsetX = (width - moleculeWidth) / 2f
    val offsetY = (height - moleculeHeight) / 2f

    return atoms.map { atom ->
        val x = offsetX + (atom.x - minX) * scale
        val y = height - (offsetY + (atom.y - minY) * scale)
        MoleculeCanvasAtom(
            element = atom.element,
            point = Offset(x, y),
            depth = atom.z,
        )
    }
}

private fun estimateMoleculeBonds(points: List<MoleculeCanvasAtom>): List<Pair<Int, Int>> {
    if (points.size < 2) return emptyList()

    val nearest = points.indices.mapNotNull { index ->
        val start = points[index].point
        val candidate = points.indices
            .filter { it != index }
            .map { other ->
                val end = points[other].point
                val distance = distanceBetween(start, end)
                other to distance
            }
            .minByOrNull { it.second }
        candidate?.let { min(index, it.first) to max(index, it.first) }
    }

    return nearest
        .distinct()
        .take(points.size + 2)
}

private fun distanceBetween(start: Offset, end: Offset): Float {
    val dx = start.x - end.x
    val dy = start.y - end.y
    return sqrt(dx * dx + dy * dy)
}

private fun moleculeElementColor(element: String): Color {
    return when (element.uppercase()) {
        "H" -> Color(0xFFE5E7EB)
        "C" -> Color(0xFF9CA3AF)
        "N" -> Color(0xFF60A5FA)
        "O" -> Color(0xFFF87171)
        "S" -> Color(0xFFFACC15)
        "P" -> Color(0xFFF59E0B)
        "F", "CL", "BR", "I" -> Color(0xFF34D399)
        else -> Color(0xFFA7B0C0)
    }
}

private fun moleculeElementRadius(element: String): Float {
    return when (element.uppercase()) {
        "H" -> 8.5f
        "C" -> 11f
        "N", "O" -> 12f
        "S", "P" -> 13f
        else -> 10.5f
    }
}
