Claude cache writes now use the duration reported by Claude Code, and token details distinguish total input from uncached input.

- Native Claude usage reports include separate five-minute and one-hour cache-write counts. Previously the duration was dropped and every cache write used the five-minute rate. The Supervisor now preserves the one-hour subset through accumulation, saved usage and public history, and charges mixed-duration writes at their respective rates. Settings → Model pricing includes a separate one-hour write rate.
- The audited image turn contained 15,121,954 input tokens across 69 responses: 138 uncached, 14,045,452 cache-read and 1,076,364 one-hour cache-write tokens. At the configured Opus 5.5 API rates its estimate should be $12.5424544; the previous five-minute assumption produced $9.3133624.
- The cost popover now shows total input and visible category labels. One-hour-only writes carry a small 1h marker. Existing records without saved duration information retain the previous five-minute fallback; this release does not scan or rewrite old records.

This release includes the 0.12.81 shell PATH and Harness settings fixes. The Windows Device Manager remains independently released.
