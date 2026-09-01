use anyhow::Result;
use remote_codex_protocol::ThreadDetailDto;

pub fn html_transcript(detail: &ThreadDetailDto) -> Result<String> {
    let mut out = String::from("<!DOCTYPE html><html><head><meta charset=\"utf-8\"><title>");
    out.push_str(&escape(&detail.thread.title));
    out.push_str("</title></head><body><h1>");
    out.push_str(&escape(&detail.thread.title));
    out.push_str("</h1>");
    for (idx, turn) in detail.turns.iter().enumerate() {
        out.push_str(&format!("<h2>Turn {}</h2>", idx + 1));
        for item in &turn.items {
            out.push_str("<p><strong>");
            out.push_str(&escape(&item.kind));
            out.push_str(":</strong> ");
            out.push_str(&escape(&item.text));
            out.push_str("</p>");
        }
    }
    out.push_str("</body></html>");
    Ok(out)
}

pub fn pdf_transcript(detail: &ThreadDetailDto) -> Result<Vec<u8>> {
    let mut text = format!("{}\n\n", detail.thread.title);
    for (idx, turn) in detail.turns.iter().enumerate() {
        text.push_str(&format!("Turn {}\n", idx + 1));
        for item in &turn.items {
            text.push_str(&format!("{}: {}\n", item.kind, item.text));
        }
        text.push('\n');
    }
    Ok(simple_pdf(&text))
}

fn escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

fn simple_pdf(text: &str) -> Vec<u8> {
    let escaped = text.replace('\\', "\\\\").replace('(', "\\(").replace(')', "\\)");
    let stream = format!("BT /F1 11 Tf 48 750 Td ({escaped}) Tj ET");
    let stream_bytes = stream.as_bytes();
    let mut pdf = Vec::new();
    pdf.extend_from_slice(b"%PDF-1.4\n");
    let mut offsets = Vec::new();
    fn obj(pdf: &mut Vec<u8>, offsets: &mut Vec<usize>, body: &[u8]) {
        offsets.push(pdf.len());
        pdf.extend_from_slice(body);
        if !body.ends_with(b"\n") {
            pdf.push(b'\n');
        }
    }
    obj(&mut pdf, &mut offsets, b"1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n");
    obj(&mut pdf, &mut offsets, b"2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n");
    obj(
        &mut pdf,
        &mut offsets,
        b"3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj\n",
    );
    let mut content = format!("4 0 obj << /Length {} >> stream\n", stream_bytes.len()).into_bytes();
    content.extend_from_slice(stream_bytes);
    content.extend_from_slice(b"\nendstream endobj\n");
    obj(&mut pdf, &mut offsets, &content);
    obj(&mut pdf, &mut offsets, b"5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Courier >> endobj\n");
    let xref = pdf.len();
    pdf.extend_from_slice(format!("xref\n0 {}\n0000000000 65535 f \n", offsets.len() + 1).as_bytes());
    for offset in offsets {
        pdf.extend_from_slice(format!("{offset:010} 00000 n \n").as_bytes());
    }
    pdf.extend_from_slice(format!("trailer << /Size {} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n", 6).as_bytes());
    pdf
}
