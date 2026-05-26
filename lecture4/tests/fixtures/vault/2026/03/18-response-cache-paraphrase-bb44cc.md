---
source: manual
source_id: 2026-03-18T16-20-00+09-00-bb44cc
captured_at: 2026-03-18T16:20:00+09:00
slug: response-cache-paraphrase
short_id: bb44cc
tags: []
agent_summary: プロンプトのキャッシュ機構について。言い換えだけで literal な語は使わない。
agent_model: null
truncated: false
deleted: false
---

ここでは response caching や request memoization の話をする。
わざと "prompt" と "caching" を隣り合わせにせず、言い換え (paraphrase) だけで書く。
substring 検索では引っかからないことの確認用 (finding H)。
プロンプト の キャッシュ という具合に語の間に必ず別の語を挟む。
