-- Scheduled educational / introduction videos with rotating topics; content scripts written by Qwen (Claude stays for trading)
ALTER TABLE content_jobs ADD COLUMN topic TEXT NOT NULL DEFAULT '';
INSERT OR IGNORE INTO settings (key, value) VALUES ('content_edu', '1'), ('content_times', '19:00'), ('content_topic_idx', '0'),
  ('content_ai', 'qwen'), ('qwen_base', 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1'), ('qwen_model', 'qwen-plus');
