# CC Switch

Source: https://github.com/farion1231/cc-switch
Revision: `889b797d8aa252299221ed6569f992bda0a31a72`

Adapted components: provider cards/actions and name/URL search in
`apps/supervisor-web/src/components/UpstreamProviderCard.tsx` and
`UpstreamManagement.tsx`; Claude provider-owned field classification from
`src-tauri/src/live/floor.rs` in `crates/runtime/src/upstreams/cc_switch.rs`.
The existing Remote Codex store, backups, atomic private writes and HTTP API
remain the integration boundary; CC Switch's Tauri state/database/proxy are
not copied.

MIT License

Copyright (c) 2025 Jason Young

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
