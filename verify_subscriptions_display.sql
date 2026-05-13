-- ============================================================
-- Verify Subscription Display on Member Profiles
-- ============================================================
-- Use this script to verify that:
-- 1. Members have subscription records
-- 2. Subscription years are properly stored
-- 3. Current year (2025) has records

-- Check all members and their subscription counts
SELECT 
    m.membership_number,
    m.first_name,
    m.surname,
    m.member_type,
    COUNT(DISTINCT s.subscription_year) as subscription_count,
    ARRAY_AGG(DISTINCT s.subscription_year ORDER BY s.subscription_year DESC) as years,
    COUNT(DISTINCT CASE WHEN s.status IN ('Paid', 'Waived') THEN s.subscription_year END) as paid_count
FROM members m
LEFT JOIN subscriptions s ON m.id = s.member_id
GROUP BY m.id, m.membership_number, m.first_name, m.surname, m.member_type
ORDER BY m.membership_number
LIMIT 20;

-- Check specifically for 2025 subscriptions
SELECT 
    COUNT(*) as total_2025_records,
    COUNT(CASE WHEN s.status = 'Paid' THEN 1 END) as paid_2025,
    COUNT(CASE WHEN s.status = 'Pending' THEN 1 END) as pending_2025,
    COUNT(CASE WHEN s.status = 'Waived' THEN 1 END) as waived_2025
FROM subscriptions s
WHERE s.subscription_year = 2025;

-- Check for members missing 2025 subscriptions (they should be created now)
SELECT 
    m.membership_number,
    m.first_name,
    m.surname,
    m.member_type
FROM members m
WHERE NOT EXISTS (
    SELECT 1 FROM subscriptions s 
    WHERE s.member_id = m.id AND s.subscription_year = 2025
)
ORDER BY m.membership_number
LIMIT 10;

-- Sample member profile data (like API returns)
SELECT 
    m.id,
    m.membership_number,
    m.member_type,
    m.first_name,
    m.surname,
    ARRAY_REMOVE(ARRAY_AGG(DISTINCT s.subscription_year ORDER BY s.subscription_year DESC), NULL) as subscription_years,
    (SELECT ARRAY_AGG(DISTINCT subscription_year ORDER BY subscription_year DESC) FROM subscriptions WHERE member_id = m.id AND (status = 'Paid' OR status = 'Waived')) as paid_years,
    COALESCE((SELECT s2.status FROM subscriptions s2 WHERE s2.member_id = m.id ORDER BY s2.subscription_year DESC LIMIT 1), 'Pending') as payment_status
FROM members m
LEFT JOIN subscriptions s ON m.id = s.member_id
GROUP BY m.id
ORDER BY m.membership_number
LIMIT 10;

-- ============================================================
-- END OF VERIFICATION SCRIPT
-- ============================================================
