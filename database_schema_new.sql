-- ============================================================
-- INSTITUTE OF DIRECTORS - GHANA
-- PostgreSQL Database Schema - UNIFIED VERSION
-- ============================================================

-- Create the database (run as superuser)
-- CREATE DATABASE iod_ghana;
-- \c iod_ghana;

-- ============================================================
-- EXTENSIONS
-- ============================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- ADMIN USERS AND ACTIVITY LOGS
-- ============================================================
CREATE TABLE IF NOT EXISTS admin_users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    role VARCHAR(20) NOT NULL DEFAULT 'admin' CHECK (role IN ('superadmin', 'admin')),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by_admin_id INTEGER REFERENCES admin_users(id) ON DELETE SET NULL,
    last_login_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS admin_activity_logs (
    id SERIAL PRIMARY KEY,
    admin_user_id INTEGER REFERENCES admin_users(id) ON DELETE SET NULL,
    admin_username VARCHAR(100),
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(100),
    entity_id VARCHAR(100),
    description TEXT,
    method VARCHAR(10),
    path TEXT,
    status_code INTEGER,
    ip_address VARCHAR(100),
    user_agent TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_activity_logs_created_at ON admin_activity_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_activity_logs_admin_user_id ON admin_activity_logs(admin_user_id);

-- ============================================================
-- UNIFIED MEMBERS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS members (
    id SERIAL PRIMARY KEY,
    membership_number TEXT UNIQUE NOT NULL,
    member_type VARCHAR(50) NOT NULL CHECK (member_type IN ('AIOD', 'FIOD', 'MIOD', 'Honorary', 'Corporate')),
    title VARCHAR(20),
    first_name VARCHAR(100),
    surname VARCHAR(100),
    last_name VARCHAR(100),  -- For FIOD, MIOD, Honorary
    other_names VARCHAR(100),
    membership_category VARCHAR(50),  -- For Corporate: Gold, Silver, Bronze, Standard
    gender VARCHAR(10) CHECK (gender IN ('Male', 'Female', NULL)),
    organization VARCHAR(255) NOT NULL,
    designation VARCHAR(150),  -- For AIOD
    position VARCHAR(150),     -- For FIOD, MIOD, Honorary
    sector VARCHAR(100),       -- For general categorization
    region VARCHAR(100),       -- For FIOD, MIOD, Honorary
    postal_address TEXT,
    date_of_admission DATE,
    registration_date DATE,    -- For Corporate members
    phone_number VARCHAR(50),
    email TEXT,
    feedback_on_calls TEXT,
    expertise TEXT,
    years_served_on_boards INTEGER DEFAULT 0,
    srl_no INTEGER UNIQUE,     -- For Corporate members
    reg_no VARCHAR(50) UNIQUE, -- For Corporate members
    contact_person VARCHAR(150),  -- For Corporate
    contact_phone VARCHAR(50),    -- For Corporate
    contact_email VARCHAR(150),   -- For Corporate
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- UNIFIED SUBSCRIPTIONS TABLE
CREATE TABLE IF NOT EXISTS subscriptions (
    id SERIAL PRIMARY KEY,
    member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    subscription_year INTEGER NOT NULL,
    status VARCHAR(20) DEFAULT 'Paid' CHECK (status IN ('Paid', 'Pending', 'Partial', 'Waived')),
    payment_date DATE,
    amount_paid DECIMAL(10, 2),
    payment_method VARCHAR(50) CHECK (payment_method IN ('Cash', 'Bank Transfer', 'Mobile Money', 'Cheque', 'Card', 'Not Specified', NULL)),
    receipt_number VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (member_id, subscription_year)
);

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX idx_members_membership_number ON members(membership_number);
CREATE INDEX idx_members_member_type ON members(member_type);
CREATE INDEX idx_members_organization ON members(organization);
CREATE INDEX idx_members_region ON members(region);
CREATE INDEX idx_members_date_of_admission ON members(date_of_admission);
CREATE INDEX idx_subscriptions_member_id ON subscriptions(member_id);
CREATE INDEX idx_subscriptions_year ON subscriptions(subscription_year);
CREATE INDEX idx_subscriptions_status ON subscriptions(status);

-- ============================================================
-- TRIGGER: Auto-update timestamp
-- ============================================================
CREATE OR REPLACE FUNCTION update_modified_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_members_modtime
    BEFORE UPDATE ON members
    FOR EACH ROW
    EXECUTE FUNCTION update_modified_column();

-- ============================================================
-- VIEW: Members in Good Standing
-- ============================================================
CREATE OR REPLACE VIEW members_good_standing AS
SELECT 
    m.id,
    m.membership_number,
    m.member_type,
    m.title,
    COALESCE(m.first_name || ' ' || COALESCE(m.surname, m.last_name), '') AS full_name,
    m.organization,
    m.region,
    m.date_of_admission,
    s.subscription_year
FROM members m
INNER JOIN subscriptions s ON m.id = s.member_id
WHERE (s.status = 'Paid' OR (m.member_type = 'Honorary' AND s.status = 'Waived'))
ORDER BY s.subscription_year DESC, m.organization;

-- ============================================================
-- FUNCTION: Get Members in Good Standing for a Specific Year
-- ============================================================
CREATE OR REPLACE FUNCTION get_good_standing_by_year(target_year INTEGER)
RETURNS TABLE (
    member_id INTEGER,
    membership_number TEXT,
    member_type VARCHAR,
    full_name VARCHAR,
    organization VARCHAR,
    region VARCHAR
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        m.id,
        m.membership_number,
        m.member_type,
        COALESCE(m.first_name || ' ' || COALESCE(m.surname, m.last_name), '') AS full_name,
        m.organization,
        m.region
    FROM members m
    INNER JOIN subscriptions s ON m.id = s.member_id
    WHERE s.subscription_year = target_year 
      AND (s.status = 'Paid' OR (m.member_type = 'Honorary' AND s.status = 'Waived'))
    ORDER BY m.organization;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- FUNCTION: Get Member Statistics
-- ============================================================
CREATE OR REPLACE FUNCTION get_member_statistics()
RETURNS TABLE (
    member_type VARCHAR,
    total_members BIGINT,
    good_standing_current_year BIGINT
) AS $$
DECLARE
    current_yr INTEGER := EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER;
BEGIN
    RETURN QUERY
    SELECT 
        m.member_type,
        COUNT(DISTINCT m.id)::BIGINT,
        (SELECT COUNT(DISTINCT s.member_id)::BIGINT 
         FROM subscriptions s 
         INNER JOIN members m2 ON s.member_id = m2.id
         WHERE s.subscription_year = current_yr 
           AND (s.status = 'Paid' OR (m2.member_type = 'Honorary' AND s.status = 'Waived'))
           AND m2.member_type = m.member_type)::BIGINT
    FROM members m
    GROUP BY m.member_type
    ORDER BY m.member_type;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- SAMPLE DATA (Optional - for testing)
-- ============================================================

-- Insert AIOD members
INSERT INTO members (membership_number, member_type, title, first_name, surname, gender, organization, designation, date_of_admission, phone_number, email, years_served_on_boards)
VALUES 
    ('AIOD-2024-001', 'AIOD', 'Mr.', 'Kwame', 'Asante', 'Male', 'Ghana Commercial Bank', 'Senior Manager', '2020-03-15', '+233 24 123 4567', 'k.asante@gcb.com.gh', 5),
    ('AIOD-2024-002', 'AIOD', 'Mrs.', 'Ama', 'Mensah', 'Female', 'MTN Ghana', 'Director of Operations', '2019-07-22', '+233 20 987 6543', 'a.mensah@mtn.com.gh', 8),
    ('AIOD-2024-003', 'AIOD', 'Dr.', 'Emmanuel', 'Osei', 'Male', 'University of Ghana', 'Dean, Business School', '2018-01-10', '+233 27 555 1234', 'e.osei@ug.edu.gh', 12)
ON CONFLICT DO NOTHING;

-- Insert FIOD members
INSERT INTO members (membership_number, member_type, title, first_name, last_name, gender, organization, position, region, postal_address, date_of_admission, phone_number, email, years_served_on_boards)
VALUES 
    ('FIOD-2024-001', 'FIOD', 'Prof.', 'Akosua', 'Darkwa', 'Female', 'Stanbic Bank Ghana', 'Board Chairperson', 'Greater Accra', 'P.O. Box CT 2344, Cantonments, Accra', '2019-05-20', '+233 24 888 7777', 'a.darkwa@stanbic.com.gh', 15),
    ('FIOD-2024-002', 'FIOD', 'Mr.', 'Kojo', 'Ampah', 'Male', 'Golden Star Resources', 'Chief Executive Officer', 'Ashanti', 'P.O. Box 5234, Kumasi', '2020-02-14', '+233 55 123 4567', 'k.ampah@goldenstar.com', 10)
ON CONFLICT DO NOTHING;

-- Insert MIOD members
INSERT INTO members (membership_number, member_type, title, first_name, last_name, gender, organization, position, region, postal_address, date_of_admission, phone_number, email, years_served_on_boards)
VALUES 
    ('MIOD-2024-001', 'MIOD', 'Mrs.', 'Adjoa', 'Boateng', 'Female', 'Vodafone Ghana', 'Marketing Director', 'Greater Accra', 'P.O. Box 1234, Accra', '2021-08-30', '+233 20 111 2222', 'a.boateng@vodafone.com.gh', 3),
    ('MIOD-2024-002', 'MIOD', 'Mr.', 'Yaw', 'Danso', 'Male', 'Ecobank Ghana', 'Branch Manager', 'Ashanti', 'P.O. Box 789, Kumasi', '2022-04-12', '+233 24 333 4444', 'y.danso@ecobank.com', 2)
ON CONFLICT DO NOTHING;

-- Insert Honorary members
INSERT INTO members (membership_number, member_type, title, first_name, last_name, gender, organization, position, region, postal_address, date_of_admission, phone_number, email, years_served_on_boards)
VALUES 
    ('HON-2024-001', 'Honorary', 'Nana', 'Otuo', 'Serebour', 'Male', 'Manhyia Palace', 'Royal Dignitary', 'Ashanti', 'Manhyia Palace, Kumasi', '2019-12-01', '+233 20 000 0001', 'contact@manhyia.org', 25),
    ('HON-2024-002', 'Honorary', 'Dr.', 'Ishmael', 'Yamson', 'Male', 'Unilever Ghana', 'Former Chairman', 'Greater Accra', 'P.O. Box 721, Accra', '2020-06-15', '+233 24 777 8888', 'i.yamson@business.com', 30)
ON CONFLICT DO NOTHING;

-- Insert Corporate members
INSERT INTO members (membership_number, member_type, srl_no, reg_no, organization, membership_category, postal_address, registration_date)
VALUES 
    ('CORP-001', 'Corporate', 1, 'CORP-001', 'Ghana Commercial Bank Ltd', 'Gold', 'Thorpe Road, High Street, Accra', '2015-01-15'),
    ('CORP-002', 'Corporate', 2, 'CORP-002', 'MTN Ghana Limited', 'Gold', 'Independence Avenue, Accra', '2016-03-20'),
    ('CORP-003', 'Corporate', 3, 'CORP-003', 'Vodafone Ghana', 'Silver', 'Ring Road Central, Accra', '2017-07-10'),
    ('CORP-004', 'Corporate', 4, 'CORP-004', 'Tullow Ghana Limited', 'Gold', 'Airport City, Accra', '2015-06-25'),
    ('CORP-005', 'Corporate', 5, 'CORP-005', 'Newmont Ghana Gold Ltd', 'Silver', 'Ahafo Region, Ghana', '2018-02-14')
ON CONFLICT DO NOTHING;

-- Insert subscriptions for AIOD members (GHS 350 annual fee)
INSERT INTO subscriptions (member_id, subscription_year, status, amount_paid, payment_date)
SELECT m.id, year_val, 'Paid', 350.00, ('2024-01-15'::DATE + (year_val - 2024) * INTERVAL '1 year')::DATE
FROM members m, (VALUES (2024), (2025), (2026), (2027), (2028), (2029), (2030), (2031), (2032), (2033), (2034)) AS years(year_val)
WHERE m.membership_number = 'AIOD-2024-001'
ON CONFLICT DO NOTHING;

INSERT INTO subscriptions (member_id, subscription_year, status, amount_paid, payment_date)
SELECT m.id, year_val, 'Paid', 350.00, ('2024-02-20'::DATE + (year_val - 2024) * INTERVAL '1 year')::DATE
FROM members m, (VALUES (2024), (2025), (2026), (2027), (2028), (2029), (2030), (2031), (2032), (2033), (2034)) AS years(year_val)
WHERE m.membership_number = 'AIOD-2024-002'
ON CONFLICT DO NOTHING;

INSERT INTO subscriptions (member_id, subscription_year, status, amount_paid, payment_date)
SELECT m.id, year_val, 'Paid', 350.00, ('2024-03-10'::DATE + (year_val - 2024) * INTERVAL '1 year')::DATE
FROM members m, (VALUES (2024), (2025), (2026), (2027), (2028), (2029), (2030), (2031), (2032), (2033), (2034)) AS years(year_val)
WHERE m.membership_number = 'AIOD-2024-003'
ON CONFLICT DO NOTHING;

-- Insert subscriptions for FIOD members (GHS 500 annual fee)
INSERT INTO subscriptions (member_id, subscription_year, status, amount_paid, payment_date)
SELECT m.id, year_val, 'Paid', 500.00, ('2024-01-20'::DATE + (year_val - 2024) * INTERVAL '1 year')::DATE
FROM members m, (VALUES (2024), (2025), (2026), (2027), (2028), (2029), (2030), (2031), (2032), (2033), (2034)) AS years(year_val)
WHERE m.membership_number = 'FIOD-2024-001'
ON CONFLICT DO NOTHING;

INSERT INTO subscriptions (member_id, subscription_year, status, amount_paid, payment_date)
SELECT m.id, year_val, 'Paid', 500.00, ('2024-02-15'::DATE + (year_val - 2024) * INTERVAL '1 year')::DATE
FROM members m, (VALUES (2024), (2025), (2026), (2027), (2028), (2029), (2030), (2031), (2032), (2033), (2034)) AS years(year_val)
WHERE m.membership_number = 'FIOD-2024-002'
ON CONFLICT DO NOTHING;

-- Insert subscriptions for MIOD members (GHS 400 annual fee)
INSERT INTO subscriptions (member_id, subscription_year, status, amount_paid, payment_date)
SELECT m.id, year_val, 'Paid', 400.00, ('2024-01-25'::DATE + (year_val - 2024) * INTERVAL '1 year')::DATE
FROM members m, (VALUES (2024), (2025), (2026), (2027), (2028), (2029), (2030), (2031), (2032), (2033), (2034)) AS years(year_val)
WHERE m.membership_number = 'MIOD-2024-001'
ON CONFLICT DO NOTHING;

INSERT INTO subscriptions (member_id, subscription_year, status, amount_paid, payment_date)
SELECT m.id, year_val, 'Paid', 400.00, ('2024-03-05'::DATE + (year_val - 2024) * INTERVAL '1 year')::DATE
FROM members m, (VALUES (2024), (2025), (2026), (2027), (2028), (2029), (2030), (2031), (2032), (2033), (2034)) AS years(year_val)
WHERE m.membership_number = 'MIOD-2024-002'
ON CONFLICT DO NOTHING;

-- Insert subscriptions for Honorary members (waived - no fee)
INSERT INTO subscriptions (member_id, subscription_year, status, amount_paid, payment_date)
SELECT m.id, year_val, 'Waived', 0.00, ('2024-01-01'::DATE + (year_val - 2024) * INTERVAL '1 year')::DATE
FROM members m, (VALUES (2024), (2025), (2026), (2027), (2028), (2029), (2030), (2031), (2032), (2033), (2034)) AS years(year_val)
WHERE m.membership_number = 'HON-2024-001'
ON CONFLICT DO NOTHING;

INSERT INTO subscriptions (member_id, subscription_year, status)
SELECT m.id, year_val, 'Waived'
FROM members m, (VALUES (2024), (2025), (2026), (2027), (2028), (2029), (2030), (2031), (2032), (2033), (2034)) AS years(year_val)
WHERE m.membership_number = 'HON-2024-002'
ON CONFLICT DO NOTHING;

-- Insert subscriptions for Corporate members
INSERT INTO subscriptions (member_id, subscription_year, status)
SELECT m.id, year_val, 'Paid'
FROM members m, (VALUES (2024), (2025), (2026), (2027), (2028), (2029), (2030), (2031), (2032), (2033), (2034)) AS years(year_val)
WHERE m.membership_number = 'CORP-001'
ON CONFLICT DO NOTHING;

INSERT INTO subscriptions (member_id, subscription_year, status)
SELECT m.id, year_val, 'Paid'
FROM members m, (VALUES (2024), (2025), (2026), (2027), (2028), (2029), (2030), (2031), (2032), (2033), (2034)) AS years(year_val)
WHERE m.membership_number = 'CORP-002'
ON CONFLICT DO NOTHING;

INSERT INTO subscriptions (member_id, subscription_year, status)
SELECT m.id, year_val, CASE WHEN year_val = 2020 THEN 'Pending' ELSE 'Paid' END
FROM members m, (VALUES (2017), (2018), (2019), (2020), (2021), (2022), (2023), (2024)) AS years(year_val)
WHERE m.membership_number = 'CORP-003'
ON CONFLICT DO NOTHING;

INSERT INTO subscriptions (member_id, subscription_year, status)
SELECT m.id, year_val, 'Paid'
FROM members m, (VALUES (2015), (2016), (2017), (2018), (2019), (2020), (2021), (2022), (2023), (2024)) AS years(year_val)
WHERE m.membership_number = 'CORP-004'
ON CONFLICT DO NOTHING;

INSERT INTO subscriptions (member_id, subscription_year, status)
SELECT m.id, year_val, CASE WHEN year_val = 2023 THEN 'Pending' ELSE 'Paid' END
FROM members m, (VALUES (2018), (2019), (2020), (2021), (2022), (2023), (2024)) AS years(year_val)
WHERE m.membership_number = 'CORP-005'
ON CONFLICT DO NOTHING;

-- ============================================================
-- END OF SCHEMA
-- ============================================================
