-- ============================================================
-- Initialize 2025 Subscription Records for All Members
-- Institute of Directors - Ghana
-- ============================================================
-- Purpose: Add subscription records for all existing members for year 2025
-- Run this script after importing member data to ensure all members
-- have subscription records
-- ============================================================

-- Add subscription record for 2025 for all members
-- The status will be:
--   - "Paid" for members whose import file had 2025 marked as paid
--   - "Pending" for members imported without 2025 data
--   - "Waived" for Honorary members
INSERT INTO subscriptions (member_id, subscription_year, status)
SELECT m.id, 2025, 
    CASE 
        WHEN m.member_type = 'Honorary' THEN 'Waived'
        ELSE 'Pending'
    END as status
FROM members m
WHERE NOT EXISTS (
    SELECT 1 FROM subscriptions s 
    WHERE s.member_id = m.id AND s.subscription_year = 2025
)
ON CONFLICT (member_id, subscription_year) DO NOTHING;

-- Update Honorary members' subscriptions to 'Waived' status for 2025
UPDATE subscriptions s
SET status = 'Waived'
FROM members m
WHERE s.member_id = m.id 
  AND m.member_type = 'Honorary'
  AND s.subscription_year = 2025
  AND s.status != 'Waived';

-- Verify the results
SELECT 
    2025 as subscription_year,
    COUNT(*) as total_subscriptions,
    COUNT(CASE WHEN status = 'Paid' THEN 1 END) as paid,
    COUNT(CASE WHEN status = 'Pending' THEN 1 END) as pending,
    COUNT(CASE WHEN status = 'Waived' THEN 1 END) as waived
FROM subscriptions
WHERE subscription_year = 2025;

-- breakdown by member type
SELECT 
    m.member_type,
    COUNT(s.id) as total,
    COUNT(CASE WHEN s.status = 'Paid' THEN 1 END) as paid,
    COUNT(CASE WHEN s.status = 'Pending' THEN 1 END) as pending,
    COUNT(CASE WHEN s.status = 'Waived' THEN 1 END) as waived
FROM members m
LEFT JOIN subscriptions s ON m.id = s.member_id AND s.subscription_year = 2025
GROUP BY m.member_type
ORDER BY m.member_type;

-- ============================================================
-- END OF SCRIPT
-- ============================================================
