# Remote Codex 0.12.67

Runtime candidate includes `434e1603`; shared UI is pinned to
`ec24408b5f71d9655efc7dd1d8dec0713553921f`.

- Clarify agent communication in the bundled skill and ACP managed prompt:
  stop/replace/reprioritize active work through steer/direct with a concrete
  interrupt reason; queue only independent work that can wait for the entire
  active turn to end. Ready inputs, reports and adoption notices stay in inbox.
  Inspect complete receipts and avoid obsolete queued task/resource instructions.
  Existing queues are preserved; agents still choose the message's semantics.
- Distinguish idle/unread parents with running descendants in recent chats,
  favorites and grouped tabs. A purple double ring and accessible count include
  grandchildren; the parent's backend execution status is unchanged. Failure,
  interruption and unknown state retain precedence.
- Put the device monitor in the desktop icon rail immediately above Settings;
  it stays visible with the chat sidebar collapsed. Mobile keeps its topbar entry.
- Place account-synchronized message shortcuts first in Preferences, keeping
  their existing Enter/Ctrl+Enter and direct steer behavior.

Validation before release: focused desktop/mobile thread-group E2E, four shared
UI grouping/status tests, desktop/mobile device-monitor E2E, account shortcut
cross-browser/device E2E, Web typecheck/build, runtime peer-policy and managed
session-context regressions, Rust formatting, and skill structure validation.
The versioned release workflow additionally gates packaging on workspace tests,
four platform builds/smokes and the pinned Web build. Windows Device Manager
remains independently versioned.

Communication evidence and remaining limitations are recorded in
[the peer-delivery audit](peer-delivery-audit-20261007.md).
