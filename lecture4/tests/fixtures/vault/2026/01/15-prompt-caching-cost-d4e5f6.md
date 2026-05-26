---
source: backfill
source_id: 2026-01-15T09-30-00+09-00-d4e5f6
captured_at: 2026-01-15T09:30:00+09:00
slug: prompt-caching-cost
short_id: d4e5f6
tags: []
agent_summary: prompt caching の cache write は通常の 1.25 倍だが read は 0.1 倍で実質コスト減。
agent_model: null
truncated: false
deleted: false
---

cache write は input の 1.25x、cache read は 0.1x。
再利用回数が多いほど得になる。1 回しか使わないなら write 分だけ損。
