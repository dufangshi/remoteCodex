use anyhow::{anyhow, bail, Result};
use printpdf::{
    Color, Mm, Op, ParsedFont, PdfDocument, PdfFontHandle, PdfPage, PdfSaveOptions, Point, Pt, Rgb,
    TextItem,
};
use remote_codex_protocol::{ThreadDetailDto, ThreadHistoryItemDto, ThreadTurnDto};

const MAX_ITEM_CHARS: usize = 12_000;
const PAGE_HEIGHT: f32 = 792.0;
const MARGIN: f32 = 48.0;
const EXPORT_FONT: &[u8] = include_bytes!("../assets/fonts/NotoSansSC[wght].ttf");

#[derive(Debug, Clone)]
pub struct TranscriptExportOptions {
    pub profile: String,
    pub include_token_and_price: bool,
    pub include_command_output: bool,
    pub include_absolute_paths: bool,
}

impl Default for TranscriptExportOptions {
    fn default() -> Self {
        Self {
            profile: "review".into(),
            include_token_and_price: true,
            include_command_output: false,
            include_absolute_paths: false,
        }
    }
}

pub fn select_turns(
    turns: &[ThreadTurnDto],
    mode: &str,
    limit: Option<usize>,
    turn_ids: &[String],
) -> Result<Vec<ThreadTurnDto>> {
    if mode == "selected" {
        if turn_ids.is_empty() {
            bail!("Select at least one turn to export.");
        }
        if turn_ids.len() > 100 {
            bail!("An export can include at most 100 turns.");
        }
        let selected: Vec<_> = turns
            .iter()
            .filter(|turn| turn_ids.iter().any(|id| id == &turn.id))
            .cloned()
            .collect();
        if selected.len() != turn_ids.len() {
            bail!("One or more selected turns could not be found.");
        }
        return Ok(selected);
    }

    let limit = limit.unwrap_or(10).clamp(1, 100);
    Ok(turns[turns.len().saturating_sub(limit)..].to_vec())
}

pub fn html_transcript(
    detail: &ThreadDetailDto,
    turns: &[ThreadTurnDto],
    options: &TranscriptExportOptions,
) -> Result<String> {
    let title = escape_html(&detail.thread.title);
    let workspace = escape_html(&detail.workspace.label);
    let mut body = String::new();
    for (index, turn) in turns.iter().enumerate() {
        let number = turn_number(detail, turn, index);
        let turn_meta = turn_meta(turn, options);
        body.push_str(&format!(
            "<section class=\"turn\"><header><span>Turn {number}</span><span class=\"status\">{}</span></header>",
            escape_html(&turn_meta)
        ));
        for item in visible_items(turn, options) {
            let label = item_label(&item.kind);
            let text = escape_html(&export_item_text(item, detail, options));
            if matches!(item.kind.as_str(), "userMessage" | "agentMessage") {
                let role = if item.kind == "userMessage" {
                    "user"
                } else {
                    "agent"
                };
                body.push_str(&format!(
                    "<article class=\"message {role}\"><div class=\"label\">{label}</div><div class=\"content\">{text}</div></article>"
                ));
            } else {
                let status = item
                    .status
                    .as_deref()
                    .map(|value| format!("<span class=\"status\">{}</span>", escape_html(value)))
                    .unwrap_or_default();
                body.push_str(&format!(
                    "<details class=\"event\"><summary><span>{label}</span>{status}</summary><pre>{text}</pre></details>"
                ));
            }
        }
        body.push_str("</section>");
    }

    Ok(format!(
        r#"<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light dark"><title>{title}</title>
<style>
:root{{color-scheme:light dark;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans",sans-serif;background:#f5f5f1;color:#20201d}}*{{box-sizing:border-box}}body{{margin:0;background:#f5f5f1;color:#20201d}}main{{width:min(860px,calc(100% - 32px));margin:0 auto;padding:56px 0 80px}}.document-header{{padding-bottom:28px;border-bottom:1px solid #cecec5}}h1{{margin:0;font-size:30px;line-height:1.2;letter-spacing:0}}.meta{{margin:10px 0 0;color:#66665f;font-size:14px}}.turn{{padding:28px 0;border-bottom:1px solid #d9d9d1}}.turn>header{{display:flex;justify-content:space-between;gap:16px;margin-bottom:20px;color:#66665f;font-size:13px;font-weight:600}}.message{{margin:0 0 22px}}.label{{margin-bottom:7px;color:#66665f;font-size:12px;font-weight:700;text-transform:uppercase}}.content,pre{{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;line-height:1.65}}.message.user .content{{font-weight:500}}.event{{margin:12px 0;border:1px solid #d6d6ce;border-radius:6px;background:#ecece6}}.event summary{{display:flex;justify-content:space-between;gap:16px;padding:10px 12px;cursor:pointer;font-size:13px}}.event pre{{padding:0 12px 12px;color:#52524c;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12px}}.status{{color:#77776f;font-weight:500}}
@media(prefers-color-scheme:dark){{:root,body{{background:#171713;color:#efefe8}}.document-header,.turn{{border-color:#37372f}}.meta,.turn>header,.label,.status{{color:#a4a49a}}.event{{border-color:#3b3b33;background:#22221d}}.event pre{{color:#c9c9bf}}}}@media(max-width:560px){{main{{width:min(100% - 24px,860px);padding-top:32px}}h1{{font-size:24px}}}}@media print{{:root,body{{background:white;color:#20201d}}main{{width:100%;padding:0}}.turn{{break-inside:avoid}}}}
</style></head><body><main><header class="document-header"><h1>{title}</h1><p class="meta">{workspace} · {} turns exported</p></header>{body}</main></body></html>
"#,
        turns.len()
    ))
}

pub fn pdf_transcript(
    detail: &ThreadDetailDto,
    turns: &[ThreadTurnDto],
    options: &TranscriptExportOptions,
) -> Result<Vec<u8>> {
    let mut lines = vec![PdfLine::title(detail.thread.title.clone())];
    lines.push(PdfLine::muted(format!(
        "{} · {} turns exported",
        detail.workspace.label,
        turns.len()
    )));
    lines.push(PdfLine::space());
    for (index, turn) in turns.iter().enumerate() {
        lines.push(PdfLine::heading(format!(
            "Turn {} · {}",
            turn_number(detail, turn, index),
            turn_meta(turn, options)
        )));
        for item in visible_items(turn, options) {
            lines.push(PdfLine::label(item_label(&item.kind).to_string()));
            for source_line in export_item_text(item, detail, options).lines() {
                lines.extend(wrap_text(source_line, 84).into_iter().map(PdfLine::body));
            }
            lines.push(PdfLine::space());
        }
    }
    write_pdf(&detail.thread.title, &paginate(lines))
}

fn turn_meta(turn: &ThreadTurnDto, options: &TranscriptExportOptions) -> String {
    if !options.include_token_and_price {
        return turn.status.clone();
    }
    let total = turn.token_usage.as_ref().and_then(|usage| {
        usage
            .get("totalTokens")
            .or_else(|| usage.get("total_tokens"))
            .and_then(serde_json::Value::as_u64)
    });
    match total {
        Some(total) => format!("{} · {total} tokens", turn.status),
        None => turn.status.clone(),
    }
}

fn turn_number(detail: &ThreadDetailDto, turn: &ThreadTurnDto, fallback: usize) -> usize {
    detail
        .turns
        .iter()
        .position(|candidate| candidate.id == turn.id)
        .map(|value| value + 1)
        .unwrap_or(fallback + 1)
}

fn visible_items<'a>(
    turn: &'a ThreadTurnDto,
    options: &TranscriptExportOptions,
) -> Vec<&'a ThreadHistoryItemDto> {
    turn.items
        .iter()
        .filter(|item| {
            options.profile == "technical"
                || matches!(item.kind.as_str(), "userMessage" | "agentMessage" | "plan")
        })
        .collect()
}

fn export_item_text(
    item: &ThreadHistoryItemDto,
    detail: &ThreadDetailDto,
    options: &TranscriptExportOptions,
) -> String {
    let source = item.preview_text.as_deref().unwrap_or(&item.text);
    let source = if item.kind == "commandExecution" && !options.include_command_output {
        source.lines().next().unwrap_or(source)
    } else {
        source
    };
    let mut text = truncate_chars(source, MAX_ITEM_CHARS);
    if !options.include_absolute_paths && !detail.workspace.abs_path.is_empty() {
        text = text.replace(&detail.workspace.abs_path, "{workspace}");
    }
    text
}

fn truncate_chars(value: &str, limit: usize) -> String {
    let mut chars = value.chars();
    let head: String = chars.by_ref().take(limit).collect();
    if chars.next().is_some() {
        format!("{head}...")
    } else {
        head
    }
}

fn item_label(kind: &str) -> &'static str {
    match kind {
        "userMessage" => "User",
        "agentMessage" => "Agent",
        "reasoning" => "Reasoning",
        "plan" => "Plan",
        "commandExecution" => "Command",
        "fileChange" => "File changes",
        "fileRead" => "File read",
        "webSearch" => "Web search",
        "contextCompaction" => "Context",
        "image" => "Image",
        "skillToolCall" => "Skill",
        "agentToolCall" => "Agent tool",
        "toolCall" => "Tool",
        _ => "Event",
    }
}

fn escape_html(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

#[derive(Clone)]
struct PdfLine {
    text: String,
    size: f32,
    leading: f32,
    color: (f32, f32, f32),
    keep_with_next: bool,
}

impl PdfLine {
    fn title(text: String) -> Self {
        Self {
            text,
            size: 20.0,
            leading: 28.0,
            color: (0.12, 0.12, 0.11),
            keep_with_next: true,
        }
    }
    fn heading(text: String) -> Self {
        Self {
            text,
            size: 13.0,
            leading: 22.0,
            color: (0.20, 0.20, 0.18),
            keep_with_next: true,
        }
    }
    fn label(text: String) -> Self {
        Self {
            text,
            size: 9.0,
            leading: 14.0,
            color: (0.38, 0.38, 0.34),
            keep_with_next: true,
        }
    }
    fn body(text: String) -> Self {
        Self {
            text,
            size: 10.5,
            leading: 15.0,
            color: (0.15, 0.15, 0.14),
            keep_with_next: false,
        }
    }
    fn muted(text: String) -> Self {
        Self {
            text,
            size: 9.5,
            leading: 16.0,
            color: (0.42, 0.42, 0.38),
            keep_with_next: false,
        }
    }
    fn space() -> Self {
        Self {
            text: String::new(),
            size: 1.0,
            leading: 9.0,
            color: (0.0, 0.0, 0.0),
            keep_with_next: false,
        }
    }
}

fn wrap_text(value: &str, max_units: usize) -> Vec<String> {
    if value.is_empty() {
        return vec![String::new()];
    }
    let mut lines = Vec::new();
    let mut line = String::new();
    let mut units = 0;
    for character in value.chars() {
        let expanded: Vec<char> = if character == '\t' {
            vec![' '; 4]
        } else {
            vec![character]
        };
        for character in expanded {
            let width = if character.is_ascii() { 1 } else { 2 };
            if units + width > max_units && !line.is_empty() {
                lines.push(line);
                line = String::new();
                units = 0;
            }
            line.push(character);
            units += width;
        }
    }
    if !line.is_empty() {
        lines.push(line);
    }
    lines
}

fn paginate(lines: Vec<PdfLine>) -> Vec<Vec<PdfLine>> {
    let mut pages = vec![Vec::new()];
    let mut remaining = PAGE_HEIGHT - MARGIN * 2.0;
    for (index, line) in lines.iter().enumerate() {
        let required = line.leading
            + if line.keep_with_next {
                lines
                    .get(index + 1)
                    .map(|next| next.leading + 9.0)
                    .unwrap_or(0.0)
            } else {
                0.0
            };
        if remaining < required && !pages.last().is_some_and(Vec::is_empty) {
            pages.push(Vec::new());
            remaining = PAGE_HEIGHT - MARGIN * 2.0;
        }
        remaining -= line.leading;
        pages.last_mut().unwrap().push(line.clone());
    }
    pages
}

fn write_pdf(title: &str, pages: &[Vec<PdfLine>]) -> Result<Vec<u8>> {
    let mut font_warnings = Vec::new();
    let font = ParsedFont::from_bytes(EXPORT_FONT, 0, &mut font_warnings)
        .ok_or_else(|| anyhow!("Unable to load the bundled transcript font."))?;
    let mut document = PdfDocument::new(title);
    let font_id = document.add_font(&font);
    let pages = pages
        .iter()
        .map(|lines| {
            let mut operations = Vec::new();
            let mut y = PAGE_HEIGHT - MARGIN;
            for line in lines {
                y -= line.leading;
                if line.text.is_empty() {
                    continue;
                }
                operations.extend([
                    Op::StartTextSection,
                    Op::SetTextCursor {
                        pos: Point {
                            x: Pt(MARGIN),
                            y: Pt(y),
                        },
                    },
                    Op::SetFillColor {
                        col: Color::Rgb(Rgb::new(line.color.0, line.color.1, line.color.2, None)),
                    },
                    Op::SetFont {
                        font: PdfFontHandle::External(font_id.clone()),
                        size: Pt(line.size),
                    },
                    Op::ShowText {
                        items: vec![TextItem::Text(line.text.clone())],
                    },
                    Op::EndTextSection,
                ]);
            }
            PdfPage::new(Mm(215.9), Mm(279.4), operations)
        })
        .collect::<Vec<_>>();
    let options = PdfSaveOptions {
        subset_fonts: true,
        optimize: true,
        ..PdfSaveOptions::default()
    };
    let mut pdf_warnings = Vec::new();
    Ok(document.with_pages(pages).save(&options, &mut pdf_warnings))
}
