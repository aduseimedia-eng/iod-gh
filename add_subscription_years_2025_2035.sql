-- ============================================================
-- Add Subscription Years 2025-2035 for All Members
-- Institute of Directors - Ghana
-- ============================================================

-- This script adds subscription year entries for all existing members
-- for the years 2025 through 2035

-- Add subscription records for all members for years 2025-2035
INSERT INTO subscriptions (member_id, subscription_year, status)
SELECT m.id, year_val, 'Pending'
FROM members m
CROSS JOIN (
    VALUES (2025), (2026), (2027), (2028), (2029), (2030), (2031), (2032), (2033), (2034), (2035)
) AS years(year_val)
ON CONFLICT (member_id, subscription_year) DO NOTHING;

-- Set Honorary members' subscriptions to 'Waived' status
UPDATE subscriptions s
SET status = 'Waived'
FROM members m
WHERE s.member_id = m.id 
  AND m.member_type = 'Honorary'
  AND s.subscription_year BETWEEN 2025 AND 2035;

-- Verify the results
SELECT 
    subscription_year,
    COUNT(*) as total_subscriptions,
    COUNT(CASE WHEN status = 'Paid' THEN 1 END) as paid,
    COUNT(CASE WHEN status = 'Pending' THEN 1 END) as pending,
    COUNT(CASE WHEN status = 'Waived' THEN 1 END) as waived
FROM subscriptions
WHERE subscription_year BETWEEN 2025 AND 2035
GROUP BY subscription_year
ORDER BY subscription_year;

-- ============================================================
-- END OF SCRIPT
-- ============================================================
