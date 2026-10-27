ALTER TABLE tuiyan_records
  ADD COLUMN is_vip_decode TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否VIP超级推演' AFTER result_data,
  ADD COLUMN vip_decode_text TEXT COMMENT 'VIP超级推演全文(1500-2000字)' AFTER is_vip_decode;
