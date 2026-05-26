---
source: manual
source_id: 2026-05-20T10-00-00+09-00-a1b2c3
captured_at: 2026-05-20T10:00:00+09:00
slug: prompt-caching-ttl
short_id: a1b2c3
tags: []
agent_summary: prompt caching を有効にすると 5min TTL でキャッシュされ、cache hit でコストが下がる。
agent_model: null
truncated: false
deleted: false
---

Anthropic API で prompt caching を使うときは cache_control を最後のブロックに付ける。
TTL は 5 分で、同じ prefix を 5 分以内に再送すると cache read 価格になる。
長い system prompt や tool 定義をキャッシュするのが定石。
