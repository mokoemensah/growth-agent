-- Hero product focus: HVAC only. Pause other sellable products, retarget default campaign.

UPDATE products
SET status = 'paused', updated_at = now()
WHERE slug IN ('bot-mvp', 'boswell-saas') AND status = 'active';

UPDATE products
SET status = 'active', updated_at = now()
WHERE slug = 'hvac-receptionist-agent';

UPDATE campaigns
SET
  name = 'HVAC Outreach',
  slug = 'hvac-outreach-v1',
  playbook_id = 'hvac-receptionist-agent',
  product_id = (SELECT id FROM products WHERE slug = 'hvac-receptionist-agent'),
  daily_send_cap = 5,
  updated_at = now()
WHERE id = '11111111-1111-1111-1111-111111111111';

UPDATE sequences
SET
  subject_template = 'Quick question about after-hours calls at {{company}}',
  body_template = 'Hi {{first_name}},

{{personalization_hook}}

Many HVAC shops your size miss evening and weekend service calls — and each one is a lost job. We built an AI receptionist that answers 24/7 and books appointments ($299/mo).

Worth a 15-minute call to hear a sample call flow?'
WHERE campaign_id = '11111111-1111-1111-1111-111111111111' AND step_number = 0;

UPDATE sequences
SET
  subject_template = 'Re: missed calls at {{company}}',
  body_template = 'Hi {{first_name}},

Following up — peak season overload is when missed calls hurt most. One booked job usually covers the monthly cost.

Still open to a quick demo this week?'
WHERE campaign_id = '11111111-1111-1111-1111-111111111111' AND step_number = 1;

UPDATE sequences
SET
  subject_template = 'Closing the loop',
  body_template = 'Hi {{first_name}},

Haven''t heard back — assuming timing isn''t right. Happy to reconnect later. Reply STOP to opt out.'
WHERE campaign_id = '11111111-1111-1111-1111-111111111111' AND step_number = 2;

INSERT INTO agent_memory (namespace, key, value)
VALUES
  ('system', 'daily_send_cap', '5'::jsonb),
  ('system', 'hero_product_slug', '"hvac-receptionist-agent"'::jsonb),
  ('system', 'warmup_started_at', to_jsonb(now()::text))
ON CONFLICT (namespace, key) DO UPDATE
SET value = EXCLUDED.value, updated_at = now();
