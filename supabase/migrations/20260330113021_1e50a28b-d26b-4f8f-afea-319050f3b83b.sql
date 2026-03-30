-- v22.7 cleanup: remove smoke fixture subscription
DELETE FROM subscriptions_v2 WHERE id = 'a7b8c9d0-1234-5678-9abc-def012345678' AND meta->>'smoke_fixture' = 'v22.7';