# Plain-text prompt editing and multimodal order

The composer uses the browser's `contenteditable="plaintext-only"` editing mode with non-editable inline photo/file tokens. It accepts text without rich formatting while retaining the placement of attachments between text segments.

## Verified model input

On 2026-10-07, one real prompt was sent through the installed `@agentclientprotocol/codex-acp` adapter to Codex CLI 0.160.0, using an isolated Codex home and temporary workspace. The default configured model was `gpt-6-astra`. The prompt comprised a text block starting with `BLOCK ALPHA`, a PNG displaying `ORBIT 731`, and a text block starting with `BLOCK OMEGA`. It explicitly asked the model to report the observed order without assuming the picture's position, and to use no tools.

The successful `end_turn` reply was: “Observed sequence: BLOCK ALPHA → image containing ‘ORBIT 731’ → BLOCK OMEGA.” The native rollout's user response item independently contains `input_text`, `input_image`, `input_text` in that exact order. No additional model prompts were needed.

The product's attachment expansion in `crates/runtime/src/acp/prompt.rs` preserves inline `[PHOTO ...]` and `[FILE ...]` token order. Codex ACP maps that array in order into native input items. Images become visual input; files become textual file links at their original positions, with file contents available for the agent to read separately. This is a content sequence, not a screenshot or pixel coordinates of the composer. Separately supplied extra images are appended by the runtime and do not have inline text positions.

The [official app-server protocol](https://learn.chatgpt.com/docs/app-server#turns) documents the text/image/localImage input list. The implementation and real rollout were checked because the protocol's ability to express a sequence alone would not prove that an adapter preserves it.

## Dictation fixes and verification

Previously, native styled dictation wrappers triggered full editor reconstruction, and asynchronously arriving photo previews also replaced text nodes. Those mutations invalidate ranges retained by dictation/autocorrection. Selection offsets additionally assumed text nodes were direct editor children. Delayed parent draft acknowledgements could overwrite a newer local edit and cancel its pending persistence.

Input now remains browser-owned through composition and ordinary native replacement events. Preview updates replace attachment tokens only. Selection measurement/restoration handles nested text, line breaks and attachment placeholders. Parent echoes acknowledge saved drafts without reverting newer local text. Pasting still inserts plain text, and attachments retain their inline sequence.

Targeted unit regressions cover delayed draft acknowledgements, nested selections and image-preview node preservation. `e2e/composer-input.spec.ts` exercises simulated composition/dictation replacements around an inline image in mobile Chromium and verifies the actual submitted prompt. It does not exercise a physical phone's microphone or proprietary keyboard speech engine.

The composer changes are a Web deployment after runtime 0.12.65 was pinned. They do not modify that immutable runtime release.
