DELETE FROM payments_v2 WHERE provider_payment_id IN ('SYNTH-STAGE2-TX-CYCLE1-UID-0001','SYNTH-STAGE2-TX-CYCLE2-UID-0002');
DELETE FROM payment_reconcile_queue WHERE bepaid_uid IN ('SYNTH-STAGE2-TX-CYCLE1-UID-0001','SYNTH-STAGE2-TX-CYCLE2-UID-0002');
DELETE FROM provider_subscriptions WHERE id='33ed8ef0-25da-4875-9736-e995d7aa5406';
DELETE FROM subscriptions_v2 WHERE id='df233027-1b17-4448-a042-2d0f8a5561e5';
DELETE FROM payment_links WHERE meta->>'runtime_tag'='stage2_second_cycle_synthetic';
DELETE FROM orders_v2 WHERE id='874c9bcf-3c2f-44c5-bbcf-6a522af64c60';