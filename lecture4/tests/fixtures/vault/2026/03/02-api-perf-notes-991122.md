---
source: manual
source_id: 2026-03-02T14-10-00+09-00-991122
captured_at: 2026-03-02T14:10:00+09:00
slug: api-perf-notes
short_id: "991122"
tags: []
agent_summary: API レイテンシ改善の雑多なメモ。リトライとタイムアウト周りが中心。
agent_model: null
truncated: false
deleted: false
---

レイテンシを下げる施策をいくつか試した。
タイムアウトを短めにしてリトライを足すと体感が良い。
あと prompt caching を入れたら 2 回目以降のリクエストがかなり速くなった。
ただし summary 側には書いていないので body でしか引っかからないはず。
