-- Garuda AI master settings, edited in Admin > Garuda AI and fetched by the MASTER EA (/api/master/config).
-- The Claude API key is stored encrypted as ai_claude_key_enc (not here).
INSERT OR IGNORE INTO settings (key, value) VALUES
  ('ai_paused', '0'), ('ai_model', 'claude-fable-5-1'), ('ai_effort', 'xhigh'),
  ('ai_news', '1'), ('ai_news_effort', 'medium'), ('ai_news_max', '4'), ('ai_web_tool', 'web_search_20260209'),
  ('ai_intermarket', '1'), ('ai_vision', '1'), ('ai_chart', '1'),
  ('ai_session_start', '7'), ('ai_session_end', '20'), ('ai_friday_last', '17'),
  ('ai_min_conf', '65'), ('ai_min_rr', '1.5'), ('ai_min_sl', '3'), ('ai_max_sl', '20'), ('ai_valid_min', '10'),
  ('ai_cost_cap', '25'), ('ai_master_trade', '1');
