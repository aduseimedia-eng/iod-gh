-- ============================================================
-- SUBSCRIPTION RATES AND DEFERRED PAYMENTS SETUP
-- Run this script to add subscription rates functionality
-- ============================================================

-- Table: subscription_rates - stores expected annual amounts per member type
CREATE TABLE IF NOT EXISTS subscription_rates (
    id SERIAL PRIMARY KEY,
    member_type VARCHAR(50) NOT NULL CHECK (member_type IN ('AIOD', 'FIOD', 'MIOD', 'Honorary', 'Corporate')),
    subscription_year INTEGER NOT NULL,
    expected_amount DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (member_type, subscription_year)
);

-- Add credit_balance column to subscriptions table if not exists
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'subscriptions' AND column_name = 'credit_balance'
    ) THEN
        ALTER TABLE subscriptions ADD COLUMN credit_balance DECIMAL(10, 2) DEFAULT 0.00;
    END IF;
END $$;

-- Add expected_amount column to subscriptions table to track what was expected at time of payment
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'subscriptions' AND column_name = 'expected_amount'
    ) THEN
        ALTER TABLE subscriptions ADD COLUMN expected_amount DECIMAL(10, 2) DEFAULT 0.00;
    END IF;
END $$;

-- Add credit_applied column to track credit applied from previous years
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'subscriptions' AND column_name = 'credit_applied'
    ) THEN
        ALTER TABLE subscriptions ADD COLUMN credit_applied DECIMAL(10, 2) DEFAULT 0.00;
    END IF;
END $$;

-- Index for faster rate lookups
CREATE INDEX IF NOT EXISTS idx_subscription_rates_type_year ON subscription_rates(member_type, subscription_year);

-- Trigger to auto-update timestamp on subscription_rates
CREATE OR REPLACE FUNCTION update_rates_modified_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_subscription_rates_modtime ON subscription_rates;
CREATE TRIGGER update_subscription_rates_modtime
    BEFORE UPDATE ON subscription_rates
    FOR EACH ROW
    EXECUTE FUNCTION update_rates_modified_column();

-- Insert default rates for current and recent years (adjust amounts as needed)
-- AIOD: Associate members
-- FIOD: Fellows
-- MIOD: Members
-- Honorary: Honorary members (usually waived)
-- Corporate: Corporate members

INSERT INTO subscription_rates (member_type, subscription_year, expected_amount, description)
VALUES 
    ('AIOD', 2025, 350.00, 'Associate annual subscription'),
    ('AIOD', 2026, 350.00, 'Associate annual subscription'),
    ('AIOD', 2027, 350.00, 'Associate annual subscription'),
    ('AIOD', 2028, 350.00, 'Associate annual subscription'),
    ('AIOD', 2029, 350.00, 'Associate annual subscription'),
    ('AIOD', 2030, 350.00, 'Associate annual subscription'),
    ('AIOD', 2031, 350.00, 'Associate annual subscription'),
    ('AIOD', 2032, 350.00, 'Associate annual subscription'),
    ('AIOD', 2033, 350.00, 'Associate annual subscription'),
    ('AIOD', 2034, 350.00, 'Associate annual subscription'),
    ('AIOD', 2035, 350.00, 'Associate annual subscription'),
    ('FIOD', 2025, 500.00, 'Fellow annual subscription'),
    ('FIOD', 2026, 500.00, 'Fellow annual subscription'),
    ('FIOD', 2027, 500.00, 'Fellow annual subscription'),
    ('FIOD', 2028, 500.00, 'Fellow annual subscription'),
    ('FIOD', 2029, 500.00, 'Fellow annual subscription'),
    ('FIOD', 2030, 500.00, 'Fellow annual subscription'),
    ('FIOD', 2031, 500.00, 'Fellow annual subscription'),
    ('FIOD', 2032, 500.00, 'Fellow annual subscription'),
    ('FIOD', 2033, 500.00, 'Fellow annual subscription'),
    ('FIOD', 2034, 500.00, 'Fellow annual subscription'),
    ('FIOD', 2035, 500.00, 'Fellow annual subscription'),
    ('MIOD', 2025, 400.00, 'Member annual subscription'),
    ('MIOD', 2026, 400.00, 'Member annual subscription'),
    ('MIOD', 2027, 400.00, 'Member annual subscription'),
    ('MIOD', 2028, 400.00, 'Member annual subscription'),
    ('MIOD', 2029, 400.00, 'Member annual subscription'),
    ('MIOD', 2030, 400.00, 'Member annual subscription'),
    ('MIOD', 2031, 400.00, 'Member annual subscription'),
    ('MIOD', 2032, 400.00, 'Member annual subscription'),
    ('MIOD', 2033, 400.00, 'Member annual subscription'),
    ('MIOD', 2034, 400.00, 'Member annual subscription'),
    ('MIOD', 2035, 400.00, 'Member annual subscription'),
    ('Honorary', 2025, 0.00, 'Honorary - waived'),
    ('Honorary', 2026, 0.00, 'Honorary - waived'),
    ('Honorary', 2027, 0.00, 'Honorary - waived'),
    ('Honorary', 2028, 0.00, 'Honorary - waived'),
    ('Honorary', 2029, 0.00, 'Honorary - waived'),
    ('Honorary', 2030, 0.00, 'Honorary - waived'),
    ('Honorary', 2031, 0.00, 'Honorary - waived'),
    ('Honorary', 2032, 0.00, 'Honorary - waived'),
    ('Honorary', 2033, 0.00, 'Honorary - waived'),
    ('Honorary', 2034, 0.00, 'Honorary - waived'),
    ('Honorary', 2035, 0.00, 'Honorary - waived'),
    ('Corporate', 2025, 5000.00, 'Corporate annual subscription'),
    ('Corporate', 2026, 5000.00, 'Corporate annual subscription'),
    ('Corporate', 2027, 5000.00, 'Corporate annual subscription'),
    ('Corporate', 2028, 5000.00, 'Corporate annual subscription'),
    ('Corporate', 2029, 5000.00, 'Corporate annual subscription'),
    ('Corporate', 2030, 5000.00, 'Corporate annual subscription'),
    ('Corporate', 2031, 5000.00, 'Corporate annual subscription'),
    ('Corporate', 2032, 5000.00, 'Corporate annual subscription'),
    ('Corporate', 2033, 5000.00, 'Corporate annual subscription'),
    ('Corporate', 2034, 5000.00, 'Corporate annual subscription'),
    ('Corporate', 2035, 5000.00, 'Corporate annual subscription'),
    -- Corporate member categories
    ('Gold', 2025, 8000.00, 'Gold Corporate subscription'),
    ('Gold', 2026, 8000.00, 'Gold Corporate subscription'),
    ('Gold', 2027, 8000.00, 'Gold Corporate subscription'),
    ('Gold', 2028, 8000.00, 'Gold Corporate subscription'),
    ('Gold', 2029, 8000.00, 'Gold Corporate subscription'),
    ('Gold', 2030, 8000.00, 'Gold Corporate subscription'),
    ('Gold', 2031, 8000.00, 'Gold Corporate subscription'),
    ('Gold', 2032, 8000.00, 'Gold Corporate subscription'),
    ('Gold', 2033, 8000.00, 'Gold Corporate subscription'),
    ('Gold', 2034, 8000.00, 'Gold Corporate subscription'),
    ('Gold', 2035, 8000.00, 'Gold Corporate subscription'),
    ('Silver', 2025, 6000.00, 'Silver Corporate subscription'),
    ('Silver', 2026, 6000.00, 'Silver Corporate subscription'),
    ('Silver', 2027, 6000.00, 'Silver Corporate subscription'),
    ('Silver', 2028, 6000.00, 'Silver Corporate subscription'),
    ('Silver', 2029, 6000.00, 'Silver Corporate subscription'),
    ('Silver', 2030, 6000.00, 'Silver Corporate subscription'),
    ('Silver', 2031, 6000.00, 'Silver Corporate subscription'),
    ('Silver', 2032, 6000.00, 'Silver Corporate subscription'),
    ('Silver', 2033, 6000.00, 'Silver Corporate subscription'),
    ('Silver', 2034, 6000.00, 'Silver Corporate subscription'),
    ('Silver', 2035, 6000.00, 'Silver Corporate subscription'),
    ('Bronze', 2025, 4000.00, 'Bronze Corporate subscription'),
    ('Bronze', 2026, 4000.00, 'Bronze Corporate subscription'),
    ('Bronze', 2027, 4000.00, 'Bronze Corporate subscription'),
    ('Bronze', 2028, 4000.00, 'Bronze Corporate subscription'),
    ('Bronze', 2029, 4000.00, 'Bronze Corporate subscription'),
    ('Bronze', 2030, 4000.00, 'Bronze Corporate subscription'),
    ('Bronze', 2031, 4000.00, 'Bronze Corporate subscription'),
    ('Bronze', 2032, 4000.00, 'Bronze Corporate subscription'),
    ('Bronze', 2033, 4000.00, 'Bronze Corporate subscription'),
    ('Bronze', 2034, 4000.00, 'Bronze Corporate subscription'),
    ('Bronze', 2035, 4000.00, 'Bronze Corporate subscription'),
    ('Standard', 2025, 2000.00, 'Standard Corporate subscription'),
    ('Standard', 2026, 2000.00, 'Standard Corporate subscription'),
    ('Standard', 2027, 2000.00, 'Standard Corporate subscription'),
    ('Standard', 2028, 2000.00, 'Standard Corporate subscription'),
    ('Standard', 2029, 2000.00, 'Standard Corporate subscription'),
    ('Standard', 2030, 2000.00, 'Standard Corporate subscription'),
    ('Standard', 2031, 2000.00, 'Standard Corporate subscription'),
    ('Standard', 2032, 2000.00, 'Standard Corporate subscription'),
    ('Standard', 2033, 2000.00, 'Standard Corporate subscription'),
    ('Standard', 2034, 2000.00, 'Standard Corporate subscription'),
    ('Standard', 2035, 2000.00, 'Standard Corporate subscription')
ON CONFLICT (member_type, subscription_year) DO NOTHING;

-- Function to calculate member payment status for a year considering credit balance
CREATE OR REPLACE FUNCTION get_member_payment_status(
    p_member_id INTEGER,
    p_year INTEGER
)
RETURNS TABLE (
    subscription_year INTEGER,
    expected_amount DECIMAL,
    amount_paid DECIMAL,
    credit_applied DECIMAL,
    credit_balance DECIMAL,
    total_paid DECIMAL,
    status VARCHAR,
    is_fully_paid BOOLEAN
) AS $$
DECLARE
    v_member_type VARCHAR;
    v_expected DECIMAL;
    v_paid DECIMAL;
    v_credit DECIMAL;
    v_prev_credit DECIMAL;
BEGIN
    -- Get member type
    SELECT m.member_type INTO v_member_type FROM members m WHERE m.id = p_member_id;
    
    -- Get expected amount for this member type and year
    SELECT COALESCE(sr.expected_amount, 0) INTO v_expected 
    FROM subscription_rates sr 
    WHERE sr.member_type = v_member_type AND sr.subscription_year = p_year;
    
    -- Get amount paid this year
    SELECT COALESCE(s.amount_paid, 0), COALESCE(s.credit_applied, 0), COALESCE(s.credit_balance, 0)
    INTO v_paid, v_credit, v_prev_credit
    FROM subscriptions s 
    WHERE s.member_id = p_member_id AND s.subscription_year = p_year;
    
    RETURN QUERY SELECT 
        p_year,
        COALESCE(v_expected, 0::DECIMAL),
        COALESCE(v_paid, 0::DECIMAL),
        COALESCE(v_credit, 0::DECIMAL),
        COALESCE(v_prev_credit, 0::DECIMAL),
        COALESCE(v_paid, 0::DECIMAL) + COALESCE(v_credit, 0::DECIMAL),
        CASE 
            WHEN v_member_type = 'Honorary' THEN 'Waived'::VARCHAR
            WHEN COALESCE(v_paid, 0) + COALESCE(v_credit, 0) >= COALESCE(v_expected, 0) THEN 'Paid'::VARCHAR
            WHEN COALESCE(v_paid, 0) + COALESCE(v_credit, 0) > 0 THEN 'Partial'::VARCHAR
            ELSE 'Pending'::VARCHAR
        END,
        (COALESCE(v_paid, 0) + COALESCE(v_credit, 0) >= COALESCE(v_expected, 0));
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- END OF SETUP
-- ============================================================
